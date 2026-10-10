// `format` (SPEC.md §12.1, §10): every statement of a file re-printed from its typed value, with the comments,
// notes and single blank lines of the source kept. A file with errors is not formatted, and `use` lines are not
// followed: format reads one file.

import { valueAt } from './json.ts';
import { classOf, type Names } from './names.ts';
import { INDENT, type Item, layout, Printer, type Stmt, verified, type Write } from './print.ts';
import { inFileOrder, isEntry } from './rotation.ts';
import { type Placed, type SchemaIndex, sectionFields, SLOT_ENUM } from './schema.ts';
import { readFile } from './setup.ts';
import type { Comment, JsonObject, JsonPath, Section, SimlDiagnostic, SimlKind, Statement, Trivia } from './types.ts';
import { isList } from './typing.ts';

const PREPULL = 'prepull';
const TOP = new Set(['version', 'spec', 'talents', 'use']);
const BLANK: Item = { blank: true };

// A comment on a line of its own at `indent`, without the spaces and tabs that end it.
export const commentLine = (c: Comment, indent: number) => `${' '.repeat(indent)}//${c.text.trimEnd()}`;
// A comment at the end of a line, without the spaces and tabs that end it.
export const trailingText = (c: Comment) => `//${c.text.trimEnd()}`;

// The formatted text, or only the diagnostics when the file has errors.
export function formatFile(index: SchemaIndex, names: Names, text: string, kind: SimlKind): { text?: string; diagnostics: SimlDiagnostic[] } {
	const file = readFile(index, names, text, kind, undefined);
	const { tree, diagnostics } = file;
	if (diagnostics.some(d => d.severity === 'error')) return { diagnostics };

	const printer = new Printer(index, names, classOf(index, file.spec), file.declarations);
	const sectionOf = new Map<Statement, Section>();
	for (const section of tree.sections) {
		if (section.header) sectionOf.set(section.header, section);
		for (const s of section.body) sectionOf.set(s, section);
	}
	const implied = kind.section === undefined ? undefined : tree.sections[0];
	const fields = new Map<Section, Placed[]>();
	const placedIn = (section: Section) => {
		let placed = fields.get(section);
		if (!placed) fields.set(section, (placed = sectionFields(index, index.sections.get(section.name)!, file.spec)));
		return placed;
	};
	const items: Item[] = [];

	// The comment and blank lines above a statement, a run of blank lines as one: none before the file's first
	// line or a section's first body line, and exactly one before the first line of a block.
	const leading = (trivia: Trivia[], indent: number, startsBlock: boolean, startsSection: boolean) => {
		const lines: Array<Comment | 'blank'> = [];
		for (const t of trivia) {
			if (t.type === 'comment') lines.push(t);
			else if (t.type === 'blank' && lines.at(-1) !== 'blank') lines.push('blank');
		}
		const blankFirst = lines[0] === 'blank';
		if (blankFirst) lines.shift();
		if (startsBlock || (blankFirst && !startsSection && items.length)) items.push(BLANK);
		items.push(...lines.map(l => (l === 'blank' ? BLANK : { line: commentLine(l, indent) })));
	};

	let block: unknown;
	let previous: Statement | undefined;
	let carried: string | undefined; // A header's trailing comment, which goes to the body line written after it.
	let header: { line: string; join?: boolean } | undefined; // The header line whose body line is being written.
	for (const s of inFileOrder(tree)) {
		const section = sectionOf.get(s);
		const group = TOP.has(s.type) ? 'top' : section;
		const indent = !section || s.type === 'header' || section === implied ? 0 : INDENT;
		const startsBlock = previous !== undefined && group !== block;
		const startsSection = previous?.type === 'header' && sectionOf.get(previous) === section;
		const onHeader = previous?.type === 'header' && previous.body === s ? header : undefined;
		block = group;
		previous = s;
		leading(s.leading, indent, startsBlock, startsSection);
		// One comment on a statement's last line stays at the end of its last line; any other inner comment is
		// written above it.
		const comments = s.inner.filter((t): t is Comment => t.type === 'comment');
		const onLastLine = comments.length === 1 && comments[0].range.start.line === s.range.end.line;
		if (!onLastLine) items.push(...comments.map(c => ({ line: commentLine(c, indent) })));
		let trailing = onLastLine ? trailingText(comments[0]) : carried;
		carried = undefined;
		if (s.type === 'header' && s.body) [carried, trailing] = [trailing, undefined];
		const line = (text: string): Item => ({ line: trailing ? `${text} ${trailing}` : text });
		const at = (path: JsonPath) => valueAt(file.json, path);
		switch (s.type) {
			case 'version':
				items.push(line('siml 1'));
				break;
			case 'spec':
				items.push(line(`spec ${s.spec.text}`));
				break;
			case 'talents':
				items.push(line(`talents ${JSON.stringify(s.talents.value)}`));
				break;
			case 'use': {
				const values = file.withs.get(s) ?? [];
				const binds = s.with.map((b, i) => ({ name: b.variable.name, braced: b.variable.braced, value: values[i] }));
				items.push({ ...printer.use(s.path.value, binds, indent), trailing });
				break;
			}
			case 'header':
				header = { line: s.group ? `group ${JSON.stringify(s.group.value)}:` : `${s.name.text}:` };
				if (trailing) header.line += ` ${trailing}`;
				items.push(header);
				break;
			case 'var':
				items.push({ ...printer.variable(at(file.paths.get(s)!)!, section?.group, indent), trailing });
				break;
			case 'row':
				items.push({ ...printer.row(at(file.paths.get(s)!)!, section?.name === PREPULL, section?.group, indent), trailing });
				break;
			case 'slot_row': {
				const [path] = file.entries.get(s)!;
				const slot = index.enumNumber(SLOT_ENUM, path.at(-1) as number)!;
				items.push({ ...printer.slotRow(slot.short, at(path) as JsonObject, path, indent, s.enchant?.text), trailing });
				break;
			}
			default: {
				if (!isEntry(s) || !section) break;
				const stmts: Stmt[] = printer.entries(statementWrites(placedIn(section), file.entries.get(s) ?? [], file.json), indent);
				if (stmts.length) stmts[stmts.length - 1].trailing = trailing;
				// A section's one entry stays on its header line when it is written there.
				if (onHeader && stmts.length === 1 && section.body.length === 1) onHeader.join = true;
				items.push(...stmts);
			}
		}
	}
	let blank = false;
	for (const t of tree.trailing) {
		if (t.type === 'blank') blank = true;
		else if (t.type === 'comment') {
			if (blank) items.push(BLANK);
			items.push({ line: commentLine(t, 0) });
			blank = false;
		}
	}
	return { text: verified(index, names, kind, items, current => `${layout(current).join('\n')}\n`), diagnostics };
}

// The writes of an entry line, from the paths it writes: the values one line gives a list, together.
function statementWrites(placed: Placed[], paths: JsonPath[], json: JsonObject): Write[] {
	const out: Write[] = [];
	for (const path of paths) {
		const p = placed.find(({ field, at }) => [...at, field.json].every((k, i) => path[i] === k) && path.length <= at.length + 2)!;
		const value = valueAt(json, path);
		const last = out.at(-1);
		if (last?.placed === p && isList(p.field) && p.field.printed !== 'message') {
			last.values.push(value);
			last.paths.push(path);
		} else out.push({ placed: p, values: [value], paths: [path] });
	}
	return out;
}
