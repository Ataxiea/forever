// Typing (SPEC.md §6, §7.2, §8.3): the meaning of each syntax node, from the schema alone, as the protojson of
// the message it writes. Typing reads every node it can: an error in one argument does not stop its
// siblings, and a node whose kind, property or field is unknown is not read further.

import { float32, isObject, normalize, normalizeField, objectAt, valueAt } from './json.ts';
import { fieldHoldsId, fieldNamespace, holdsId, isSpellLike, type Names, THINGS, unitFieldOf, unitReference } from './names.ts';
import { type KindForm, OTHER_ENUM, type Placed, type SchemaField, type SchemaIndex, STAT_ENUM, type Vocabulary } from './schema.ts';
import type {
	AccessorNode,
	ActionNode,
	Args,
	CallNode,
	DiagnosticCode,
	JsonObject,
	JsonPath,
	JsonValue,
	MemberNode,
	Name,
	Namespace,
	PathSpan,
	PlaceholderBind,
	Range,
	RawNode,
	RefUse,
	SimlDiagnostic,
	SpellName,
	SpellNamespace,
	Statement,
	Step,
	Term,
	VarNode,
} from './types.ts';

// A variable declaration: a value variable (no scope) or a group's variable.
export interface VariableDecl {
	name: string;
	range: Range;
	scope: string | undefined;
	uses: VariableUse[]; // The references in its value.
}

// `$x` or `${X}`, whose JSON name the checks fill in once every declaration is known (SPEC.md §7.5).
export interface VariableUse {
	node: VarNode;
	body: JsonObject;
	scope: string | undefined;
}

// A group reference, with the placeholders its `with` list sets.
export interface GroupUse {
	name: string;
	range: Range;
	scope: string | undefined;
	with: Array<{ name: string; range: Range }>;
}

export interface NameUse {
	name: string;
	range: Range;
}

const COMPARE_OPS: Record<string, string> = { '==': 'OpEq', '!=': 'OpNe', '>=': 'OpGe', '>': 'OpGt', '<=': 'OpLe', '<': 'OpLt' };
const MATH_OPS: Record<string, string> = { '+': 'OpAdd', '-': 'OpSub', '*': 'OpMul', '/': 'OpDiv' };
const INTEGER = /^-?[0-9]+$/;
const DECIMAL = /^-?[0-9]+(\.[0-9]+)?$/;
const INT_RANGES: Record<string, [number, number]> = { int32: [-(2 ** 31), 2 ** 31 - 1], uint32: [0, 2 ** 32 - 1] };
const OTHER = 'other';
const ITEM = 'item';
// What a slot row's parts take, as unknown-name says it.
const SLOT_PLACES: Record<string, string> = { id: 'a slot', random_suffix: "a slot row's suffix", enchant: '+' };

// The candidates within edit distance 2 of `word`, closest first, at most three.
function closest(word: string, candidates: Iterable<string>): string[] {
	return [...new Set(candidates)]
		.map(c => [c, distance(word, c)] as const)
		.filter(([, d]) => d <= 2)
		.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
		.slice(0, 3)
		.map(([c]) => c);
}

// "; did you mean a, b?" for the closest candidates to `word`.
export function didYouMean(word: string, candidates: Iterable<string>): string {
	const close = closest(word, candidates);
	return close.length ? `; did you mean ${close.join(', ')}?` : '';
}

// The edit distance of `a` and `b` when it is at most 2, else 3. A path of cost 2 or less stays within 2 of the
// diagonal, so only those cells are worked out, and a row with none at 2 or less ends the work.
function distance(a: string, b: string): number {
	const far = 3;
	if (Math.abs(a.length - b.length) > 2) return far;
	let prev = Array.from({ length: b.length + 1 }, (_, j) => Math.min(j, far));
	let row = new Array<number>(b.length + 1);
	for (let i = 1; i <= a.length; i++) {
		row[0] = Math.min(i, far);
		let best = row[0];
		for (let j = 1; j <= b.length; j++) {
			if (j < i - 2 || j > i + 2) {
				row[j] = far;
				continue;
			}
			row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), far);
			best = Math.min(best, row[j]);
		}
		if (best === far) return far;
		[prev, row] = [row, prev];
	}
	return prev[b.length];
}

// A message's name without its package: APLValue for proto.APLValue.
const typeName = (message: string) => message.slice(message.lastIndexOf('.') + 1);

// Whether a field holds a list of values. An array indexed by an enum is one value, written `field(…)`.
export const isList = (field: SchemaField) => field.repeated && field.printed !== 'indexed';

export function diagnostic(code: DiagnosticCode, message: string, range: Range, severity: 'error' | 'warning' = 'error'): SimlDiagnostic {
	return { range, severity, code, message };
}

// Diagnostics in the order SPEC.md §13 fixes: by where they start, then by where they end, then by code.
export function sortDiagnostics(diagnostics: SimlDiagnostic[]): SimlDiagnostic[] {
	return diagnostics.sort(
		(a, b) => a.range.start.offset - b.range.start.offset || a.range.end.offset - b.range.end.offset || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0),
	);
}

