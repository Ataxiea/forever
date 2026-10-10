// What may go at the cursor: the statement's tokens up to the cursor read by a partial parser of the grammar
// (sim/siml/SPEC.md §4), which stops where the tokens run out and says what it expected there. The parser of the
// SIML module reads whole statements and reports errors; this one reads a prefix and reports expectations.

import { contains, type Parsed } from './document.ts';
import {
	fieldNamespace,
	type JsonObject,
	type KindForm,
	lex,
	type SchemaField,
	type SectionDef,
	sectionFields,
	type SpellNamespace,
	STAT_ENUM,
	type Statement,
	type Token,
	TOP_WORDS,
	unitFieldOf,
	unitReference,
} from './siml.ts';
import { namedBy } from './symbols.ts';

export type Want =
	| { t: 'line'; column0: boolean } // A new statement: headers, top-level lines, the section's body.
	| { t: 'step'; prepull: boolean } // An action: the action keywords and kinds.
	| { t: 'time' } // A prepull row's time.
	| { t: 'value' } // An operand.
	| { t: 'words'; words: string[] } // Keywords that may come next.
	| { t: 'ref'; ns: SpellNamespace } // A name of a spell-like namespace, or item., other. or none.
	| { t: 'usable' } // An item after `item.`: one with a use.
	| { t: 'other' } // An OtherAction after `other.`.
	| { t: 'unit' }
	| { t: 'member' } // After `unit.`: an accessor head or a kind the unit prefixes.
	| { t: 'enum'; name: string }
	| { t: 'bool' }
	| { t: 'args'; message: string; kind?: KindForm; used: Set<string>; skip: Set<string> } // Named arguments.
	| { t: 'props'; head: string }
	| { t: 'strings'; of: 'group' | 'sequence' }
	| { t: 'placeholders'; group?: string }
	| { t: 'variables' }
	| { t: 'entries'; def: SectionDef } // An entry line's first field, or a slot word.
	| { t: 'flags'; def: SectionDef }
	| { t: 'field'; field: SchemaField } // A value of an entry's or a message's field.
	| { t: 'slot-item'; slot: string }
	| { t: 'slot-rest'; slot: string; item: string } // A suffix, or `+`.
	| { t: 'enchants'; slot: string; item?: string }
	| { t: 'specs' }
	| { t: 'use-path' }
	| { t: 'use-variables'; path: string };

// Where the cursor is: what is expected there, the word being written and the text it replaces.
export interface CursorContext {
	wants: Want[];
	prefix: string; // The text from the start of the word, or of the string, to the cursor.
	start: number; // Where the replaced text starts.
	end: number; // Where it ends: the cursor, or the end of a string the cursor is inside.
	string: boolean; // The cursor is inside a string.
	section?: string; // The section the statement belongs to.
	group?: string; // The group, when the section is one.
	headers: number; // How many headers come before the statement.
}

const GROUP = 'group';
const PREPULL = 'prepull';
const APL = 'apl';
const OPERATORS = new Set(['==', '!=', '>=', '>', '<=', '<', '+', '-', '*', '/']);
const AFTER_VALUE = ['and', 'or'];

// The tokens before the cursor ran out: what was expected there.
class End {
	readonly wants: Want[];
	constructor(wants: Want[]) {
		this.wants = wants;
	}
}

