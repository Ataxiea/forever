// Canonical printing (SPEC.md §12): settings JSON as SIML text, for every file kind. Each node takes the
// shortest form that reads back to it, the generic call when no shorter one fits, and raw JSON when no form does;
// every printed statement is then checked by reading the whole text back.

import { declaredBy, declaredIn, resolveVariable } from './check.ts';
import { identifier } from './identifier.ts';
import { equalJson, isObject, LONE_SURROGATE, normalize, valueAt } from './json.ts';
import { classOf, fieldNamespace, type Names, readsBack, unitFieldOf, unitReference } from './names.ts';
import { inFileOrder, rotationPath, TYPE_APL, TYPE_SIMPLE } from './rotation.ts';
import {
	type KindForm,
	OTHER_ENUM,
	type Placed,
	PLAYER_MESSAGE,
	type SchemaField,
	type SchemaIndex,
	type SectionDef,
	sectionFields,
	SETTINGS_MESSAGE,
	SLOT_ENUM,
	type SpecDef,
	specPath,
	STAT_ENUM,
} from './schema.ts';
import { readFile, simplePaths, slotField, type TypedFile } from './setup.ts';
import { fileSections, STOP_WORDS, TOP_WORDS } from './syntax.ts';
import type { JsonObject, JsonPath, JsonValue, SimlDoc, SimlKind, SpellNamespace, Statement } from './types.ts';
import { isList } from './typing.ts';

// Printed text, in the pieces it is put together from.
export type Text = string[];

// A printed statement: `parts` joined by spaces, or, past the width, the first part followed by each other
// part on a continuation line (SPEC.md §12.3).
export interface Stmt {
	indent: number;
	notes: string[]; // Its `///` lines.
	parts: Text[];
	trailing?: string; // A comment after its last line.
	role?: 'row' | 'var' | 'entry' | 'slot' | 'use'; // A statement that is read back and checked.
	// What it must read back as, the JSON it was printed from, and the statement written instead when it does not.
	expect?: { json: JsonValue; fallback: () => Stmt };
}

// A line of text, a blank line, or a statement. A header line that `join`s takes its section's one statement
// onto it when that is one line and the two fit in the width.
export type Item = Stmt | { blank: true } | { line: string; join?: boolean };

// A field's values as a section's entry lines write them: one value, a list's values, or one message of a list.
export interface Write {
	placed: Placed;
	values: Array<JsonValue | undefined>; // Undefined writes the field's default.
	paths: JsonPath[]; // Each value's path in the settings.
}

const WIDTH = 100;
export const INDENT = 2;
const CONTINUATION = 4;
const SLOT_WIDTH = 11; // A slot row's slot word, padded.
const PREC = { top: 0, or: 1, and: 2, not: 3, cmp: 4, add: 5, mul: 6, operand: 7 };
const LITERAL = /^-?[0-9]+(\.[0-9]+)?(%|(ns|us|µs|ms|s|m|h)([0-9]+(\.[0-9]+)?(ns|us|µs|ms|s|m|h))*)?$/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BRACED = /^[^}\n\r]*$/;
const CMP_TEXT: Record<string, string> = { OpEq: '==', OpNe: '!=', OpGe: '>=', OpGt: '>', OpLe: '<=', OpLt: '<' };
const MATH_TEXT: Record<string, string> = { OpAdd: '+', OpSub: '-', OpMul: '*', OpDiv: '/' };
const MATH_PREC: Record<string, number> = { OpAdd: PREC.add, OpSub: PREC.add, OpMul: PREC.mul, OpDiv: PREC.mul };
// Words that never read as the name of a kind: the stop words, and `true`, `false` and `none`.
const NOT_NAMES = new Set([...STOP_WORDS, 'true', 'false', 'none']);
// Stop words that are calls when `(` follows directly (SPEC.md §4 note 8).
const CALL_WORDS = new Set(['and', 'or', 'not']);
// Action kinds named by an action keyword, which no call can write (SPEC.md §4 note 7).
const KEYWORD_ACTIONS = new Set(['wait', 'move']);

// JSON in backticks: compact, keys in the order given, and a backtick, which can only sit in a JSON string,
// escaped.
const raw = (v: JsonValue): string => `\`${JSON.stringify(v).replace(/`/g, '\\u0060')}\``;

