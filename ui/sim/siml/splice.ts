// Edits to the rotation of an x.apl.siml, as the rotation panel makes them: each AplEdit changes the rotation JSON,
// and the text changes only where the JSON does. A statement an edit touches is printed again, with the `//` lines
// directly above it and its trailing comment (SPEC.md §10); a statement that moves takes its lines along; every
// other line stays as written. The new text is read back, and a statement that does not read as its JSON is printed
// again, or as raw JSON, until each one does.

import { declaredBy } from './check.ts';
import { commentLine, trailingText } from './format.ts';
import { isObject, normalize, valueAt } from './json.ts';
import { lex, type LineMap } from './lexer.ts';
import { classOf, type Names, readsBack } from './names.ts';
import { INDENT, layout, Printer, type Stmt } from './print.ts';
import { rotationPath } from './rotation.ts';
import type { SchemaIndex } from './schema.ts';
import { readFile, type TypedFile } from './setup.ts';
import type {
	AplEdit,
	Comment,
	HeaderStatement,
	JsonObject,
	JsonPath,
	JsonValue,
	Section,
	SimlParse,
	Statement,
	SyntaxTree,
	TextEdit,
	UseStatement,
} from './types.ts';

const APL = 'apl';
const GROUP = 'group';
const PREPULL = 'prepull';
const PRIORITY = 'priority';
const ROUNDS = 4; // A statement is read as written, then printed from its JSON, then written as raw JSON.

// --- Lines

// A line of the new text: a line of the text as written (`from`), or a new one.
interface Line {
	text: string;
	from?: number;
	header?: boolean; // A section header, which no blank line follows inside its section.
}

// The lines of a group's block, from the comments above its header to its last statement, which move as one.
interface Block {
	first: number;
	last: number;
}

interface Insert {
	lines: Line[];
	phase: number; // At one line: the lines that close a block, then the others, then those that open a block.
	block?: Block; // The block the lines belong to, which they move with.
}

const BLANK: Line = { text: '' };
const headerLine = (text: string): Line => ({ text, header: true });
const plain = (texts: string[]): Line[] => texts.map(text => ({ text }));

// Changes to a text by whole lines: lines dropped, lines put in front of a line, and blocks moved elsewhere with
// what changed inside them.
class LineEdits {
	readonly count: number; // The text's lines; putting lines in front of line `count` puts them at its end.
	private readonly text: string;
	private readonly map: LineMap;
	private readonly eol: string;
	private readonly ended: boolean; // Whether the text ends with a line break.
	private readonly blanks: Set<number>;
	private readonly headers: Set<number>;
	private readonly dropped = new Set<number>();
	private readonly inserts = new Map<number, Insert[]>();
	private readonly moved = new Set<Block>();

	constructor(text: string, tree: SyntaxTree) {
		const { trivia, lines } = lex(text);
		this.text = text;
		this.map = lines;
		this.eol = text.includes('\r\n') ? '\r\n' : '\n';
		this.ended = text === '' || text.endsWith('\n');
		this.count = lines.starts.length - (this.ended ? 1 : 0);
		this.blanks = new Set(trivia.filter(t => t.type === 'blank').map(t => t.range.start.line));
		this.headers = new Set(tree.statements.filter(s => s.type === 'header' && !s.body).map(s => s.range.start.line));
	}

	// Line `i` as written, without its line break.
	line(i: number): string {
		const next = this.map.starts[i + 1];
		const text = this.text.slice(this.map.starts[i], next === undefined ? this.text.length : next - 1);
		return text.endsWith('\r') ? text.slice(0, -1) : text;
	}

	// Lines `first` to `last` as written.
	written(first: number, last: number): Line[] {
		const out: Line[] = [];
		for (let i = first; i <= last; i++) out.push({ text: this.line(i), header: this.headers.has(i) });
		return out;
	}

	drop(first: number, last: number) {
		for (let i = first; i <= last; i++) this.dropped.add(i);
	}

	// Puts `lines` in front of line `at`, as lines of `block` when they belong to one.
	insert(at: number, lines: Line[], block?: Block) {
		const phase = !block ? 1 : at === block.first ? 2 : 0;
		const here = this.inserts.get(at) ?? [];
		here.push({ lines, phase, block });
		here.sort((a, b) => a.phase - b.phase);
		this.inserts.set(at, here);
	}

