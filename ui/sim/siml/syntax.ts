// SIML text into its syntax tree (SPEC.md §3, §4, §10): lines into statements, statements into sections, and
// each statement read on its own, so a bad one costs only itself. Typing gives the nodes their meaning.

import { lex, type LineMap, type Token } from './lexer.ts';
import type { SchemaIndex, SectionDef } from './schema.ts';
import type {
	ActionNode,
	Arg,
	Args,
	CompareOp,
	DiagnosticCode,
	Expr,
	Flag,
	HeaderStatement,
	JsonValue,
	ListNode,
	MathOp,
	Name,
	Note,
	PlaceholderBind,
	PlaceholderNode,
	Range,
	RawNode,
	Section,
	SimlDiagnostic,
	SimlKind,
	Statement,
	Step,
	StringNode,
	SyntaxTree,
	Term,
	Trivia,
	VarBind,
	VarNode,
} from './types.ts';

export interface SyntaxResult {
	tree: SyntaxTree;
	diagnostics: SimlDiagnostic[];
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
// A statement before its range and trivia are known.
type Draft = DistributiveOmit<Statement, 'range' | 'leading' | 'inner'>;

const APL = 'apl';
const GEAR = 'gear';
const GROUP = 'group';
const PREPULL = 'prepull'; // The rows section whose rows start with their time and take no notes.

// Words that end an expression or start an action, and so never read as a name or value.
export const STOP_WORDS: ReadonlySet<string> = new Set([
	'if',
	'on',
	'until',
	'recast',
	'for',
	'with',
	'and',
	'or',
	'not',
	'cast',
	'channel',
	'wait',
	'move',
	'group',
]);
// Words that start a top-level line, unless `=` follows: then the line is an entry (SPEC.md §4 note 5).
export const TOP_WORDS: ReadonlySet<string> = new Set(['siml', 'spec', 'talents', 'use', 'var']);
const COMPARE_OPS = new Set(['==', '!=', '>=', '>', '<=', '<']);
const INT = /^[0-9]+$/;
const NO_ENDS: ReadonlySet<string> = new Set();
const ARG_ENDS: ReadonlySet<string> = new Set([',', ')']);
const LIST_ENDS: ReadonlySet<string> = new Set([',', ']']);
const ENTRY_ENDS: ReadonlySet<string> = new Set([',']);

const join = (a: { range: Range }, b: { range: Range }): Range => ({ start: a.range.start, end: b.range.end });

// The file kind of a path's double extension: `p1.gear.siml` holds the gear section, `x.siml` any sections.
export function kindOf(path: string): SimlKind {
	const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
	if (!base.endsWith('.siml')) return {};
	const stem = base.slice(0, -'.siml'.length);
	const dot = stem.lastIndexOf('.');
	return dot > 0 && dot < stem.length - 1 ? { section: stem.slice(dot + 1) } : {};
}

export function parseSyntax(text: string, index: SchemaIndex, kind: SimlKind): SyntaxResult {
	return new FileParser(text, index, kind).run();
}

// A fatal error in a statement: the statement is left unread.
class Failure extends Error {
	readonly code: DiagnosticCode;
	readonly start: number;
	readonly end: number;
	readonly atEnd: boolean; // At the end of the statement's readable tokens rather than at a token.

