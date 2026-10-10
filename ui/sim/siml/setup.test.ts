import { describe, expect, it } from 'vitest';

import { createSiml, type JsonPath, type SimlParse } from './index.ts';
import { resolveUse } from './setup.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const siml = createSiml(testSchema, fixtureNames);

// The text the span of a JSON path covers.
const textAt = (parsed: SimlParse, text: string, path: JsonPath) => {
	const span = parsed.spans.find(s => JSON.stringify(s.path) === JSON.stringify(path));
	return span && text.slice(span.range.start.offset, span.range.end.offset);
};

const GEAR = ['siml 1', 'head       helm + agility', 'waist      belt of_the_tiger', ''].join('\n');

const FILES: Record<string, string> = {
	'specs/p1.gear.siml': GEAR,
	'specs/base.apl.siml': ['siml 1', 'spec hunter', '', 'var $weave = true', '', 'priority:', '  cast x if $weave', ''].join('\n'),
	'specs/cd.cooldowns.siml': 'siml 1\n\ncooldowns(id=x)\n',
};
const open = (path: string) => FILES[path];

describe('parse of a gear file', () => {
	const parsed = siml.parse(GEAR, { path: 'specs/p1.gear.siml' });

	it('gives the equipment, its category, and paths into the equipment', () => {
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.categories).toEqual(['g']);
		expect(parsed.equipment?.items).toHaveLength(17);
		expect(parsed.rotation).toBeUndefined();
		expect(textAt(parsed, GEAR, ['items', 0])).toBe('head       helm + agility');
		expect(textAt(parsed, GEAR, ['items', 7, 'randomSuffix'])).toBe('of_the_tiger');
		expect(parsed.equipment?.items).toEqual([
			{ id: 990000, enchant: 990002 },
			...Array(6).fill({}),
			{ id: 990003, randomSuffix: 12727 },
			...Array(9).fill({}),
		]);
		expect(parsed.refs.map(r => [r.name, r.path?.join('.'), r.namespace])).toEqual([
			['helm', 'items.0.id', 'item'],
			['agility', 'items.0.enchant', 'enchant'],
			['belt', 'items.7.id', 'item'],
			['of_the_tiger', 'items.7.randomSuffix', 'suffix'],
		]);
	});
});

describe('parse of a full file', () => {
	const text = [
		'siml 1',
		'spec hunter',
		'talents "-005"',
		'use "p1.gear.siml"',
		'use "base.apl.siml" with $weave = spell(x).is_ready',
		'',
		'consumables: pot mighty_rage_potion',
		'',
	].join('\n');
	const parsed = siml.parse(text, { path: 'specs/x.siml', open });

	it('takes in the used files: their sections, categories and rotation', () => {
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.categories).toEqual(['g', 't', 'r', 'c']);
		expect(parsed.equipment?.items).toHaveLength(17);
		expect(parsed.rotation?.type).toBe('TypeAPL');
		expect(parsed.rotation?.valueVariables).toEqual([{ name: 'weave', value: { spellIsReady: { spellId: { spellId: 5 } } } }]);
	});

	it('gives paths into the settings, a with value at the variable it sets', () => {
		expect(textAt(parsed, text, ['player', 'talentsString'])).toBe('"-005"');
		expect(textAt(parsed, text, ['player', 'consumables', 'potId'])).toBe('mighty_rage_potion');
		expect(textAt(parsed, text, ['player', 'rotation', 'valueVariables', 0, 'value'])).toBe('spell(x).is_ready');
		expect(parsed.refs.map(r => r.name)).toEqual(['x', 'mighty_rage_potion']);
	});

	it('reads the names of a used file with its own spec line', () => {
		const used = siml.parse('siml 1\nspec hunter\nuse "cd.cooldowns.siml"\n', { path: 'specs/x.siml', open });
		expect(used.diagnostics.map(d => [d.code, d.message])).toEqual([
			['unknown-name', 'specs/cd.cooldowns.siml:3:14: no spell is named x; with no spec, a file reads only the spells and auras every class shares'],
		]);
	});

	it('refuses use where the host reads no files', () => {
		const refused = siml.parse(text, { path: 'specs/x.siml' });
		expect(refused.diagnostics.map(d => d.code)).toEqual(['use-refused', 'use-refused']);
		expect(refused.settings).toBeUndefined();
	});

	it('formats it without reading the used files', () => {
		const formatted = siml.format(text, { path: 'specs/x.siml' });
		expect(formatted.diagnostics).toEqual([]);
		expect(formatted.text).toBe(text);
	});
});

describe('the body on a header line', () => {
	const flags = (n: number) =>
		Array.from({ length: n }, (_, i) => ['arcane_brilliance', 'gift_of_the_wild', 'prayer_of_fortitude', 'prayer_of_spirit'][i]).join(', ');

	it('stays there in format when it fits, and moves to a line of its own when it does not', () => {
		const short = `siml 1\nspec hunter\n\nraid_buffs: ${flags(2)} // kept\n`;
		expect(siml.format(short).text).toBe(short);
		const long = `siml 1\nspec hunter\n\nraid_buffs: ${flags(4)}, prayer_of_shadow_protection, fire_resistance_aura // kept\n`;
		expect(siml.format(long).text).toBe(`siml 1\nspec hunter\n\nraid_buffs:\n  ${flags(4)}\n  prayer_of_shadow_protection, fire_resistance_aura // kept\n`);
	});

	it('is not taken up by format from a line of its own', () => {
		const text = `siml 1\nspec hunter\n\nraid_buffs:\n  ${flags(2)}\n`;
		expect(siml.format(text).text).toBe(text);
	});
});

describe('resolveUse', () => {
	it('reads a path against the folder of the using file', () => {
		expect(resolveUse('ui/specs/hunter/dps/defaults.siml', 'gear_sets/p1.gear.siml')).toBe('ui/specs/hunter/dps/gear_sets/p1.gear.siml');
		expect(resolveUse('a/b/builds/x.siml', '../apls/./y.apl.siml')).toBe('a/b/apls/y.apl.siml');
		expect(resolveUse('/abs/dir/x.siml', '../y.siml')).toBe('/abs/y.siml');
		expect(resolveUse('x.siml', '../y.siml')).toBe('../y.siml');
		expect(resolveUse('C:\\specs\\x.siml', 'y.siml')).toBe('C:/specs/y.siml');
		expect(resolveUse('a/x.siml', '/etc/y.siml')).toBe('/etc/y.siml');
	});
});
