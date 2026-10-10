import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { readDisk } from '../src/lang/document.ts';
import { createSiml } from '../src/lang/siml.ts';
import { lintApl } from '../src/lint/index.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const json = path => JSON.parse(readFileSync(join(repository, path), 'utf8'));
const siml = createSiml(json('ui/generated/siml/schema.json'), json('sim/siml/names.json'));

const cast = spellId => ({ castSpell: { spellId: { spellId } } });
const constant = val => ({ const: { val } });
const codes = findings => findings.map(finding => finding.code);
const find = (findings, code) => findings.filter(finding => finding.code === code);

test("the repository's rotations carry no error or warning", () => {
	const specs = join(repository, 'ui', 'specs');
	const files = readdirSync(specs, { recursive: true }).filter(file => /(^|[\\/])apls[\\/][^\\/]+\.apl\.siml$/.test(file));
	assert.ok(files.length > 0);
	for (const file of files) {
		const path = join(specs, file);
		const { rotation, diagnostics } = siml.parse(readFileSync(path, 'utf8'), { path, open: readDisk });
		assert.deepEqual(
			diagnostics.filter(d => d.severity === 'error'),
			[],
			file,
		);
		const serious = lintApl(rotation).filter(finding => finding.severity !== 'info');
		assert.deepEqual(serious, [], file);
	}
});

test('an empty action is an error, except in a toggle group', () => {
	const findings = lintApl({
		priorityList: [{ action: {} }, { action: { groupReference: { groupName: 'Stance ON/OFF' } } }, { action: { condition: constant('true') } }],
		groups: [{ name: 'Stance ON/OFF', actions: [{ action: {} }] }],
	});
	assert.deepEqual(
		find(findings, 'empty-action').map(finding => finding.path),
		[
			['priorityList', 0, 'action'],
			['priorityList', 2, 'action'],
		],
	);
	assert.ok(find(findings, 'empty-action').every(finding => finding.severity === 'error'));
});

test('an empty value: as the sim reads it in each field', () => {
	const findings = lintApl({
		priorityList: [
			{ action: { condition: {}, ...cast(1) } },
			{ action: { condition: { or: { vals: [{ gcdIsReady: {} }, {}] } }, ...cast(2) } },
			{ action: { multidot: { spellId: { spellId: 3 }, maxOverlap: {} } } },
			{ action: { channelSpell: { spellId: { spellId: 4 }, interruptIf: {} } } },
			{ action: { move: { rangeFromTarget: {} } } },
			{ action: { moveDuration: {} } },
			{ action: { groupReference: { groupName: 'G', variables: [{ name: 'p', value: {} }] } } },
			{ action: { wait: { duration: {} } } },
		],
		groups: [{ name: 'G', actions: [{ action: { condition: { variablePlaceholder: { name: 'p' } }, ...cast(5) } }] }],
	});
	assert.deepEqual(
		find(findings, 'empty-value').map(finding => [finding.path.join('/'), finding.severity, finding.message]),
		[
			['priorityList/0/action/condition', 'warning', 'No value set; the sim reads it as no condition, so the row always runs.'],
			['priorityList/1/action/condition/or/vals/1', 'info', 'No value set; the sim leaves it out of the list.'],
			['priorityList/2/action/multidot/maxOverlap', 'info', 'No value set; the sim reads as 0s.'],
			['priorityList/3/action/channelSpell/interruptIf', 'info', 'No value set; the sim casts the channel with no interrupt condition.'],
			['priorityList/4/action/move/rangeFromTarget', 'error', 'No value set; the sim fails to run.'],
			['priorityList/6/action/groupReference/variables/0/value', 'error', 'No value set; the sim fails to run.'],
			['priorityList/7/action/wait/duration', 'warning', 'No value set; the sim drops it and what holds it.'],
			['priorityList/5/action/moveDuration', 'error', 'No duration set; the sim fails to run.'],
		],
	);
});

test('group references, toggles and unused groups', () => {
	const findings = lintApl({
		priorityList: [
			{ action: { groupReference: { groupName: 'Missing' } } },
			{ hide: true, action: { groupReference: { groupName: 'Off ON/OFF' } } },
			{ action: { condition: { actionGroupUsed: { name: 'Off ON/OFF' } }, ...cast(1) } },
			{ action: { condition: { actionGroupUsed: { name: 'Unreferenced' } }, ...cast(2) } },
			{ action: { condition: { actionGroupUsed: { name: 'Nowhere' } }, ...cast(3) } },
		],
		groups: [
			{ name: 'Off ON/OFF', actions: [{ action: {} }] },
			{ name: 'Unreferenced', actions: [{ action: cast(4) }] },
			{ name: 'Lonely', actions: [{ action: cast(5) }] },
		],
	});
	assert.deepEqual(find(findings, 'undefined-group')[0].path, ['priorityList', 0, 'action', 'groupReference', 'groupName']);
	// A hidden reference is a toggle switched off, not a missing one.
	assert.deepEqual(
		find(findings, 'group-never-used').map(finding => finding.path[1]),
		[3, 4],
	);
	assert.deepEqual(
		find(findings, 'unused-group').map(finding => finding.path),
		[['groups', 2, 'name']],
	);
});

