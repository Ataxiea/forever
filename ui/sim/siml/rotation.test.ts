import { describe, expect, it } from 'vitest';

import { createSiml, type JsonObject, type JsonPath, type SimlParse } from './index.ts';
import { valueAt } from './json.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const siml = createSiml(testSchema, fixtureNames);
const PATH = 'x.apl.siml';
const TEXT = [
	'siml 1',
	'spec hunter',
	'',
	'var $v = 1s',
	'',
	'prepull:',
	'  -1s cast hunters_mark',
	'',
	'priority:',
	'  cast hunters_mark if target.aura(hunters_mark).is_active and pet1.aura(frenzy).is_active',
	'  cast item.goblin_sapper_charge if boss_spell(x).is_casting or $v > 0s',
	'',
].join('\n');

// The text the span of a JSON path covers.
const textAt = (parsed: SimlParse, text: string, path: JsonPath) => {
	const span = parsed.spans.find(s => JSON.stringify(s.path) === JSON.stringify(path));
	return span && text.slice(span.range.start.offset, span.range.end.offset);
};

describe('parse of a rotation file', () => {
	const parsed = siml.parse(TEXT, { path: PATH });

	it('gives the rotation, and the settings and category it sets', () => {
		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.spec).toBe('hunter');
		expect(parsed.categories).toEqual(['r']);
		expect(parsed.settings).toEqual({ player: { class: 'ClassHunter', hunter: {}, rotation: parsed.rotation } });
		expect(parsed.rotation?.type).toBe('TypeAPL');
	});

	it('gives the text of every row, var line and node by its JSON path', () => {
		expect(textAt(parsed, TEXT, ['valueVariables', 0])).toBe('var $v = 1s');
		expect(textAt(parsed, TEXT, ['valueVariables', 0, 'value'])).toBe('1s');
		expect(textAt(parsed, TEXT, ['prepullActions', 0])).toBe('-1s cast hunters_mark');
		expect(textAt(parsed, TEXT, ['prepullActions', 0, 'doAtValue'])).toBe('-1s');
		expect(textAt(parsed, TEXT, ['priorityList', 0, 'action'])).toBe(
			'cast hunters_mark if target.aura(hunters_mark).is_active and pet1.aura(frenzy).is_active',
		);
		expect(textAt(parsed, TEXT, ['priorityList', 0, 'action', 'condition', 'and', 'vals', 1])).toBe('pet1.aura(frenzy).is_active');
		expect(textAt(parsed, TEXT, ['priorityList', 0, 'action', 'condition', 'and', 'vals', 0, 'auraIsActive', 'sourceUnit'])).toBe('target');
		expect(textAt(parsed, TEXT, ['priorityList', 1, 'action', 'castSpell', 'spellId'])).toBe('item.goblin_sapper_charge');
	});

	it('gives every ref with its path and the namespace it is read in', () => {
		expect(parsed.refs.map(r => [r.name, r.path?.join('.'), r.namespace])).toEqual([
			['hunters_mark', 'prepullActions.0.action.castSpell.spellId', 'spell'],
			['hunters_mark', 'priorityList.0.action.castSpell.spellId', 'spell'],
			['hunters_mark', 'priorityList.0.action.condition.and.vals.0.auraIsActive.auraId', 'target_aura'],
			['frenzy', 'priorityList.0.action.condition.and.vals.1.auraIsActive.auraId', 'pet_aura'],
			['goblin_sapper_charge', 'priorityList.1.action.castSpell.spellId', 'item'],
			['x', 'priorityList.1.action.condition.or.vals.0.bossSpellIsCasting.spellId', 'target_spell'],
		]);
	});

	it('writes what each name means in its namespace: the entry of the spell, the aura, or the item', () => {
		expect(parsed.rotation?.prepullActions).toEqual([
			{ action: { castSpell: { spellId: { spellId: 14325, rank: 4 } } }, doAtValue: { const: { val: '-1s' } } },
		]);
		const [first, second] = parsed.rotation?.priorityList as Array<{ action: JsonObject }>;
		expect(valueAt(first.action, ['condition', 'and', 'vals', 0, 'auraIsActive', 'auraId'])).toEqual({ spellId: 14325 });
		expect(valueAt(second.action, ['castSpell', 'spellId'])).toEqual({ itemId: 10646 });
	});

	it('gives the refs and spans of a file with errors, and no rotation', () => {
		const text = TEXT.replace('cast item.goblin_sapper_charge', 'cast item.goblin_sapper_chrge');
		const broken = siml.parse(text, { path: PATH });
		expect(broken.diagnostics.map(d => [d.code, d.message])).toEqual([
			['unknown-name', 'no item is named goblin_sapper_chrge; did you mean goblin_sapper_charge?'],
		]);
		expect(broken.rotation).toBeUndefined();
		expect(broken.settings).toBeUndefined();
		expect(broken.refs.map(r => r.name)).toContain('goblin_sapper_chrge');
		expect(textAt(broken, text, ['priorityList', 1])).toBe('cast item.goblin_sapper_chrge if boss_spell(x).is_casting or $v > 0s');
	});

	it('gives the refs of a section the file kind does not hold with no path, as they lie outside the rotation', () => {
		const foreign = siml.parse('siml 1\nspec hunter\n\ncooldowns:\n  cooldowns(id=hunters_mark)\n', { path: PATH });
		expect(foreign.diagnostics.map(d => d.code)).toEqual(['section-not-allowed']);
		expect(foreign.refs.map(r => [r.name, r.path, r.namespace])).toEqual([['hunters_mark', undefined, 'spell']]);
	});

	it('reads raw refs with no diagnostic, and gives them as the raw-ref a file under ui/specs reports', () => {
		const text = TEXT.replace('cast item.goblin_sapper_charge', 'cast `{"itemId": 10646}`').replace(
			'-1s cast hunters_mark',
			'-1s cast `{"otherId": "OtherActionPotion"}`',
		);
		const raw = siml.parse(text, { path: PATH });
		expect(raw.diagnostics).toEqual([]);
		expect(raw.rawRefs.map(d => [d.range.start.line, d.range.start.character, d.severity, d.code])).toEqual([[10, 7, 'error', 'raw-ref']]);
		expect(parsed.rawRefs).toEqual([]);
	});
});

describe('format of a rotation file', () => {
	it('gives a file with errors back with its diagnostics and no text', () => {
		const formatted = siml.format('siml 1\nspec hunter\npriority:\n  cast nothing\n', { path: PATH });
		expect(formatted.text).toBeUndefined();
		expect(formatted.diagnostics.map(d => d.code)).toEqual(['unknown-name']);
	});

	it('formats a file with warnings', () => {
		const formatted = siml.format('siml 1\nspec hunter\npriority:\n  group "G"\n', { path: PATH });
		expect(formatted.diagnostics.map(d => d.code)).toEqual(['undefined-group']);
		expect(formatted.text).toBe('siml 1\nspec hunter\n\npriority:\n  group "G"\n');
	});
});
