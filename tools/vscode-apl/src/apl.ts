// An .apl.siml rotation as the panel, the sims and Insert Pattern read it: the file parsed with the schema and the
// name table of the repository it sits in, its rotation's JSON, and the text each JSON path is written at. Edits to
// the rotation go through the SIML module's splice, which prints only the statements they change.

import type { DiagnosticSeverity } from 'vscode-languageserver-types';

import { diagnose } from './lang/diagnostics.ts';
import { offsetAt, type Opener, type Parsed, parseText, pathAt, readDisk } from './lang/document.ts';
import { type AplEdit, resolveUse, type TextEdit } from './lang/siml.ts';
import { loadWorkspace, repositoryRoot } from './lang/workspace.ts';
import type { LintFinding, LintSeverity } from './lint/index.ts';

export const isAplSiml = (path: string) => path.endsWith('.apl.siml');

// The file's text, parsed; or why the repository's schema or table cannot be read.
export function readApl(file: string, text: string, open: Opener = readDisk): Parsed | { error: string } {
	const root = repositoryRoot(file);
	if (!root) return { error: 'the file is not in a WoWSims repository: no sim/siml/names.json above it' };
	const ws = loadWorkspace(root);
	return 'error' in ws ? ws : parseText(ws, file, text, open);
}

// Why the panel cannot edit the rotation: the text has an error, or the rotation is put together with another file,
// whose rows the panel shows but this text does not hold. Undefined when it can.
export function readOnlyReason(p: Parsed): string | undefined {
	const error = p.parse.diagnostics.find(d => d.severity === 'error');
	if (error) return `The text has errors (line ${error.range.start.line + 1}: ${error.message}). Edits wait until it reads again.`;
	const use = p.parse.tree.top.find(s => s.type === 'use');
	if (use?.type === 'use') return `The rotation is put together with ${use.path.value}; edit it as text.`;
	return undefined;
}

const SEVERITY: Record<DiagnosticSeverity, LintSeverity> = { 1: 'error', 2: 'warning', 3: 'info', 4: 'info' };

// The file's diagnostics, each at the rotation path of the text it is about, for the panel's rows: what the Problems
// panel shows for the file.
export function panelFindings(p: Parsed): LintFinding[] {
	return diagnose(p).map(d => ({
		path: pathAt(p, offsetAt(p, d.range.start)),
		severity: SEVERITY[d.severity ?? 1],
		code: String(d.code ?? ''),
		message: typeof d.message === 'string' ? d.message : d.message.value,
	}));
}

// The text edits that make the panel's edits, or why they cannot be made: the text has errors or uses another file,
// a path leads through an index or a field that does not exist, or the edited rotation has an error.
export function spliceApl(p: Parsed, edits: AplEdit[]): { edits: TextEdit[] } | { error: string } {
	return p.ws.siml.splice(p.text, p.parse, edits);
}

// The files the rotation's `use` lines name.
export function usedFiles(p: Parsed): string[] {
	return p.parse.tree.top.flatMap(s => (s.type === 'use' ? [resolveUse(p.path, s.path.value)] : []));
}

// The line a row's text starts on, by its JSON path joined with '/'; undefined for a row of a used file.
export function rowLine(p: Parsed, key: string): number | undefined {
	return p.parse.spans.find(span => span.path.join('/') === key)?.range.start.line;
}

// Whether a document moved from version `base` to `current` only through `own` changes: each version between was
// one the panel's own edits made.
export function movedOnlyBy(own: ReadonlySet<number>, base: number, current: number): boolean {
	for (let version = base + 1; version <= current; version++) if (!own.has(version)) return false;
	return base <= current;
}