export class Typer {
	readonly index: SchemaIndex;
	readonly v: Vocabulary;
	readonly names: Names;
	readonly diagnostics: SimlDiagnostic[] = [];
	readonly rawRefs: SimlDiagnostic[] = [];
	readonly refs: Array<Required<RefUse>> = [];
	readonly spans: PathSpan[] = [];
	readonly variableUses: VariableUse[] = [];
	readonly groupUses: GroupUse[] = [];
	readonly sequenceDefs = new Set<string>();
	readonly sequenceUses: NameUse[] = [];
	readonly placeholders = new Map<string | undefined, Set<string>>(); // The placeholders each group's statements hold.
	cls: string | undefined; // The class whose names the file reads, which its spec line sets (SPEC.md §7.1).
	scope: string | undefined; // The group whose statements are being typed.
	decl: VariableDecl | undefined; // The declaration whose value is being typed.
	private readonly sequenceFields: Set<string>; // The string fields that name a sequence: the sequence head's subject.

	constructor(index: SchemaIndex, names: Names) {
		this.index = index;
		this.v = index.vocabulary;
		this.names = names;
		this.sequenceFields = new Set(
			[...index.accessors.values()].filter(k => index.protoField(k.message, k.accessor!.subject)?.printed === 'string').map(k => k.accessor!.subject),
		);
	}

	report(code: DiagnosticCode, message: string, range: Range, severity: 'error' | 'warning' = 'error') {
		this.diagnostics.push(diagnostic(code, message, range, severity));
	}

	span(path: JsonPath, range: Range) {
		this.spans.push({ path, range });
	}

	// --- Values (SPEC.md §6.5)

	value(t: Term, path: JsonPath): JsonObject | undefined {
		if (t.type === 'paren') return this.value(t.expr, path);
		const out = this.valueOf(t, path);
		if (out) this.span(path, t.range);
		return out;
	}

	private valueOf(t: Term, path: JsonPath): JsonObject | undefined {
		const V = this.v;
		switch (t.type) {
			case 'literal':
				return { [V.const.json]: { [V.const.f.val]: t.text } };
			case 'string':
				return { [V.const.json]: { [V.const.f.val]: t.value } };
			case 'bool':
				return { [V.const.json]: { [V.const.f.val]: String(t.value) } };
			case 'none':
				return {};
			case 'var': {
				const body: JsonObject = {};
				const use = { node: t, body, scope: this.scope };
				this.variableUses.push(use);
				this.decl?.uses.push(use);
				return { [V.variableRef.json]: body };
			}
			case 'placeholder': {
				let names = this.placeholders.get(this.scope);
				if (!names) this.placeholders.set(this.scope, (names = new Set()));
				names.add(t.name);
				return { [V.variablePlaceholder.json]: { [V.variablePlaceholder.f.name]: t.name } };
			}
			case 'raw':
				return this.raw(V.value.message, t);
			case 'not': {
				const val = this.value(t.operand, [...path, V.not.json, V.not.f.val]);
				return val && { [V.not.json]: { [V.not.f.val]: val } };
			}
			case 'and':
			case 'or': {
				const F = V[t.type];
				const vals = t.operands.map((o, i) => this.value(o, [...path, F.json, F.f.vals, i]));
				return vals.every(x => x !== undefined) ? { [F.json]: { [F.f.vals]: vals as JsonObject[] } } : undefined;
			}
			case 'compare':
			case 'math': {
				const F = t.type === 'compare' ? V.cmp : V.math;
				const lhs = this.value(t.left, [...path, F.json, F.f.lhs]);
				const rhs = this.value(t.right, [...path, F.json, F.f.rhs]);
				const op = (t.type === 'compare' ? COMPARE_OPS : MATH_OPS)[t.op];
				return lhs && rhs && { [F.json]: { [F.f.op]: op, [F.f.lhs]: lhs, [F.f.rhs]: rhs } };
			}
			case 'call':
				return this.valueCall(t, path);
			case 'member':
				return this.unitPrefixed(t, path);
			case 'accessor':
				return this.accessor(t, path);
		}
		this.report('wrong-type', t.type === 'list' ? 'a value goes here, not a list' : 'a value goes here, not an action', t.range);
		return undefined;
	}

	// `kind` or `kind(args)`; a kind written with no arguments has none of its fields set.
	private valueCall(c: CallNode, path: JsonPath): JsonObject | undefined {
		const kind = this.index.valueKinds.get(c.name.text);
		if (!kind) {
			this.report('unknown-kind', this.unknownKind(c.name.text, 'value', this.index.valueKinds.keys()), c.name.range);
			return undefined;
		}
		const body = c.args ? this.kindArgs(kind, c.args, [...path, kind.json]) : {};
		return body && { [kind.json]: body };
	}

	private unknownKind(name: string, what: 'value' | 'action', kinds: Iterable<string>): string {
		const other = what === 'value' ? this.index.actionKinds.has(name) : this.index.valueKinds.has(name);
		if (other) return `${name} is ${what === 'value' ? 'an action' : 'a value'}, and ${what === 'value' ? 'a value' : 'an action'} goes here`;
		return `no ${what} is named ${name}${didYouMean(name, kinds)}`;
	}

