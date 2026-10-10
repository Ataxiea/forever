import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	type DocumentLink,
	type DocumentSymbol,
	type FoldingRange,
	FoldingRangeKind,
	type Location,
	type Position,
	type Range as LspRange,
	SymbolKind,
	type TextEdit,
	type WorkspaceEdit,
} from 'vscode-languageserver-types';

import { contains, lspRange, nearbyFiles, offsetAt, type Parsed, parseText, samePath } from './document.ts';
import {
	type AccessorNode,
	type CallNode,
	declaredIn,
	type GroupStep,
	identifier,
	type KindForm,
	type PlaceholderNode,
	type Range,
	resolveUse,
	resolveVariable,
	type SchemaIndex,
	type SequenceStep,
	type StringNode,
	type UseStatement,
	type VarNode,
} from './siml.ts';
import { sectionsByStatement, type TreeNode, walk } from './tree.ts';

// The names a rotation gives its own parts, which go to definition, find references and rename work on: value and
// group variables, groups, sequences and placeholders.
export type SymbolKindName = 'variable' | 'group' | 'sequence' | 'placeholder';

export interface Occurrence {
	kind: SymbolKindName;
	name: string; // The exact name it means; the written name when it resolves to nothing in this file.
	range: Range; // `$x`, `${X}`, `"Name"` or `%p`.
	definition: boolean;
	scope?: string; // The group a variable or placeholder belongs to.
	resolved: boolean; // Whether this file, or the file a `use … with` bind sets a variable of, declares what it names.
	file?: string; // For a `use … with` bind: the file that declares the variable it sets.
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
// The kinds whose string field names a group, by that field's proto name.
const GROUP_FIELDS: Record<string, string> = { group_reference: 'group_name', action_group_used: 'name' };
const SEQUENCE_HEAD = 'sequence';
const GROUP_SECTION = 'group';

// What a kind's string field names: a group, a sequence (a field named like the `sequence` head's subject, SPEC.md
// §7.5), or nothing the file defines.
export function namedBy(index: SchemaIndex, kind: KindForm | undefined, field: string | undefined): 'group' | 'sequence' | undefined {
	if (!kind || field === undefined) return undefined;
	if (GROUP_FIELDS[kind.kind] === field) return 'group';
	const sequence = [...index.accessors.values()].some(k => k.accessor?.head === SEQUENCE_HEAD && k.accessor.subject === field);
	return sequence && index.fields(kind.message).some(f => f.name === field && f.printed === 'string') ? 'sequence' : undefined;
}

// Every occurrence of a variable, group, sequence or placeholder in the file, in file order.
export function occurrences(p: Parsed): Occurrence[] {
	const { tree } = p.parse;
	const { index } = p.ws;
	const sections = sectionsByStatement(tree);
	const out: Occurrence[] = [];
	const declarations: Array<{ name: string; scope: string | undefined; node: VarNode }> = [];
	const uses: Array<{ node: VarNode; scope: string | undefined }> = [];
	const groupOf = (statement: unknown) => sections.get(statement as never)?.group;

	for (const statement of tree.statements) {
		const scope = groupOf(statement);
		if (statement.type === 'use') {
			out.push(...withBinds(p, statement));
			continue;
		}
		if (statement.type === 'header' && statement.group && sections.get(statement)?.name === GROUP_SECTION) {
			out.push({ kind: 'group', name: statement.group.value, range: statement.group.range, definition: true, resolved: true });
		}
		walk(statement, (node, parent) => {
			const n = node as unknown as Node;
			switch (n.type) {
				case 'var':
					// The statement `var $x = …` and the node `$x` share the type; the node has `braced`.
					if (!('braced' in n)) break;
					if (statement.type === 'var' && n === statement.variable) declarations.push({ name: n.name, scope, node: n });
					else uses.push({ node: n, scope });
					break;
				case 'placeholder':
					// A `with` list's placeholders belong to the group it references, and are added with that reference.
					if (!isWithBind(parent)) out.push({ kind: 'placeholder', name: n.name, range: n.range, definition: true, scope, resolved: true });
					break;
				case 'group':
					out.push({ kind: 'group', name: n.name.value, range: n.name.range, definition: false, resolved: true });
					for (const bind of n.with) {
						out.push({
							kind: 'placeholder',
							name: bind.placeholder.name,
							range: bind.placeholder.range,
							definition: false,
							scope: n.name.value,
							resolved: true,
						});
					}
					break;
				case 'sequence':
					out.push({ kind: 'sequence', name: n.name.value, range: n.name.range, definition: true, resolved: true });
					break;
				case 'accessor':
					if (n.head.text === SEQUENCE_HEAD && isString(n.subject)) {
						out.push({ kind: 'sequence', name: n.subject.value, range: n.subject.range, definition: false, resolved: true });
					}
					break;
				case 'call': {
					const kind = index.actionKinds.get(n.name.text) ?? index.valueKinds.get(n.name.text);
					if (!kind) break;
					for (const arg of n.args?.items ?? []) {
						const named = namedBy(index, kind, arg.name ? index.field(kind.message, arg.name.text)?.name : kind.positional);
						if (named && isString(arg.value))
							out.push({ kind: named, name: arg.value.value, range: arg.value.range, definition: false, resolved: true });
					}
					break;
				}
			}
		});
	}

	for (const d of declarations) out.push({ kind: 'variable', name: d.name, range: d.node.range, definition: true, scope: d.scope, resolved: true });
	for (const use of uses) {
		const resolution = resolveVariable(use.node.name, use.node.braced, declaredIn(declarations, use.scope));
		const name = 'name' in resolution ? resolution.name : use.node.name;
		const declared = declarations.find(d => d.name === name && (d.scope === undefined || d.scope === use.scope));
		out.push({ kind: 'variable', name, range: use.node.range, definition: false, scope: declared?.scope, resolved: 'name' in resolution });
	}
	// Groups and sequences the file names but never defines resolve to nothing.
	const defined = new Set(out.filter(o => o.definition).map(o => `${o.kind}\u0000${o.name}`));
	for (const o of out) if ((o.kind === 'group' || o.kind === 'sequence') && !defined.has(`${o.kind}\u0000${o.name}`)) o.resolved = false;
	return out.sort((a, b) => a.range.start.offset - b.range.start.offset);
}

// The variables a `use … with` list sets, each an occurrence of the variable in the file that declares it: the used
// file, or one it uses in turn. They resolve as the parser reads them, against every variable those files declare.
function withBinds(p: Parsed, use: UseStatement): Occurrence[] {
	const path = resolveUse(p.path, use.path.value);
	const declared = use.with.length ? declaredThrough(p, path, [p.path]) : [];
	const names = declared.map(d => d.name);
	return use.with.map(({ variable }) => {
		const resolution = resolveVariable(variable.name, variable.braced, names);
		const name = 'name' in resolution ? resolution.name : variable.name;
		const file = declared.find(d => d.name === name)?.file ?? path;
		return { kind: 'variable', name, range: variable.range, definition: false, resolved: 'name' in resolution, file };
	});
}

// The variables a `use` line of `p` naming `usePath` can set: those the file declares outside its groups, then those of
// the files it uses in turn, each with the file that declares it.
export function settableVariables(p: Parsed, usePath: string): Array<{ name: string; file: string }> {
	return declaredThrough(p, resolveUse(p.path, usePath), [p.path]);
}

function declaredThrough(p: Parsed, path: string, chain: string[]): Array<{ name: string; file: string }> {
	const text = chain.some(file => samePath(file, path)) ? undefined : p.open(path);
	if (text === undefined) return [];
	const used = parseText(p.ws, path, text, p.open);
	const sections = sectionsByStatement(used.parse.tree);
	const out: Array<{ name: string; file: string }> = [];
	for (const s of used.parse.tree.statements) {
		if (s.type === 'var' && sections.get(s)?.group === undefined) out.push({ name: s.variable.name, file: path });
		if (s.type === 'use') out.push(...declaredThrough(used, resolveUse(path, s.path.value), [...chain, path]));
	}
	return out;
}

// The nodes the walk reads names from, by their `type`.
type Node = VarNode | PlaceholderNode | GroupStep | SequenceStep | AccessorNode | CallNode | { type?: undefined };

const isString = (value: unknown): value is StringNode => typeof value === 'object' && value !== null && (value as StringNode).type === 'string';
const isWithBind = (parent: TreeNode | undefined) => parent !== undefined && parent.type === undefined && 'placeholder' in parent && 'value' in parent;

// Whether two occurrences name the same thing.
function same(a: Occurrence, b: Occurrence): boolean {
	if (a.kind !== b.kind || a.name !== b.name || a.file !== b.file) return false;
	return a.kind === 'group' || a.kind === 'sequence' || a.scope === b.scope;
}

function occurrenceAt(p: Parsed, position: Position): Occurrence | undefined {
	const offset = offsetAt(p, position);
	return occurrences(p).find(o => contains(o.range, offset));
}

// A file's parse and the URI its locations are given with.
interface Doc {
	p: Parsed;
	uri: string;
}

// The file that declares what an occurrence names, with the key its occurrences there match: this file, or for a
// `use … with` bind the file that declares the variable, read as `use` reads it.
function homeOf(from: Doc, at: Occurrence): { home: Doc; key: Occurrence } | undefined {
	if (at.file === undefined) return { home: from, key: at };
	const text = from.p.open(at.file);
	if (text === undefined) return undefined;
	return { home: { p: parseText(from.p.ws, at.file, text, from.p.open), uri: pathToFileURL(at.file).href }, key: { ...at, file: undefined } };
}

// The first declaration of what an occurrence names, with the file it is in.
export function declarationOf(p: Parsed, at: Occurrence): { p: Parsed; declaration: Occurrence } | undefined {
	const found = homeOf({ p, uri: '' }, at);
	const declaration = found && occurrences(found.home.p).find(o => o.definition && same(o, found.key));
	return found && declaration && { p: found.home.p, declaration };
}

// Every occurrence of what `key` names in `home`, and, for a variable outside the groups of a saved file, the
// `use … with` binds that set it in the .siml files near `home` and in `from`.
function everywhere(home: Doc, key: Occurrence, from: Doc): Array<{ uri: string; o: Occurrence }> {
	const out = occurrences(home.p)
		.filter(o => same(o, key))
		.map(o => ({ uri: home.uri, o }));
	if (key.kind !== 'variable' || key.scope !== undefined || !home.p.path) return out;
	const files = nearbyFiles(home.p.path);
	if (from.p !== home.p && !files.some(file => samePath(file, from.p.path))) files.push(from.p.path);
	for (const file of files) {
		const own = samePath(file, from.p.path);
		const text = own ? from.p.text : home.p.open(file);
		if (text === undefined || !/\buse\b/.test(text) || !/\bwith\b/.test(text)) continue;
		const other = own ? from : { p: parseText(home.p.ws, file, text, home.p.open), uri: pathToFileURL(file).href };
		for (const o of occurrences(other.p)) if (o.file !== undefined && samePath(o.file, home.p.path) && o.name === key.name) out.push({ uri: other.uri, o });
	}
	return out;
}

const location = ({ uri, o }: { uri: string; o: Occurrence }): Location => ({ uri, range: lspRange(o.range) });

// The files the `use` lines name that exist, each with its path's string.
function linkedFiles(p: Parsed): Array<{ range: Range; path: string }> {
	if (!p.path) return [];
	return p.parse.tree.top.flatMap(s => {
		if (s.type !== 'use') return [];
		const path = resolveUse(p.path, s.path.value);
		return existsSync(path) ? [{ range: s.path.range, path }] : [];
	});
}

// Each `use` path as a link to the file it names.
export function documentLinks(p: Parsed): DocumentLink[] {
	return linkedFiles(p).map(used => ({ range: lspRange(used.range), target: pathToFileURL(used.path).href }));
}

// What an occurrence names, where it is declared; or the file a `use` path names.
export function definition(p: Parsed, uri: string, position: Position): Location[] {
	const offset = offsetAt(p, position);
	const used = linkedFiles(p).find(u => contains(u.range, offset));
	if (used) return [{ uri: pathToFileURL(used.path).href, range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } } }];
	const at = occurrenceAt(p, position);
	const found = at && homeOf({ p, uri }, at);
	if (!found) return [];
	return occurrences(found.home.p)
		.filter(o => o.definition && same(o, found.key))
		.map(o => location({ uri: found.home.uri, o }));
}

