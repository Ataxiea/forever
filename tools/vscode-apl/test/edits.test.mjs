import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { applyAplEdits, compactJson, minimalReplace, pathAt, rangeOf } from '../src/edits.ts';

const repository = new URL('../../../', import.meta.url).pathname;

function aplFiles() {
	const specs = join(repository, 'ui', 'specs');
	return readdirSync(specs, { recursive: true })
		.filter(file => String(file).endsWith('.apl.json'))
		.map(file => join(specs, String(file)));
}

const expanded = `{
	"priorityList": [
		{
			"action": { "castSpell": { "spellId": { "spellId": 1 } } }
		},
		{ "action": { "castSpell": { "spellId": { "spellId": 2 } } } },
		{ "action": { "castSpell": { "spellId": { "spellId": 3 } } } }
	]
}
`;

test('values are written on one line, spaced the way the formatter keeps them', () => {
	assert.equal(compactJson({ action: { castSpell: { spellId: { spellId: 1 } } } }), '{ "action": { "castSpell": { "spellId": { "spellId": 1 } } } }');
	assert.equal(compactJson({ vals: [{ const: { val: '1s' } }, {}], empty: [] }), '{ "vals": [{ "const": { "val": "1s" } }, {}], "empty": [] }');
	assert.equal(compactJson({ kept: 1, dropped: undefined }), '{ "kept": 1 }');
});

test('setting a value that exists replaces only that value', () => {
	const after = applyAplEdits(expanded, [{ op: 'set', path: ['priorityList', 1, 'action', 'castSpell', 'spellId'], value: { itemId: 9 } }]);
	assert.equal(after, expanded.replace('{ "spellId": 2 }', '{ "itemId": 9 }'));
});

test('a new property follows its siblings, on their line or on its own line', () => {
	const compact = applyAplEdits(expanded, [{ op: 'set', path: ['priorityList', 1, 'hide'], value: true }]);
	assert.ok(compact.includes('{ "action": { "castSpell": { "spellId": { "spellId": 2 } } }, "hide": true },'));

	const multiline = applyAplEdits(expanded, [{ op: 'set', path: ['priorityList', 0, 'hide'], value: true }]);
	assert.ok(multiline.includes('"action": { "castSpell": { "spellId": { "spellId": 1 } } },\n\t\t\t"hide": true\n\t\t},'));
});

test('a property under objects that do not exist yet brings them along', () => {
	const after = applyAplEdits(expanded, [{ op: 'set', path: ['priorityList', 2, 'action', 'condition', 'const', 'val'], value: '1' }]);
	assert.ok(after.includes('{ "action": { "castSpell": { "spellId": { "spellId": 3 } }, "condition": { "const": { "val": "1" } } } }'));
});

test('removing a member takes its comma with it, wherever it sits', () => {
	const list = '{ "a": [1, 2, 3] }';
	assert.equal(applyAplEdits(list, [{ op: 'set', path: ['a', 0], value: undefined }]), '{ "a": [2, 3] }');
	assert.equal(applyAplEdits(list, [{ op: 'set', path: ['a', 1], value: undefined }]), '{ "a": [1, 3] }');
	assert.equal(applyAplEdits(list, [{ op: 'set', path: ['a', 2], value: undefined }]), '{ "a": [1, 2] }');
	assert.equal(applyAplEdits('{ "a": [1] }', [{ op: 'set', path: ['a', 0], value: undefined }]), '{ "a": [] }');
	assert.equal(applyAplEdits('{ "a": 1, "b": 2 }', [{ op: 'set', path: ['b'], value: undefined }]), '{ "a": 1 }');
	assert.equal(applyAplEdits('{ "a": 1 }', [{ op: 'set', path: ['missing'], value: undefined }]), '{ "a": 1 }');
});

