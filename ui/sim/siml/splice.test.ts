// `splice`: panel edits applied to the text of an x.apl.siml, over the corpus in sim/siml/testdata/splice and over
// each rule on its own.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { type AplEdit, createSiml, type TextEdit } from './index.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const SPLICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../sim/siml/testdata/splice');
const PATH = 'x.apl.siml';

const siml = createSiml(testSchema, fixtureNames);

const applied = (text: string, edits: TextEdit[]) =>
	[...edits]
		.sort((a, b) => b.range.start.offset - a.range.start.offset)
		.reduce((t, e) => t.slice(0, e.range.start.offset) + e.newText + t.slice(e.range.end.offset), text);

function spliced(text: string, edits: AplEdit[], file = PATH) {
	return siml.splice(text, siml.parse(text, { path: file }), edits);
}

// The edits as the lines they replace and the text they write, by line number.
function changes(text: string, edits: AplEdit[]) {
	const result = spliced(text, edits);
	if ('error' in result) throw new Error(result.error);
	return result.edits.map(e => [e.range.start.line, e.range.end.line, e.newText]);
}

function after(text: string, edits: AplEdit[]): string {
	const result = spliced(text, edits);
	if ('error' in result) throw new Error(result.error);
	return applied(text, result.edits);
}

const lines = (...l: string[]) => `${l.join('\n')}\n`;

describe('splice cases', () => {
	const cases = readdirSync(SPLICE)
		.filter(f => f.endsWith('.apl.siml'))
		.sort();

	it('finds the cases', () => {
		expect(cases.length).toBeGreaterThan(5);
	});

	for (const file of cases) {
		it(`applies splice/${file.replace(/\.apl\.siml$/, '.edits.json')}`, () => {
			const text = readFileSync(path.join(SPLICE, file), 'utf8');
			const edits = JSON.parse(readFileSync(path.join(SPLICE, file.replace(/\.apl\.siml$/, '.edits.json')), 'utf8')) as AplEdit[];
			const want = readFileSync(path.join(SPLICE, `${file}.want`), 'utf8');
			expect(after(text, edits)).toBe(want);
			// A file in canonical form stays in it.
			expect(siml.format(text, { path: file }).text).toBe(text);
			expect(siml.format(want, { path: file }).text).toBe(want);
		});
	}
});

const ROWS = lines(
	'siml 1',
	'spec hunter',
	'',
	'priority:',
	'  cast hunters_mark if not target.aura(hunters_mark).is_active',
	'  // Bite whenever it is up.',
	'  /// Mongoose Bite needs a dodge first.',
	'  cast mongoose_bite',
	'  cast multi_shot',
	'',
	'group "Weave":',
	'  move 5 if auto_time_to_next(main_hand_auto) < 1s',
	'  move 11',
);

