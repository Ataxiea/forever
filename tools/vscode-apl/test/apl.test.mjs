import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { movedOnlyBy, panelFindings, readApl, readOnlyReason, rowLine, spliceApl } from '../src/apl.ts';
import { pathAt, spanFor } from '../src/lang/document.ts';
import { registeredFor } from '../src/registered.ts';
import { placementAt } from '../src/snippets/patterns.ts';
import { applyEdit, shiftKeys } from '../src/webview/apply.ts';

// The rotation as the panel, the sims and Insert Pattern read an .apl.siml, without VS Code.

const fixture = name => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const DEFAULT = fixture('default.apl.siml');
const text = readFileSync(DEFAULT, 'utf8');

// The text with the edits made, as VS Code makes a WorkspaceEdit.
function applied(source, edits) {
	const lines = source.split('\n');
	const offset = p => lines.slice(0, p.line).reduce((n, line) => n + line.length + 1, 0) + p.character;
	return [...edits]
		.sort((a, b) => offset(b.range.start) - offset(a.range.start))
		.reduce((out, e) => out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end)), source);
}

describe('reading', () => {
	test('an .apl.siml reads as its rotation, and its text leads to its rows and back', () => {
		const p = readApl(DEFAULT, text);
		assert.equal(readOnlyReason(p), undefined);
		assert.equal(p.parse.rotation.priorityList.length, 13);
		const serpent = text.indexOf('cast serpent_sting');
		assert.deepEqual(pathAt(p, serpent + 2).slice(0, 2), ['priorityList', 5]);
		assert.equal(rowLine(p, 'priorityList/5'), text.slice(0, serpent).split('\n').length - 1);
		assert.equal(spanFor(p, ['priorityList', 5, 'action', 'castSpell', 'spellId']).start.offset, serpent + 'cast '.length);
		assert.equal(rowLine(p, 'priorityList/99'), undefined);
	});

	test('a file outside a repository says why it cannot be read', () => {
		assert.match(readApl('/nowhere/x.apl.siml', text).error, /not in a WoWSims repository/);
	});

	test('text with an error is read-only, and says where the first error is', () => {
		const p = readApl(DEFAULT, text.replace('cast mongoose_bite', 'cast mongoose_bit'));
		assert.equal(p.parse.rotation, undefined);
		assert.equal(
			readOnlyReason(p),
			'The text has errors (line 27: no spell is named mongoose_bit; did you mean mongoose_bite?). Edits wait until it reads again.',
		);
		assert.match(spliceApl(p, [{ op: 'set', path: ['priorityList', 0, 'hide'], value: true }]).error, /the text has errors/);
	});

	test('a rotation put together with another file reads with its rows, and is read-only', () => {
		const hawks = fixture('hawks.apl.siml');
		const p = readApl(hawks, readFileSync(hawks, 'utf8'));
		assert.equal(p.parse.rotation.priorityList.length, 13);
		assert.equal(readOnlyReason(p), 'The rotation is put together with default.apl.siml; edit it as text.');
		assert.match(spliceApl(p, [{ op: 'set', path: ['priorityList', 0, 'hide'], value: true }]).error, /put together with default\.apl\.siml/);
	});

	test("the panel's findings are the file's diagnostics, at the paths of the rows they are about", () => {
		const source = 'siml 1\nspec hunter\n\npriority:\n  cast hunters_mark\n  move none\n  cast hunters_mark\n';
		const findings = panelFindings(readApl(DEFAULT, source));
		assert.deepEqual(
			findings.map(f => [f.code, f.severity, f.path.slice(0, 2).join('/')]),
			[
				['empty-value', 'error', 'priorityList/1'],
				['shadowed-row', 'warning', 'priorityList/2'],
			],
		);
	});
});