	// Takes `block` from its place, and gives its lines with the changes made inside it.
	moveOut(block: Block): Line[] {
		const out: Line[] = [];
		for (let i = block.first; i <= block.last + 1; i++) {
			for (const x of this.inserts.get(i) ?? []) if (x.block === block) out.push(...x.lines);
			if (i <= block.last && !this.dropped.has(i)) out.push({ text: this.line(i), header: this.headers.has(i) });
		}
		this.moved.add(block);
		return out;
	}

	// The edits that turn the text into the new one, each covering only lines that change.
	edits(): TextEdit[] {
		const out: TextEdit[] = [];
		let prev = -1;
		let pending: string[] = [];
		const flush = (to: number) => {
			for (const [from, until, lines] of this.changes(prev + 1, to, pending)) out.push(this.edit(from, until, lines));
			pending = [];
		};
		for (const l of this.sequence()) {
			if (l.from === undefined) pending.push(l.text);
			else {
				if (l.from > prev + 1 || pending.length) flush(l.from);
				prev = l.from;
			}
		}
		if (prev + 1 < this.count || pending.length) flush(this.count);
		return out;
	}

	// The new text.
	result(): string {
		let text = this.text;
		for (const e of [...this.edits()].reverse()) text = text.slice(0, e.range.start.offset) + e.newText + text.slice(e.range.end.offset);
		return text;
	}

	private gone(i: number): boolean {
		return this.dropped.has(i) || [...this.moved].some(b => i >= b.first && i <= b.last);
	}

	private sequence(): Line[] {
		const out: Line[] = [];
		for (let i = 0; i <= this.count; i++) {
			for (const x of this.inserts.get(i) ?? []) if (!x.block || !this.moved.has(x.block)) out.push(...x.lines);
			if (i < this.count && !this.gone(i)) out.push({ text: this.line(i), from: i, header: this.headers.has(i) });
		}
		return this.tidy(out);
	}

	// Blank lines as format writes them where the edits change what is around them: one between statements, and
	// none between a header and the first statement of its section or at either end of the text. A run that has the
	// same lines around it as in the text stays as written.
	private tidy(lines: Line[]): Line[] {
		const blank = (l: Line) => (l.from !== undefined ? this.blanks.has(l.from) : l.text.trim() === '');
		const comment = (l: Line) => l.text.trimStart().startsWith('//');
		const out: Line[] = [];
		for (let i = 0; i < lines.length;) {
			if (!blank(lines[i])) {
				out.push(lines[i++]);
				continue;
			}
			let j = i;
			while (j < lines.length && blank(lines[j])) j++;
			const run = lines.slice(i, j);
			const [before, after] = [lines[i - 1], lines[j]];
			const next = lines.slice(j).find(l => !blank(l) && !comment(l));
			if (this.asWritten(run, before, after)) out.push(...run);
			else if (before && after && !(before.header && next && !next.header)) out.push(run.find(l => l.from !== undefined) ?? run[0]);
			i = j;
		}
		return out;
	}

	private asWritten(run: Line[], before: Line | undefined, after: Line | undefined): boolean {
		const first = run[0].from;
		if (first === undefined || run.some((l, k) => l.from !== first + k)) return false;
		const last = first + run.length - 1;
		return (before ? before.from === first - 1 : first === 0) && (after ? after.from === last + 1 : last === this.count - 1);
	}

	// Where `lines` differ from the text's lines `from` to `to` (exclusive), which they replace: each run of lines that
	// is not in their longest common run, as the text's lines it replaces and the lines that go in their place.
	private changes(from: number, to: number, lines: string[]): Array<[number, number, string[]]> {
		const old = Array.from({ length: to - from }, (_, k) => this.line(from + k));
		const common = Array.from({ length: old.length + 1 }, () => new Array<number>(lines.length + 1).fill(0));
		for (let i = old.length - 1; i >= 0; i--) {
			for (let j = lines.length - 1; j >= 0; j--) {
				common[i][j] = old[i] === lines[j] ? common[i + 1][j + 1] + 1 : Math.max(common[i + 1][j], common[i][j + 1]);
			}
		}
		const out: Array<[number, number, string[]]> = [];
		let change: [number, number, string[]] | undefined;
		for (let i = 0, j = 0; i < old.length || j < lines.length;) {
			if (i < old.length && j < lines.length && old[i] === lines[j]) {
				if (change) out.push(change);
				change = undefined;
				[i, j] = [i + 1, j + 1];
				continue;
			}
			change ??= [from + i, from + i, []];
			if (j < lines.length && (i === old.length || common[i][j + 1] >= common[i + 1][j])) change[2].push(lines[j++]);
			else change[1] = from + ++i;
		}
		if (change) out.push(change);
		return out;
	}