describe('splice', () => {
	it('moves a row with its notes and the comment above it, and changes no other line', () => {
		const block = '  // Bite whenever it is up.\n  /// Mongoose Bite needs a dodge first.\n  cast mongoose_bite\n';
		expect(changes(ROWS, [{ op: 'move', path: ['priorityList'], from: 1, to: 2 }])).toEqual([
			[5, 8, ''],
			[9, 9, block],
		]);
	});

	it('prints only the row an edit inside a group changes', () => {
		expect(changes(ROWS, [{ op: 'set', path: ['groups', 0, 'actions', 1, 'action', 'move', 'rangeFromTarget', 'const', 'val'], value: '8' }])).toEqual([
			[12, 13, '  move 8\n'],
		]);
	});

	it('writes a row with a new spell by its name, and changes no other line', () => {
		const row = { action: { castSpell: { spellId: { spellId: 3045 } } } };
		expect(changes(ROWS, [{ op: 'insert', path: ['priorityList'], index: 3, value: row }])).toEqual([[9, 9, '  cast rapid_fire\n']]);
	});

	it('names a spell whatever its rank, and writes an id the table does not name as raw JSON', () => {
		const cast = (spellId: object) => ({ action: { castSpell: { spellId } } });
		expect(changes(ROWS, [{ op: 'set', path: ['priorityList', 2], value: cast({ spellId: 2643, rank: 3 }) }])).toEqual([]);
		expect(changes(ROWS, [{ op: 'set', path: ['priorityList', 2], value: cast({ spellId: 2643, tag: 7 }) }])).toEqual([
			[8, 9, '  cast `{"spellId":2643,"tag":7}`\n'],
		]);
	});

	it('reads each edit against the rotation the edits before it leave', () => {
		const edits: AplEdit[] = [
			{ op: 'insert', path: ['groups', 0, 'actions'], index: 0, value: { action: { castSpell: { spellId: { spellId: 2643 } } } } },
			{ op: 'set', path: ['groups', 0, 'actions', 0, 'action', 'condition'], value: { const: { val: 'true' } } },
			{ op: 'move', path: ['groups', 0, 'actions'], from: 0, to: 2 },
		];
		expect(changes(ROWS, edits)).toEqual([[13, 13, '  cast multi_shot if true\n']]);
	});

	it('refuses a path through an index the rotation does not hold, or to a place it does not have', () => {
		const refused = (edit: AplEdit) => {
			const result = spliced(ROWS, [edit]);
			return 'error' in result ? result.error : undefined;
		};
		expect(refused({ op: 'set', path: ['priorityList', 3, 'hide'], value: true })).toBe('priorityList[3] does not exist');
		expect(refused({ op: 'set', path: ['groups', 1, 'name'], value: 'G' })).toBe('groups[1] does not exist');
		expect(refused({ op: 'set', path: ['groups', 0, 'actions', 2] })).toBe('groups[0].actions[2] does not exist');
		expect(refused({ op: 'set', path: ['priorityList', 0, 'action', 'castSpell', 'target', 'type'], value: 'Self' })).toBe(
			'priorityList[0].action.castSpell.target.type does not exist',
		);
		expect(refused({ op: 'set', path: ['priorityList', 0, 'notes'] })).toBe('priorityList[0].notes does not exist');
		expect(refused({ op: 'insert', path: ['priorityList'], index: 4, value: { action: {} } })).toBe('priorityList holds 3, so nothing goes in at 4');
		expect(refused({ op: 'move', path: ['groups', 0, 'actions'], from: 2, to: 0 })).toBe('groups[0].actions[2] does not exist');
		expect(refused({ op: 'move', path: ['priorityList', 0, 'action'], from: 0, to: 1 })).toBe('priorityList[0].action is no list');
		expect(refused({ op: 'set', path: ['type'], value: 'TypeAuto' })).toBe('type is not in a row, var line or group, which are what the panel edits');
	});

	it('refuses a file of another kind, a text with errors, and a rotation put together from other files', () => {
		const refused = (text: string, file: string) => {
			const result = siml.splice(text, siml.parse(text, { path: file, open: () => lines('siml 1', 'spec hunter') }), []);
			return 'error' in result ? result.error : undefined;
		};
		expect(refused(ROWS, 'x.siml')).toBe('the panel edits the rotation of an x.apl.siml file');
		expect(refused(ROWS.replace('cast multi_shot', 'cast multi'), PATH)).toBe('the text has errors; fix them to edit the rotation');
		expect(refused(lines('siml 1', 'spec hunter', 'use "y.apl.siml"'), PATH)).toBe('the rotation is put together with y.apl.siml; edit it as text');
	});

	it('refuses an edit that leaves the rotation with an error', () => {
		const text = lines('siml 1', 'spec hunter', '', 'var $a = 1', 'var $b = $a');
		const result = spliced(text, [{ op: 'set', path: ['valueVariables', 0, 'value'], value: { variableRef: { name: 'b' } } }]);
		expect(result).toEqual({ error: 'the edited rotation has an error: a refers to itself through other variables' });
	});

	it('prints again a statement whose meaning an edit changes', () => {
		const text = lines('siml 1', 'spec hunter', '', 'var ${Use Multi-Shot} = true', '', 'priority:', '  cast multi_shot if $use_multi_shot');
		expect(changes(text, [{ op: 'set', path: ['valueVariables', 0] }])).toEqual([
			[3, 5, ''],
			[6, 7, '  cast multi_shot if ${Use Multi-Shot}\n'],
		]);
	});

	it('moves a group with the changes made inside it', () => {
		const text = lines('siml 1', 'spec hunter', '', 'group "A":', '  // Shoot.', '  cast multi_shot', '', 'group "B":', '  none');
		const edits: AplEdit[] = [
			{ op: 'set', path: ['groups', 0, 'name'], value: 'C' },
			{ op: 'set', path: ['groups', 0, 'actions', 0, 'hide'], value: true },
			{ op: 'move', path: ['groups'], from: 0, to: 1 },
		];
		expect(after(text, edits)).toBe(lines('siml 1', 'spec hunter', '', 'group "B":', '  none', '', 'group "C":', '  // Shoot.', '  # cast multi_shot'));
	});

	it('puts a row written on its header line on a line of its own when its list changes', () => {
		const text = lines('siml 1', 'spec hunter', '', 'priority: cast multi_shot // first', '  none');
		expect(after(text, [{ op: 'move', path: ['priorityList'], from: 1, to: 0 }])).toBe(
			lines('siml 1', 'spec hunter', '', 'priority:', '  none', '  cast multi_shot // first'),
		);
		expect(changes(text, [{ op: 'set', path: ['priorityList', 1, 'hide'], value: true }])).toEqual([[4, 5, '  # none\n']]);
	});

	it('writes new lines with the line breaks of the text, and adds none at its end', () => {
		const crlf = ROWS.replace(/\n/g, '\r\n');
		expect(after(crlf, [{ op: 'move', path: ['priorityList'], from: 1, to: 2 }])).toBe(
			after(ROWS, [{ op: 'move', path: ['priorityList'], from: 1, to: 2 }]).replace(/\n/g, '\r\n'),
		);
		const open = lines('siml 1', 'spec hunter', '', 'priority:', '  none').trimEnd();
		expect(after(open, [{ op: 'insert', path: ['priorityList'], index: 1, value: { action: {} } }])).toBe(`${open}\n  none`);
	});
});