export function references(p: Parsed, uri: string, position: Position, includeDeclaration: boolean): Location[] {
	const at = occurrenceAt(p, position);
	const found = at && homeOf({ p, uri }, at);
	if (!found) return [];
	return everywhere(found.home, found.key, { p, uri })
		.filter(({ o }) => includeDeclaration || !o.definition)
		.map(location);
}

// The occurrence a rename starts from, or why there is none.
export function prepareRename(p: Parsed, position: Position): { range: LspRange; placeholder: string } | { error: string } {
	const at = occurrenceAt(p, position);
	if (!at) return { error: 'Only variables, groups, sequences and placeholders rename.' };
	if (!at.resolved) return { error: `${at.file === undefined ? 'This file' : basename(at.file)} does not declare ${at.name}, so it cannot rename it.` };
	return { range: lspRange(at.range), placeholder: at.name };
}

// How an occurrence of a renamed symbol is written.
function spelled(kind: SymbolKindName, name: string): string {
	switch (kind) {
		case 'variable':
			return IDENT.test(name) ? `$${name}` : `\${${name}}`;
		case 'placeholder':
			return IDENT.test(name) ? `%${name}` : `%{${name}}`;
		default:
			return JSON.stringify(name);
	}
}

// Why what `key` names in `p` cannot take `newName`: the name is empty; it holds a `}` or a line break, which no spelling
// of a variable or placeholder writes; or another of its kind, seen where it is, has the name, which would merge the
// two. Variables compare by identifier, which a `$name` reference also resolves by.
function refusal(p: Parsed, key: Occurrence, newName: string): string | undefined {
	if (newName === '') return 'A name cannot be empty.';
	if ((key.kind === 'variable' || key.kind === 'placeholder') && /[}\r\n]/.test(newName)) return `A ${key.kind}'s name cannot hold } or a line break.`;
	const seen = (o: Occurrence) =>
		key.kind === 'group' ||
		key.kind === 'sequence' ||
		o.scope === key.scope ||
		(key.kind === 'variable' && (o.scope === undefined || key.scope === undefined));
	const taken = (o: Occurrence) => (key.kind === 'variable' ? identifier(o.name) === identifier(newName) : o.name === newName);
	const other = occurrences(p).find(o => o.definition && o.kind === key.kind && !same(o, key) && seen(o) && taken(o));
	return other && `${basename(p.path) || 'The file'} has a ${key.kind} named ${other.name} already.`;
}