	// The edit that puts `lines` in place of the text's lines `from` to `to` (exclusive).
	private edit(from: number, to: number, lines: string[]): TextEdit {
		const offset = (i: number) => this.map.starts[i] ?? this.text.length;
		// At the end of a text with no final line break, the lines are joined, and follow a line break of their own.
		const open = to === this.count && !this.ended;
		const newText = open ? (from === to && lines.length ? this.eol : '') + lines.join(this.eol) : lines.map(l => l + this.eol).join('');
		return { range: this.map.range(offset(from), offset(to)), newText };
	}
}

// --- The rotation as the edits leave it

// A statement's lines: the comment and note lines directly above it, with no blank line between, and its own.
interface Unit<S extends Statement = Statement> {
	statement: S;
	first: number;
	last: number;
	comments: Comment[]; // The comment lines directly above it.
	header?: HeaderStatement; // The header whose line it is written on.
}

// An element of a rotation list: a row or a var line.
interface Slot {
	json: JsonValue;
	unit?: Unit; // Its statement in the text.
	dirty: boolean; // Printed again.
	raw: boolean; // Printed as raw JSON.
}

interface List {
	key: string; // Its JSON name in the rotation or the group.
	message: string;
	row: boolean; // Rows, else var lines.
	prepull: boolean;
	group?: Group;
	section?: Section; // Its section in the text.
	indent: number;
	old: Slot[]; // Its elements in the text, in their order.
	slots: Slot[]; // Its elements as the edits leave them.
}

interface Group {
	name: string;
	renamed: boolean;
	header?: Unit<HeaderStatement>;
	block?: Block;
	variables: List;
	actions: List;
}

interface Model {
	rotation: JsonObject; // The rotation the text writes.
	lists: Map<string, List>; // The value variables, the prepull rows and the priority rows, by their JSON names.
	groups: Group[];
	old: Group[];
}

function unitOf<S extends Statement>(s: S, header?: HeaderStatement): Unit<S> {
	const line = s.range.start.line;
	if (header) return { statement: s, first: line, last: header.range.end.line, comments: [], header };
	const above = [...s.leading, ...(s.type === 'row' ? s.notes : [])].sort((a, b) => a.range.start.offset - b.range.start.offset);
	let first = line;
	for (let k = above.length - 1; k >= 0 && above[k].type !== 'blank' && above[k].range.start.line === first - 1; k--) first--;
	const comments = above.filter((t): t is Comment => t.type === 'comment' && t.range.start.line >= first);
	return { statement: s, first, last: s.range.end.line, comments };
}

// The last line of a section's header and statements.
const lastLine = (s: Section) => Math.max(s.header?.range.end.line ?? -1, ...s.body.map(b => b.range.end.line));

const clone = (v: unknown): JsonValue => JSON.parse(JSON.stringify(v)) as JsonValue;
const isIndex = (k: unknown, length: number): k is number => typeof k === 'number' && Number.isInteger(k) && k >= 0 && k < length;
const describe = (path: JsonPath) => path.map((k, i) => (typeof k === 'number' ? `[${k}]` : i ? `.${k}` : k)).join('');

class Rotation {
	readonly model: Model;
	private readonly index: SchemaIndex;
	private readonly V: SchemaIndex['vocabulary'];