	constructor(code: DiagnosticCode, message: string, start: number, end: number, atEnd: boolean) {
		super(message);
		this.code = code;
		this.start = start;
		this.end = end;
		this.atEnd = atEnd;
	}
}

// The tokens of each statement (SPEC.md §3.1). A statement continues while a bracket is open, and, unless it is a
// header, onto a later line indented deeper than its first, with no blank line between, that does not itself
// start with a header; comment lines never decide.
function statementsOf(tokens: Token[], trivia: Trivia[], lines: LineMap): Token[][] {
	const blank = new Set(trivia.filter(t => t.type === 'blank').map(t => t.range.start.line));
	const out: Token[][] = [];
	let i = 0;
	while (i < tokens.length) {
		const indent = lines.position(tokens[i].start).character;
		const header = headerShape(tokens, i, lines);
		const open: Token[] = [];
		let j = i;
		for (; ; j++) {
			const t = tokens[j];
			if (t.kind === 'punct' && (t.text === '(' || t.text === '[')) open.push(t);
			else if (t.kind === 'punct' && (t.text === ')' || t.text === ']')) open.pop();
			const next = tokens[j + 1];
			if (!next) break;
			const endLine = lines.line(t.end - 1);
			const nextLine = lines.line(next.start);
			if (nextLine === endLine || open.length) continue;
			let gap = false;
			for (let l = endLine + 1; l < nextLine && !gap; l++) gap = blank.has(l);
			if (gap || header || lines.position(next.start).character <= indent || headerShape(tokens, j + 1, lines)) break;
		}
		if (open.length)
			open[0].error = { code: 'unclosed-bracket', message: `this '${open[0].text}' is never closed`, start: open[0].start, end: open[0].end };
		out.push(tokens.slice(i, j + 1));
		i = j + 1;
	}
	return out;
}

// `name:` or `group "Name":` on the statement's first line. A header-shaped statement is a header wherever it
// starts; one that does not start at column 1 is `indented-header`.
function headerShape(tokens: Token[], i: number, lines: LineMap): boolean {
	const [a, b, c] = [tokens[i], tokens[i + 1], tokens[i + 2]];
	const sameLine = (t: Token) => lines.line(t.start) === lines.line(a.start);
	const colon = (t: Token | undefined) => t?.kind === 'punct' && t.text === ':' && sameLine(t);
	if (a.kind !== 'ident' || a.error) return false;
	return colon(b) || (a.text === GROUP && b?.kind === 'string' && !b.error && colon(c));
}

// The sections a file kind holds: all of them in a full file, and its own in a section file. An x.apl.siml holds the
// rotation, every section whose fields all lie in the apl section's message.
export function fileSections(index: SchemaIndex, kind: SimlKind): Set<string> {
	if (kind.section === undefined) return new Set(index.sections.keys());
	const own = index.sections.get(kind.section);
	const allowed = new Set<string>();
	if (!own) return allowed;
	allowed.add(own.name);
	const root = own.sources[0]?.path;
	const within = (def: SectionDef) => root !== undefined && def.sources.length > 0 && def.sources.every(s => root.every((seg, k) => s.path[k] === seg));
	for (const def of index.sections.values()) {
		if (own.name === APL && within(def)) allowed.add(def.name);
	}
	return allowed;
}

class FileParser {
	private readonly index: SchemaIndex;
	private readonly kind: SimlKind;
	private readonly tokens: Token[];
	private readonly trivia: Trivia[];
	private readonly lines: LineMap;
	private readonly allowed: Set<string>;
	private readonly diagnostics: SimlDiagnostic[] = [];
	private readonly statements: Statement[] = [];
	private readonly top: Statement[] = [];
	private readonly sections: Section[] = [];
	private readonly present = new Set<string>();
	private nextTrivia = 0;
	private implied: Section | undefined;
	private section: Section | undefined;
	private def: SectionDef | undefined;
	private skip = false; // The current header names no section, so its statements are not read.
	private seenHeader = false;
	private seenSpec = false;
	private seenTalents = false;
	private versionFirst = false;

	constructor(text: string, index: SchemaIndex, kind: SimlKind) {
		const lexed = lex(text);
		this.index = index;
		this.kind = kind;
		this.tokens = lexed.tokens;
		this.trivia = lexed.trivia;
		this.lines = lexed.lines;
		this.allowed = fileSections(index, kind);
	}

	run(): SyntaxResult {
		this.openImplied();
		statementsOf(this.tokens, this.trivia, this.lines).forEach((toks, n) => this.physical(toks, n === 0));
		if (!this.versionFirst) {
			const range = this.statements[0]?.range ?? this.lines.range(0, 0);
			this.diagnostics.push(diagnostic('missing-version', 'a file starts with siml 1', range));
		}
		const trailing = this.trivia.slice(this.nextTrivia);
		if (!this.skip) for (const t of trailing) if (t.type === 'note') this.misplacedNote(t);
		for (const s of this.sections) s.range = this.sectionRange(s);
		this.diagnostics.sort((a, b) => a.range.start.offset - b.range.start.offset);
		return { tree: { statements: this.statements, top: this.top, sections: this.sections, trailing }, diagnostics: this.diagnostics };
	}

	private openImplied() {
		const name = this.kind.section;
		if (name === undefined) return;
		const def = this.index.sections.get(name);
		const range = this.lines.range(0, 0);
		if (!def) this.diagnostics.push(diagnostic('unknown-section', `the file name names no section: ${name}`, range));
		this.implied = { name, body: [], range };
		this.sections.push(this.implied);
		this.present.add(name);
		this.section = this.implied;
		this.def = def;
		this.skip = !def;
	}

	private physical(toks: Token[], first: boolean) {
		const p = new Parser(toks, this.lines);
		const start = toks[0].start;
		const end = toks[toks.length - 1].end;
		const leading = this.triviaBefore(this.lines.line(start));
		const inner = this.triviaBefore(this.lines.line(end - 1) + 1);
		let statement: Statement;
		let row = false;
		if (headerShape(toks, 0, this.lines)) {
			statement = this.header(p, end);
		} else if (p.atEnd()) {
			// Its first token has a lexer error, which is all there is to report.
			statement = this.statement({ type: 'unparsed' }, start, end);
			(this.section?.body ?? this.top).push(statement);
		} else {
			const read = this.line(p, first);
			row = read.row;
			statement = this.statement(read.fields, start, end);
			(read.place?.body ?? this.top).push(statement);
		}
		statement.leading = leading;
		statement.inner = inner;
		this.attachNotes(statement, row);
		this.statements.push(statement);
		toks.forEach((t, k) => {
			if (t.error && k < p.suppressFrom) this.diagnostics.push(diagnostic(t.error.code, t.error.message, this.lines.range(t.error.start, t.error.end)));
		});
		this.diagnostics.push(...p.diagnostics);
	}

	private statement(fields: Draft, start: number, end: number): Statement {
		return { ...fields, range: this.lines.range(start, end), leading: [], inner: [] } as Statement;
	}

	private triviaBefore(line: number): Trivia[] {
		const out: Trivia[] = [];
		while (this.nextTrivia < this.trivia.length && this.trivia[this.nextTrivia].range.start.line < line) out.push(this.trivia[this.nextTrivia++]);
		return out;
	}

