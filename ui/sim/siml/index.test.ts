import { describe, expect, it } from 'vitest';

import { createSiml, type NameTable } from './index.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

describe('createSiml', () => {
	const siml = createSiml(testSchema, fixtureNames);

	it('reads the file kind from a path', () => {
		expect(siml.kindOf('ui/specs/hunter/dps/gear_sets/p1.gear.siml')).toEqual({ section: 'gear' });
		expect(siml.kindOf('wowsims.siml')).toEqual({});
	});

	it('parses into the syntax tree and its diagnostics, with the kind its path gives, reading names from the table', () => {
		const parsed = siml.parse('siml 1\nhead lieutenant_commanders_chain_helmet + falcons_call\n', { path: 'p1.gear.siml' });
		expect(parsed.kind).toEqual({ section: 'gear' });
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.tree.sections.map(s => s.name)).toEqual(['gear']);
		expect((parsed.equipment?.items as unknown[])[0]).toEqual({ id: 16428, enchant: 2586 });
	});

	it('reads text with no path as a full file', () => {
		const parsed = siml.parse('siml 1\nspec hunter\npriority:\n  cast x if a = b\n');
		expect(parsed.kind).toEqual({});
		expect(parsed.settings).toBeUndefined();
		expect(parsed.diagnostics.map(d => [d.range.start.line, d.range.start.character, d.code])).toEqual([[3, 14, 'write-eq']]);
	});

	it('refuses a name table that breaks the rules of SPEC.md §7.4', () => {
		const spell = (spellId: number, tag?: number) => ({ spellId, tag, registeredBy: [] });
		const refused = (table: NameTable) => () => createSiml(testSchema, table);
		expect(refused({ items: { a: 1, b: 1 } })).toThrow('the name table names items 1 twice: a and b');
		expect(refused({ suffixes: { a: 1, b: 1 } })).toThrow('the name table names suffixes 1 twice: a and b');
		expect(refused({ shared: { spell: { a: spell(1), b: spell(1) } } })).toThrow('the name table names spell 1 twice in shared.spell: a and b');
		expect(refused({ classes: { hunter: { aura: { a: spell(1, 2), b: spell(1, 2) } } } })).toThrow('in hunter.aura');
		expect(refused({ classes: { hunter: { spell: { a: spell(1) } } }, shared: { spell: { a: spell(2) } } })).toThrow(
			'the name table gives a two meanings in hunter.spell and shared.spell',
		);
		expect(refused({ items: { Bad: 1 } })).toThrow("the name table's items.Bad is no name of a positive id");
		expect(refused({ suffixes: { a: 0 } })).toThrow("the name table's suffixes.a is no name of a positive id");
		expect(refused({ shared: { aura: { '1a': spell(1) } } })).toThrow("the name table's shared.aura.1a is no name of a positive id");
		expect(refused({ enchants: { a: { effectId: 1, slots: ['hed'] } } })).toThrow("the name table's enchants.a fits hed, which is no slot");
		expect(refused({ classes: { warlord: {} } })).toThrow('the name table holds the class warlord, which is no class');
		expect(refused({ shared: { spells: {} } as NameTable['shared'] })).toThrow('the name table holds shared.spells, which is no spell-like namespace');
		expect(refused({ classes: { hunter: { spell: { a: spell(1) } } }, shared: { spell: { b: spell(1) } } })).not.toThrow();
		expect(refused({ shared: { spell: { a: spell(1, 1), b: spell(1) } } })).not.toThrow();
	});
});