export function cursorContext(p: Parsed, offset: number): CursorContext | undefined {
	const { text } = p;
	if (insideTrivia(text, offset)) return undefined;
	const statement = statementAt(p, offset);
	const start = statement ? statement.range.start.offset : lineIndentEnd(text, offset);
	const lineEnd = text.indexOf('\n', offset);
	const tokens = lex(text.slice(start, lineEnd < 0 ? text.length : lineEnd)).tokens.map(t => ({ ...t, start: t.start + start, end: t.end + start }));
	const at = tokens.find(t => t.start < offset && offset <= t.end && t.kind !== 'punct' && t.kind !== 'bad');
	const before = tokens.filter(t => t.end <= (at ? at.start : offset));
	const after = tokens.filter(t => t.start >= offset);
	const located = sectionAt(p, statement, start);
	const ctx: CursorContext = {
		wants: [],
		prefix: at ? text.slice(at.start, offset) : '',
		start: at ? at.start : offset,
		end: at?.kind === 'string' ? at.end : offset,
		string: at?.kind === 'string',
		...located,
	};
	const column0 = (at ? at.start : offset) === lineStart(text, offset) && before.length === 0;
	try {
		new Reader(p, before, after, located.section).statement(column0);
	} catch (e) {
		if (!(e instanceof End)) throw e;
		ctx.wants = e.wants;
	}
	// A variable or placeholder being written is one wherever it stands.
	if (at?.kind === 'var' && ctx.wants.some(w => w.t === 'value' || w.t === 'time')) ctx.wants = [{ t: 'variables' }];
	if (at?.kind === 'placeholder') {
		const placeholders = ctx.wants.find(w => w.t === 'placeholders');
		ctx.wants = placeholders ? [placeholders] : ctx.wants.some(w => w.t === 'value' || w.t === 'time') ? [{ t: 'placeholders', group: located.group }] : [];
	}
	if (at?.kind === 'var' && !ctx.wants.some(w => w.t === 'variables' || w.t === 'use-variables')) ctx.wants = [];
	return ctx;
}

const lineStart = (text: string, offset: number) => text.lastIndexOf('\n', offset - 1) + 1;

function lineIndentEnd(text: string, offset: number): number {
	let i = lineStart(text, offset);
	while (i < offset && (text[i] === ' ' || text[i] === '\t')) i++;
	return i;
}

// Whether the cursor is in a `//` comment or a `///` note.
function insideTrivia(text: string, offset: number): boolean {
	const from = lineStart(text, offset);
	return lex(text.slice(from, offset)).trivia.some(t => t.type === 'comment' || t.type === 'note');
}

// The statement the cursor is in: one it lies inside, or the last one before it that it continues, on its last line
// or on a deeper-indented line below with no blank line between.
function statementAt(p: Parsed, offset: number): Statement | undefined {
	const { text } = p;
	let last: Statement | undefined;
	for (const s of p.parse.tree.statements) {
		if (s.range.start.offset >= offset) break;
		last = s;
	}
	if (!last) return undefined;
	if (contains(last.range, offset)) return last;
	const between = text.slice(last.range.end.offset, offset);
	if (!between.includes('\n')) return last;
	if (last.type === 'header' && !last.body) return undefined;
	if (/\n[ \t]*\r?\n/.test(between)) return undefined;
	const indentOf = (at: number) => {
		let i = lineStart(text, at);
		const from = i;
		while (text[i] === ' ' || text[i] === '\t') i++;
		return i - from;
	};
	const cursorIndent = Math.min(indentOf(offset), offset - lineStart(text, offset));
	return cursorIndent > indentOf(last.range.start.offset) && last.type !== 'header' ? last : undefined;
}

// The section a statement belongs to: the last header at or before it, else the section a section file implies.
function sectionAt(p: Parsed, statement: Statement | undefined, start: number): { section?: string; group?: string; headers: number } {
	const kind = p.parse.kind.section;
	let out: { section?: string; group?: string; headers: number } = { section: kind === GROUP ? undefined : kind, headers: 0 };
	for (const s of p.parse.tree.sections) {
		if (s.header && s.header.range.start.offset <= start) out = { section: s.name, group: s.group, headers: out.headers + 1 };
	}
	if (statement?.type === 'header') {
		const own = p.parse.tree.sections.find(s => s.header === statement);
		if (own) out = { ...out, section: own.name, group: own.group };
	}
	return out;
}

class Reader {
	private i = 0;
	private readonly p: Parsed;
	private readonly ts: Token[]; // The statement's tokens before the word at the cursor.
	private readonly after: Token[]; // The tokens after the cursor, which only say what an accessor goes on to.
	private readonly section?: string;