	// `u.kind`: a kind whose only field is a unit (SPEC.md §6.8).
	private unitPrefixed(m: MemberNode, path: JsonPath): JsonObject | undefined {
		const kind = this.index.valueKinds.get(m.name.text);
		if (!kind || !kind.unitField) {
			const prefixed = [...this.index.valueKinds.values()].filter(k => k.unitField).map(k => k.kind);
			const message = kind
				? `${kind.kind} takes no unit; the values a unit goes in front of are ${prefixed.join(', ')}`
				: `no value is named ${m.name.text}${didYouMean(m.name.text, prefixed)}`;
			this.report('unknown-kind', message, m.name.range);
			return undefined;
		}
		const field = this.index.protoField(kind.message, kind.unitField)!;
		const unit = this.unitName(m.object, [...path, kind.json, field.json]);
		return unit && { [kind.json]: { [field.json]: unit } };
	}

	// `[u.]head(subject).prop[(args)]` (SPEC.md §6.7).
	private accessor(a: AccessorNode, path: JsonPath): JsonObject | undefined {
		const head = a.head.text;
		if (!this.index.heads.has(head)) {
			const message = didYouMean(head, this.index.heads) || `; the heads are ${[...this.index.heads].join(', ')}`;
			this.report('unknown-kind', `${head} is no accessor head${message}`, a.head.range);
			return undefined;
		}
		const kind = this.index.accessors.get(`${head}.${a.prop.text}`);
		if (!kind) {
			const props = [...this.index.accessors.values()].filter(k => k.accessor!.head === head).map(k => k.accessor!.prop);
			this.report('unknown-property', `${head}(…) has no property ${a.prop.text}${didYouMean(a.prop.text, props)}`, a.prop.range);
			return undefined;
		}
		const acc = kind.accessor!;
		const at = [...path, kind.json];
		const body: JsonObject = {};
		const given = new Set<SchemaField>();
		let ok = true;
		let unitJson: JsonObject | undefined;
		if (a.unit) {
			const unitField = acc.unit ? this.index.protoField(kind.message, acc.unit) : undefined;
			if (!unitField) {
				this.report('wrong-type', `${head}(…).${a.prop.text} takes no unit`, a.unit.range);
				ok = false;
			} else {
				given.add(unitField);
				unitJson = this.unitName(a.unit, [...at, unitField.json]);
				if (unitJson) body[unitField.json] = unitJson;
				else ok = false;
			}
		}
		const subject = this.index.protoField(kind.message, acc.subject)!;
		given.add(subject);
		const unit = a.unit ? unitJson : a.args && this.unitArg(kind, a.args);
		const value = this.single(subject, a.subject, [...at, subject.json], fieldNamespace(this.index, kind, subject, unit));
		if (value === undefined) ok = false;
		else body[subject.json] = value;
		if (a.args && !this.namedArgs(kind, a.args, at, body, given, `arguments on a property are named: ${a.prop.text}(field=value)`)) ok = false;
		return ok ? { [kind.json]: body } : undefined;
	}

	// The arguments of a generic or plain-argument kind (SPEC.md §8.3 rules 5 and 6): the positional field, or
	// the list's items, unnamed; every other field named; a bool field also by its name alone.
	kindArgs(kind: KindForm, args: Args, path: JsonPath): JsonObject | undefined {
		const fields = this.index.fields(kind.message);
		const body: JsonObject = {};
		const given = new Set<SchemaField>();
		const list = kind.listField ? this.index.protoField(kind.message, kind.listField) : undefined;
		const positional = !list && kind.positional ? this.index.protoField(kind.message, kind.positional) : undefined;
		const unit = this.unitArg(kind, args);
		const items: JsonValue[] = [];
		let positionalWritten = false;
		let ok = true;
		for (const arg of args.items) {
			if (arg.name) {
				ok = this.namedArg(kind, arg.name, arg.value, path, body, given, unit) && ok;
				continue;
			}
			const flag = this.flagField(arg.value, fields);
			if (flag) {
				ok = this.setFlag(flag, arg.value.range, path, body, given) && ok;
				continue;
			}
			const target = list ?? positional;
			if (!target || positionalWritten || (given.has(target) && !items.length)) {
				ok = false;
				if (target && given.has(target) && !positionalWritten) this.report('duplicate-field', `${target.siml} is written twice`, arg.range);
				else if (target)
					this.report('positional-not-allowed', `${kind.kind} takes one positional argument, ${target.siml}; name the others`, arg.range);
				else if (fields.length)
					this.report(
						'positional-not-allowed',
						`${kind.kind} takes no positional argument; name its fields: ${fields.map(f => f.siml).join(', ')}`,
						arg.range,
					);
				else this.report('positional-not-allowed', `${kind.kind} takes no arguments`, arg.range);
				continue;
			}
			given.add(target);
			const value = this.single(
				target,
				arg.value,
				list ? [...path, target.json, items.length] : [...path, target.json],
				fieldNamespace(this.index, kind, target, unit),
			);
			if (value === undefined) ok = false;
			if (list) items.push(value ?? null);
			else {
				positionalWritten = true;
				if (value !== undefined) body[target.json] = value;
			}
		}
		if (list && items.length) body[list.json] = items;
		return ok ? body : undefined;
	}

	// Named arguments, and bare bool flags; any other unnamed argument is positional-not-allowed.
	private namedArgs(kind: KindForm, args: Args, path: JsonPath, body: JsonObject, given: Set<SchemaField>, positionalMessage: string): boolean {
		const fields = this.index.fields(kind.message);
		const unit = this.unitArg(kind, args);
		let ok = true;
		for (const arg of args.items) {
			if (arg.name) {
				ok = this.namedArg(kind, arg.name, arg.value, path, body, given, unit) && ok;
				continue;
			}
			const flag = this.flagField(arg.value, fields);
			if (flag) ok = this.setFlag(flag, arg.value.range, path, body, given) && ok;
			else {
				this.report('positional-not-allowed', positionalMessage, arg.range);
				ok = false;
			}
		}
		return ok;
	}