test('an inserted element takes the layout of the list it joins', () => {
	const row = { action: { waitUntil: {} } };
	const atEnd = applyAplEdits(expanded, [{ op: 'insert', path: ['priorityList'], index: 3, value: row }]);
	assert.ok(atEnd.includes('"spellId": 3 } } } },\n\t\t{ "action": { "waitUntil": {} } }\n\t]'));
	const atStart = applyAplEdits(expanded, [{ op: 'insert', path: ['priorityList'], index: 0, value: row }]);
	assert.ok(atStart.includes('[\n\t\t{ "action": { "waitUntil": {} } },\n\t\t{\n\t\t\t"action"'));
	assert.equal(applyAplEdits('{ "a": [1, 2] }', [{ op: 'insert', path: ['a'], index: 1, value: 9 }]), '{ "a": [1, 9, 2] }');
	assert.equal(applyAplEdits('{ "a": [] }', [{ op: 'insert', path: ['a'], index: 0, value: 9 }]), '{ "a": [9] }');
	assert.equal(applyAplEdits('{ "b": 1 }', [{ op: 'insert', path: ['a'], index: 0, value: 9 }]), '{ "b": 1, "a": [9] }');
});

test('a moved element keeps its own text', () => {
	const after = applyAplEdits(expanded, [{ op: 'move', path: ['priorityList'], from: 0, to: 2 }]);
	assert.deepEqual(
		JSON.parse(after).priorityList.map(item => item.action.castSpell.spellId.spellId),
		[2, 3, 1],
	);
	assert.ok(after.includes('{\n\t\t\t"action": { "castSpell": { "spellId": { "spellId": 1 } } }\n\t\t}\n\t]'));
	assert.equal(
		applyAplEdits(expanded, [
			{ op: 'move', path: ['priorityList'], from: 2, to: 0 },
			{ op: 'move', path: ['priorityList'], from: 0, to: 2 },
		]),
		expanded,
	);
});

test('in every APL file, each edit undone by its inverse gives back the same text', () => {
	for (const file of aplFiles()) {
		const text = readFileSync(file, 'utf8');
		const apl = JSON.parse(text);
		for (const list of ['prepullActions', 'priorityList']) {
			const items = apl[list] ?? [];
			for (let i = 0; i < items.length; i++) {
				const path = [list, i, 'hide'];
				const hidden = applyAplEdits(text, [{ op: 'set', path, value: !items[i].hide || undefined }]);
				assert.equal(JSON.parse(hidden)[list][i].hide, items[i].hide ? undefined : true, `${file} ${list}[${i}] hide`);
				if (!items[i].hide) {
					assert.equal(applyAplEdits(hidden, [{ op: 'set', path, value: undefined }]), text, `${file} ${list}[${i}] hide round trip`);
				}
				const condition = items[i].action?.condition;
				if (condition !== undefined) {
					const cpath = [list, i, 'action', 'condition'];
					const without = applyAplEdits(text, [{ op: 'set', path: cpath, value: undefined }]);
					assert.equal(JSON.parse(without)[list][i].action.condition, undefined, `${file} ${list}[${i}] condition removed`);
					assert.deepEqual(
						JSON.parse(applyAplEdits(without, [{ op: 'set', path: cpath, value: condition }])),
						apl,
						`${file} ${list}[${i}] condition restored`,
					);
				}
			}
			let cycled = text;
			for (let i = 0; i < items.length; i++) {
				cycled = applyAplEdits(cycled, [{ op: 'move', path: [list], from: 0, to: items.length - 1 }]);
			}
			assert.equal(cycled, text, `${file} ${list} full move cycle`);
		}
	}
});

test('the replacement covers only what changed', () => {
	assert.equal(minimalReplace('abc', 'abc'), undefined);
	assert.deepEqual(minimalReplace('a 1 b', 'a 22 b'), { start: 2, end: 3, text: '22' });
	assert.deepEqual(minimalReplace('aa', 'aaa'), { start: 2, end: 2, text: 'a' });
	assert.deepEqual(minimalReplace('aaa', 'aa'), { start: 2, end: 3, text: '' });
});

test('paths and ranges address the same nodes', () => {
	const range = rangeOf(expanded, ['priorityList', 1]);
	assert.ok(range);
	assert.equal(JSON.parse(expanded.slice(range.start, range.end)).action.castSpell.spellId.spellId, 2);
	const offset = expanded.indexOf('"spellId": 3');
	assert.deepEqual(pathAt(expanded, offset + 1).slice(0, 2), ['priorityList', 2]);
});