	private header(p: Parser, end: number): HeaderStatement {
		const nameTok = p.take();
		const name = p.name(nameTok);
		const group = nameTok.text === GROUP && p.peek()?.kind === 'string' ? p.stringNode(p.take()) : undefined;
		p.take();
		const header: HeaderStatement = { type: 'header', name, group, range: this.lines.range(nameTok.start, end), leading: [], inner: [] };
		if (name.range.start.character > 0) p.report('indented-header', 'a section header starts at column 1', name.range);
		this.open(p, header);
		if (!p.atEnd()) {
			const read = this.line(p, false);
			header.body = this.statement(read.fields, read.start, end);
			(read.place?.body ?? this.top).push(header.body);
		}
		return header;
	}

	private open(p: Parser, header: HeaderStatement) {
		const { name, group } = header;
		const def = this.index.sections.get(name.text);
		this.seenHeader = true;
		let skip = false;
		if (!def) {
			p.report('unknown-section', `no section is named ${name.text}`, name.range);
			skip = true;
		} else if (def.name === GROUP && !group) {
			p.report('parse', 'a group header names its group: group "Name":', name.range);
			skip = true;
		} else {
			if (!this.allowed.has(def.name)) p.report('section-not-allowed', `an x.${this.kind.section}.siml file holds no ${def.name}: section`, name.range);
			const implied = this.implied;
			// A group's header names its group, so it opens a section of its own.
			if (implied && implied.name === def.name && !implied.header && !group) {
				implied.header = header;
				this.section = implied;
				this.def = def;
				this.skip = false;
				return;
			}
			const key = group ? `${GROUP} ${group.value}` : def.name;
			if (this.present.has(key)) {
				if (group) p.report('duplicate-group', `group "${group.value}" is written twice`, group.range);
				else p.report('duplicate-section', `${def.name}: is written twice`, name.range);
			}
			this.present.add(key);
		}
		this.section = { name: name.text, group: group?.value, header, body: [], range: header.range };
		this.sections.push(this.section);
		this.def = skip ? undefined : def;
		this.skip = skip;
	}

	// One statement that is not a header, in the current section.
	private line(p: Parser, first: boolean): { fields: Draft; place: Section | undefined; row: boolean; start: number } {
		const t = p.peek()!;
		const start = t.start;
		const word = t.kind === 'ident' && !(TOP_WORDS.has(t.text) && p.isPunct('=', 1)) ? t.text : undefined;
		const top = (fields: Draft) => ({ fields, place: undefined, row: false, start });
		const here = (fields: Draft, row = false) => ({ fields, place: this.section, row, start });
		if (word === 'siml') {
			if (first) this.versionFirst = true;
			else p.report('misplaced-statement', 'siml 1 is the first line of a file', p.range(t.start, t.end));
			return top(attempt(p, () => p.version()));
		}
		if (word === 'spec' || word === 'talents' || word === 'use') {
			const repeated = (word === 'spec' && this.seenSpec) || (word === 'talents' && this.seenTalents);
			if (repeated) p.report('misplaced-statement', `${word} is written once`, p.range(t.start, t.end));
			else if (this.seenHeader) p.report('misplaced-statement', `${word} goes before the first section header`, p.range(t.start, t.end));
			this.seenSpec ||= word === 'spec';
			this.seenTalents ||= word === 'talents';
			return top(attempt(p, () => (word === 'spec' ? p.spec() : word === 'talents' ? p.talents() : p.use())));
		}
		if (this.skip) return here({ type: 'unparsed' });
		if (this.section === this.implied && this.kind.section === GROUP)
			p.report('misplaced-statement', 'in an x.group.siml, a row or var line goes under a group "Name": header', p.range(t.start, t.end));
		if (word === 'var') {
			if (this.def && !this.def.body.includes('var'))
				p.report('misplaced-var', 'var goes at the top of a file, under apl: or under a group', p.range(t.start, t.end));
			const fields = attempt(p, () => p.varDecl());
			return this.section ? here(fields) : top(fields);
		}
		if (!this.def) return top(attempt(p, () => p.fail('this line goes under a section header, such as priority: or settings:')));
		const body = this.def.body;
		if (body.includes('rows')) return here(this.row(p, this.def.name === PREPULL), true);
		const slotRowsOnly = this.kind.section === GEAR && this.section === this.implied; // An x.gear.siml holds slot rows only.
		if (body.includes('slot_rows') && (slotRowsOnly || this.index.slots.has(word ?? ''))) return here(attempt(p, () => p.slotRow()));
		return here(attempt(p, () => p.entry()));
	}

	// A row; a hidden row that does not read is `bad-hidden-row` alone, since a `#` line is most often a comment.
	private row(p: Parser, prepull: boolean): Draft {
		if (!p.isPunct('#')) return attempt(p, () => p.row(prepull));
		const from = p.tokenIndex();
		const mark = p.diagnostics.length;
		const hash = p.peek()!;
		let fields: Draft;
		try {
			fields = p.row(prepull);
		} catch (e) {
			if (!(e instanceof Failure)) throw e;
			fields = { type: 'unparsed' };
		}
		if (fields.type === 'row' && !p.truncated) return fields;
		p.diagnostics.length = mark;
		p.suppressFrom = from;
		p.report('bad-hidden-row', '# hides a row; write // for a comment', p.range(hash.start, p.lastEnd));
		return { type: 'unparsed' };
	}