	private namedArg(kind: KindForm, name: Name, value: Term, path: JsonPath, body: JsonObject, given: Set<SchemaField>, unit: JsonValue | undefined): boolean {
		const field = this.index.field(kind.message, name.text);
		if (!field) {
			const names = this.index.fields(kind.message).map(f => f.siml);
			const message = didYouMean(name.text, names) || `; its fields are ${names.join(', ')}`;
			this.report('unknown-field', `${kind.kind} has no field ${name.text}${message}`, name.range);
			return false;
		}
		if (given.has(field)) {
			this.report('duplicate-field', `${field.siml} is written twice`, name.range);
			return false;
		}
		given.add(field);
		const typed = this.term(field, value, [...path, field.json], fieldNamespace(this.index, kind, field, unit));
		if (typed === undefined) return false;
		body[field.json] = typed;
		return true;
	}

	// A bare word naming one of the bool fields: that flag, set.
	private flagField(t: Term, fields: SchemaField[]): SchemaField | undefined {
		if (t.type !== 'call' || t.args) return undefined;
		return fields.find(f => f.printed === 'bool' && !f.repeated && (f.siml === t.name.text || f.aliases.includes(t.name.text)));
	}

	private setFlag(field: SchemaField, range: Range, path: JsonPath, body: JsonObject, given: Set<SchemaField>): boolean {
		if (given.has(field)) {
			this.report('duplicate-field', `${field.siml} is written twice`, range);
			return false;
		}
		given.add(field);
		body[field.json] = true;
		this.span([...path, field.json], range);
		return true;
	}

	// The unit a kind's arguments give its unit field, whose auras its aura_id reads (SPEC.md §7.2).
	private unitArg(kind: KindForm, args: Args): JsonValue | undefined {
		const field = unitFieldOf(this.index, kind);
		const value = field && args.items.find(a => a.name && this.index.field(kind.message, a.name.text) === field)?.value;
		if (value?.type === 'call' && !value.args) return unitReference(this.index, value.name.text);
		return value?.type === 'raw' ? value.json : undefined;
	}

	// --- Terms: the value of a field, by its printed type (SPEC.md §5.2, §8.3)

	term(field: SchemaField, t: Term, path: JsonPath, ns: SpellNamespace = 'spell'): JsonValue | undefined {
		if (!isList(field)) return this.single(field, t, path, ns);
		if (t.type === 'raw') return this.rawField(field, t, true, path);
		if (t.type !== 'list') {
			this.report('wrong-type', `${field.siml} takes a list, such as [a, b]`, t.range);
			return undefined;
		}
		const items = t.items.map((item, i) => this.single(field, item, [...path, i], ns));
		if (items.some(x => x === undefined)) return undefined;
		this.span(path, t.range);
		return items as JsonValue[];
	}

	// One value of `field`; `ns` is the namespace an ActionID field reads.
	single(field: SchemaField, t: Term, path: JsonPath, ns: SpellNamespace = 'spell'): JsonValue | undefined {
		if (t.type === 'raw' && field.printed !== 'value' && field.printed !== 'action') {
			return this.rawField(field, t, field.printed === 'indexed' || field.printed === 'map', path);
		}
		const value = this.singleOf(field, t, path, ns);
		if (value !== undefined && !isObject(value)) this.span(path, t.range);
		return value;
	}

	private singleOf(field: SchemaField, t: Term, path: JsonPath, ns: SpellNamespace): JsonValue | undefined {
		switch (field.printed) {
			case 'value':
				return this.value(t, path);
			case 'action':
				return this.actionTerm(t, path);
			case 'action_id':
				return this.actionId(t, path, ns);
			case 'unit':
				return this.unit(t, path);
			case 'bool':
				if (t.type === 'bool') return t.value;
				return this.wrongType(field, 'true or false', t);
			case 'string':
				if (t.type === 'string') {
					if (this.sequenceFields.has(field.name)) this.sequenceUses.push({ name: t.value, range: t.range });
					return t.value;
				}
				return this.wrongType(field, 'a string in quotes', t);
			case 'number':
				return this.number(field, t);
			case 'enum':
			case 'flag_enum':
				return this.enumValue(field.type!, t, field);
			case 'stat':
				if (t.type === 'literal' && INTEGER.test(t.text)) return this.number(field, t);
				return this.enumValue(STAT_ENUM, t, field, true);
			case 'ref':
				return this.ref(field, t, path);
			case 'message':
				return this.message(field, t, path);
			case 'indexed':
				return this.indexed(field, t, path);
			case 'map':
				return this.wrongType(field, 'raw JSON', t);
		}
	}

	private wrongType(field: SchemaField, what: string, t: Term): undefined {
		this.report('wrong-type', `${field.siml} takes ${what}`, t.range);
		return undefined;
	}