	constructor(p: Parsed, tokens: Token[], after: Token[], section: string | undefined) {
		this.p = p;
		this.ts = tokens;
		this.after = after;
		this.section = section;
	}

	private get index() {
		return this.p.ws.index;
	}

	private get t(): Token | undefined {
		return this.ts[this.i];
	}

	private peek(k = 1): Token | undefined {
		return this.ts[this.i + k];
	}

	private is(text: string, t = this.t): boolean {
		return t !== undefined && (t.kind === 'punct' || t.kind === 'ident') && t.text === text;
	}

	// Throws what is expected when the tokens have run out.
	private need(...wants: Want[]): void {
		if (this.i >= this.ts.length) throw new End(wants);
	}

	// The tokens before the cursor do not read: nothing is offered.
	private fail(): never {
		throw new End([]);
	}

	private take(text?: string): Token {
		const t = this.t;
		if (!t || (text !== undefined && !this.is(text))) this.fail();
		this.i++;
		return t;
	}

	statement(column0: boolean): void {
		const def = this.section === undefined ? undefined : this.index.sections.get(this.section);
		if (this.i >= this.ts.length) throw new End([{ t: 'line', column0 }, ...this.bodyStart(def)]);
		const [a, b, c] = [this.t!, this.peek(), this.peek(2)];
		// A header, and the body line written after its colon.
		if (a.kind === 'ident' && this.is(':', b)) {
			this.i += 2;
			return this.body(this.index.sections.get(a.text));
		}
		if (this.is(GROUP, a) && b?.kind === 'string' && this.is(':', c)) {
			this.i += 3;
			return this.body(this.index.sections.get(GROUP));
		}
		if (a.kind === 'ident' && TOP_WORDS.has(a.text) && !this.is('=', b) && (a.text !== 'var' || this.allowsVar(def))) return this.top();
		if (!def) this.fail();
		return this.body(def);
	}

	private allowsVar(def: SectionDef | undefined): boolean {
		return def === undefined || def.name === APL || def.name === GROUP || this.section === undefined;
	}

	// What a body line of the section starts with.
	private bodyStart(def: SectionDef | undefined): Want[] {
		if (!def) return [];
		if (def.body.includes('rows')) return def.name === PREPULL ? [{ t: 'time' }] : [{ t: 'step', prepull: false }];
		return [{ t: 'entries', def }];
	}

	private body(def: SectionDef | undefined): void {
		if (!def) this.fail();
		this.need(...this.bodyStart(def));
		if (def.body.includes('rows')) {
			if (this.is('var')) return this.varLine();
			return this.row(def.name === PREPULL);
		}
		return this.entry(def);
	}

	// --- Top-level lines.

	private top(): void {
		const word = this.take().text;
		switch (word) {
			case 'siml':
				return this.need({ t: 'words', words: ['1'] });
			case 'spec':
				return this.need({ t: 'specs' });
			case 'talents':
				return this.need();
			case 'use': {
				this.need({ t: 'use-path' });
				const path = this.take().value ?? '';
				this.need({ t: 'words', words: ['with'] });
				this.take('with');
				for (;;) {
					this.need({ t: 'use-variables', path });
					this.take();
					this.need();
					this.take('=');
					this.expr([]);
					this.take(',');
				}
			}
			case 'var':
				this.i--;
				return this.varLine();
		}
	}

	private varLine(): void {
		this.take('var');
		this.need();
		this.take();
		this.need();
		this.take('=');
		this.expr([]);
	}

	// --- Rows and actions.

	private row(prepull: boolean): void {
		if (this.is('#')) this.i++;
		if (prepull) {
			this.need({ t: 'time' });
			this.unary();
		}
		this.action(prepull);
	}

	private action(prepull: boolean): void {
		const trailing = this.step(prepull);
		this.need({ t: 'words', words: [...trailing, 'if'] });
		if (this.is('if')) {
			this.i++;
			this.expr([]);
		}
	}