// The edits that rename what the occurrence at `position` names, in every file that names it, or why it cannot be.
export function rename(p: Parsed, uri: string, position: Position, newName: string): WorkspaceEdit | { error: string } | undefined {
	const at = occurrenceAt(p, position);
	const found = at?.resolved ? homeOf({ p, uri }, at) : undefined;
	if (!found) return undefined;
	const error = refusal(found.home.p, found.key, newName);
	if (error) return { error };
	const changes: Record<string, TextEdit[]> = {};
	for (const { uri: file, o } of everywhere(found.home, found.key, { p, uri }))
		(changes[file] ??= []).push({ range: lspRange(o.range), newText: spelled(o.kind, newName) });
	return { changes };
}

// The sections and the group's and file's variables, for the outline.
export function documentSymbols(p: Parsed): DocumentSymbol[] {
	const { tree } = p.parse;
	const all = occurrences(p);
	const variables = (inside: Range | undefined, scope: string | undefined) =>
		all
			.filter(o => o.kind === 'variable' && o.definition && o.scope === scope && (!inside || contains(inside, o.range.start.offset)))
			.map(o => symbol(o.name, 'variable', SymbolKind.Variable, o.range, o.range));
	const out: DocumentSymbol[] = [];
	const firstHeader = tree.sections.find(s => s.header)?.range.start.offset ?? Infinity;
	out.push(...variables(undefined, undefined).filter(s => offsetOf(p, s.range.start) < firstHeader));
	for (const section of tree.sections) {
		if (!section.header) continue;
		const name = section.group === undefined ? section.name : `group ${JSON.stringify(section.group)}`;
		const kind = section.group === undefined ? SymbolKind.Namespace : SymbolKind.Module;
		const sequences = all
			.filter(o => o.kind === 'sequence' && o.definition && contains(section.range, o.range.start.offset))
			.map(o => symbol(o.name, 'sequence', SymbolKind.Event, o.range, o.range));
		const vars = section.group !== undefined || section.name === 'apl' ? variables(section.range, section.group) : [];
		out.push({ ...symbol(name, '', kind, section.range, section.header.range), children: [...vars, ...sequences] });
	}
	return out;
}