test('sequences are found among the live priority list and group rows only', () => {
	const findings = lintApl({
		prepullActions: [{ action: { sequence: { name: 'Pre', actions: [cast(1)] } }, doAtValue: constant('-1s') }],
		priorityList: [
			{ action: { sequence: { name: 'Live', actions: [cast(1)] } } },
			{ hide: true, action: { sequence: { name: 'Hidden', actions: [cast(1)] } } },
			{ action: { condition: { sequenceIsComplete: { sequenceName: 'Live' } }, resetSequence: { sequenceName: 'Live' } } },
			{ action: { condition: { sequenceIsComplete: { sequenceName: 'Hidden' } }, resetSequence: { sequenceName: 'Pre' } } },
			{ action: { resetSequence: { sequenceName: 'Nope' } } },
		],
	});
	assert.deepEqual(
		find(findings, 'undefined-sequence').map(finding => finding.path.join('/')),
		[
			'priorityList/3/action/condition/sequenceIsComplete/sequenceName',
			'priorityList/3/action/resetSequence/sequenceName',
			'priorityList/4/action/resetSequence/sequenceName',
		],
	);
});

test('variables: undefined, duplicate, unused, group variables and placeholders', () => {
	const findings = lintApl({
		priorityList: [
			{ action: { condition: { variableRef: { name: 'Used' } }, ...cast(1) } },
			{ action: { condition: { variableRef: { name: 'Missing' } }, ...cast(2) } },
			{ action: { groupReference: { groupName: 'Filled', variables: [{ name: 'x', value: constant('1s') }] } } },
			{ action: { groupReference: { groupName: 'Filled' } } },
			{ action: { condition: { variablePlaceholder: { name: 'stray' } }, ...cast(3) } },
		],
		groups: [
			{
				name: 'Filled',
				actions: [
					{
						action: {
							condition: { cmp: { op: 'OpLt', lhs: { variablePlaceholder: { name: 'x' } }, rhs: { variableRef: { name: 'x' } } } },
							...cast(4),
						},
					},
				],
			},
		],
		valueVariables: [
			{ name: 'Used', value: constant('true') },
			{ name: 'Used', value: constant('false') },
			{ name: 'Idle', value: constant('true') },
		],
	});
	assert.deepEqual(
		find(findings, 'undefined-variable').map(finding => finding.path.join('/')),
		['priorityList/1/action/condition/variableRef/name', 'groups/0/actions/0/action/condition/cmp/rhs/variableRef/name'],
	);
	assert.match(find(findings, 'undefined-variable')[1].message, /Only the group's variables or a reference to it set "x"; .* so the sim drops this\./);
	assert.deepEqual(find(findings, 'duplicate-variable')[0].path, ['valueVariables', 1, 'name']);
	assert.deepEqual(
		find(findings, 'unused-variable').map(finding => finding.path),
		[['valueVariables', 2, 'name']],
	);
	assert.deepEqual(
		find(findings, 'placeholder-unset').map(finding => finding.path[1]),
		[3],
	);
	assert.deepEqual(find(findings, 'placeholder-outside')[0].path, ['priorityList', 4, 'action', 'condition', 'variablePlaceholder', 'name']);
});

test('a reference with no name set refers to nothing', () => {
	const findings = lintApl({
		priorityList: [
			{ action: { condition: { variableRef: {} }, ...cast(1) } },
			{ action: { groupReference: {} } },
			{ action: { condition: { actionGroupUsed: {} }, resetSequence: {} } },
			{ action: { condition: { sequenceIsComplete: {} }, ...cast(2) } },
		],
	});
	assert.deepEqual(
		findings.filter(finding => finding.severity !== 'info').map(finding => [finding.code, finding.path.join('/'), finding.message]),
		[
			['undefined-group', 'priorityList/1/action/groupReference/groupName', 'No group name set; the sim skips this.'],
			['group-never-used', 'priorityList/2/action/condition/actionGroupUsed/name', 'No group name set, so this is always false.'],
			['undefined-sequence', 'priorityList/2/action/resetSequence/sequenceName', 'No sequence name set.'],
			['undefined-sequence', 'priorityList/3/action/condition/sequenceIsComplete/sequenceName', 'No sequence name set.'],
			['undefined-variable', 'priorityList/0/action/condition/variableRef/name', 'No variable name set; the sim drops this.'],
		],
	);
});

test("a prepull row's condition is not read", () => {
	const findings = lintApl({
		prepullActions: [
			{ action: { condition: { gcdIsReady: {} }, ...cast(1) }, doAtValue: constant('-1s') },
			{ action: { condition: constant('false'), ...cast(2) }, doAtValue: constant('-1s') },
		],
	});
	assert.deepEqual(
		find(findings, 'prepull-condition').map(finding => finding.path.join('/')),
		['prepullActions/0/action/condition'],
	);
});

test('prepull times: missing, after the pull, read from the fight, not a time and out of order', () => {
	const findings = lintApl({
		prepullActions: [
			{ action: cast(1), doAtValue: constant('-2s') },
			{ action: cast(2), doAtValue: constant('-3s') },
			{ action: cast(3) },
			{ action: cast(4), doAtValue: constant('1s') },
			{ action: cast(5), doAtValue: { currentTime: {} } },
			{ action: cast(6), doAtValue: constant('soon') },
			{ action: cast(7), doAtValue: { variableRef: { name: 'Start' } } },
			{ action: cast(8), doAtValue: constant('0s') },
			{ hide: true, action: cast(9), doAtValue: constant('5s') },
			{ action: cast(10), doAtValue: { math: { op: 'OpSub', lhs: constant('0s'), rhs: { spellCastTime: { spellId: { spellId: 10 } } } } } },
		],
		valueVariables: [{ name: 'Start', value: { math: { op: 'OpSub', lhs: constant('-1s'), rhs: constant('500ms') } } }],
	});
	assert.deepEqual(
		findings.map(finding => [finding.code, finding.path[1]]),
		[
			['prepull-no-time', 2],
			['prepull-positive-time', 3],
			['prepull-not-time', 4],
			['prepull-not-time', 5],
			['prepull-order', 1],
		].sort((a, b) => a[1] - b[1]),
	);
});

test('constant conditions', () => {
	const findings = lintApl({
		priorityList: [
			{ action: { condition: constant('false'), ...cast(1) } },
			{ action: { condition: { and: { vals: [{ gcdIsReady: {} }, { not: { val: constant('true') } }] } }, ...cast(2) } },
			{ action: { condition: { cmp: { op: 'OpLt', lhs: constant('1s'), rhs: constant('500ms') } }, ...cast(3) } },
			{ action: { condition: { or: { vals: [{ gcdIsReady: {} }, constant('true')] } }, ...cast(4) } },
			{ action: { condition: { and: { vals: [{ gcdIsReady: {} }, { cmp: { op: 'OpGe', lhs: constant('10%'), rhs: constant('0.1') } }] } }, ...cast(5) } },
			{ action: { condition: constant('0'), ...cast(6) } },
			{ action: { condition: { variableRef: { name: 'Off' } }, ...cast(7) } },
		],
		valueVariables: [{ name: 'Off', value: constant('false') }],
	});
	assert.deepEqual(
		findings.map(finding => [finding.code, finding.severity, finding.path.join('/')]),
		[
			['never-runs', 'info', 'priorityList/0/action/condition'],
			['never-runs', 'warning', 'priorityList/1/action/condition'],
			['never-runs', 'warning', 'priorityList/2/action/condition'],
			['always-true', 'info', 'priorityList/3/action/condition'],
			['always-true', 'info', 'priorityList/4/action/condition/and/vals/1'],
			['always-true', 'info', 'priorityList/5/action/condition'],
		],
	);
});

test('a row an earlier row of its list shadows', () => {
	const gcd = { gcdIsReady: {} };
	const findings = lintApl({
		priorityList: [
			{ action: { condition: gcd, ...cast(1) } },
			{ action: { condition: { gcdIsReady: {}, uuid: { value: 'x' } }, ...cast(1) } },
			{ action: cast(2) },
			{ action: { condition: gcd, ...cast(2) } },
			{ action: { condition: { not: { val: gcd } }, ...cast(1) } },
			{ action: { sequence: { name: 'A', actions: [cast(3)] } } },
			{ action: { sequence: { name: 'A', actions: [cast(3)] } } },
			{ hide: true, action: cast(4) },
			{ action: cast(4) },
		],
		groups: [{ name: 'G', actions: [{ action: cast(5) }, { action: cast(5) }] }],
	});
	assert.deepEqual(
		find(findings, 'shadowed-row').map(finding => finding.path.join('/')),
		['priorityList/1', 'priorityList/3', 'groups/0/actions/1'],
	);
});

test('hidden rows are skipped, but their references count as uses', () => {
	const findings = lintApl({
		priorityList: [
			{ hide: true, action: { condition: constant('false'), groupReference: { groupName: 'G' } } },
			{ hide: true, action: {} },
		],
		groups: [{ name: 'G', actions: [{ action: { condition: { variableRef: { name: 'V' } }, ...cast(1) } }] }],
		valueVariables: [{ name: 'V', value: constant('true') }],
	});
	assert.deepEqual(codes(findings), []);
});
