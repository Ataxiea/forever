import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isDeepStrictEqual } from 'node:util';

import { createSiml } from '../src/lang/siml.ts';
import { lintApl } from '../src/lint/index.ts';
import { APL_PATTERNS, patternEdits, withDefaults } from '../src/snippets/patterns.ts';

const repository = new URL('../../../', import.meta.url);
const json = path => JSON.parse(readFileSync(new URL(path, repository), 'utf8'));
const siml = createSiml(json('ui/generated/siml/schema.json'), json('sim/siml/names.json'));

// The JSON as protojson compares it: an empty list is the default and left out, and an ActionID's rank is the
// name's own once it prints by one (sim/siml/SPEC.md §12.4), so ranks are not compared.
const normalized = value =>
	Array.isArray(value)
		? value.map(normalized)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.entries(value)
						.filter(([key, v]) => key !== 'rank' && !(Array.isArray(v) && v.length === 0))
						.map(([key, v]) => [key, normalized(v)]),
				)
			: value;

const PATH = 'pattern.apl.siml';
const printed = apl => siml.print({ kind: { section: 'apl' }, spec: 'hunter', settings: { player: { rotation: apl } } });

// A valid APLRotation prints as SIML that reads back to it: a field, kind or enum value the protos do not have, or a
// value of two kinds, does not.
function validate(apl) {
	const text = printed(apl);
	const parsed = siml.parse(text, { path: PATH });
	validate.errors = parsed.diagnostics.length ? parsed.diagnostics : text;
	return parsed.diagnostics.length === 0 && isDeepStrictEqual(normalized(parsed.rotation), normalized(apl));
}

// What a reader would fill in: spell and aura ids, a group or variable name, the defaults for the rest.
function sampleValues(pattern) {
	const values = {};
	for (const [i, placeholder] of pattern.placeholders.entries()) {
		if (placeholder.default !== undefined) continue;
		if (placeholder.kind === 'spell' || placeholder.kind === 'aura' || placeholder.kind === 'target_aura') values[placeholder.name] = 1000 + i;
		else if (placeholder.kind === 'group') values[placeholder.name] = 'Base ON/OFF';
		else if (placeholder.kind === 'variable') values[placeholder.name] = 'Use it';
	}
	return values;
}

const base = () => ({
	type: 'TypeAPL',
	prepullActions: [
		{ action: { castSpell: { spellId: { spellId: 1 } } }, doAtValue: { const: { val: '-5s' } } },
		{ action: { castSpell: { spellId: { spellId: 2 } } }, doAtValue: { const: { val: '-1s' } } },
	],
	priorityList: [
		{ action: { castSpell: { spellId: { spellId: 3 } } } },
		{ action: { condition: { gcdIsReady: {} }, castSpell: { spellId: { spellId: 4 } } } },
		{ action: { groupReference: { groupName: 'Rows' } } },
		{ action: { groupReference: { groupName: 'Base ON/OFF' } } },
	],
	groups: [
		{ name: 'Rows', actions: [{ action: { castSpell: { spellId: { spellId: 5 } } } }] },
		{ name: 'Base ON/OFF', actions: [{ action: {} }] },
	],
});

// The rotation after the pattern goes in the way Insert Pattern puts it: its edits made on the rotation's text with the
// SIML module's splice, and the text read back.
function inserted(apl, pattern, values, placement) {
	const text = printed(apl);
	const parsed = siml.parse(text, { path: PATH });
	const result = siml.splice(text, parsed, patternEdits(parsed.rotation, pattern, values, placement));
	assert.equal(result.error, undefined, pattern.id);
	const after = [...result.edits]
		.sort((a, b) => b.range.start.offset - a.range.start.offset)
		.reduce((out, e) => out.slice(0, e.range.start.offset) + e.newText + out.slice(e.range.end.offset), text);
	const read = siml.parse(after, { path: PATH });
	assert.deepEqual(read.diagnostics, [], pattern.id);
	return read.rotation;
}

test('every pattern has a unique id, its placeholders named once and choices with options', () => {
	assert.equal(new Set(APL_PATTERNS.map(pattern => pattern.id)).size, APL_PATTERNS.length);
	for (const pattern of APL_PATTERNS) {
		assert.equal(new Set(pattern.placeholders.map(placeholder => placeholder.name)).size, pattern.placeholders.length, pattern.id);
		for (const placeholder of pattern.placeholders) {
			if (placeholder.kind === 'choice') assert.ok(placeholder.options?.includes(placeholder.default), `${pattern.id}.${placeholder.name}`);
		}
	}
});