function offsetOf(p: Parsed, position: Position): number {
	return offsetAt(p, position);
}

function symbol(name: string, detail: string, kind: SymbolKind, range: Range, selection: Range): DocumentSymbol {
	return { name, detail, kind, range: lspRange(range), selectionRange: lspRange(selection) };
}

// Each section, each statement that runs over several lines, the block of `use` lines and each run of comment lines.
export function foldingRanges(p: Parsed): FoldingRange[] {
	const { tree } = p.parse;
	const out: FoldingRange[] = [];
	const fold = (start: number, end: number, kind?: FoldingRangeKind) => {
		if (end > start) out.push(kind ? { startLine: start, endLine: end, kind } : { startLine: start, endLine: end });
	};
	for (const section of tree.sections) if (section.header) fold(section.range.start.line, section.range.end.line, FoldingRangeKind.Region);
	for (const statement of tree.statements) fold(statement.range.start.line, statement.range.end.line);
	const uses = tree.top.filter(s => s.type === 'use');
	if (uses.length > 1) fold(uses[0].range.start.line, uses.at(-1)!.range.end.line, FoldingRangeKind.Imports);
	const comments = [...tree.statements.flatMap(s => s.leading), ...tree.trailing].filter(t => t.type === 'comment');
	let run: number[] = [];
	const flush = () => {
		if (run.length > 1) fold(run[0], run.at(-1)!, FoldingRangeKind.Comment);
		run = [];
	};
	for (const line of comments.map(c => c.range.start.line)) {
		if (run.length && line !== run.at(-1)! + 1) flush();
		run.push(line);
	}
	flush();
	return out;
}