describe('editing', () => {
	const p = readApl(DEFAULT, text);

	test('a moved row is one line in and one line out', () => {
		const { edits } = spliceApl(p, [{ op: 'move', path: ['priorityList'], from: 4, to: 1 }]);
		assert.deepEqual(
			edits.map(e => e.newText),
			['  cast strider_kick\n', ''],
		);
		const moved = applied(text, edits);
		assert.deepEqual(readApl(DEFAULT, moved).parse.rotation.priorityList[1], p.parse.rotation.priorityList[4]);
	});

	test('a path through an index or into a list that does not exist is refused', () => {
		assert.equal(spliceApl(p, [{ op: 'set', path: ['priorityList', 13, 'hide'], value: true }]).error, 'priorityList[13] does not exist');
		assert.match(spliceApl(p, [{ op: 'set', path: ['groups', 0, 'actions', -1, 'action', 'condition'], value: {} }]).error, /does not exist/);
		assert.match(spliceApl(p, [{ op: 'move', path: ['priorityList'], from: 20, to: 0 }]).error, /does not exist/);
	});

	test('what the pickers offer writes ActionIDs the text names: tags, ranks, auras on a target and items', () => {
		const registered = registeredFor(p);
		assert.equal(registered.status, 'ready');
		const { spells, targetAuras, items } = registered.registered;
		const innervate = spells.find(n => n.name === 'innervate');
		assert.deepEqual(innervate.id, { spellId: 29166, tag: -1 });
		const mark = targetAuras.find(n => n.name === 'hunters_mark');
		const potion = items.find(n => n.name === 'item.major_mana_potion') ?? items[0];
		const rows = [
			{ action: { castSpell: { spellId: innervate.id } } },
			{ action: { condition: { auraIsActive: { sourceUnit: { type: 'CurrentTarget' }, auraId: mark.id } }, castSpell: { spellId: potion.id } } },
		];
		const { edits } = spliceApl(
			p,
			rows.map((value, i) => ({ op: 'insert', path: ['priorityList'], index: 13 + i, value })),
		);
		const written = edits.map(e => e.newText).join('');
		assert.equal(written, `  cast innervate\n  cast ${potion.name} if target.aura(hunters_mark).is_active\n`);
		assert.doesNotMatch(written, /`/, 'no raw JSON');
	});

	test("an edit made against a version only the panel's own edits moved past is made", () => {
		assert.equal(movedOnlyBy(new Set(), 4, 4), true);
		assert.equal(movedOnlyBy(new Set([5, 6]), 4, 6), true);
		assert.equal(movedOnlyBy(new Set([6]), 4, 6), false, 'version 5 was someone else');
		assert.equal(movedOnlyBy(new Set(), 5, 4), false);
	});
});

describe("the panel's own copy of the rotation", () => {
	const rotation = { priorityList: [{ action: { a: {} } }, { action: { b: {} } }, { action: { c: {} } }], groups: [{ name: 'G', actions: [] }] };

	test('edits are made on it as the text makes them', () => {
		assert.deepEqual(
			applyEdit(rotation, { op: 'move', path: ['priorityList'], from: 2, to: 0 }).priorityList.map(r => Object.keys(r.action)[0]),
			['c', 'a', 'b'],
		);
		assert.deepEqual(applyEdit(rotation, { op: 'set', path: ['priorityList', 1] }).priorityList.length, 2);
		assert.equal(applyEdit(rotation, { op: 'set', path: ['priorityList', 0, 'hide'], value: true }).priorityList[0].hide, true);
		assert.deepEqual(applyEdit(rotation, { op: 'insert', path: ['groups', 0, 'actions'], index: 0, value: { action: {} } }).groups[0].actions, [
			{ action: {} },
		]);
		assert.deepEqual(
			applyEdit(rotation, { op: 'insert', path: ['prepullActions'], index: 0, value: 1 }).prepullActions,
			[1],
			'a list the rotation leaves out',
		);
		assert.deepEqual(applyEdit(rotation, { op: 'set', path: ['priorityList', 9, 'hide'], value: true }), rotation, 'an index that does not exist');
		assert.equal(applyEdit(rotation, { op: 'set', path: ['missing'] }), rotation, 'removing what is not there changes nothing');
		assert.equal(rotation.priorityList.length, 3, 'the rotation it was given stays as it was');
	});

	test('open rows follow the rows an edit inserts, moves or removes', () => {
		const open = new Set(['priorityList/0', 'priorityList/2', 'groups/0/actions/1', 'groups/1/actions/0']);
		const keys = (edit, from = open) => [...shiftKeys(from, edit)].sort();
		assert.deepEqual(keys({ op: 'set', path: ['priorityList', 1] }), ['groups/0/actions/1', 'groups/1/actions/0', 'priorityList/0', 'priorityList/1']);
		assert.deepEqual(keys({ op: 'set', path: ['priorityList', 2] }), ['groups/0/actions/1', 'groups/1/actions/0', 'priorityList/0']);
		assert.deepEqual(keys({ op: 'insert', path: ['priorityList'], index: 1, value: {} }), [
			'groups/0/actions/1',
			'groups/1/actions/0',
			'priorityList/0',
			'priorityList/3',
		]);
		assert.deepEqual(keys({ op: 'move', path: ['priorityList'], from: 0, to: 2 }), [
			'groups/0/actions/1',
			'groups/1/actions/0',
			'priorityList/1',
			'priorityList/2',
		]);
		assert.deepEqual(keys({ op: 'set', path: ['groups', 0] }), ['groups/0/actions/0', 'priorityList/0', 'priorityList/2'], "a group's rows go with it");
		assert.deepEqual(keys({ op: 'set', path: ['priorityList', 0, 'hide'], value: true }), [...open].sort());
	});
});

test('a pattern goes after the row the cursor is in, and a condition only onto a priority or group row', () => {
	assert.deepEqual(placementAt(['priorityList', 3, 'action', 'castSpell'], 'row'), { list: ['priorityList'], index: 4 });
	assert.deepEqual(placementAt(['groups', 1, 'actions', 0], 'row'), { list: ['groups', 1, 'actions'], index: 1 });
	assert.deepEqual(placementAt(['groups', 0, 'actions', -1], 'row'), { list: ['groups', 0, 'actions'], index: 0 }, 'the start of an empty group');
	assert.deepEqual(placementAt(['priorityList', 3], 'condition'), { condition: ['priorityList', 3, 'action'] });
	assert.deepEqual(placementAt(['groups', 0, 'actions', -1], 'condition'), {}, 'an empty group has no row');
	assert.deepEqual(placementAt(['prepullActions', 0], 'condition'), {}, "the sim does not read a prepull row's condition");
	assert.deepEqual(placementAt([], 'row'), {});
});