	constructor(index: SchemaIndex, file: TypedFile) {
		this.index = index;
		this.V = index.vocabulary;
		const R = this.V.rotation.f;
		const base = rotationPath(index);
		const rotation = (valueAt(file.json, base) ?? {}) as JsonObject;
		const statements = new Map<string, Statement>();
		for (const [s, path] of file.paths) statements.set(JSON.stringify(path.slice(base.length)), s);
		const headers = new Map<Statement, HeaderStatement>();
		for (const s of file.tree.statements) if (s.type === 'header' && s.body) headers.set(s.body, s);
		// A list's elements in the text, each with its statement, and the indent its statements have.
		const fill = (list: List, path: JsonPath) => {
			const items = valueAt(rotation, path);
			list.old = (Array.isArray(items) ? items : []).map((json, i) => {
				const s = statements.get(JSON.stringify([...path, i]))!;
				return { json: clone(json), unit: unitOf(s, headers.get(s)), dirty: false, raw: false };
			});
			list.slots = [...list.old];
			const own = list.old.find(x => !x.unit!.header);
			if (own) list.indent = own.unit!.statement.range.start.character;
			return list;
		};
		const section = (name: string) => file.tree.sections.find(s => s.name === name);
		const lists: Array<[string, List]> = [
			[R.value_variables, this.list(R.value_variables, false, false, file.tree.sections[0])],
			[R.prepull_actions, this.list(R.prepull_actions, true, true, section(PREPULL))],
			[R.priority_list, this.list(R.priority_list, true, false, section(PRIORITY))],
		];
		const old = file.tree.sections
			.filter(s => s.name === GROUP && s.group !== undefined)
			.map((s, g) => {
				const header = unitOf(s.header!);
				const group = this.group(s.group!, false, s, header);
				fill(group.variables, [R.groups, g, group.variables.key]);
				fill(group.actions, [R.groups, g, group.actions.key]);
				return group;
			});
		this.model = { rotation, lists: new Map(lists.map(([key, list]) => [key, fill(list, [key])])), groups: [...old], old };
	}

	// The rotation JSON the slots hold.
	json(): JsonObject {
		const R = this.V.rotation.f;
		const G = this.V.group.f;
		const items = (l: List) => l.slots.map(s => s.json);
		const lists = Object.fromEntries([...this.model.lists].map(([key, l]) => [key, items(l)]));
		const groups = this.model.groups.map(g => ({ [G.name]: g.name, [G.variables]: items(g.variables), [G.actions]: items(g.actions) }));
		return normalize(this.index, this.V.rotation.message, { ...this.model.rotation, ...lists, [R.groups]: groups }) as JsonObject;
	}

	// Every list of rows and var lines, as the edits leave them.
	lists(): List[] {
		return [...this.model.lists.values(), ...this.model.groups.flatMap(g => [g.variables, g.actions])];
	}

	// Applies one edit; gives why not when its path leads nowhere, or to something other than rows, var lines and
	// groups.
	apply(edit: AplEdit): string | undefined {
		const t = this.locate(edit.path);
		if (typeof t === 'string') return t;
		const { path } = edit;
		const { groups } = this.model;
		if (edit.op === 'set') {
			const { value } = edit;
			if ('groups' in t) {
				if (value !== undefined && !Array.isArray(value)) return `${describe(path)} takes a list of groups`;
				this.model.groups = (value ?? []).map(v => this.newGroup(v));
			} else if ('group' in t) {
				const group = groups[t.group];
				if (t.name && value !== undefined && typeof value !== 'string') return `${describe(path)} takes a string`;
				if (!t.name && value !== undefined && !isObject(value)) return `${describe(path)} takes a group`;
				if (t.name) Object.assign(group, { name: value ?? '', renamed: true });
				else if (value === undefined) groups.splice(t.group, 1);
				else {
					const fresh = this.newGroup(value);
					Object.assign(group, { name: fresh.name, renamed: true });
					group.variables.slots = fresh.variables.slots;
					group.actions.slots = fresh.actions.slots;
				}
			} else if (t.index === undefined) {
				if (value !== undefined && !Array.isArray(value)) return `${describe(path)} takes a list`;
				t.list.slots = (value ?? []).map(newSlot);
			} else if (t.rest.length) {
				return changed(t.list.slots[t.index], json => setIn(json, t.rest, value, path));
			} else if (value === undefined) t.list.slots.splice(t.index, 1);
			else Object.assign(t.list.slots[t.index], { json: clone(value), dirty: true });
			return undefined;
		}
		if ('group' in t) return `${describe(path)} is no list`;
		if (edit.op === 'insert' && edit.value === undefined) return `nothing to insert at ${describe([...path, edit.index])}`;
		if ('list' in t && t.index !== undefined) {
			const slot = t.list.slots[t.index];
			if (edit.op === 'insert') return changed(slot, json => insertIn(json, t.rest, edit.index, edit.value, path));
			return changed(slot, json => {
				const list = valueAt(json, t.rest);
				return Array.isArray(list) ? move(list, edit.from, edit.to, path) : `${describe(path)} is no list`;
			});
		}
		const list: unknown[] = 'groups' in t ? groups : t.list.slots;
		if (edit.op === 'move') return move(list, edit.from, edit.to, path);
		const { index, value } = edit;
		if (!isIndex(index, list.length + 1)) return `${describe(path)} holds ${list.length}, so nothing goes in at ${index}`;
		list.splice(index, 0, 'groups' in t ? this.newGroup(value) : newSlot(value));
		return undefined;
	}

