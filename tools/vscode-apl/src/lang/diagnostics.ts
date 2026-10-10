import { type Diagnostic, DiagnosticSeverity } from 'vscode-languageserver-types';

import { lintApl, type LintFinding } from '../lint/index.ts';
import { enchantFits, itemName, itemSlots, loadDatabase } from './database.ts';
import { lspRange, type Parsed, spanFor } from './document.ts';
import { isSpellLike, type Range, SLOT_ENUM, THINGS } from './siml.ts';

export const SOURCE = 'siml';
const CHECKS = 'siml-lint';
// The lint codes the parser reports too (SPEC.md §7.5). Where both report one at the same text, the parser's stands.
const PARSER_CHECKS = new Set(['undefined-group', 'undefined-variable', 'undefined-sequence', 'duplicate-variable']);
const LINT_SEVERITY: Record<LintFinding['severity'], DiagnosticSeverity> = {
	error: DiagnosticSeverity.Error,
	warning: DiagnosticSeverity.Warning,
	info: DiagnosticSeverity.Information,
};

// The file's diagnostics: the parser's, the raw refs a file under ui/specs may not hold, names the spec registers
// for no build, the rotation lints, and slot rows the database says do not fit. Under ui/specs, where the
// repository's checks hold, warnings are errors.
export function diagnose(p: Parsed): Diagnostic[] {
	const strict = (severity: DiagnosticSeverity) => (p.repository && severity === DiagnosticSeverity.Warning ? DiagnosticSeverity.Error : severity);
	const out: Diagnostic[] = p.parse.diagnostics.map(d => ({
		range: lspRange(d.range),
		severity: strict(d.severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning),
		code: d.code,
		source: SOURCE,
		message: d.message,
	}));
	if (p.repository) {
		for (const d of p.parse.rawRefs)
			out.push({ range: lspRange(d.range), severity: DiagnosticSeverity.Error, code: d.code, source: SOURCE, message: d.message });
	}
	const check = (range: Range, code: string, message: string) =>
		out.push({ range: lspRange(range), severity: strict(DiagnosticSeverity.Warning), code, source: CHECKS, message });
	unregistered(p, check);
	gear(p, check);
	for (const finding of p.parse.rotation ? lintApl(p.parse.rotation) : []) {
		const range = spanFor(p, finding.path);
		if (!range || (PARSER_CHECKS.has(finding.code) && p.parse.diagnostics.some(d => d.code === finding.code && overlaps(d.range, range)))) continue;
		out.push({ range: lspRange(range), severity: LINT_SEVERITY[finding.severity], code: finding.code, source: CHECKS, message: finding.message });
	}
	return out;
}

const overlaps = (a: Range, b: Range) => a.start.offset <= b.end.offset && b.start.offset <= a.end.offset;

type Check = (range: Range, code: string, message: string) => void;

// A spell-like name the spec registers for no build, as the repository's registration check finds it: the sim does
// not have it unless gear, an item or a setting the builds leave out registers it.
function unregistered(p: Parsed, check: Check): void {
	const spec = p.parse.spec;
	for (const ref of p.parse.refs) {
		if (!isSpellLike(ref.namespace)) continue;
		const entry = p.ws.names.spell(p.cls, ref.namespace, ref.name);
		if (!entry) continue;
		const registered = spec === undefined ? entry.registeredBy.length > 0 : entry.registeredBy.includes(spec);
		if (!registered)
			check(ref.range, 'unregistered-name', `${ref.name} is ${THINGS[ref.namespace]} no ${spec === undefined ? '' : `${spec} `}build registers`);
	}
}

// Slot rows whose item, suffix or enchant the database says do not go together: the item goes in another slot, the
// item rolls no such suffix, or no row of the enchant fits the slot or the item.
function gear(p: Parsed, check: Check): void {
	const { names, table, index } = p.ws;
	const rows = p.parse.tree.statements.flatMap(s => (s.type === 'slot_row' ? [s] : s.type === 'header' && s.body?.type === 'slot_row' ? [s.body] : []));
	if (!rows.length) return;
	const db = loadDatabase(p.ws.root);
	for (const row of rows) {
		if (!('text' in row.item)) continue;
		const slot = row.slot.text;
		const slotNumber = index.enumValue(SLOT_ENUM, slot)?.number;
		const id = names.item(row.item.text);
		const item = id === undefined ? undefined : db.items.get(id);
		if (id !== undefined && !item) {
			const known = itemName(db, id);
			check(row.item.range, 'gear-item', known ? `${known} is no gear the database lists` : `the database has no item ${id}`);
		} else if (item && slotNumber !== undefined && !itemSlots(item).includes(slotNumber)) {
			const slots = itemSlots(item).map(n => index.enumNumber(SLOT_ENUM, n)?.short);
			check(row.item.range, 'gear-slot', `${item.name} goes in ${slots.join(' or ') || 'no slot'}, not ${slot}`);
		}
		if (row.suffix && item) {
			const suffix = names.suffix(row.suffix.text);
			if (suffix !== undefined && !(item.randomSuffixOptions ?? []).includes(suffix)) {
				check(row.suffix.range, 'gear-suffix', `${item.name} rolls no ${row.suffix.text}`);
			}
		}
		if (row.enchant) {
			const entry = table.enchants?.[row.enchant.text];
			if (!entry) continue;
			if (!entry.slots.includes(slot)) check(row.enchant.range, 'gear-enchant', `${row.enchant.text} fits ${entry.slots.join(', ')}, not ${slot}`);
			else if (item && !enchantFits(db, entry.effectId, item)) check(row.enchant.range, 'gear-enchant', `${row.enchant.text} does not fit ${item.name}`);
		}
	}
}