	private number(field: SchemaField, t: Term, scalar = field.scalar ?? 'int32'): JsonValue | undefined {
		if (t.type !== 'literal') return this.wrongType(field, 'a number', t);
		if (!DECIMAL.test(t.text)) {
			this.report('bad-literal', `${field.siml} takes a number with no unit`, t.range);
			return undefined;
		}
		if (scalar === 'double' || scalar === 'float') {
			const n = scalar === 'float' ? float32(Number(t.text)) : Number(t.text);
			return Number.isFinite(n) ? n : this.wrongType(field, `a number that fits ${scalar}`, t);
		}
		if (!INTEGER.test(t.text)) return this.wrongType(field, 'a whole number', t);
		if (scalar === 'int64' || scalar === 'uint64') {
			const n = BigInt(t.text);
			const fits = scalar === 'int64' ? n >= -(2n ** 63n) && n < 2n ** 63n : n >= 0n && n < 2n ** 64n;
			return fits ? n.toString() : this.wrongType(field, `a number that fits ${scalar}`, t);
		}
		const n = Number(t.text);
		const [min, max] = INT_RANGES[scalar] ?? INT_RANGES.int32;
		return n >= min && n <= max ? n : this.wrongType(field, `a number that fits ${scalar}`, t);
	}

	// An enum value by its short or proto name; a stat field holds the number.
	private enumValue(enumName: string, t: Term, field: SchemaField, asNumber = false): JsonValue | undefined {
		if (t.type !== 'call' || t.args) return this.wrongType(field, asNumber ? 'a stat, such as attack_power' : 'one of its values', t);
		const value = this.index.enumValue(enumName, t.name.text);
		if (!value) {
			const names = (this.index.schema.enums[enumName]?.values ?? []).map(v => v.short);
			this.report('unknown-enum', `${field.siml} has no value ${t.name.text}${didYouMean(t.name.text, names)}`, t.name.range);
			return undefined;
		}
		return asNumber ? value.number : value.name;
	}

	// An item, enchant or suffix ref field: a name of its namespace, written as the id.
	private ref(field: SchemaField, t: Term, path: JsonPath): JsonValue | undefined {
		const ns = field.ref!;
		if (t.type !== 'call' || t.args) return this.wrongType(field, `the name of ${THINGS[ns]}`, t);
		const slotRow = this.index.protoField(this.v.itemSpec.message, field.name) === field;
		return this.lookup(t.name, path, ns, (slotRow && SLOT_PLACES[field.name]) || field.siml) as number | undefined;
	}

	// `field(args)` for a message field: named arguments, bare bool flags and flag-value enums, and nested
	// `field(args)` for message fields; or `none` for the empty message.
	private message(field: SchemaField, t: Term, path: JsonPath): JsonValue | undefined {
		if (t.type === 'none') return {};
		if (t.type !== 'call' || !t.args || (t.name.text !== field.siml && !field.aliases.includes(t.name.text))) {
			return this.wrongType(field, `its fields in ${field.siml}(…), or raw JSON`, t);
		}
		const out = this.messageArgs(field.type!, t.args, path);
		if (out) this.span(path, t.range);
		return out;
	}

	// The fields of a message as arguments: named, a bool or flag-value enum by its name alone, a message
	// field as `field(…)`, and each element of a list of messages as a `field(…)` of its own.
	messageArgs(message: string, args: Args, path: JsonPath): JsonObject | undefined {
		const body: JsonObject = {};
		const given = new Set<SchemaField>();
		const elements = new Set<SchemaField>(); // Lists of messages written an element at a time.
		const fields = this.index.fields(message);
		let ok = true;
		for (const arg of args.items) {
			const f = arg.name
				? this.index.field(message, arg.name.text)
				: arg.value.type === 'call'
					? this.index.field(message, arg.value.name.text)
					: undefined;
			const name = arg.name ?? (arg.value.type === 'call' ? arg.value.name : undefined);
			if (!name) {
				this.report('positional-not-allowed', `the fields of a message are named: field=value`, arg.range);
				ok = false;
				continue;
			}
			if (!f) {
				const names = fields.map(x => x.siml);
				this.report('unknown-field', `${typeName(message)} has no field ${name.text}${didYouMean(name.text, names)}`, name.range);
				ok = false;
				continue;
			}
			const element = !arg.name && arg.value.type === 'call' && arg.value.args !== undefined && isList(f) && f.printed === 'message';
			if (given.has(f) || (!element && elements.has(f))) {
				this.report('duplicate-field', `${f.siml} is written twice`, name.range);
				ok = false;
				continue;
			}
			(element ? elements : given).add(f);
			let value: JsonValue | undefined;
			if (element) {
				const list = (body[f.json] ??= []) as JsonValue[];
				value = this.single(f, arg.value, [...path, f.json, list.length]);
				if (value !== undefined) list.push(value);
			} else if (arg.name || (arg.value.type === 'call' && arg.value.args)) value = this.term(f, arg.value, [...path, f.json]);
			else value = this.bareFlag(f, arg.value);
			if (value === undefined) ok = false;
			else if (!element) body[f.json] = value;
		}
		return ok ? body : undefined;
	}

	// A field written by its name alone: a bool's true, or a flag-value enum's flag value.
	bareFlag(field: SchemaField, t: Term): JsonValue | undefined {
		if (field.printed === 'bool' && !field.repeated) return true;
		const flag = field.printed === 'flag_enum' ? this.index.schema.enums[field.type!]?.flag : undefined;
		if (flag) return flag;
		this.report('wrong-type', `${field.siml} needs a value: ${field.siml} <value>`, t.range);
		return undefined;
	}