	// What a path names: a list of rows or var lines, one of their elements with a path inside it, the list of
	// groups, a group, or a group's name.
	private locate(path: JsonPath): { list: List; index?: number; rest: JsonPath } | { groups: true } | { group: number; name: boolean } | string {
		const R = this.V.rotation.f;
		const G = this.V.group.f;
		const [head, ...rest] = path;
		const element = (list: List, at: number) => {
			const [index, ...inside] = path.slice(at);
			if (index === undefined) return { list, rest: [] };
			if (!isIndex(index, list.slots.length)) return `${describe(path.slice(0, at + 1))} does not exist`;
			return { list, index, rest: inside };
		};
		if (head === R.groups) {
			const [g, key] = rest;
			if (g === undefined) return { groups: true };
			if (!isIndex(g, this.model.groups.length)) return `${describe(path.slice(0, 2))} does not exist`;
			const group = this.model.groups[g];
			if (key === undefined) return { group: g, name: false };
			if (key === G.name && rest.length === 2) return { group: g, name: true };
			if (key === G.variables) return element(group.variables, 3);
			if (key === G.actions) return element(group.actions, 3);
		} else {
			const list = typeof head === 'string' ? this.model.lists.get(head) : undefined;
			if (list) return element(list, 1);
		}
		return `${describe(path)} is not in a row, var line or group, which are what the panel edits`;
	}

	private list(key: string, row: boolean, prepull: boolean, section: Section | undefined): List {
		const V = this.V;
		const message = row ? (prepull ? V.prepullAction.message : V.listItem.message) : V.variable.message;
		const indent = section === undefined || section.header ? INDENT : 0;
		return { key, message, row, prepull, section, indent, old: [], slots: [] };
	}

	private group(name: string, renamed: boolean, section?: Section, header?: Unit<HeaderStatement>): Group {
		const G = this.V.group.f;
		const variables = this.list(G.variables, false, false, section);
		const actions = this.list(G.actions, true, false, section);
		const block = header && section ? { first: header.first, last: lastLine(section) } : undefined;
		const group: Group = { name, renamed, header, block, variables, actions };
		variables.group = actions.group = group;
		return group;
	}

	// A group the text does not hold, from its JSON.
	private newGroup(value: unknown): Group {
		const G = this.V.group.f;
		const json = isObject(value) ? value : {};
		const group = this.group(typeof json[G.name] === 'string' ? (json[G.name] as string) : '', true);
		const items = (key: string) => (Array.isArray(json[key]) ? (json[key] as JsonValue[]) : []).map(newSlot);
		group.variables.slots = items(G.variables);
		group.actions.slots = items(G.actions);
		return group;
	}
}

// Applies `change` to a slot's JSON, which the slot is then printed from.
function changed(slot: Slot, change: (json: JsonValue) => string | undefined): string | undefined {
	const error = change(slot.json);
	if (!error) slot.dirty = true;
	return error;
}

const newSlot = (value: unknown): Slot => ({ json: clone(value), dirty: true, raw: false });

function setIn(root: JsonValue, rest: JsonPath, value: unknown, path: JsonPath): string | undefined {
	const parent = valueAt(root, rest.slice(0, -1));
	const key = rest.at(-1)!;
	if (Array.isArray(parent) && isIndex(key, parent.length)) {
		if (value === undefined) parent.splice(key, 1);
		else parent[key] = clone(value);
		return undefined;
	}
	if (isObject(parent) && typeof key === 'string' && (value !== undefined || key in parent)) {
		if (value === undefined) delete parent[key];
		else parent[key] = clone(value);
		return undefined;
	}
	return `${describe(path)} does not exist`;
}

