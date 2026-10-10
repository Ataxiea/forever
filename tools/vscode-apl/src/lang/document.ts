import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Position as LspPosition, Range as LspRange } from 'vscode-languageserver-types';

import { classOf, type JsonPath, LineMap, type Range, type SimlParse, type SpecDef } from './siml.ts';
import { inSpecs, type Workspace } from './workspace.ts';

// A .siml file's text, read with the repository's schema and table: what every service works from.
export interface Parsed {
	ws: Workspace;
	path: string; // The file's path, which gives its kind; '' for text with no file.
	text: string;
	open: Opener; // How the parse read the files `use` names, which the services read them with too.
	parse: SimlParse;
	lines: LineMap;
	spec?: SpecDef;
	cls?: string; // The class the file's names are read with.
	repository: boolean; // Under ui/specs, where warnings are errors and raw refs are reported.
}

// Reads a file that `use` names: an open editor's text when there is one, else the file on disk.
export type Opener = (path: string) => string | undefined;

export const readDisk: Opener = path => {
	try {
		return statSync(path).isFile() ? readFileSync(path, 'utf8') : undefined;
	} catch {
		return undefined;
	}
};

export function parseText(ws: Workspace, path: string, text: string, open: Opener = readDisk): Parsed {
	const parse = ws.siml.parse(text, { path, open });
	const spec = parse.spec === undefined ? undefined : ws.index.specs.get(parse.spec);
	return { ws, path, text, open, parse, lines: new LineMap(text), spec, cls: classOf(ws.index, spec), repository: path !== '' && inSpecs(ws.root, path) };
}

// Whether two paths name one file, whichever separator each is written with.
export const samePath = (a: string, b: string) => a.replaceAll('\\', '/') === b.replaceAll('\\', '/');

// The .siml files near a file, which `use` names by a short path from its folder: those in its folder and the folder
// above, and in the folders those hold (`../gear_sets/p1.gear.siml` from an apls folder). The file itself is left out.
export function nearbyFiles(path: string): string[] {
	const folder = dirname(path);
	const files = new Set<string>();
	for (const dir of [folder, dirname(folder)]) {
		for (const name of list(dir)) {
			const full = join(dir, name);
			if (name.endsWith('.siml')) files.add(full);
			else if (isDirectory(full)) for (const inner of list(full)) if (inner.endsWith('.siml')) files.add(join(full, inner));
		}
	}
	return [...files].filter(file => !samePath(file, path));
}

function list(dir: string): string[] {
	try {
		return readdirSync(dir);
	} catch {
		return [];
	}
}

function isDirectory(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

export function lspRange(range: Range): LspRange {
	return { start: { line: range.start.line, character: range.start.character }, end: { line: range.end.line, character: range.end.character } };
}

export function rangeOf(lines: LineMap, start: number, end: number): LspRange {
	return lspRange(lines.range(start, end));
}

// The offset of an LSP position, clamped to its line.
export function offsetAt(p: Parsed, position: LspPosition): number {
	const starts = p.lines.starts;
	if (position.line >= starts.length) return p.text.length;
	const lineEnd = position.line + 1 < starts.length ? starts[position.line + 1] - 1 : p.text.length;
	return Math.min(starts[Math.max(0, position.line)] + Math.max(0, position.character), lineEnd);
}

export const contains = (range: Range, offset: number) => range.start.offset <= offset && offset <= range.end.offset;

// The rotation's place in the JSON the spans lead into: none in an x.apl.siml, whose spans lead into the rotation, and
// the settings' rotation field in any other file.
function rotationBase(p: Parsed): JsonPath {
	return p.parse.kind.section === 'apl' ? [] : p.ws.index.sections.get('apl')!.sources[0].path;
}

const startsWith = (path: JsonPath, prefix: JsonPath) => prefix.length <= path.length && prefix.every((part, i) => part === path[i]);

// The text of the innermost node a rotation path leads into: the path's own span, else the deepest span that holds it.
export function spanFor(p: Parsed, path: JsonPath): Range | undefined {
	const full = [...rotationBase(p), ...path];
	let best: { length: number; range: Range } | undefined;
	for (const span of p.parse.spans) {
		if (startsWith(full, span.path) && (!best || span.path.length > best.length)) best = { length: span.path.length, range: span.range };
	}
	return best?.range;
}

// The rotation path the text at `offset` writes: the path of the shortest span around it, the deeper one of two the
// same length. Empty outside the rotation's spans.
export function pathAt(p: Parsed, offset: number): JsonPath {
	const base = rotationBase(p);
	const size = (range: Range) => range.end.offset - range.start.offset;
	let best: { path: JsonPath; range: Range } | undefined;
	for (const span of p.parse.spans) {
		if (!contains(span.range, offset) || !startsWith(span.path, base)) continue;
		if (!best || size(span.range) < size(best.range) || (size(span.range) === size(best.range) && span.path.length > best.path.length)) best = span;
	}
	return best ? best.path.slice(base.length) : [];
}