	// `///` lines directly above a priority or group row are its notes; any other `///` is `misplaced-note`.
	private attachNotes(statement: Statement, row: boolean) {
		if (this.skip) return;
		const leading = statement.leading;
		let k = leading.length;
		while (k > 0 && leading[k - 1].type !== 'blank') k--;
		const adjacent = leading.slice(k).filter((t): t is Note => t.type === 'note');
		const attachable = row && this.def?.name !== PREPULL;
		if (attachable && statement.type === 'row') {
			statement.notes = adjacent;
			statement.leading = leading.filter(t => !adjacent.includes(t as Note));
		}
		for (const t of [...statement.leading, ...statement.inner]) {
			if (t.type === 'note' && !(attachable && adjacent.includes(t))) this.misplacedNote(t);
		}
	}

	private misplacedNote(note: Note) {
		this.diagnostics.push(diagnostic('misplaced-note', '/// notes go directly above a priority or group row; write // for a comment', note.range));
	}

	private sectionRange(s: Section): Range {
		const ends = [s.header, ...s.body].filter(x => x !== undefined).map(x => x.range);
		if (!ends.length) return s.range;
		let { start, end } = ends[0];
		for (const r of ends) {
			if (r.start.offset < start.offset) start = r.start;
			if (r.end.offset > end.offset) end = r.end;
		}
		return { start, end };
	}
}

// How deep a statement nests at most (SPEC.md §4 note 10), which keeps reading and printing it within a browser's
// stack.
const MAX_DEPTH = 256;

// How deep JSON text nests its arrays and objects; the text need not be JSON.
function jsonDepth(text: string): number {
	let depth = 0;
	let deepest = 0;
	let inString = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inString && c === '\\') i++;
		else if (c === '"') inString = !inString;
		else if (inString) continue;
		else if (c === '[' || c === '{') deepest = Math.max(deepest, ++depth);
		else if (c === ']' || c === '}') depth--;
	}
	return deepest;
}

function diagnostic(code: DiagnosticCode, message: string, range: Range): SimlDiagnostic {
	return { range, severity: 'error', code, message };
}

// Runs a statement's reader. A Failure leaves the statement unread with its diagnostic, and so does a lexer error,
// in front of which the reader stopped.
function attempt(p: Parser, read: () => Draft): Draft {
	try {
		const fields = read();
		return p.truncated ? { type: 'unparsed' } : fields;
	} catch (e) {
		if (!(e instanceof Failure)) throw e;
		p.failed(e);
		return { type: 'unparsed' };
	}
}

// Reads one statement's tokens. They stop in front of the first token with a lexer error, whose diagnostic
// stands for the statement: a failure at the end of the readable tokens then adds none.
class Parser {
	readonly diagnostics: SimlDiagnostic[] = [];
	readonly truncated: boolean;
	readonly lastEnd: number; // The end of the statement's last token, readable or not.
	suppressFrom = Infinity; // The index from which the tokens' lexer errors are not reported.
	private readonly toks: Token[];
	private readonly lines: LineMap;
	private readonly end: number;
	private i = 0;
	private depth = 0; // How deep the statement nests at the next token (`nest`).

	constructor(all: Token[], lines: LineMap) {
		const bad = all.findIndex(t => t.error);
		this.toks = bad < 0 ? all : all.slice(0, bad);
		this.truncated = bad >= 0;
		this.lines = lines;
		this.lastEnd = all[all.length - 1].end;
		this.end = this.toks.length ? this.toks[this.toks.length - 1].end : all[0].start;
	}

	// --- Tokens

	tokenIndex(): number {
		return this.i;
	}

	peek(k = 0): Token | undefined {
		return this.toks[this.i + k];
	}

	atEnd(): boolean {
		return this.i >= this.toks.length;
	}

	isPunct(text: string, k = 0): boolean {
		const t = this.peek(k);
		return t?.kind === 'punct' && t.text === text;
	}

	isWord(text: string, k = 0): boolean {
		const t = this.peek(k);
		return t?.kind === 'ident' && t.text === text;
	}

	take(): Token {
		return this.toks[this.i++];
	}

	range(start: number, end: number): Range {
		return this.lines.range(start, end);
	}

	// From `start` to the end of the last token taken.
	from(start: number): Range {
		return this.range(start, this.toks[this.i - 1].end);
	}

	name(t: Token): Name {
		return { text: t.text, range: this.range(t.start, t.end) };
	}

	stringNode(t: Token): StringNode {
		return { type: 'string', value: t.value!, range: this.range(t.start, t.end) };
	}

	report(code: DiagnosticCode, message: string, range: Range) {
		this.diagnostics.push(diagnostic(code, message, range));
	}

	failed(e: Failure) {
		if (!(e.atEnd && this.truncated)) this.report(e.code, e.message, this.range(e.start, e.end));
	}