	// `field(<short name>=<number>, …)` for an array indexed by an enum, written out to the enum's length.
	private indexed(field: SchemaField, t: Term, path: JsonPath): JsonValue | undefined {
		if (t.type !== 'call' || !t.args || (t.name.text !== field.siml && !field.aliases.includes(t.name.text))) {
			return this.wrongType(field, `${field.siml}(<name>=<number>, …)`, t);
		}
		const values = this.index.schema.enums[field.index!]?.values ?? [];
		const out: number[] = Array(this.index.enumLength(field.index!)).fill(0);
		const seen = new Set<number>();
		let ok = true;
		for (const arg of t.args.items) {
			if (!arg.name) {
				this.report('positional-not-allowed', `${field.siml} names each entry: ${field.siml}(<name>=<number>)`, arg.range);
				ok = false;
				continue;
			}
			const value = this.index.enumValue(field.index!, arg.name.text);
			if (!value) {
				this.report(
					'unknown-enum',
					`${field.siml} has no entry ${arg.name.text}${didYouMean(
						arg.name.text,
						values.map(v => v.short),
					)}`,
					arg.name.range,
				);
				ok = false;
				continue;
			}
			if (seen.has(value.number)) {
				this.report('duplicate-field', `${value.short} is written twice`, arg.name.range);
				ok = false;
				continue;
			}
			seen.add(value.number);
			const n = this.number(field, arg.value, 'double');
			if (n === undefined) ok = false;
			else out[value.number] = n as number;
		}
		this.span(path, t.range);
		return ok ? out : undefined;
	}

	// --- Refs and units (SPEC.md §6.6, §7.2)

	// An ActionID: a name of the namespace `ns`, `item.<name>`, `other.<short>`, `none` or raw JSON.
	actionId(t: Term, path: JsonPath, ns: SpellNamespace): JsonObject | undefined {
		const A = this.v.actionId;
		let out: JsonObject | undefined;
		if (t.type === 'none') out = {};
		else if (t.type === 'raw') out = this.raw(A.message, t);
		else if (t.type === 'member' && t.object.text === OTHER) {
			const value = this.index.enumValue(OTHER_ENUM, t.name.text);
			if (!value) {
				const names = (this.index.schema.enums[OTHER_ENUM]?.values ?? []).map(v => v.short);
				this.report('unknown-enum', `other.${t.name.text} names no other action${didYouMean(t.name.text, names)}`, t.name.range);
				return undefined;
			}
			out = { [A.f.other_id]: value.name };
		} else if (t.type === 'member' && t.object.text === ITEM) {
			const id = this.lookup(t.name, path, ITEM, `${ITEM}.`) as number | undefined;
			if (id === undefined) return undefined;
			out = { [A.f.item_id]: id };
		} else if (t.type === 'call' && !t.args) {
			const entry = this.lookup(t.name, path, ns, 'this position') as SpellName | undefined;
			if (!entry) return undefined;
			out = { [A.f.spell_id]: entry.spellId };
			if (entry.tag) out[A.f.tag] = entry.tag;
			if (entry.rank) out[A.f.rank] = entry.rank;
		} else {
			this.report('wrong-type', 'a name goes here: a spell, item.<name> or other.<name>', t.range);
			return undefined;
		}
		this.span(path, t.range);
		return out;
	}

	// What `name` means in `ns` for this file (SPEC.md §7.2), recorded for the tools: a spell-like entry, or the id of
	// an item, enchant or suffix. Undefined, and unknown-name, when it means nothing there; `place` is what takes
	// the name, as the message says it.
	private lookup(name: Name, path: JsonPath, ns: Namespace, place: string): SpellName | number | undefined {
		this.refs.push({ name: name.text, range: name.range, path, namespace: ns });
		const n = this.names;
		const found = isSpellLike(ns)
			? n.spell(this.cls, ns, name.text)
			: ns === ITEM
				? n.item(name.text)
				: ns === 'enchant'
					? n.enchant(name.text)
					: n.suffix(name.text);
		if (found === undefined) this.report('unknown-name', this.unknownName(name.text, ns, place), name.range);
		return found;
	}

	// What a name that `ns` does not hold is, when another namespace holds it; otherwise the closest names `ns` holds.
	private unknownName(name: string, ns: Namespace, place: string): string {
		const [other] = this.names.holding(this.cls, name);
		if (other === ITEM && isSpellLike(ns)) return `${name} is an item; write item.${name}`;
		if (other !== undefined) return `${name} is ${THINGS[other]}; ${place} takes ${THINGS[ns]}`;
		const shared = this.cls === undefined && isSpellLike(ns) ? '; with no spec, a file reads only the spells and auras every class shares' : '';
		return `no ${THINGS[ns].replace(/^an? /, '')} is named ${name}${didYouMean(name, this.names.visible(this.cls, ns))}${shared}`;
	}

	unit(t: Term, path: JsonPath): JsonObject | undefined {
		let out: JsonObject | undefined;
		if (t.type === 'none') out = {};
		else if (t.type === 'raw') out = this.raw(this.v.unit.message, t);
		else if (t.type === 'call' && !t.args) return this.unitName(t.name, path);
		else {
			this.report('wrong-type', 'a unit goes here, such as target', t.range);
			return undefined;
		}
		this.span(path, t.range);
		return out;
	}