	// Reads a step, and gives the words that may still follow it before its `if`.
	private step(prepull: boolean): string[] {
		this.need({ t: 'step', prepull });
		const t = this.t!;
		if (t.kind === 'raw') {
			this.i++;
			return [];
		}
		if (t.kind !== 'ident') this.fail();
		this.i++;
		switch (t.text) {
			case 'cast':
			case 'channel': {
				this.ref('spell');
				const left = t.text === 'cast' ? ['on'] : ['on', 'until', 'recast'];
				for (;;) {
					this.need({ t: 'words', words: [...left, 'if'] });
					const word = this.t!.text;
					if (!left.includes(word) || this.t!.kind !== 'ident') return left;
					this.i++;
					left.splice(left.indexOf(word), 1);
					if (word === 'on') {
						this.need({ t: 'unit' });
						this.i++;
					} else if (word === 'until') {
						this.expr([...left, 'if']);
					}
				}
			}
			case 'wait':
			case 'move': {
				const word = t.text === 'wait' ? 'until' : 'for';
				this.need({ t: 'value' }, { t: 'words', words: [word] });
				if (this.is(word)) this.i++;
				this.expr(['if']);
				return [];
			}
			case 'group': {
				this.need({ t: 'strings', of: 'group' });
				const name = this.take();
				if (name.kind !== 'string') this.fail();
				this.need({ t: 'words', words: ['with', 'if'] });
				if (!this.is('with')) return ['with'];
				this.i++;
				for (;;) {
					this.need({ t: 'placeholders', group: name.value });
					this.take();
					this.need();
					this.take('=');
					this.expr(['if']);
					if (!this.is(',') || this.peek()?.kind !== 'placeholder') return [];
					this.i++;
				}
			}
			case 'schedule':
				if (this.t?.kind !== 'string') return this.call(t.text, true);
				this.i++;
				return this.step(prepull);
			case 'sequence': {
				if (this.t?.kind !== 'string') return this.call(t.text, true);
				this.i++;
				this.need();
				this.take('[');
				for (;;) {
					if (this.is(']')) {
						this.i++;
						return [];
					}
					this.action(false);
					this.need();
					if (this.is(']')) continue;
					this.take(',');
				}
			}
			case 'none':
				return [];
			default:
				return this.call(t.text, true);
		}
	}

	// A kind written by name, with its arguments when a `(` follows.
	private call(name: string, action: boolean): string[] {
		const kind = (action ? this.index.actionKinds : this.index.valueKinds).get(name);
		if (this.is('(')) {
			if (!kind) this.fail();
			this.args(kind.message, kind, undefined, new Set());
		}
		return [];
	}

	// --- Expressions.

	// An expression, and the words `after` the caller takes once it is complete.
	private expr(after: string[]): void {
		for (;;) {
			this.unary();
			this.need({ t: 'words', words: [...AFTER_VALUE, ...after] });
			const t = this.t!;
			if ((t.kind === 'punct' && OPERATORS.has(t.text)) || this.is('and') || this.is('or')) {
				this.i++;
				continue;
			}
			return;
		}
	}

	private unary(): void {
		this.need({ t: 'value' });
		if (this.is('not') && !(this.is('(', this.peek()) && this.peek()!.start === this.t!.end)) {
			this.i++;
			return this.unary();
		}
		if (this.is('-')) {
			this.i++;
			this.need();
		}
		if (this.is('(')) {
			this.i++;
			this.expr([]);
			this.need();
			this.take(')');
			return;
		}
		this.operand();
	}

