import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findGo } from '../src/go.ts';
import { createSiml } from '../src/lang/siml.ts';
import { buildRequest, deadRows, dpsDifference, parseResult, runTool } from '../src/sim/tool.ts';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const json = path => JSON.parse(readFileSync(new URL(path, new URL('../../../', import.meta.url)), 'utf8'));
// The hunter's default rotation. Its path picks the hunter's default build, as ui/specs/hunter/dps/apls/default.apl.siml.
const PATH = 'tools/vscode-apl/test/fixtures/default.apl.siml';
const text = readFileSync(new URL('fixtures/default.apl.siml', import.meta.url), 'utf8');

const run = (mean, stdev, iterations, rows = {}) => ({ dps: { mean, stdev }, iterations, duration: 180, rows, spells: [] });

test('a request gets the default iterations, a sane bound and no undefined fields', () => {
	assert.deepEqual(buildRequest({ siml: text, path: PATH, seed: undefined }), { siml: text, path: PATH, iterations: 1000 });
	assert.equal(buildRequest({ siml: text, path: PATH, iterations: 0 }).iterations, 1000);
	assert.equal(buildRequest({ siml: text, path: PATH, iterations: -5 }).iterations, 1);
	assert.equal(buildRequest({ siml: text, path: PATH, iterations: 1e9 }).iterations, 100000);
	assert.throws(() => buildRequest({ siml: '', path: PATH }), /text of an \.apl\.siml and its path/);
	assert.throws(() => buildRequest({ siml: text, path: '' }), /text of an \.apl\.siml and its path/);
});

test('the difference is significant only beyond about two combined standard errors', () => {
	// Each mean's error is 100 / sqrt(10000) = 1, so the combined error is sqrt(2).
	const small = dpsDifference(run(1000, 100, 10000), run(1002, 100, 10000));
	assert.equal(small.delta, 2);
	assert.ok(Math.abs(small.stderr - Math.SQRT2) < 1e-12);
	assert.ok(Math.abs(small.z - 2 / Math.SQRT2) < 1e-12);
	assert.equal(small.significant, false);
	assert.ok(Math.abs(small.percent - 0.2) < 1e-12);

	const large = dpsDifference(run(1000, 100, 10000), run(997, 100, 10000));
	assert.equal(large.significant, true);
	assert.ok(large.z < 0);

	assert.deepEqual(dpsDifference(run(1000, 0, 1), run(1000, 0, 1)), { delta: 0, percent: 0, stderr: 0, z: 0, significant: false });
	assert.equal(dpsDifference(run(1000, 0, 1), run(1001, 0, 1)).significant, true, 'no noise at all');
});

test('dead rows are the shown rows that never ran', () => {
	const rows = { 'priorityList/0': { executions: 2.5 }, 'priorityList/1': { executions: 0 }, 'priorityList/2': { executions: 0, hidden: true } };
	assert.deepEqual(deadRows(run(1, 0, 1, rows)), ['priorityList/1']);
});

test('a result is parsed, an error is thrown, and a compare gets its difference', () => {
	const base = { ...run(1000, 100, 10000), character: { source: 'ui/specs/hunter/dps/defaults.siml', race: 'RaceOrc', talents: '' } };
	assert.throws(() => parseResult(JSON.stringify({ error: 'the sim cannot run mage/dps: To be implemented' })), /mage\/dps/);
	assert.throws(() => parseResult('panic: boom'), /printed no result/);
	assert.throws(() => parseResult('{}'), /incomplete/);
	const parsed = parseResult(JSON.stringify({ ...base, spells: null, compare: run(1010, 100, 10000) }));
	assert.deepEqual(parsed.spells, []);
	assert.equal(parsed.difference.delta, 10);
	assert.equal(parsed.difference.significant, true);
	assert.equal(parseResult(JSON.stringify(base)).difference, undefined);
});

const go = findGo('go');

test('the tool sims the text of an .apl.siml, keyed by the paths of the rotation it reads as', { skip: !go && 'no go binary', timeout: 300000 }, async () => {
	const rotation = createSiml(json('ui/generated/siml/schema.json'), json('sim/siml/names.json')).parse(text, { path: PATH }).rotation;
	const result = await runTool(repository, go, { siml: text, path: PATH, compare: { siml: text }, iterations: 20, timeline: true, timelineLimit: 10 });
	assert.ok(result.dps.mean > 0);
	assert.equal(result.iterations, 20);
	assert.equal(result.rows['prepullActions/0'].executions, 1);
	const rows = rotation.prepullActions.length + rotation.priorityList.length + rotation.groups.reduce((n, g) => n + g.actions.length, 0);
	assert.equal(Object.keys(result.rows).length, rows);
	assert.equal(result.timeline.length, 10);
	assert.equal(result.timeline[0].path, 'prepullActions/0');
	assert.equal(result.character.race, 'RaceOrc');
	assert.ok(result.spells.some(spell => spell.name === "Hunter's Mark"));
	assert.equal(result.difference.delta, 0, 'the same text on the same seed');
});

test('the tool reports a text that does not read, at its path, and a spec the sim cannot build', { skip: !go && 'no go binary', timeout: 300000 }, async () => {
	const misspelt = 'siml 1\nspec hunter\n\npriority:\n  cast hunters_mrk\n';
	await assert.rejects(
		runTool(repository, go, { siml: misspelt, path: PATH, iterations: 2 }),
		new RegExp(`${PATH}:5:8 unknown-name no spell is named hunters_mrk`),
	);
	await assert.rejects(
		runTool(repository, go, { siml: 'siml 1\nspec mage\n\npriority:\n  wait 1s\n', path: PATH, iterations: 2 }),
		/the sim cannot run mage\/dps/,
	);
});

test('an aborted sim rejects with an AbortError', { skip: !go && 'no go binary', timeout: 300000 }, async () => {
	const controller = new AbortController();
	const pending = runTool(repository, go, { siml: text, path: PATH, iterations: 100000 }, controller.signal);
	setTimeout(() => controller.abort(), 200);
	await assert.rejects(pending, { name: 'AbortError' });
	const already = new AbortController();
	already.abort();
	await assert.rejects(runTool(repository, go, { siml: text, path: PATH }, already.signal), { name: 'AbortError' });
});