// A number as SIML writes it: the shortest decimal that reads back to it, never with an exponent.
function numberText(n: number): string {
	const s = String(n);
	const m = /^(-?)([0-9]+)(?:\.([0-9]+))?e([+-][0-9]+)$/.exec(s);
	if (!m) return s;
	const [, sign, int, frac = '', exp] = m;
	const digits = int + frac;
	const point = int.length + Number(exp);
	if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`;
	if (point >= digits.length) return sign + digits + '0'.repeat(point - digits.length);
	return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
}

const word = (text: string): Text => [text];
const join = (texts: Text[], sep: string): Text => texts.flatMap((t, i) => (i ? [sep, ...t] : t));
const wrap = (t: Text, needed: boolean): Text => (needed ? ['(', ...t, ')'] : t);

// Whether notes can be written as `///` lines: no carriage return, tab or other control character but the
// line feed, and no line ending in a space.
const printableNotes = (notes: string) => !/[\x00-\x09\x0b-\x1f\x7f]/.test(notes) && !/ (\n|$)/.test(notes);

export class Printer {
	private readonly index: SchemaIndex;
	private readonly names: Names;
	private readonly cls: string | undefined;
	private readonly declarations: ReadonlyArray<{ name: string; scope: string | undefined }>;

	// Names are the table's for the class `cls` (SPEC.md §7.4). `declarations` are the variables the rotation
	// declares, which decide how a reference is written.
	constructor(index: SchemaIndex, names: Names, cls: string | undefined, declarations: ReadonlyArray<{ name: string; scope: string | undefined }>) {
		this.index = index;
		this.names = names;
		this.cls = cls;
		this.declarations = declarations;
	}

	private get V() {
		return this.index.vocabulary;
	}

	// --- Values (SPEC.md §6.5, §8.3)

	value(v: JsonValue | undefined, prec: number, scope: string | undefined): Text {
		if (!isObject(v)) return word(raw(v ?? null));
		const keys = Object.keys(v);
		if (!keys.length) return word('none');
		const kind = keys.length === 1 ? this.index.valueKindsByJson.get(keys[0]) : undefined;
		const body = kind ? v[kind.json] : undefined;
		if (!kind || !isObject(body) || !this.known(kind.message, body)) return word(raw(v));
		return this.shortValue(kind, body, prec, scope) ?? this.call(kind, body, scope, false) ?? word(raw(v));
	}

	// The operator and operands of a value written as a run of two or more `and` or `or` operands.
	infix(v: JsonValue | undefined, scope: string | undefined): { op: 'and' | 'or'; operands: Text[] } | undefined {
		if (!isObject(v) || Object.keys(v).length !== 1) return undefined;
		const op = this.V.and.json in v ? 'and' : this.V.or.json in v ? 'or' : undefined;
		if (!op) return undefined;
		const F = this.V[op];
		const body = v[F.json];
		const vals = isObject(body) && Object.keys(body).every(k => k === F.f.vals) ? body[F.f.vals] : undefined;
		if (!Array.isArray(vals) || vals.length < 2) return undefined;
		return { op, operands: vals.map(x => this.value(x, PREC[op] + 1, scope)) };
	}

	private shortValue(kind: KindForm, body: JsonObject, prec: number, scope: string | undefined): Text | undefined {
		const V = this.V;
		const only = (...names: string[]) => Object.keys(body).every(k => names.includes(k));
		switch (kind.json) {
			case V.const.json: {
				const val = body[V.const.f.val] ?? '';
				if (typeof val !== 'string' || !only(V.const.f.val)) return undefined;
				return word(LITERAL.test(val) || val === 'true' || val === 'false' ? val : JSON.stringify(val));
			}
			case V.variableRef.json: {
				const name = body[V.variableRef.f.name] ?? '';
				return typeof name === 'string' && only(V.variableRef.f.name) ? this.variableRef(name, scope) : undefined;
			}
			case V.variablePlaceholder.json: {
				const name = body[V.variablePlaceholder.f.name] ?? '';
				return typeof name === 'string' && only(V.variablePlaceholder.f.name) ? placeholder(name) : undefined;
			}
			case V.and.json:
			case V.or.json: {
				const infix = this.infix({ [kind.json]: body }, scope);
				return infix && wrap(join(infix.operands, ` ${infix.op} `), prec > PREC[infix.op]);
			}
			case V.not.json:
				if (!(V.not.f.val in body) || !only(V.not.f.val)) return undefined;
				return wrap(['not ', ...this.value(body[V.not.f.val], PREC.not, scope)], prec > PREC.not);
			case V.cmp.json:
			case V.math.json: {
				const F = kind.json === V.cmp.json ? V.cmp : V.math;
				const op = body[F.f.op];
				const text = typeof op === 'string' ? (F === V.cmp ? CMP_TEXT : MATH_TEXT)[op] : undefined;
				if (!text || !(F.f.lhs in body) || !(F.f.rhs in body) || !only(F.f.op, F.f.lhs, F.f.rhs)) return undefined;
				const p = F === V.cmp ? PREC.cmp : MATH_PREC[op as string];
				const lhs = this.value(body[F.f.lhs], F === V.cmp ? PREC.add : p, scope);
				const rhs = this.value(body[F.f.rhs], F === V.cmp ? PREC.add : p + 1, scope);
				return wrap([...lhs, ` ${text} `, ...rhs], prec > p);
			}
		}
		if (kind.form === 'accessor') return this.accessor(kind, body, scope);
		if (kind.form === 'unit_prefix' && kind.unitField && only(this.index.protoField(kind.message, kind.unitField)!.json)) {
			const unit = this.unitWord(body[this.index.protoField(kind.message, kind.unitField)!.json]);
			return unit ? word(`${unit}.${kind.kind}`) : undefined;
		}
		return undefined;
	}

	// `$x` when §7.5 reads it back as `name` in this scope, else `${name}`.
	private variableRef(name: string, scope: string | undefined): Text | undefined {
		const declared = declaredIn(this.declarations, scope);
		const readsBack = (written: string) => {
			const r = resolveVariable(written, false, declared);
			return 'name' in r ? r.name === name : 'undefined' in r && written === name;
		};
		if (IDENT.test(name) && readsBack(name)) return word(`$${name}`);
		const folded = identifier(name);
		if (IDENT.test(folded) && readsBack(folded)) return word(`$${folded}`);
		return BRACED.test(name) ? word(`\${${name}}`) : undefined;
	}

	// `[u.]head(subject).prop[(f=v, …)]`, when the subject is set and the unit, if set, is a unit word.
	private accessor(kind: KindForm, body: JsonObject, scope: string | undefined): Text | undefined {
		const acc = kind.accessor!;
		const subject = this.index.protoField(kind.message, acc.subject)!;
		const unitField = acc.unit ? this.index.protoField(kind.message, acc.unit) : undefined;
		if (!(subject.json in body)) return undefined;
		const ns = fieldNamespace(this.index, kind, subject, unitField && body[unitField.json]);
		let prefix = '';
		if (unitField && unitField.json in body) {
			const unit = this.unitWord(body[unitField.json]);
			if (!unit) return undefined;
			prefix = `${unit}.`;
		}
		const rest = this.index.fields(kind.message).filter(f => f !== subject && f !== unitField && f.json in body);
		const args = rest.map(f => [`${f.siml}=`, ...this.field(f, body[f.json], scope)]);
		return [
			`${prefix}${acc.head}(`,
			...this.field(subject, body[subject.json], scope, ns),
			`).${acc.prop}`,
			...(args.length ? ['(', ...join(args, ', '), ')'] : []),
		];
	}

	// A kind as a call (SPEC.md §8.3 rules 3, 5 and 6): bare when no field is set, else the positional value
	// or the list's items unnamed and every other field named; undefined when no call can write its name.
	private call(kind: KindForm, body: JsonObject, scope: string | undefined, action: boolean): Text | undefined {
		const bare = !NOT_NAMES.has(kind.kind) && !(action && KEYWORD_ACTIONS.has(kind.kind));
		if (!bare && !CALL_WORDS.has(kind.kind)) return undefined;
		const all = this.index.fields(kind.message);
		const set = all.filter(f => f.json in body);
		if (!set.length) return word(bare ? kind.kind : `${kind.kind}()`);
		const list = kind.listField ? this.index.protoField(kind.message, kind.listField) : undefined;
		const positional = !list && kind.positional ? this.index.protoField(kind.message, kind.positional) : undefined;
		const bools = new Set(all.filter(f => f.printed === 'bool').map(f => f.siml));
		const unitField = unitFieldOf(this.index, kind);
		const ns = (f: SchemaField) => fieldNamespace(this.index, kind, f, unitField && body[unitField.json]);
		const args: Text[] = [];
		const listValue = list ? body[list.json] : undefined;
		if (list && Array.isArray(listValue)) args.push(...listValue.map(x => this.single(list, x, scope, ns(list))));
		if (positional && positional.json in body) {
			const text = this.field(positional, body[positional.json], scope, ns(positional));
			const readsAsFlag = text.length === 1 && typeof text[0] === 'string' && bools.has(text[0]);
			args.push(readsAsFlag ? [`${positional.siml}=`, ...text] : text);
		}
		for (const f of set) {
			if ((f !== list || !Array.isArray(listValue)) && f !== positional) args.push([`${f.siml}=`, ...this.field(f, body[f.json], scope, ns(f))]);
		}
		return [`${kind.kind}(`, ...join(args, ', '), ')'];
	}

	// Whether every key of `body` is a field of `message`.
	private known(message: string, body: JsonObject): boolean {
		const fields = this.index.fields(message);
		return Object.keys(body).every(k => fields.some(f => f.json === k));
	}

	// --- Fields (SPEC.md §5.2, §8.3)

	// A field's value; `ns` is the namespace an ActionID field reads.
	field(f: SchemaField, value: JsonValue | undefined, scope: string | undefined, ns: SpellNamespace = 'spell'): Text {
		if (!isList(f)) return this.single(f, value, scope, ns);
		if (!Array.isArray(value)) return word(raw(value ?? null));
		return [
			'[',
			...join(
				value.map(x => this.single(f, x, scope, ns)),
				', ',
			),
			']',
		];
	}

	// One value of `f`: an element of a repeated field.
	single(f: SchemaField, value: JsonValue | undefined, scope: string | undefined, ns: SpellNamespace = 'spell'): Text {
		if (value === undefined) return word(this.zero(f));
		const v = value;
		switch (f.printed) {
			case 'value':
				return this.value(v, PREC.top, scope);
			case 'action':
				return this.inlineAction(v, scope);
			case 'action_id':
				return this.ref(v, ns);
			case 'unit':
				return word(this.unitText(v));
			case 'bool':
				return word(typeof v === 'boolean' ? String(v) : raw(v));
			case 'number':
				if (typeof v === 'number') return word(numberText(v));
				return word(typeof v === 'string' && /^-?[0-9]+$/.test(v) ? v : raw(v));
			case 'string':
				return word(typeof v === 'string' ? JSON.stringify(v) : raw(v));
			case 'enum':
			case 'flag_enum': {
				const e = typeof v === 'string' ? this.index.enumValue(f.type!, v) : undefined;
				return word(e && e.name === v ? e.short : raw(v));
			}
			case 'stat':
				return word(typeof v === 'number' ? (this.index.enumNumber(STAT_ENUM, v)?.short ?? String(v)) : raw(v));
			case 'ref':
				return word((typeof v === 'number' ? this.idName(f.ref!, v) : undefined) ?? raw(v));
			case 'message':
				return word(isObject(v) && !Object.keys(v).length ? 'none' : raw(v));
			default:
				return word(raw(v));
		}
	}

	// A field's default value, which protojson leaves out.
	private zero(f: SchemaField): string {
		switch (f.printed) {
			case 'bool':
				return 'false';
			case 'number':
				return '0';
			case 'string':
				return '""';
			case 'enum':
			case 'flag_enum':
				return this.index.enumNumber(f.type!, 0)?.short ?? '0';
			case 'stat':
				return this.index.enumNumber(STAT_ENUM, 0)?.short ?? '0';
			default:
				return 'none';
		}
	}

	// The name of an item, enchant or suffix id (SPEC.md §7.4); an enchant's as it prints on an item in `slot`.
	private idName(ns: 'item' | 'enchant' | 'suffix', id: number, slot = ''): string | undefined {
		return ns === 'item' ? this.names.itemName(id) : ns === 'suffix' ? this.names.suffixName(id) : this.names.enchantName(id, slot);
	}

	// An ActionID (SPEC.md §7.4): the name of its spell id and tag in `ns`, whatever its rank; `item.` and the name of
	// an item id with no tag or rank; `other.<short>`; `none`; or raw JSON when it has no name.
	private ref(v: JsonValue, ns: SpellNamespace): Text {
		const A = this.V.actionId.f;
		if (!isObject(v)) return word(raw(v));
		const keys = Object.keys(v);
		if (!keys.length) return word('none');
		const other = v[A.other_id];
		const value = keys.length === 1 && typeof other === 'string' ? this.index.enumValue(OTHER_ENUM, other) : undefined;
		if (value && value.name === other) return word(`other.${value.short}`);
		const spell = v[A.spell_id];
		const item = v[A.item_id];
		const tag = v[A.tag] ?? 0;
		let name: string | undefined;
		if (typeof spell === 'number' && typeof tag === 'number' && keys.every(k => k === A.spell_id || k === A.tag || k === A.rank)) {
			name = this.names.spellName(this.cls, ns, spell, tag);
		} else if (typeof item === 'number' && keys.length === 1) {
			const itemName = this.names.itemName(item);
			name = itemName && `item.${itemName}`;
		}
		return word(name ?? raw(v));
	}

	private unitText(v: JsonValue): string {
		if (isObject(v) && !Object.keys(v).length) return 'none';
		return this.unitWord(v) ?? raw(v);
	}

	// The unit word that writes `v` (SPEC.md §6.6), if one does: the word that reads back as `v`.
	private unitWord(v: JsonValue | undefined): string | undefined {
		if (!isObject(v) || !Object.keys(v).length) return undefined;
		for (const w of this.index.unitWords.keys()) if (equalJson(unitReference(this.index, w), v)) return w;
		const prefix = [...this.index.unitPrefixes].find(([, type]) => type === v[this.V.unit.f.type])?.[0];
		const index = v[this.V.unit.f.index] ?? 0;
		if (!prefix || typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined;
		const word = `${prefix}${index + 1}`;
		return equalJson(unitReference(this.index, word), v) ? word : undefined;
	}

	// --- Setup sections (SPEC.md §5.2, §5.3, §12.2)

	// The entry lines of a section's writes: each run of flags as flag lists packed into lines of at most 100
	// columns, and every other field, or message of a list, on a line of its own.
	entries(writes: Write[], indent: number): Stmt[] {
		const out: Stmt[] = [];
		let run: Array<{ write: Write; text: string }> = [];
		const flush = () => {
			const lines: Array<typeof run> = [];
			for (const flag of run) {
				const line = lines.at(-1);
				if (line && indent + [...line, flag].map(x => x.text).join(', ').length <= WIDTH) line.push(flag);
				else lines.push([flag]);
			}
			for (const line of lines)
				out.push(
					this.entryStmt(
						line.map(x => x.write),
						[[line.map(x => x.text).join(', ')]],
						indent,
					),
				);
			run = [];
		};
		for (const w of writes) {
			const flag = w.values.length === 1 ? this.flag(w.placed.field, w.values[0]) : undefined;
			if (flag !== undefined) run.push({ write: w, text: flag });
			else {
				flush();
				out.push(this.entryStmt([w], this.entryParts(w), indent));
			}
		}
		flush();
		return out;
	}

	// A field's value as a flag, or undefined when it is none: a true bool by its name, a flag-value enum by its
	// name at its flag value and as `name=value` at another.
	private flag(f: SchemaField, v: JsonValue | undefined): string | undefined {
		if (isList(f) || TOP_WORDS.has(f.siml)) return undefined;
		if (f.printed === 'bool' && v === true) return f.siml;
		const e = f.printed === 'flag_enum' && typeof v === 'string' ? this.index.enumValue(f.type!, v) : undefined;
		if (!e || e.name !== v) return undefined;
		return v === this.index.schema.enums[f.type!]?.flag ? f.siml : `${f.siml}=${e.short}`;
	}

	// One write's entry line: `field value`; `field a, b` for a list, broken after each comma past the width;
	// `field(…)` for a message, broken after each argument's comma; and `field=value` for a field named like a
	// top-level line, which `field value` would read as.
	private entryParts({ placed: { field: f }, values }: Write): Text[] {
		if (TOP_WORDS.has(f.siml)) return [[`${f.siml}=`, ...this.field(f, isList(f) ? (values as JsonValue[]) : values[0], undefined)]];
		if (f.printed === 'message' && isObject(values[0])) return this.messageParts(f, values[0]);
		if (f.printed === 'indexed') return [this.indexed(f, values[0])];
		const texts = values.map(v => this.single(f, v, undefined));
		return texts.map((t, i) => [...(i ? [] : [`${f.siml} `]), ...t, ...(i < texts.length - 1 ? [','] : [])]);
	}

	// An entry line, which must read back as its writes, else is written as a raw entry of the fields they set.
	private entryStmt(writes: Write[], parts: Text[], indent: number): Stmt {
		const json = writes.flatMap(w => w.values.map((v, i) => [w.paths[i], v ?? null]));
		const fallback = (): Stmt => {
			const fields: JsonObject = {};
			for (const { placed, values } of writes) fields[placed.field.json] = isList(placed.field) ? (values as JsonValue[]) : (values[0] ?? null);
			return { indent, notes: [], parts: [word(raw(fields))], role: 'entry' };
		};
		return { indent, notes: [], parts, role: 'entry', expect: { json, fallback } };
	}

	// `field(arg, …)`, each argument a part of its own so that a long one breaks after each comma.
	private messageParts(f: SchemaField, v: JsonObject): Text[] {
		const args = this.messageArgs(f.type!, v);
		if (args.length < 2) return [[`${f.siml}(`, ...(args[0] ?? []), ')']];
		return args.map((a, i) => [...(i ? [] : [`${f.siml}(`]), ...a, i < args.length - 1 ? ',' : ')']);
	}

	// The fields of a message as arguments: a true bool, or a flag-value enum at its flag value, by its name
	// alone; a message as `field(…)`; each message of a list as a `field(…)` of its own; every other field named.
	private messageArgs(message: string, v: JsonObject): Text[] {
		const out: Text[] = [];
		for (const f of this.index.fields(message)) {
			const x = v[f.json];
			if (x === undefined) continue;
			const flag = this.flag(f, x);
			if (flag !== undefined) out.push(word(flag));
			else if (f.printed === 'message' && isList(f) && Array.isArray(x) && x.every(isObject)) out.push(...x.map(m => this.messageText(f, m)));
			else if (f.printed === 'message' && !isList(f) && isObject(x)) out.push(this.messageText(f, x));
			else if (f.printed === 'indexed') out.push(this.indexed(f, x));
			else out.push([`${f.siml}=`, ...this.field(f, x, undefined)]);
		}
		return out;
	}

	private messageText(f: SchemaField, v: JsonObject): Text {
		return [`${f.siml}(`, ...join(this.messageArgs(f.type!, v), ', '), ')'];
	}

	// `field(<short name>=<number>, …)` for an array indexed by an enum, its non-zero entries in index order, or
	// `field=` raw JSON when an entry has no name or is no number.
	private indexed(f: SchemaField, v: JsonValue | undefined): Text {
		const entries = Array.isArray(v) ? v.map((n, i) => ({ n, e: this.index.enumNumber(f.index!, i) })).filter(x => x.n !== 0) : undefined;
		if (!entries || entries.some(x => typeof x.n !== 'number' || !x.e)) return [`${f.siml}=`, raw(v ?? null)];
		return [
			`${f.siml}(`,
			...join(
				entries.map(x => [`${x.e!.short}=${numberText(x.n as number)}`]),
				', ',
			),
			')',
		];
	}

	// `<slot> <item> [<suffix>] [+ <enchant>]` by their names, or the slot and the raw ItemSpec when a part has no name
	// (SPEC.md §5.3, §7.4). `enchant` is the name the enchant is written with, which it keeps while it means the effect.
	slotRow(slot: string, item: JsonObject, path: JsonPath, indent: number, enchant?: string): Stmt {
		const I = this.V.itemSpec.f;
		const pad = `${slot.padEnd(SLOT_WIDTH - 1)} `;
		const fallback = (): Stmt => ({ indent, notes: [], parts: [[pad, raw(item)]], role: 'slot' });
		const expect = { json: [[path, item]], fallback };
		const parts: Array<[string, string, 'item' | 'suffix' | 'enchant']> = [
			[I.id, '', 'item'],
			[I.random_suffix, ' ', 'suffix'],
			[I.enchant, ' + ', 'enchant'],
		];
		if (!(I.id in item) || Object.keys(item).some(k => !parts.some(([key]) => key === k))) return { ...fallback(), expect };
		const text: Text = [pad];
		for (const [key, before, ns] of parts) {
			const id = item[key];
			if (id === undefined) continue;
			const kept = ns === 'enchant' && enchant !== undefined && this.names.enchant(enchant) === id;
			const name = kept ? enchant : typeof id === 'number' ? this.idName(ns, id, slot) : undefined;
			if (name === undefined) return { ...fallback(), expect };
			text.push(before, name);
		}
		return { indent, notes: [], parts: [text], role: 'slot', expect };
	}

	// `use "path" [with $v = value, …]`, its values checked as the `with` list's values.
	use(path: string, binds: Array<{ name: string; braced: boolean; value: JsonValue }>, indent: number): Stmt {
		const line = (value: (v: JsonValue) => Text): Text[] => {
			const list = binds.map(b => [b.braced ? `\${${b.name}}` : `$${b.name}`, ' = ', ...value(b.value)]);
			return [[`use ${JSON.stringify(path)}`, ...(list.length ? [' with ', ...join(list, ', ')] : [])]];
		};
		const fallback = (): Stmt => ({ indent, notes: [], parts: line(v => word(raw(v))), role: 'use' });
		const parts = line(v => this.value(v, PREC.top, undefined));
		return { indent, notes: [], parts, role: 'use', expect: { json: binds.map(b => b.value), fallback } };
	}

	// --- Actions (SPEC.md §6.4)

	// An action's step, without its condition; undefined when only raw JSON writes it.
	private step(a: JsonObject, scope: string | undefined): Text | undefined {
		const keys = Object.keys(a).filter(k => k !== this.V.action.f.condition);
		if (!keys.length) return word('none');
		const kind = keys.length === 1 ? this.index.actionKindsByJson.get(keys[0]) : undefined;
		const body = kind ? a[kind.json] : undefined;
		if (!kind || !isObject(body) || !this.known(kind.message, body)) return undefined;
		return this.shortAction(kind, body, scope) ?? this.call(kind, body, scope, true);
	}

	private shortAction(kind: KindForm, body: JsonObject, scope: string | undefined): Text | undefined {
		const V = this.V;
		const has = (k: string) => k in body;
		const only = (...names: string[]) => Object.keys(body).every(k => names.includes(k));
		switch (kind.json) {
			case V.castSpell.json:
			case V.channelSpell.json: {
				const F = kind.json === V.castSpell.json ? V.castSpell : V.channelSpell;
				const fields = F === V.castSpell ? [F.f.spell_id, F.f.target] : [F.f.spell_id, F.f.target, F.f.interrupt_if, F.f.allow_recast];
				if (!has(F.f.spell_id) || !only(...fields) || (has(F.f.allow_recast) && body[F.f.allow_recast] !== true)) return undefined;
				const out: Text = [F === V.castSpell ? 'cast ' : 'channel ', ...this.ref(body[F.f.spell_id], 'spell')];
				if (has(F.f.target)) out.push(` on ${this.unitText(body[F.f.target])}`);
				if (has(F.f.interrupt_if)) out.push(' until ', ...this.value(body[F.f.interrupt_if], PREC.top, scope));
				if (has(F.f.allow_recast)) out.push(' recast');
				return out;
			}
			case V.wait.json:
			case V.waitUntil.json:
			case V.move.json:
			case V.moveDuration.json: {
				const [text, field] = {
					[V.wait.json]: ['wait ', V.wait.f.duration],
					[V.waitUntil.json]: ['wait until ', V.waitUntil.f.condition],
					[V.move.json]: ['move ', V.move.f.range_from_target],
					[V.moveDuration.json]: ['move for ', V.moveDuration.f.duration],
				}[kind.json];
				return has(field) && only(field) ? [text, ...this.value(body[field], PREC.top, scope)] : undefined;
			}
			case V.groupReference.json: {
				const G = V.groupReference.f;
				const W = V.variable.f;
				const name = body[G.group_name] ?? '';
				const vars = body[G.variables] ?? [];
				if (!only(G.group_name, G.variables) || typeof name !== 'string' || !Array.isArray(vars)) return undefined;
				const binds: Text[] = [];
				for (const x of vars) {
					if (!isObject(x) || !(W.value in x) || Object.keys(x).some(k => k !== W.name && k !== W.value)) return undefined;
					const p = placeholder(typeof x[W.name] === 'string' ? (x[W.name] as string) : '');
					if (!p || (W.name in x && typeof x[W.name] !== 'string')) return undefined;
					binds.push([...p, ' = ', ...this.value(x[W.value], PREC.top, scope)]);
				}
				return [`group ${JSON.stringify(name)}`, ...(binds.length ? [' with ', ...join(binds, ', ')] : [])];
			}
			case V.schedule.json: {
				const S = V.schedule.f;
				const schedule = body[S.schedule] ?? '';
				const inner = body[S.inner_action];
				if (!only(S.schedule, S.inner_action) || typeof schedule !== 'string' || !isObject(inner) || V.action.f.condition in inner) return undefined;
				return [`schedule ${JSON.stringify(schedule)} `, ...(this.step(inner, scope) ?? word(raw(inner)))];
			}
			case V.sequence.json: {
				const S = V.sequence.f;
				const name = body[S.name] ?? '';
				const actions = body[S.actions] ?? [];
				if (!only(S.name, S.actions) || typeof name !== 'string' || !Array.isArray(actions)) return undefined;
				return [
					`sequence ${JSON.stringify(name)} [`,
					...join(
						actions.map(x => this.inlineAction(x, scope)),
						', ',
					),
					']',
				];
			}
		}
		return undefined;
	}

	// An action written in one piece: `step if condition`, or raw JSON.
	private inlineAction(v: JsonValue, scope: string | undefined): Text {
		if (!isObject(v)) return word(raw(v));
		const C = this.V.action.f.condition;
		const condition = v[C];
		if (condition !== undefined && !isObject(condition)) return word(raw(v));
		const { [C]: _, ...rest } = v;
		const step = this.step(v, scope) ?? word(raw(rest));
		return condition === undefined ? step : [...step, ' if ', ...this.value(condition, PREC.top, scope)];
	}

	// --- Statements

	// A row (SPEC.md §6.3): an APLPrepullAction in `prepull:`, an APLListItem elsewhere. A row no form writes is
	// raw JSON alone, which reads as the whole row.
	row(item: JsonValue, prepull: boolean, scope: string | undefined, indent: number): Stmt {
		const F = prepull ? this.V.prepullAction.f : this.V.listItem.f;
		const C = this.V.action.f.condition;
		const fallback = (): Stmt => ({ indent, notes: [], parts: [word(raw(item))], role: 'row' });
		const expect = { json: item, fallback };
		if (!isObject(item)) return { ...fallback(), expect };
		const allowed = prepull ? [F.action, F.do_at_value, F.hide] : [F.hide, F.notes, F.action];
		const { [F.action]: action, [F.notes]: notes, [F.hide]: hide } = item;
		const condition = isObject(action) ? action[C] : undefined;
		const fits =
			Object.keys(item).every(k => allowed.includes(k)) &&
			isObject(action) &&
			(hide === undefined || hide === true) &&
			(!prepull || isObject(item[F.do_at_value])) &&
			(notes === undefined || (typeof notes === 'string' && printableNotes(notes))) &&
			(condition === undefined || isObject(condition));
		if (!fits) return { ...fallback(), expect };
		const { [C]: _, ...rest } = action as JsonObject;
		const step = this.step(action as JsonObject, scope);
		// A raw step needs a `#`, a time, a condition or notes beside it, or it reads as the whole row.
		if (!step && !hide && !prepull && condition === undefined && notes === undefined) return { ...fallback(), expect };
		const time = prepull ? [...this.value(item[F.do_at_value], PREC.operand, scope), ' '] : [];
		const head: Text = [hide ? '# ' : '', ...time, ...(step ?? word(raw(rest)))];
		return {
			indent,
			notes: typeof notes === 'string' ? notes.split('\n') : [],
			parts: [head, ...this.conditionParts(condition, scope)],
			role: 'row',
			expect,
		};
	}

	// `if c`, and each further operand of a top-level `and` or `or` as a part of its own.
	private conditionParts(condition: JsonValue | undefined, scope: string | undefined): Text[] {
		if (condition === undefined) return [];
		const infix = this.infix(condition, scope);
		if (!infix) return [['if ', ...this.value(condition, PREC.top, scope)]];
		return infix.operands.map((t, i) => [i ? `${infix.op} ` : 'if ', ...t]);
	}

	// `var $x = v` (SPEC.md §6.1), breaking after `=` and before each operand of a top-level `and` or `or`.
	variable(v: JsonValue, scope: string | undefined, indent: number): Stmt {
		const W = this.V.variable.f;
		const name = isObject(v) && typeof v[W.name] === 'string' ? (v[W.name] as string) : '';
		const head = word(`var ${IDENT.test(name) ? `$${name}` : `\${${name}}`} =`);
		const value = isObject(v) ? v[W.value] : undefined;
		const fallback = (): Stmt => ({ indent, notes: [], parts: [head, word(raw(value ?? null))], role: 'var' });
		const expect = { json: v, fallback };
		if (!isObject(v) || Object.keys(v).some(k => k !== W.name && k !== W.value)) return { ...fallback(), expect };
		const infix = this.infix(value, scope);
		const parts = infix ? infix.operands.map((t, i) => (i ? [`${infix.op} `, ...t] : t)) : [this.value(value, PREC.top, scope)];
		return { indent, notes: [], parts: [head, ...parts], role: 'var', expect };
	}
}

// `%x`, or `%{name}` when the name is no ident.
function placeholder(name: string): Text | undefined {
	if (IDENT.test(name)) return word(`%${name}`);
	return BRACED.test(name) ? word(`%{${name}}`) : undefined;
}

// --- Layout

// The lines of `items`.
export function layout(items: Item[]): string[] {
	const out: string[] = [];
	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const next = items[i + 1];
		if ('blank' in item) out.push('');
		else if ('parts' in item) out.push(...statementLines(item));
		else if (item.join && next && 'parts' in next && !next.notes.length) {
			const body = texts(next).join(' ');
			const joined = `${item.line} ${body}`;
			if (joined.length > WIDTH) out.push(item.line);
			else {
				out.push(next.trailing ? `${joined} ${next.trailing}` : joined);
				i++;
			}
		} else out.push(item.line);
	}
	return out;
}

const texts = (s: Stmt) => s.parts.map(t => t.join(''));

function statementLines(s: Stmt): string[] {
	const pad = ' '.repeat(s.indent);
	const parts = texts(s);
	const one = pad + parts.join(' ');
	const body = one.length <= WIDTH || parts.length === 1 ? [one] : [pad + parts[0], ...parts.slice(1).map(p => ' '.repeat(s.indent + CONTINUATION) + p)];
	if (s.trailing) body[body.length - 1] += ` ${s.trailing}`;
	return [...s.notes.map(n => (n ? `${pad}/// ${n}` : `${pad}///`)), ...body];
}

// The statements a printed statement is read back as.
const READ = new Set<Statement['type']>(['row', 'var', 'slot_row', 'field_entry', 'flag_list', 'message_entry', 'raw_entry', 'use', 'unparsed']);

// What a statement of a typed file writes, in the shape a printed statement's `expect` gives it.
function writtenBy(file: TypedFile, s: Statement): JsonValue | undefined {
	const path = file.paths.get(s);
	if (path) return valueAt(file.json, path);
	const entries = file.entries.get(s);
	if (entries) return entries.map(p => [p, valueAt(file.json, p) ?? null]);
	return file.withs.get(s);
}

// Reads the text `build` writes for `items` back as a file of `kind`, and writes each statement that does not
// read back as the JSON it was printed from (SPEC.md §12.3) as its fallback instead, until every one does or has
// fallen back.
export function verified(index: SchemaIndex, names: Names, kind: SimlKind, items: Item[], build: (items: Item[]) => string): string {
	for (;;) {
		const text = build(items);
		const file = readFile(index, names, text, kind, undefined);
		const read = inFileOrder(file.tree).filter(s => READ.has(s.type));
		const printed = items.filter((x): x is Stmt => 'parts' in x && x.role !== undefined);
		if (read.length !== printed.length) return text;
		let changed = false;
		printed.forEach((s, k) => {
			if (!s.expect || readsBack(index, writtenBy(file, read[k]), s.expect.json)) return;
			items[items.indexOf(s)] = { ...s.expect.fallback(), trailing: s.trailing };
			changed = true;
		});
		if (!changed) return text;
	}
}

// --- Files

const APL = 'apl';
const ROTATION_CATEGORY = 'r';
const GEAR = 'gear';
const GROUP = 'group';
const PREPULL = 'prepull';
const PRIORITY = 'priority';
const TALENTS_CATEGORY = 't';
const BLANK: Item = { blank: true };

// The spec a document is for: the one it names, else the one whose message its player holds.
function specOf(index: SchemaIndex, doc: SimlDoc, json: JsonObject): SpecDef | undefined {
	if (doc.spec !== undefined) return index.specs.get(doc.spec);
	const player = json[index.protoField(SETTINGS_MESSAGE, 'player')!.json];
	return [...index.specs.values()].find(spec => isObject(player) && index.protoField(PLAYER_MESSAGE, spec.field)!.json in player);
}

// What the printer reads: the settings as `normalize` gives them, each array indexed by an enum written out to
// its enum's length or left out when it is all zeros, and each string `simple:` encodes read as its JSON. This is
// the JSON a parse of the printed text gives.
function printable(index: SchemaIndex, settings: JsonObject, spec: SpecDef | undefined): JsonObject {
	const json = indexedArrays(index, SETTINGS_MESSAGE, normalize(index, SETTINGS_MESSAGE, settings)) as JsonObject;
	if (!spec) return json;
	for (const def of index.sections.values()) {
		for (const path of simplePaths(index, def, spec)) {
			const holder = valueAt(json, path.slice(0, -1));
			const text = isObject(holder) ? holder[path.at(-1)!] : undefined;
			if (typeof text !== 'string') continue;
			// A string that does not read as the Rotation, keys that name no field aside, writes no field of it, as the
			// site reads it: one that holds no JSON object, escapes a lone surrogate, or holds a value that does not fit.
			let decoded: JsonValue = {};
			let lone = false;
			try {
				decoded = JSON.parse(text, (k, v: JsonValue) => {
					lone ||= LONE_SURROGATE.test(k) || (typeof v === 'string' && LONE_SURROGATE.test(v));
					return v;
				}) as JsonValue;
			} catch {
				// No JSON, so no field.
			}
			const problems: string[] = [];
			const rotation = normalize(index, spec.rotation, isObject(decoded) ? decoded : {}, problems, []);
			(holder as JsonObject)[path.at(-1)!] = lone || problems.length ? {} : rotation;
		}
	}
	return json;
}

function indexedArrays(index: SchemaIndex, message: string, v: JsonValue): JsonValue {
	if (!isObject(v)) return v;
	const out: JsonObject = {};
	for (const [key, x] of Object.entries(v)) {
		const f = index.fields(message).find(field => field.json === key);
		if (f?.printed === 'indexed' && Array.isArray(x) && x.every(n => typeof n === 'number')) {
			if (x.some(n => n !== 0)) out[key] = [...x, ...Array(Math.max(0, index.enumLength(f.index!) - x.length)).fill(0)];
		} else if (f?.type && index.schema.messages[f.type])
			out[key] = Array.isArray(x) ? x.map(m => indexedArrays(index, f.type!, m)) : indexedArrays(index, f.type, x);
		else out[key] = x;
	}
	return out;
}

// A section as printed: its header, its statements, and whether it is written whatever the categories ask for.
interface Section {
	def: SectionDef;
	header: string;
	body: Item[];
	written: boolean;
}

// A file of any kind (SPEC.md §12.1): `siml 1`, the `spec` and `talents` lines, and the sections in their order. A
// full file writes the sections of the categories `doc.categories` gives, or with none given every section that holds
// something; a section file writes its own section.
export function printFile(index: SchemaIndex, names: Names, doc: SimlDoc): string {
	const { kind } = doc;
	const own = kind.section;
	const spec = specOf(index, doc, doc.settings);
	const json = printable(index, doc.settings, spec);
	const V = index.vocabulary;
	const R = V.rotation.f;
	const G = V.group.f;
	const rotation = valueAt(json, rotationPath(index));
	const allowed = fileSections(index, kind);
	// A reference is written as the printed file reads it, from the variables the file declares.
	const declared = declaredBy(index, rotation).variables.filter(v => allowed.has(v.scope === undefined ? APL : GROUP));
	// A section file writes the spec when its section reads it, or holds a rotation, whose names the spec's class reads.
	const writesSpec = (def: SectionDef | undefined) =>
		def && (def.category === ROTATION_CATEGORY || def.sources.some(src => src.flatten || src.path.includes('*')));
	const specLine = spec && (own === undefined || writesSpec(index.sections.get(own))) ? spec : undefined;
	const printer = new Printer(index, names, classOf(index, specLine), declared);
	const given = doc.categories && new Set(doc.categories);
	const list = (json: JsonValue | undefined, key: string) => (isObject(json) && Array.isArray(json[key]) ? (json[key] as JsonValue[]) : []);
	// A section file writes its own section's body at column 1 with no header, except an x.group.siml: a group's
	// header names it.
	const headless = (def: SectionDef) => def.name === own && own !== GROUP;
	const indent = (def: SectionDef) => (headless(def) ? 0 : INDENT);

	const items: Item[] = [{ line: 'siml 1' }];
	if (specLine) items.push({ line: `spec ${specLine.field}` });
	if (own === undefined) {
		const talents = valueAt(json, [index.protoField(SETTINGS_MESSAGE, 'player')!.json, index.protoField(PLAYER_MESSAGE, 'talents_string')!.json]);
		if (given ? given.has(TALENTS_CATEGORY) : talents !== undefined) items.push({ line: `talents ${JSON.stringify(talents ?? '')}` });
	}

	// A setup section's slot rows and entries. An x.gear.siml holds the slot rows alone.
	const setup = (def: SectionDef): Section => {
		const placed = sectionFields(index, def, spec);
		const slots = def.body.includes('slot_rows') ? slotField(index, placed) : undefined;
		const presence = def.presence && specPath(index, def.presence, spec);
		const body: Item[] = [];
		const writes: Write[] = [];
		let written = presence !== undefined && isObject(valueAt(json, presence));
		for (const p of placed) {
			const path = [...p.at, p.field.json];
			const v = valueAt(json, path);
			if (v === undefined) continue;
			written = true;
			if (p !== slots) writes.push(...writesOf(p, v, path));
			else {
				(Array.isArray(v) ? v : []).forEach((item, i) => {
					const slot = index.enumNumber(SLOT_ENUM, i);
					if (slot && isObject(item) && Object.keys(item).length) body.push(printer.slotRow(slot.short, item, [...path, i], indent(def)));
				});
			}
		}
		if (own !== GEAR) body.push(...printer.entries(writes, indent(def)));
		return { def, header: `${def.name}:`, body, written };
	};

	const sections: Section[] = [];
	const simple = isObject(rotation) && isObject(rotation[R.simple]);
	for (const def of index.schema.sections) {
		if (!allowed.has(def.name) || (given && def.name !== own && !given.has(def.category))) continue;
		if (def.name === APL) {
			const type = isObject(rotation) ? rotation[R.type] : undefined;
			const typeField = sectionFields(index, def, spec).find(p => p.field.json === R.type)!;
			const vars = list(rotation, R.value_variables);
			const needsType = isObject(rotation) && type !== (simple ? TYPE_SIMPLE : TYPE_APL);
			const body: Item[] = [];
			if (needsType) body.push(...printer.entries([{ placed: typeField, values: [type], paths: [[...typeField.at, R.type]] }], indent(def)));
			body.push(...vars.map(v => printer.variable(v, undefined, indent(def))));
			const rest = simple || list(rotation, R.prepull_actions).length || list(rotation, R.priority_list).length || list(rotation, R.groups).length;
			sections.push({ def, header: `${def.name}:`, body, written: isObject(rotation) && (body.length > 0 || !rest) });
		} else if (def.name === PREPULL || def.name === PRIORITY) {
			const prepull = def.name === PREPULL;
			const body = list(rotation, prepull ? R.prepull_actions : R.priority_list).map(r => printer.row(r, prepull, undefined, indent(def)));
			sections.push({ def, header: `${def.name}:`, body, written: body.length > 0 });
		} else if (def.name === GROUP) {
			for (const g of list(rotation, R.groups)) {
				const name = isObject(g) && typeof g[G.name] === 'string' ? (g[G.name] as string) : '';
				const body = [
					...list(g, G.variables).map(v => printer.variable(v, name, indent(def))),
					...list(g, G.actions).map(r => printer.row(r, false, name, indent(def))),
				];
				sections.push({ def, header: `group ${JSON.stringify(name)}:`, body, written: true });
			}
		} else sections.push(setup(def));
	}
	// A category asked for that no section holds gets its first section, empty, so that reading the file sets it.
	for (const category of given ?? []) {
		const first = sections.find(s => s.def.category === category);
		if (first && !sections.some(s => s.written && s.def.category === category)) first.written = true;
	}

	for (const s of sections) {
		if (headless(s.def)) {
			if (s.body.length) items.push(BLANK, ...s.body);
		} else if (s.written) {
			const one = s.body.length === 1 && 'role' in s.body[0] && s.body[0].role === 'entry';
			items.push(BLANK, { line: s.header, join: one }, ...s.body);
		}
	}
	return verified(index, names, kind, items, current => `${layout(current).join('\n')}\n`);
}

// A field's value as writes: one value, a list's values, or each message of a list as a write of its own.
function writesOf(placed: Placed, v: JsonValue, path: JsonPath): Write[] {
	if (!isList(placed.field) || !Array.isArray(v)) return [{ placed, values: [v], paths: [path] }];
	if (placed.field.printed === 'message') return v.map((x, i) => ({ placed, values: [x], paths: [[...path, i]] }));
	return [{ placed, values: v, paths: v.map((_, i) => [...path, i]) }];
}