	private operand(): void {
		const t = this.t!;
		const next = this.peek();
		if (t.kind === 'number' || t.kind === 'string' || t.kind === 'raw' || t.kind === 'var' || t.kind === 'placeholder') {
			this.i++;
			return;
		}
		if (this.is('[')) return this.skipTerm();
		if (t.kind !== 'ident') this.fail();
		const word = t.text;
		if (word === 'true' || word === 'false' || word === 'none') {
			this.i++;
			return;
		}
		if ((word === 'item' || word === 'other') && this.is('.', next)) {
			this.i += 2;
			this.need(word === 'item' ? { t: 'usable' } : { t: 'other' });
			this.i++;
			return;
		}
		if (this.is('.', next) && unitReference(this.index, word)) {
			this.i += 2;
			this.need({ t: 'member' });
			const member = this.take();
			if (this.index.heads.has(member.text) && this.is('(')) return this.accessor(member.text, word);
			return;
		}
		if (this.index.heads.has(word) && this.is('(', next)) {
			this.i++;
			return this.accessor(word, undefined);
		}
		if ((word === 'and' || word === 'or' || word === 'not') && this.is('(', next) && next!.start === t.end) {
			const kind = this.index.valueKinds.get(word)!;
			this.i++;
			this.args(kind.message, kind, undefined, new Set());
			return;
		}
		this.i++;
		this.call(word, false);
	}

	// `head(subject).prop(args)`, after the head.
	private accessor(head: string, unitWord: string | undefined): void {
		this.take('(');
		const kinds = [...this.index.accessors.values()].filter(k => k.accessor!.head === head);
		const prop = this.lookaheadProp();
		const kind = kinds.find(k => k.accessor!.prop === prop) ?? kinds[0];
		if (!kind) this.fail();
		const subject = this.index.protoField(kind.message, kind.accessor!.subject)!;
		if (subject.printed === 'string') {
			this.need({ t: 'strings', of: 'sequence' });
			this.i++;
		} else {
			const unit = unitWord !== undefined ? unitReference(this.index, unitWord) : this.lookaheadUnit(kind);
			this.ref(fieldNamespace(this.index, kind, subject, unit));
		}
		this.need();
		this.take(')');
		this.need();
		this.take('.');
		this.need({ t: 'props', head });
		const propKind = this.index.accessors.get(`${head}.${this.take().text}`);
		if (!this.is('(')) return;
		if (!propKind) this.fail();
		const skip = new Set([propKind.accessor!.subject, ...(unitWord !== undefined && propKind.accessor!.unit ? [propKind.accessor!.unit] : [])]);
		this.args(propKind.message, propKind, unitWord === undefined ? undefined : unitReference(this.index, unitWord), skip);
	}

	// The property an accessor whose subject the cursor is in goes on to, read from the text after the cursor.
	private lookaheadProp(): string | undefined {
		const close = this.closing(this.after, 0);
		const dot = this.after[close + 1];
		const prop = this.after[close + 2];
		return close >= 0 && dot?.text === '.' && prop?.kind === 'ident' ? prop.text : undefined;
	}

	// The unit an accessor's property argument gives, read from the text after the cursor: an aura's namespace
	// follows its unit, written before or after the aura (SPEC.md §7.2).
	private lookaheadUnit(kind: KindForm): JsonObject | undefined {
		const unitField = unitFieldOf(this.index, kind);
		const close = this.closing(this.after, 0);
		if (!unitField || close < 0 || this.after[close + 3]?.text !== '(') return undefined;
		const end = this.closing(this.after, close + 4);
		for (let k = close + 4; k + 2 < (end < 0 ? this.after.length : end); k++) {
			const [name, eq, value] = [this.after[k], this.after[k + 1], this.after[k + 2]];
			if (name.kind === 'ident' && (name.text === unitField.siml || unitField.aliases.includes(name.text)) && eq.text === '=' && value.kind === 'ident') {
				return unitReference(this.index, value.text);
			}
		}
		return undefined;
	}

	// The index in `tokens` of the `)` that closes the bracket open before `from`, or -1.
	private closing(tokens: Token[], from: number): number {
		let depth = 0;
		for (let k = from; k < tokens.length; k++) {
			const text = tokens[k].text;
			if (tokens[k].kind !== 'punct') continue;
			if (text === '(' || text === '[') depth++;
			else if (text === ')' || text === ']') {
				if (depth === 0) return text === ')' ? k : -1;
				depth--;
			}
		}
		return -1;
	}

