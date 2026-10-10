import type { TextEdit } from 'vscode-languageserver-types';

import { type Parsed, rangeOf } from './document.ts';

// The file as `format` writes it (SPEC.md §12.1), as one edit over the lines that change; none while the text has an
// error, which format does not reprint.
export function formatting(p: Parsed): TextEdit[] {
	const formatted = p.ws.siml.format(p.text, { path: p.path }).text;
	const replace = formatted === undefined ? undefined : minimalReplace(p.text, formatted);
	return replace ? [{ range: rangeOf(p.lines, replace.start, replace.end), newText: replace.text }] : [];
}

// The smallest single replacement that turns `before` into `after`, so the editor keeps the cursor and folding
// outside it and undo restores it in one step.
export function minimalReplace(before: string, after: string): { start: number; end: number; text: string } | undefined {
	if (before === after) return undefined;
	let start = 0;
	while (start < before.length && start < after.length && before[start] === after[start]) start++;
	let tail = 0;
	while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
	return { start, end: before.length - tail, text: after.slice(start, after.length - tail) };
}