test('every pattern inserted into a rotation is a valid APLRotation the lints pass', () => {
	for (const pattern of APL_PATTERNS) {
		const values = withDefaults(pattern, sampleValues(pattern));
		assert.deepEqual(
			pattern.placeholders.filter(placeholder => !placeholder.optional && values[placeholder.name] === undefined),
			[],
			pattern.id,
		);
		const placements =
			pattern.target === 'condition'
				? [{ condition: ['priorityList', 0, 'action'] }, { condition: ['priorityList', 1, 'action'] }]
				: [{ index: 1 }, { list: ['groups', 0, 'actions'] }];
		for (const placement of placements) {
			const apl = inserted(base(), pattern, values, placement);
			assert.ok(validate(apl), `${pattern.id}: ${JSON.stringify(validate.errors)}`);
			// The sample spells are not registered, and the base's rows do nothing in particular; nothing else may show.
			const serious = lintApl(apl).filter(finding => finding.severity !== 'info');
			assert.deepEqual(serious, [], pattern.id);
		}
	}
});

test('a pattern also builds into a rotation that has none of the lists', () => {
	for (const pattern of APL_PATTERNS) {
		const apl = inserted({ type: 'TypeAPL' }, pattern, sampleValues(pattern), pattern.target === 'condition' ? {} : { index: 0 });
		assert.ok(validate(apl), `${pattern.id}: ${JSON.stringify(validate.errors)}`);
	}
});

test('prepull rows go where their time keeps the list in time order', () => {
	const sequence = APL_PATTERNS.find(pattern => pattern.id === 'prepull-sequence');
	const apl = inserted(base(), sequence, { first: 10, second: 11, third: 12, start: '-3s', gap: '1.5s' });
	assert.deepEqual(
		apl.prepullActions.map(row => [row.action.castSpell.spellId.spellId, row.doAtValue.const.val]),
		[
			[1, '-5s'],
			[10, '-3s'],
			[11, '-1.5s'],
			[2, '-1s'],
			[12, '0s'],
		],
	);
	assert.deepEqual(
		lintApl(apl).filter(finding => finding.code.startsWith('prepull')),
		[],
	);
});

test('a condition joins the existing one with "and"', () => {
	const outside = APL_PATTERNS.find(pattern => pattern.id === 'outside-execute');
	const execute = { not: { val: { isExecutePhase: { threshold: 'E20' } } } };
	assert.deepEqual(inserted(base(), outside, {}, { condition: ['priorityList', 0, 'action'] }).priorityList[0].action.condition, execute);
	assert.deepEqual(inserted(base(), outside, {}, { condition: ['priorityList', 1, 'action'] }).priorityList[1].action.condition, {
		and: { vals: [{ gcdIsReady: {} }, execute] },
	});
	const joined = base();
	joined.priorityList[1].action.condition = { and: { vals: [{ gcdIsReady: {} }] } };
	assert.deepEqual(inserted(joined, outside, {}, { condition: ['priorityList', 1, 'action'] }).priorityList[1].action.condition, {
		and: { vals: [{ gcdIsReady: {} }, execute] },
	});
});

test('patterns build the shapes the repository APLs use', () => {
	const build = (id, values) => {
		const pattern = APL_PATTERNS.find(pattern => pattern.id === id);
		return pattern.build(withDefaults(pattern, values));
	};
	// The arms Rend row and the prot debuff refresh.
	assert.deepEqual(build('refresh-dot', { spell: 11574 }).rows[0].action.condition, {
		cmp: { op: 'OpLe', lhs: { dotRemainingTime: { spellId: { spellId: 11574 } } }, rhs: { const: { val: '1.5s' } } },
	});
	assert.deepEqual(build('keep-debuff', { spell: { spellId: 11581, rank: 6 }, remaining: '6s' }).rows[0], {
		action: {
			condition: {
				cmp: {
					op: 'OpLe',
					lhs: { auraRemainingTime: { sourceUnit: { type: 'CurrentTarget' }, auraId: { spellId: 11581, rank: 6 } } },
					rhs: { const: { val: '6s' } },
				},
			},
			castSpell: { spellId: { spellId: 11581, rank: 6 } },
		},
	});
	// The retribution Exorcism mana floor and the warrior toggles.
	assert.deepEqual(build('resource-above', {}).condition, { cmp: { op: 'OpGe', lhs: { currentManaPercent: {} }, rhs: { const: { val: '10%' } } } });
	assert.deepEqual(build('resource-above', { resource: 'currentRage', amount: 40 }).condition.cmp.rhs, { const: { val: '40' } });
	assert.deepEqual(build('toggle-group', { group: 'Stance Dance ON/OFF' }), {
		groups: [{ name: 'Stance Dance ON/OFF', actions: [{ action: {} }] }],
		rows: [{ action: { groupReference: { groupName: 'Stance Dance ON/OFF' } } }],
	});
	assert.deepEqual(build('toggle-is-on', { group: 'Stance Dance ON/OFF' }).condition, { actionGroupUsed: { name: 'Stance Dance ON/OFF' } });
	assert.deepEqual(build('prepull-cast', { spell: 2687, at: -3 }).prepullRows, [
		{ action: { castSpell: { spellId: { spellId: 2687 } } }, doAtValue: { const: { val: '-3s' } } },
	]);
});