	private unitName(name: Name, path: JsonPath): JsonObject | undefined {
		const unit = unitReference(this.index, name.text);
		if (!unit) {
			const words = [...this.index.unitWords.keys()];
			const message = didYouMean(name.text, words) || `; the units are ${words.join(', ')}, and targetN, playerN, petN`;
			this.report('wrong-type', `no unit is named ${name.text}${message}`, name.range);
			return undefined;
		}
		this.span(path, name.range);
		return unit;
	}

	// --- Actions (SPEC.md §6.4)

	action(n: ActionNode, path: JsonPath): JsonObject | undefined {
		const out = this.step(n.step, path);
		const condition = n.condition && this.value(n.condition, [...path, this.v.action.f.condition]);
		if (!out || (n.condition && !condition)) return undefined;
		if (condition) {
			if (this.v.action.f.condition in out) {
				this.report('duplicate-field', 'the raw action holds its condition already', n.condition!.range);
				return undefined;
			}
			out[this.v.action.f.condition] = condition;
		}
		this.span(path, n.range);
		return out;
	}

	// An action's step: the APLAction without its condition.
	step(s: Step, path: JsonPath): JsonObject | undefined {
		const V = this.v;
		switch (s.type) {
			case 'none':
				return {};
			case 'raw':
				return this.raw(V.action.message, s);
			case 'cast':
			case 'channel': {
				const F = s.type === 'cast' ? V.castSpell : V.channelSpell;
				const at = [...path, F.json];
				const body: JsonObject = {};
				const spell = this.actionId(s.spell, [...at, F.f.spell_id], 'spell');
				const target = s.target && this.unit(s.target, [...at, F.f.target]);
				let ok = spell !== undefined && (!s.target || target !== undefined);
				if (spell) body[F.f.spell_id] = spell;
				if (target) body[F.f.target] = target;
				if (s.type === 'channel') {
					const until = s.until && this.value(s.until, [...at, F.f.interrupt_if]);
					if (s.until && !until) ok = false;
					if (until) body[F.f.interrupt_if] = until;
					if (s.recast) body[F.f.allow_recast] = true;
				}
				return ok ? { [F.json]: body } : undefined;
			}
			case 'wait':
			case 'wait_until':
			case 'move':
			case 'move_for': {
				const F = { wait: V.wait, wait_until: V.waitUntil, move: V.move, move_for: V.moveDuration }[s.type];
				const field = {
					wait: V.wait.f.duration,
					wait_until: V.waitUntil.f.condition,
					move: V.move.f.range_from_target,
					move_for: V.moveDuration.f.duration,
				}[s.type];
				const value = this.value(s.value, [...path, F.json, field]);
				return value && { [F.json]: { [field]: value } };
			}
			case 'group':
				return this.groupStep(s.name.value, s.name.range, s.with, path);
			case 'schedule': {
				const F = V.schedule;
				const inner = this.step(s.step, [...path, F.json, F.f.inner_action]);
				if (inner) this.span([...path, F.json, F.f.inner_action], s.step.range);
				return inner && { [F.json]: { [F.f.schedule]: s.schedule.value, [F.f.inner_action]: inner } };
			}
			case 'sequence': {
				const F = V.sequence;
				this.sequenceDefs.add(s.name.value);
				const actions = s.actions.map((a, i) => this.action(a, [...path, F.json, F.f.actions, i]));
				return actions.every(a => a !== undefined) ? { [F.json]: { [F.f.name]: s.name.value, [F.f.actions]: actions as JsonObject[] } } : undefined;
			}
			case 'call':
				return this.actionCall(s, path);
		}
	}

	private groupStep(name: string, range: Range, binds: PlaceholderBind[], path: JsonPath): JsonObject | undefined {
		const G = this.v.groupReference;
		const W = this.v.variable;
		this.groupUses.push({ name, range, scope: this.scope, with: binds.map(b => ({ name: b.placeholder.name, range: b.placeholder.range })) });
		const variables = binds.map((b, i) => {
			const value = this.value(b.value, [...path, G.json, G.f.variables, i, W.f.value]);
			if (value) this.span([...path, G.json, G.f.variables, i], b.range);
			return value && { [W.f.name]: b.placeholder.name, [W.f.value]: value };
		});
		if (variables.some(v => v === undefined)) return undefined;
		const body: JsonObject = { [G.f.group_name]: name };
		if (variables.length) body[G.f.variables] = variables as JsonObject[];
		return { [G.json]: body };
	}

	private actionCall(c: CallNode, path: JsonPath): JsonObject | undefined {
		const kind = this.index.actionKinds.get(c.name.text);
		if (!kind) {
			this.report('unknown-kind', this.unknownKind(c.name.text, 'action', this.index.actionKinds.keys()), c.name.range);
			return undefined;
		}
		const body = c.args ? this.kindArgs(kind, c.args, [...path, kind.json]) : {};
		if (!body) return undefined;
		const G = this.v.groupReference;
		const S = this.v.sequence;
		if (kind.json === G.json) this.groupUses.push({ name: String(body[G.f.group_name] ?? ''), range: c.range, scope: this.scope, with: [] });
		if (kind.json === S.json) this.sequenceDefs.add(String(body[S.f.name] ?? ''));
		return { [kind.json]: body };
	}