	// A ref: a name of `ns`, `item.<name>`, `other.<short>`, `none` or raw JSON.
	private ref(ns: SpellNamespace): void {
		this.need({ t: 'ref', ns });
		const t = this.t!;
		if ((t.text === 'item' || t.text === 'other') && this.is('.', this.peek())) {
			this.i += 2;
			this.need(t.text === 'item' ? { t: 'usable' } : { t: 'other' });
		}
		this.i++;
	}

	// The arguments of a kind or a message, from its `(`. `skip` holds fields the form fills elsewhere: an accessor's
	// subject and the unit its prefix gives.
	private args(message: string, kind: KindForm | undefined, unit: JsonObject | undefined, skip: Set<string>): void {
		this.take('(');
		const used = new Set<string>();
		const fields = this.index.fields(message);
		const list = kind?.listField ? fields.find(f => f.name === kind.listField) : undefined;
		let positional = list ?? (kind?.positional && !skip.has(kind.positional) ? this.index.protoField(message, kind.positional) : undefined);
		for (;;) {
			const wants: Want[] = [{ t: 'args', message, kind, used, skip }];
			if (positional && !used.has(positional.name)) wants.push(...this.fieldWants(positional, kind, unit));
			this.need(...wants);
			if (this.is(')')) {
				this.i++;
				return;
			}
			const t = this.t!;
			const named = t.kind === 'ident' && this.is('=', this.peek()) ? this.index.field(message, t.text) : undefined;
			const bare = t.kind === 'ident' && !this.is('(', this.peek()) ? this.index.field(message, t.text) : undefined;
			const nested = t.kind === 'ident' && this.is('(', this.peek()) ? this.index.field(message, t.text) : undefined;
			if (named) {
				this.i += 2;
				this.need(...this.fieldWants(named, kind, unit));
				this.term(named, kind, unit);
				used.add(named.name);
				if (named.printed === 'unit' && this.ts[this.i - 1]?.kind === 'ident') unit = unitReference(this.index, this.ts[this.i - 1].text) ?? unit;
			} else if (bare?.printed === 'bool') {
				this.i++;
				used.add(bare.name);
			} else if (nested && (nested.printed === 'message' || nested.printed === 'indexed')) {
				this.i++;
				this.messageValue(nested);
				if (!nested.repeated) used.add(nested.name);
			} else if (positional) {
				this.term(positional, kind, unit);
				if (positional !== list) {
					used.add(positional.name);
					positional = undefined;
				}
			} else {
				this.fail();
			}
			this.need();
			if (this.is(')')) continue;
			this.take(',');
		}
	}

	// A message field's value written `field(...)`, after the field's name.
	private messageValue(field: SchemaField): void {
		if (field.printed === 'indexed') {
			this.take('(');
			for (;;) {
				this.need({ t: 'enum', name: field.index! });
				if (this.is(')')) {
					this.i++;
					return;
				}
				this.take();
				this.need();
				this.take('=');
				this.need();
				this.skipTerm();
				this.need();
				if (this.is(')')) continue;
				this.take(',');
			}
		}
		this.args(field.type!, undefined, undefined, new Set());
	}

	// What a value of `field` may be.
	private fieldWants(field: SchemaField, kind: KindForm | undefined, unit: JsonObject | undefined): Want[] {
		switch (field.printed) {
			case 'value':
				return [{ t: 'value' }];
			case 'action':
				return [{ t: 'step', prepull: false }];
			case 'action_id':
				return [{ t: 'ref', ns: fieldNamespace(this.index, kind, field, unit) }];
			case 'unit':
				return [{ t: 'unit' }];
			case 'enum':
			case 'flag_enum':
				return [{ t: 'enum', name: field.type! }];
			case 'stat':
				return [{ t: 'enum', name: STAT_ENUM }];
			case 'bool':
				return [{ t: 'bool' }];
			case 'ref':
			case 'message':
				return [{ t: 'field', field }];
			case 'string': {
				const named = namedBy(this.index, kind, field.name);
				return named ? [{ t: 'strings', of: named }] : [];
			}
			default:
				return [];
		}
	}