	fail(message: string, code: DiagnosticCode = 'parse', at: Token | undefined = this.peek()): never {
		if (!at) throw new Failure(code, message, this.end, this.end, true);
		throw new Failure(code, message, at.start, at.end, false);
	}

	private failAt(message: string, code: DiagnosticCode, range: Range): never {
		throw new Failure(code, message, range.start.offset, range.end.offset, false);
	}

	// Goes `levels` deeper at `t`, failing past MAX_DEPTH: a bracket, `not` or `schedule` goes one deeper until what it
	// holds ends, an arithmetic operator one deeper for the rest of the statement, and raw JSON as deep as its own
	// brackets.
	private nest(t: Token, levels = 1) {
		this.depth += levels;
		if (this.depth > MAX_DEPTH) this.fail(`the statement nests deeper than ${MAX_DEPTH}`, 'parse', t);
	}

	private expected(what: string, code: DiagnosticCode = 'parse'): never {
		const t = this.peek();
		const found = t && (t.text.length > 24 ? `${t.text.slice(0, 21)}...` : t.text);
		this.fail(t ? `expected ${what}, found '${found}'` : `expected ${what}`, code, t);
	}

	private expectPunct(text: string, what = `'${text}'`): Token {
		if (!this.isPunct(text)) this.expected(what);
		return this.take();
	}

	private finish(what: string) {
		if (!this.atEnd()) this.expected(what);
	}

	private string(what: string): StringNode {
		const t = this.peek();
		if (t?.kind !== 'string') this.expected(what);
		return this.stringNode(this.take());
	}

	// --- Top-level lines (SPEC.md §3.3)

	version(): Draft {
		this.take();
		const t = this.peek();
		if (t?.kind !== 'number' || !INT.test(t.text)) this.expected('the major version: siml 1');
		this.take();
		this.finish('the end of the siml line');
		if (Number(t.text) !== 1) this.report('unsupported-version', `this reads SIML 1, and the file is SIML ${t.text}`, this.range(t.start, t.end));
		return { type: 'version', version: { type: 'literal', text: t.text, range: this.range(t.start, t.end) } };
	}

	spec(): Draft {
		this.take();
		const t = this.peek();
		if (t?.kind !== 'ident') this.expected('the spec, such as spec hunter');
		this.take();
		this.finish('the end of the spec line');
		return { type: 'spec', spec: this.name(t) };
	}

	talents(): Draft {
		this.take();
		const talents = this.string('the talents in quotes');
		this.finish('the end of the talents line');
		return { type: 'talents', talents };
	}

	use(): Draft {
		this.take();
		const path = this.string("the used file's path in quotes");
		const binds: VarBind[] = [];
		if (this.isWord('with')) {
			this.take();
			do {
				if (binds.length) this.take();
				binds.push(this.varBind());
			} while (this.isPunct(','));
		}
		this.finish(binds.length ? "',' or the end of the use line" : 'with or the end of the use line');
		return { type: 'use', path, with: binds };
	}

	private varBind(): VarBind {
		const variable = this.variable();
		this.expectPunct('=');
		const value = this.expr();
		return { variable, value, range: join(variable, value) };
	}

	private variable(): VarNode {
		const t = this.peek();
		if (t?.kind !== 'var') this.expected('a variable, $name or ${Name}');
		this.take();
		return { type: 'var', name: t.value!, braced: t.text[1] === '{', range: this.range(t.start, t.end) };
	}

	private placeholder(t: Token): PlaceholderNode {
		return { type: 'placeholder', name: t.value!, braced: t.text[1] === '{', range: this.range(t.start, t.end) };
	}

	varDecl(): Draft {
		this.take();
		const variable = this.variable();
		this.expectPunct('=');
		const value = this.expr();
		this.finish('an operator or the end of the var line');
		return { type: 'var', variable, value };
	}

	// --- Setup sections (SPEC.md §5)

	slotRow(): Draft {
		const s = this.peek()!;
		if (s.kind !== 'ident') this.expected('a slot, such as head');
		const slot = this.name(this.take());
		const t = this.peek();
		if (t?.kind === 'raw') {
			const item = this.raw();
			this.finish('the end of the slot row');
			return { type: 'slot_row', slot, item };
		}
		if (t?.kind !== 'ident') this.expected("the item's name");
		const item = this.name(this.take());
		const suffix = this.peek()?.kind === 'ident' ? this.name(this.take()) : undefined;
		let enchant: Name | undefined;
		if (this.isPunct('+')) {
			this.take();
			if (this.peek()?.kind !== 'ident') this.expected("the enchant's name");
			enchant = this.name(this.take());
		}
		this.finish(enchant ? 'the end of the slot row' : "'+ enchant' or the end of the slot row");
		return { type: 'slot_row', slot, item, suffix, enchant };
	}

	// A flag list, a field and its values, a field and its message's arguments, or raw JSON (SPEC.md §4 note 5).
	entry(): Draft {
		const t = this.peek()!;
		if (t.kind === 'raw') {
			const value = this.raw();
			this.finish('the end of the entry');
			return { type: 'raw_entry', value };
		}
		if (t.kind !== 'ident') this.expected('a field name');
		const next = this.peek(1);
		if (!next || (next.kind === 'punct' && (next.text === ',' || next.text === '='))) return this.flags();
		this.take();
		const name = this.name(t);
		if (this.isPunct('(')) {
			const args = this.args();
			this.finish('the end of the entry');
			return { type: 'message_entry', name, args };
		}
		const values = [this.term(ENTRY_ENDS)];
		while (this.isPunct(',')) {
			this.take();
			values.push(this.term(ENTRY_ENDS));
		}
		this.finish("',' or the end of the entry");
		return { type: 'field_entry', name, values };
	}