function insertIn(root: JsonValue, rest: JsonPath, index: number, value: unknown, path: JsonPath): string | undefined {
	const list = valueAt(root, rest);
	const parent = valueAt(root, rest.slice(0, -1));
	const key = rest.at(-1);
	// A list a message leaves out is empty.
	if (list === undefined && isObject(parent) && typeof key === 'string' && index === 0) {
		parent[key] = [clone(value)];
		return undefined;
	}
	if (!Array.isArray(list)) return `${describe(path)} is no list`;
	if (!isIndex(index, list.length + 1)) return `${describe(path)} holds ${list.length}, so nothing goes in at ${index}`;
	list.splice(index, 0, clone(value));
	return undefined;
}

function move(list: unknown[], from: number, to: number, path: JsonPath): string | undefined {
	if (!isIndex(from, list.length)) return `${describe([...path, from])} does not exist`;
	if (!isIndex(to, list.length)) return `${describe(path)} holds ${list.length}, so nothing goes to ${to}`;
	list.splice(to, 0, ...list.splice(from, 1));
	return undefined;
}

// --- Writing the new text

// The elements of `now` that keep their places: the longest run of them in the order `old` gives them.
function stable<T>(now: T[], old: T[]): Set<T> {
	const order = now.map(x => old.indexOf(x));
	const length = order.map(() => 1);
	const prev = order.map(() => -1);
	for (let i = 0; i < order.length; i++) {
		for (let j = 0; j < i; j++) {
			if (order[j] < order[i] && length[j] + 1 > length[i]) [length[i], prev[i]] = [length[j] + 1, j];
		}
	}
	const kept = new Set<T>();
	for (let i = length.indexOf(Math.max(...length)); i >= 0; i = prev[i]) kept.add(now[i]);
	return kept;
}

// The element of `list` nearest to index `k`, in the direction `step`, that keeps its place.
function nearest<T>(list: T[], k: number, step: -1 | 1, kept: Set<T>): T | undefined {
	for (let i = k + step; i >= 0 && i < list.length; i += step) if (kept.has(list[i])) return list[i];
	return undefined;
}

class Writer {
	private readonly index: SchemaIndex;
	private readonly file: TypedFile;
	private readonly rotation: Rotation;
	private readonly model: Model;
	private readonly out: LineEdits;
	private readonly printer: Printer;

	constructor(index: SchemaIndex, names: Names, text: string, file: TypedFile, rotation: Rotation) {
		this.index = index;
		this.file = file;
		this.rotation = rotation;
		this.model = rotation.model;
		this.out = new LineEdits(text, file.tree);
		this.printer = new Printer(index, names, classOf(index, file.spec), declaredBy(index, rotation.json()).variables);
	}

	// The slots the edits leave as they are whose statements are in canonical form, and are not under `printer`, which
	// prints with the variables the rotation declares before the edits: how a variable reference is written depends
	// on the others (SPEC.md §12.3).
	unsettled(before: Printer): Slot[] {
		return this.rotation.lists().flatMap(list =>
			list.slots.filter(s => {
				if (!s.unit || s.unit.header || s.dirty) return false;
				const written = this.out.written(s.unit.first, s.unit.last).map(l => l.text);
				const was = list.group?.header?.statement.group?.value;
				const same = (lines: Line[]) => lines.length === written.length && lines.every((l, k) => l.text === written[k]);
				return same(this.render(s, list, before, was)) && !same(this.render(s, list));
			}),
		);
	}

	// The text's changes.
	statements(): LineEdits {
		for (const list of this.model.lists.values()) this.list(list);
		this.groups();
		return this.out;
	}