	// A term of `field`: a list in brackets for a list field, else one value.
	private term(field: SchemaField, kind: KindForm | undefined, unit: JsonObject | undefined): void {
		if (field.repeated && field.printed !== 'indexed' && this.is('[')) {
			this.i++;
			for (;;) {
				this.need(...this.fieldWants(field, kind, unit));
				if (this.is(']')) {
					this.i++;
					return;
				}
				this.single(field, kind, unit);
				this.need();
				if (this.is(']')) continue;
				this.take(',');
			}
		}
		this.single(field, kind, unit);
	}

	private single(field: SchemaField, kind: KindForm | undefined, unit: JsonObject | undefined): void {
		switch (field.printed) {
			case 'value':
				return this.expr([]);
			case 'action':
				return this.action(false);
			case 'action_id':
				return this.ref(fieldNamespace(this.index, kind, field, unit));
			case 'message':
			case 'indexed':
				if (this.t?.kind === 'ident' && this.is('(', this.peek())) {
					this.i++;
					return this.messageValue(field);
				}
				return this.skipTerm();
			default:
				return this.skipTerm();
		}
	}

	// Steps over a term whose parts offer nothing: a value, with its arguments or brackets, up to the `,` or closing
	// bracket that ends it.
	private skipTerm(): void {
		let depth = 0;
		for (;;) {
			this.need();
			if (depth === 0 && (this.is(',') || this.is(')') || this.is(']'))) return;
			const t = this.take();
			if (t.kind === 'punct' && (t.text === '(' || t.text === '[')) depth++;
			else if (t.kind === 'punct' && (t.text === ')' || t.text === ']')) depth--;
			if (depth > 0 || (t.kind === 'punct' && (t.text === '-' || t.text === '.'))) continue;
			if (this.is('(') || this.is('[') || this.is('.')) continue;
			return;
		}
	}

	// --- Entries and slot rows.

	private entry(def: SectionDef): void {
		const t = this.take();
		if (t.kind !== 'ident') this.fail();
		if (def.body.includes('slot_rows') && this.index.slots.has(t.text)) return this.slotRow(t.text);
		if (t.text === 'var' && def.body.includes('var')) {
			this.i--;
			return this.varLine();
		}
		const field = this.entryField(def, t.text);
		if (!field) this.fail();
		if (this.is('(') && (field.printed === 'message' || field.printed === 'indexed')) return this.messageValue(field);
		if (this.is('=') || this.is(',')) return this.flags(def, field);
		for (;;) {
			this.need(...this.fieldWants(field, undefined, undefined));
			this.single(field, undefined, undefined);
			this.need();
			this.take(',');
		}
	}

	// A flag list, after its first flag's name.
	private flags(def: SectionDef, first: SchemaField): void {
		let field = first;
		for (;;) {
			if (this.is('=')) {
				this.i++;
				this.need(...this.fieldWants(field, undefined, undefined));
				this.single(field, undefined, undefined);
			}
			this.need();
			this.take(',');
			this.need({ t: 'flags', def });
			const next = this.entryField(def, this.take().text);
			if (!next) this.fail();
			field = next;
		}
	}

	private entryField(def: SectionDef, name: string): SchemaField | undefined {
		const placed = sectionFields(this.index, def, this.p.spec);
		return placed.find(p => p.field.siml === name || p.field.aliases.includes(name))?.field;
	}

	private slotRow(slot: string): void {
		this.need({ t: 'slot-item', slot });
		const item = this.take();
		if (item.kind !== 'ident') this.fail();
		this.need({ t: 'slot-rest', slot, item: item.text });
		if (this.t!.kind === 'ident') {
			this.i++;
			this.need({ t: 'words', words: ['+'] });
		}
		this.take('+');
		this.need({ t: 'enchants', slot, item: item.text });
		this.fail();
	}
}