	private flags(): Draft {
		const flags: Flag[] = [];
		for (;;) {
			const t = this.peek();
			if (t?.kind !== 'ident') this.expected('a field name');
			this.take();
			let value: Term | undefined;
			if (this.isPunct('=')) {
				this.take();
				value = this.term(ENTRY_ENDS);
			}
			flags.push({ name: this.name(t), value, range: this.from(t.start) });
			if (!this.isPunct(',')) break;
			this.take();
		}
		this.finish("',' or the end of the flags");
		return { type: 'flag_list', flags };
	}

	// --- Rows (SPEC.md §6.3)

	row(prepull: boolean): Draft {
		const hide = this.isPunct('#');
		if (hide) this.take();
		let doAt: Expr | undefined;
		// Raw JSON alone is the whole row, its time included (SPEC.md §6.3).
		const rawRow = !hide && this.toks.length === 1 && this.peek()?.kind === 'raw';
		if (prepull && !rawRow) doAt = this.doAt();
		else if (this.startsTime()) {
			doAt = this.unary();
			this.report('unexpected-time', 'only a prepull row starts with a time', doAt.range);
		}
		const action = this.action(NO_ENDS);
		this.finish('an operator or the end of the row');
		return { type: 'row', notes: [], hide, doAt, action };
	}

	// A prepull row's time. A row that holds only an action is `missing-time`.
	private doAt(): Expr | undefined {
		const t = this.peek();
		if (t && !this.startsAction()) {
			const [from, depth] = [this.i, this.depth];
			const value = this.unary();
			if (!this.atEnd() && !this.isWord('if')) return value;
			[this.i, this.depth] = [from, depth];
		}
		this.report('missing-time', 'a prepull row starts with its time, such as -1.5s', t ? this.range(t.start, t.end) : this.range(this.end, this.end));
		return undefined;
	}

	// A token that starts a value but never an action.
	private startsTime(): boolean {
		const t = this.peek();
		if (!t) return false;
		if (t.kind === 'number' || t.kind === 'string' || t.kind === 'var' || t.kind === 'placeholder') return true;
		if (t.kind === 'punct') return t.text === '-' || t.text === '(';
		return t.kind === 'ident' && (t.text === 'true' || t.text === 'false');
	}

	// A keyword that starts an action and never a value.
	private startsAction(): boolean {
		const t = this.peek();
		if (t?.kind !== 'ident') return false;
		switch (t.text) {
			case 'cast':
			case 'channel':
			case 'wait':
			case 'move':
			case 'group':
				return true;
			case 'schedule':
			case 'sequence':
				return this.peek(1)?.kind === 'string';
		}
		return false;
	}

	// A step and its condition. Tokens after the step that are not `if` or one of `ends` are `expected-if`.
	private action(ends: ReadonlySet<string>): ActionNode {
		const start = this.peek()?.start ?? this.end;
		const step = this.step();
		const next = this.peek();
		if (next && !this.isWord('if') && !(next.kind === 'punct' && ends.has(next.text))) this.fail('a condition starts with if', 'expected-if', next);
		let condition: Expr | undefined;
		if (this.isWord('if')) {
			this.take();
			condition = this.expr();
		}
		return { type: 'action', step, condition, range: this.from(start) };
	}

	private step(): Step {
		const t = this.peek();
		if (t?.kind === 'raw') return this.raw();
		if (t?.kind !== 'ident') this.expected('an action');
		const start = t.start;
		switch (t.text) {
			case 'none':
				this.take();
				return { type: 'none', range: this.from(start) };
			case 'cast': {
				this.take();
				const spell = this.ref();
				const target = this.on();
				return { type: 'cast', spell, target, range: this.from(start) };
			}
			case 'channel': {
				this.take();
				const spell = this.ref();
				const target = this.on();
				const until = this.isWord('until') ? (this.take(), this.expr()) : undefined;
				const recast = this.isWord('recast');
				if (recast) this.take();
				return { type: 'channel', spell, target, until, recast, range: this.from(start) };
			}
			case 'wait':
			case 'move': {
				this.take();
				const second = t.text === 'wait' ? 'until' : 'for';
				const long = this.isWord(second);
				if (long) this.take();
				const value = this.expr();
				const range = this.from(start);
				return t.text === 'wait' ? { type: long ? 'wait_until' : 'wait', value, range } : { type: long ? 'move_for' : 'move', value, range };
			}
			case 'group':
				return this.groupStep();
			case 'schedule': {
				if (this.peek(1)?.kind !== 'string') break;
				this.nest(this.take());
				const schedule = this.stringNode(this.take());
				const step = this.step();
				this.depth--;
				return { type: 'schedule', schedule, step, range: this.from(start) };
			}
			case 'sequence': {
				if (this.peek(1)?.kind !== 'string') break;
				this.take();
				const name = this.stringNode(this.take());
				this.nest(this.expectPunct('[', "'[' and the sequence's actions"));
				const actions: ActionNode[] = [];
				if (!this.isPunct(']')) {
					for (;;) {
						actions.push(this.action(LIST_ENDS));
						if (!this.isPunct(',')) break;
						this.take();
					}
				}
				this.expectPunct(']', "',' or ']'");
				this.depth--;
				return { type: 'sequence', name, actions, range: this.from(start) };
			}
		}
		if (!this.callable()) this.expected('an action');
		this.take();
		return this.call(t);
	}