	// An action in a field: an action term, a bare or called action kind, raw JSON or `none`.
	private actionTerm(t: Term, path: JsonPath): JsonObject | undefined {
		if (t.type === 'action') return this.action(t, path);
		if (t.type === 'call' || t.type === 'raw' || t.type === 'none') {
			const out = this.step(t, path);
			if (out) this.span(path, t.range);
			return out;
		}
		this.report('wrong-type', 'an action goes here', t.range);
		return undefined;
	}

	// --- Raw JSON (SPEC.md §11): it must type-check against the node it stands for.

	raw(message: string, t: RawNode): JsonObject | undefined {
		const problems: string[] = [];
		const json = normalize(this.index, message, t.json, problems);
		if (problems.length) {
			this.report('bad-raw', `the raw JSON is no ${typeName(message)}: ${problems[0]}`, t.range);
			return undefined;
		}
		if (holdsId(this.index, message, json)) this.rawRef(t.range);
		return json as JsonObject;
	}

	// A raw token that holds an id a file under ui/specs writes by name (SPEC.md §7.3), once for each token.
	private rawRef(range: Range) {
		if (this.rawRefs.some(d => d.range.start.offset === range.start.offset)) return;
		this.rawRefs.push(
			diagnostic(
				'raw-ref',
				'a file under ui/specs writes ids by name: format writes the names the table holds, and make sim/siml/names.json names what the sim registers',
				range,
			),
		);
	}

	private rawField(field: SchemaField, t: RawNode, whole: boolean, path: JsonPath): JsonValue | undefined {
		const problems: string[] = [];
		const json = normalizeField(this.index, field, t.json, whole, problems);
		if (problems.length) {
			this.report('bad-raw', `the raw JSON is no value of ${field.siml}: ${problems[0]}`, t.range);
			return undefined;
		}
		if (fieldHoldsId(this.index, field, json, whole)) this.rawRef(t.range);
		this.span(path, t.range);
		return json;
	}

	// --- Entries (SPEC.md §5.2): a section's lines that set the fields of its message.

	// Types an entry line of a section whose fields are `placed`, writing into `root`, and gives the path of each
	// value it writes. `set` holds the fields the section's lines have written.
	entry(s: Statement, placed: Placed[], root: JsonObject, set: Set<SchemaField>): JsonPath[] {
		const written: JsonPath[] = [];
		const find = (name: string, range: Range, raw = false) => {
			const p = placed.find(({ field: x }) => (raw ? x.json === name || x.name === name : x.siml === name || x.aliases.includes(name)));
			if (!p) {
				const names = raw
					? ''
					: didYouMean(
							name,
							placed.map(x => x.field.siml),
						);
				this.report(raw ? 'bad-raw' : 'unknown-field', `no field here is named ${name}${names}`, range);
				return undefined;
			}
			if (set.has(p.field) && !isList(p.field)) {
				this.report('duplicate-field', `${p.field.siml} is written twice`, range);
				return undefined;
			}
			set.add(p.field);
			return p;
		};
		const next = ({ field, at }: Placed): JsonPath => {
			const path = [...at, field.json];
			return isList(field) ? [...path, ((valueAt(root, path) as JsonValue[] | undefined) ?? []).length] : path;
		};
		const put = ({ field, at }: Placed, value: JsonValue | undefined, path: JsonPath) => {
			if (value === undefined) return;
			const holder = objectAt(root, at);
			if (isList(field)) ((holder[field.json] ??= []) as JsonValue[]).push(value);
			else holder[field.json] = value;
			written.push(path);
		};
		switch (s.type) {
			case 'field_entry': {
				const p = find(s.name.text, s.name.range);
				if (!p) break;
				if (!isList(p.field) && s.values.length > 1) {
					this.report('wrong-type', `${p.field.siml} takes one value`, s.values[1].range);
					break;
				}
				for (const value of s.values) {
					const at = next(p);
					put(p, this.single(p.field, value, at), at);
				}
				break;
			}
			case 'flag_list':
				for (const flag of s.flags) {
					const p = find(flag.name.text, flag.name.range);
					if (!p) continue;
					const at = next(p);
					const bare: Term = { type: 'call', name: flag.name, range: flag.range };
					put(p, flag.value ? this.single(p.field, flag.value, at) : this.bareFlag(p.field, bare), at);
				}
				break;
			case 'message_entry': {
				const p = find(s.name.text, s.name.range);
				if (!p) break;
				const at = next(p);
				put(p, this.single(p.field, { type: 'call', name: s.name, args: s.args, range: s.range }, at), at);
				break;
			}
			case 'raw_entry': {
				if (!isObject(s.value.json)) {
					this.report('bad-raw', 'a raw entry is a JSON object of the fields it sets', s.value.range);
					break;
				}
				for (const [key, value] of Object.entries(s.value.json)) {
					const p = find(key, s.value.range, true);
					if (!p) continue;
					const list = isList(p.field);
					const whole = list || p.field.printed === 'indexed' || p.field.printed === 'map';
					const typed = this.rawField(p.field, { type: 'raw', json: value, range: s.value.range }, whole, [...p.at, p.field.json]);
					for (const item of list && Array.isArray(typed) ? typed : [typed]) put(p, item, next(p));
				}
				break;
			}
		}
		return written;
	}
}