	private list(list: List) {
		const { out } = this;
		const { old, slots } = list;
		const block = list.group?.block;
		const changed = slots.length !== old.length || slots.some((s, i) => s !== old[i] || s.dirty || s.raw);
		// A statement written on its section's header line stays there while it stays first and as written, and its
		// group keeps its name; otherwise it goes on a line of its own.
		const onHeader = old[0]?.unit?.header;
		const split = onHeader !== undefined && (slots[0] !== old[0] || old[0].dirty || old[0].raw || list.group?.renamed === true);
		if (!changed && !split) return;
		if (split) {
			out.drop(onHeader.range.start.line, onHeader.range.end.line);
			const text = list.group ? `${GROUP} ${JSON.stringify(list.group.name)}:` : `${onHeader.name.text}:`;
			out.insert(onHeader.range.start.line, [headerLine(text)], block);
			old[0].dirty = true; // It is printed from its JSON on its own line.
		}
		const kept = new Set(slots);
		const lined = (s: Slot) => s.unit !== undefined && !(split && s.unit.header);
		for (const s of old) if (!kept.has(s) && lined(s)) out.drop(s.unit!.first, s.unit!.last);
		const anchors = stable(slots.filter(lined), old);
		const home = this.home(list);
		const fresh: Line[] = [];
		slots.forEach((s, k) => {
			if (anchors.has(s)) {
				if (s.dirty || s.raw) {
					out.drop(s.unit!.first, s.unit!.last);
					out.insert(s.unit!.first, this.render(s, list), block);
				}
				return;
			}
			const lines = lined(s) && !s.dirty && !s.raw ? out.written(s.unit!.first, s.unit!.last) : this.render(s, list);
			if (lined(s)) out.drop(s.unit!.first, s.unit!.last);
			const [prev, next] = [nearest(slots, k, -1, anchors), nearest(slots, k, 1, anchors)];
			if (prev) out.insert(prev.unit!.last + 1, lines, block);
			else if (next) out.insert(next.unit!.first, lines, block);
			else if (home !== undefined) out.insert(home, lines, block);
			else fresh.push(...lines);
		});
		if (fresh.length) {
			const [at, top] = this.newSection(list);
			out.insert(at, [...top, ...fresh]);
		}
	}

	// Where a list's elements go when none of its statements keeps its place: where its first one was, or after its
	// section's header or last statement. Undefined when the text holds no place for them.
	private home(list: List): number | undefined {
		const first = list.old.find(s => !s.unit!.header);
		if (first) return first.unit!.first;
		const { group, section } = list;
		if (group?.header) return list.row ? group.block!.last + 1 : group.header.statement.range.end.line + 1;
		if (section && (section.header || section.body.length)) return lastLine(section) + 1;
		return undefined;
	}

	// A section the text does not hold, after the sections that come before it (SPEC.md §12.1): its place, and the
	// lines in front of its statements. The value variables of an x.apl.siml are lines at the top level.
	private newSection(list: List): [number, Line[]] {
		const implied = this.file.tree.sections[0];
		if (!list.row) return [this.after([implied]), [BLANK]];
		if (list.prepull) return [this.after([implied]), [BLANK, headerLine(`${PREPULL}:`)]];
		return [this.after([implied, ...this.sections(PREPULL)]), [BLANK, headerLine(`${PRIORITY}:`)]];
	}

	// The line after the top-level statements and the given sections.
	private after(sections: Section[]): number {
		return Math.max(...this.file.tree.top.map(s => s.range.end.line), ...sections.map(lastLine)) + 1;
	}

	private sections(name: string): Section[] {
		return this.file.tree.sections.filter(s => s.name === name);
	}

	private groups() {
		const { out, model } = this;
		const current = new Set(model.groups);
		for (const g of model.old) if (!current.has(g)) out.drop(g.block!.first, g.block!.last);
		for (const g of model.groups) {
			if (!g.header) continue;
			const header = g.header.statement;
			if (g.renamed && !header.body) {
				const comment = header.inner.find((t): t is Comment => t.type === 'comment');
				const line = header.range.start.line;
				out.drop(line, line);
				out.insert(line, [headerLine(`${GROUP} ${JSON.stringify(g.name)}:${comment ? ` ${trailingText(comment)}` : ''}`)], g.block);
			}
			this.list(g.variables);
			this.list(g.actions);
		}
		const anchors = stable(
			model.groups.filter(g => g.block),
			model.old,
		);
		model.groups.forEach((g, k) => {
			if (anchors.has(g)) return;
			const lines = g.block ? out.moveOut(g.block) : this.group(g);
			const [prev, next] = [nearest(model.groups, k, -1, anchors), nearest(model.groups, k, 1, anchors)];
			if (prev) out.insert(prev.block!.last + 1, [BLANK, ...lines]);
			else if (next) out.insert(next.block!.first, [...lines, BLANK]);
			else out.insert(this.after([this.file.tree.sections[0], ...this.sections(PREPULL), ...this.sections(PRIORITY)]), [BLANK, ...lines]);
		});
	}