	// `group "Name" [with %p = v, …]`; the list goes past a comma only while a `%p =` follows (SPEC.md §4 note 1).
	private groupStep(): Step {
		const start = this.take().start;
		const name = this.string("the group's name in quotes");
		const binds: PlaceholderBind[] = [];
		if (this.isWord('with')) {
			this.take();
			do {
				if (binds.length) this.take();
				const t = this.peek();
				if (t?.kind !== 'placeholder') this.expected('a placeholder, %name or %{Name}');
				this.take();
				this.expectPunct('=');
				const placeholder = this.placeholder(t);
				const value = this.expr();
				binds.push({ placeholder, value, range: join(placeholder, value) });
			} while (this.isPunct(',') && this.peek(1)?.kind === 'placeholder' && this.isPunct('=', 2));
		}
		return { type: 'group', name, with: binds, range: this.from(start) };
	}

	// A name, `other.<value>`, `item.<name>`, `none` or raw JSON.
	private ref(): Expr {
		const t = this.peek();
		if (t?.kind === 'raw') return this.raw();
		if (t?.kind !== 'ident' || STOP_WORDS.has(t.text)) this.expected('a spell name, item.<name> or other.<name>');
		this.take();
		const name = this.name(t);
		if (t.text === 'none') return { type: 'none', range: name.range };
		if ((t.text === 'other' || t.text === 'item') && this.isPunct('.') && this.peek(1)?.kind === 'ident') {
			this.take();
			return { type: 'member', object: name, name: this.name(this.take()), range: this.from(t.start) };
		}
		return { type: 'call', name, range: name.range };
	}

	private on(): Expr | undefined {
		if (!this.isWord('on')) return undefined;
		this.take();
		const t = this.peek();
		if (t?.kind === 'raw') return this.raw();
		if (t?.kind !== 'ident' || STOP_WORDS.has(t.text)) this.expected('a unit, such as target');
		this.take();
		const name = this.name(t);
		return t.text === 'none' ? { type: 'none', range: name.range } : { type: 'call', name, range: name.range };
	}

	private raw(): RawNode {
		const t = this.take();
		const depth = jsonDepth(t.value!);
		this.nest(t, depth);
		this.depth -= depth;
		let json: JsonValue;
		try {
			json = JSON.parse(t.value!) as JsonValue;
		} catch (e) {
			this.fail(`the raw JSON does not read: ${(e as Error).message}`, 'bad-raw', t);
		}
		return { type: 'raw', json, range: this.range(t.start, t.end) };
	}

	// --- Values (SPEC.md §6.5)

	expr(): Expr {
		return this.logic('or', () => this.conj());
	}

	private conj(): Expr {
		return this.logic('and', () => this.neg());
	}

	private logic(op: 'and' | 'or', next: () => Expr): Expr {
		const first = next();
		if (!this.isWord(op)) return first;
		const operands = [first];
		while (this.isWord(op)) {
			this.take();
			operands.push(next());
		}
		return { type: op, operands, range: join(first, operands[operands.length - 1]) };
	}

	private neg(): Expr {
		if (!this.isWord('not') || this.callable()) return this.cmp();
		const t = this.take();
		this.nest(t);
		const operand = this.neg();
		this.depth--;
		return { type: 'not', operand, range: { start: this.lines.position(t.start), end: operand.range.end } };
	}

	private cmp(): Expr {
		const left = this.sum();
		const t = this.peek();
		if (t?.kind !== 'punct' || !COMPARE_OPS.has(t.text)) {
			this.noAssign();
			return left;
		}
		this.take();
		const right = this.sum();
		const again = this.peek();
		if (again?.kind === 'punct' && COMPARE_OPS.has(again.text)) this.fail('comparisons do not chain: write a < b and b < c', 'chained-comparison', again);
		this.noAssign();
		return { type: 'compare', op: t.text as CompareOp, left, right, range: join(left, right) };
	}

	private noAssign() {
		if (this.isPunct('=')) this.fail('write == to compare', 'write-eq');
	}

	private sum(): Expr {
		return this.math('+', '-', () => this.prod());
	}

	private prod(): Expr {
		return this.math('*', '/', () => this.unary());
	}

	private math(a: MathOp, b: MathOp, next: () => Expr): Expr {
		let left = next();
		while (this.isPunct(a) || this.isPunct(b)) {
			const op = this.take();
			this.nest(op);
			const right = next();
			left = { type: 'math', op: op.text as MathOp, left, right, range: join(left, right) };
		}
		return left;
	}