	// A group the text does not hold.
	private group(g: Group): Line[] {
		return [headerLine(`${GROUP} ${JSON.stringify(g.name)}:`), ...[g.variables, g.actions].flatMap(list => list.slots.flatMap(s => this.render(s, list)))];
	}

	// A slot printed from its JSON, with the comment lines directly above its statement, and the comments in it: one
	// at the end of its last line stays there, and any other goes above it.
	private render(s: Slot, list: List, printer = this.printer, scope = list.group?.name): Line[] {
		const unit = s.unit;
		const indent = unit && !unit.header ? unit.statement.range.start.character : list.indent;
		const json = normalize(this.index, list.message, s.json);
		let stmt: Stmt = list.row ? printer.row(json, list.prepull, scope, indent) : printer.variable(json, scope, indent);
		if (s.raw) stmt = stmt.expect!.fallback();
		const above: string[] = [];
		if (unit) {
			above.push(...unit.comments.map(c => this.out.line(c.range.start.line)));
			const host = unit.header ?? unit.statement;
			const inner = host.inner.filter((t): t is Comment => t.type === 'comment');
			if (inner.length === 1 && inner[0].range.start.line === host.range.end.line) stmt = { ...stmt, trailing: trailingText(inner[0]) };
			else above.push(...inner.map(c => commentLine(c, indent)));
		}
		return plain([...above, ...layout([stmt])]);
	}
}

// --- splice

export function splice(index: SchemaIndex, names: Names, text: string, parsed: SimlParse, edits: AplEdit[]): { edits: TextEdit[] } | { error: string } {
	if (parsed.kind.section !== APL) return { error: 'the panel edits the rotation of an x.apl.siml file' };
	if (parsed.diagnostics.some(d => d.severity === 'error')) return { error: 'the text has errors; fix them to edit the rotation' };
	const use = parsed.tree.top.find((s): s is UseStatement => s.type === 'use');
	if (use) return { error: `the rotation is put together with ${use.path.value}; edit it as text` };
	const file = readFile(index, names, text, parsed.kind, undefined);
	if (file.diagnostics.some(d => d.severity === 'error')) return { error: 'the text is not the text that was parsed; parse it again' };
	const rotation = new Rotation(index, file);
	for (const edit of edits) {
		const error = rotation.apply(edit);
		if (error) return { error };
	}

	const R = index.vocabulary.rotation.f;
	const base = rotationPath(index);
	const writer = () => new Writer(index, names, text, file, rotation);
	const printed = (s: Slot) => s.dirty || s.unit === undefined;
	const declared = (json: JsonValue | undefined) => JSON.stringify(declaredBy(index, json).variables);
	if (declared(rotation.model.rotation) !== declared(rotation.json())) {
		const before = new Printer(index, names, classOf(index, file.spec), declaredBy(index, rotation.model.rotation).variables);
		for (const s of writer().unsettled(before)) s.dirty = true;
	}
	const items = (v: JsonValue | undefined, key: string) => (isObject(v) && Array.isArray(v[key]) ? (v[key] as JsonValue[]) : []);

	for (let round = 0; round < ROUNDS; round++) {
		const out = writer().statements();
		const back = readFile(index, names, out.result(), parsed.kind, undefined);
		// The forms the printer writes read back, so an error is the edited rotation's own: a cycle, or a name
		// written twice.
		const error = back.diagnostics.find(d => d.severity === 'error');
		if (error) return { error: `the edited rotation has an error: ${error.message}` };
		// A statement that does not read as its JSON is printed from it, and one printed already is written as raw JSON.
		const got = valueAt(back.json, base);
		const misread = rotation.lists().flatMap(list => {
			const group = list.group && rotation.model.groups.indexOf(list.group);
			const read = items(group === undefined ? got : items(got, R.groups)[group], list.key);
			return list.slots.filter((s, k) => read.length !== list.slots.length || !readsBack(index, read[k], normalize(index, list.message, s.json)));
		});
		if (misread.some(s => s.raw)) break;
		if (misread.length) {
			for (const s of misread) {
				if (printed(s)) s.raw = true;
				else s.dirty = true;
			}
			continue;
		}
		if (!readsBack(index, got, rotation.json())) break;
		return { edits: out.edits() };
	}
	return { error: 'the edited rotation does not read back as its JSON' };
}