	// A minus goes only directly before a number, and is part of its literal.
	private unary(): Expr {
		if (!this.isPunct('-')) return this.operand();
		const minus = this.take();
		const t = this.peek();
		if (t?.kind !== 'number') this.expected('a number after -');
		this.take();
		return { type: 'literal', text: `-${t.text}`, range: this.range(minus.start, t.end) };
	}

	private operand(): Expr {
		const t = this.peek();
		if (!t) this.expected('a value');
		switch (t.kind) {
			case 'number':
				this.take();
				return { type: 'literal', text: t.text, range: this.range(t.start, t.end) };
			case 'string':
				return this.stringNode(this.take());
			case 'var':
				return this.variable();
			case 'placeholder':
				return this.placeholder(this.take());
			case 'raw':
				return this.raw();
			case 'ident':
				return this.word();
		}
		if (!this.isPunct('(')) this.expected('a value');
		this.nest(this.take());
		const expr = this.expr();
		this.expectPunct(')', "an operator or ')'");
		this.depth--;
		return { type: 'paren', expr, range: this.from(t.start) };
	}

	// Whether the word ahead reads as a name: any but a stop word, and `and`, `or` and `not` directly followed by
	// `(`, which are calls.
	private callable(): boolean {
		const t = this.peek()!;
		if (!STOP_WORDS.has(t.text)) return true;
		const next = this.peek(1);
		return (t.text === 'and' || t.text === 'or' || t.text === 'not') && next?.kind === 'punct' && next.text === '(' && next.start === t.end;
	}

	private word(): Expr {
		const t = this.peek()!;
		if (t.text === 'true' || t.text === 'false' || t.text === 'none') {
			this.take();
			const range = this.range(t.start, t.end);
			return t.text === 'none' ? { type: 'none', range } : { type: 'bool', value: t.text === 'true', range };
		}
		if (!this.callable()) this.expected('a value');
		this.take();
		const name = this.name(t);
		if (this.isPunct('.') && this.peek(1)?.kind === 'ident') {
			this.take();
			const member = this.name(this.take());
			if (!this.isPunct('(')) return { type: 'member', object: name, name: member, range: this.from(t.start) };
			const args = this.args();
			if (!this.isPunct('.')) this.expected(`.property after ${member.text}(…)`);
			return this.accessor(name, member, args, t.start);
		}
		if (!this.isPunct('(')) return { type: 'call', name, range: name.range };
		const args = this.args();
		if (this.isPunct('.')) return this.accessor(undefined, name, args, t.start);
		return { type: 'call', name, args, range: this.from(t.start) };
	}

	private call(t: Token): Step {
		const name = this.name(t);
		const args = this.isPunct('(') ? this.args() : undefined;
		return { type: 'call', name, args, range: this.from(t.start) };
	}

	// `[unit.]head(subject).prop[(args)]`; the head's parentheses hold the subject and nothing else.
	private accessor(unit: Name | undefined, head: Name, headArgs: Args, start: number): Expr {
		const extra = headArgs.items.find((a, k) => a.name || k > 0);
		if (extra) this.failAt(`arguments go on the property: ${head.text}(x).p(f=v)`, 'args-on-head', extra.range);
		const subject = headArgs.items[0];
		if (!subject) this.failAt(`expected what ${head.text}() reads, such as ${head.text}(name)`, 'parse', headArgs.range);
		this.take();
		const p = this.peek();
		if (p?.kind !== 'ident') this.expected('a property after the .');
		this.take();
		const args = this.isPunct('(') ? this.args() : undefined;
		return { type: 'accessor', unit, head, subject: subject.value, prop: this.name(p), args, range: this.from(start) };
	}

	private args(): Args {
		const open = this.take();
		this.nest(open);
		const items: Arg[] = [];
		if (!this.isPunct(')')) {
			for (;;) {
				items.push(this.arg());
				if (!this.isPunct(',')) break;
				this.take();
			}
		}
		this.expectPunct(')', "',' or ')'");
		this.depth--;
		return { items, range: this.from(open.start) };
	}

	private arg(): Arg {
		const t = this.peek();
		if (t?.kind === 'ident' && this.isPunct('=', 1)) {
			this.take();
			this.take();
			const value = this.term(ARG_ENDS);
			return { name: this.name(t), value, range: this.from(t.start) };
		}
		const value = this.term(ARG_ENDS);
		return { value, range: value.range };
	}

	// An argument or entry value: a list, an action, or a value, which `if` makes an action.
	private term(ends: ReadonlySet<string>): Term {
		if (this.isPunct('[')) return this.list();
		if (this.startsAction()) return this.action(ends);
		const value = this.expr();
		if (!this.isWord('if')) return value;
		if (value.type !== 'call' && value.type !== 'raw' && value.type !== 'none') this.fail('if follows an action, such as cast x if y');
		this.take();
		const condition = this.expr();
		return { type: 'action', step: value, condition, range: join(value, condition) };
	}

	private list(): ListNode {
		const open = this.take();
		this.nest(open);
		const items: Term[] = [];
		if (!this.isPunct(']')) {
			for (;;) {
				items.push(this.term(LIST_ENDS));
				if (!this.isPunct(',')) break;
				this.take();
			}
		}
		this.expectPunct(']', "',' or ']'");
		this.depth--;
		return { type: 'list', items, range: this.from(open.start) };
	}
}
