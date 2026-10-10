import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { buildPanel } from '../scripts/panel.mjs';
import { activateBuilt, fakeVscode } from './vscode.mjs';

// The panel, bundled from its sources as the build bundles it, mounted in happy-dom and talking to the built extension
// host through the stand-in for VS Code, as it talks to the extension in a webview: what a click or a key in the panel
// does to the text.

const out = mkdtempSync(join(tmpdir(), 'wowsims-apl-panel-'));
const fixture = fileURLToPath(new URL('fixtures/default.apl.siml', import.meta.url));

let stand;
let panel;
let document_;
const sent = [];

async function until(condition, ms = 5000) {
	const end = Date.now() + ms;
	while (!condition()) {
		if (Date.now() > end) throw new Error('timed out');
		await new Promise(resolve => setTimeout(resolve, 10));
	}
}

const rows = list => [...document.querySelectorAll(`[data-row^="${list}/"]`)].filter(row => /^[a-zA-Z]+\/\d+$/.test(row.dataset.row));
const priority = () => rows('priorityList');
const rowText = row => row.querySelector('.summary-main').textContent;
const lastRotation = () => panel.posted.filter(m => m.type === 'rotation').at(-1);
// Waits until the extension has answered every edit the panel sent.
const settled = () => until(() => (lastRotation()?.handled ?? 0) >= sent.filter(m => m.type === 'edit').length);

before(async () => {
	await buildPanel(out);
	GlobalRegistrator.register({ url: 'https://panel.test/' });
	stand = fakeVscode();
	await activateBuilt(stand);
	const uri = stand.vscode.Uri.file(fixture);
	document_ = await stand.vscode.workspace.openTextDocument(uri);
	await stand.state.commands.get('wowsims-apl.openToSide')(uri);
	panel = stand.state.panels.at(-1);
	panel.onPost = message => window.dispatchEvent(new MessageEvent('message', { data: message }));
	window.acquireVsCodeApi = () => ({
		postMessage: message => {
			sent.push(message);
			panel.send(message);
		},
		setState() {},
	});
	document.body.innerHTML = '<div id="root"></div>';
	vm.runInThisContext(readFileSync(join(out, 'webview.js'), 'utf8'));
	await until(() => priority().length === 13);
});

after(async () => {
	await GlobalRegistrator.unregister();
	rmSync(out, { recursive: true, force: true });
});

const key = (element, init) => element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const click = element => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

test('Alt+ArrowUp moves the focused row, and the focus goes with it', async () => {
	const summary = priority()[4].querySelector('.summary');
	assert.equal(rowText(priority()[4]), 'Cast Strider Kick');
	summary.focus();
	key(summary, { key: 'ArrowUp', altKey: true });
	// A second key press is a task of its own, after the panel has drawn the first.
	await until(() => document.activeElement.closest('li')?.dataset.row === 'priorityList/3');
	key(document.activeElement, { key: 'ArrowUp', altKey: true });
	await settled();
	assert.equal(rowText(priority()[2]), 'Cast Strider Kick');
	assert.equal(document.activeElement.closest('li').dataset.row, 'priorityList/2');
	const lines = document_.getText().split('\n');
	assert.equal(lines[lines.indexOf('  cast strider_kick') - 1], '  cast hunters_mark if not target.aura(hunters_mark).is_active');
});

test('an open row stays open on its row when a row above it is deleted', async () => {
	click(priority()[5].querySelector('.chevron'));
	await until(() => priority()[5].querySelector('.row-body'));
	const open = rowText(priority()[5]);
	click(priority()[0].querySelector('button[title="Delete"]'));
	await settled();
	assert.equal(rowText(priority()[4]), open);
	assert.ok(priority()[4].querySelector('.row-body'), 'still open');
	assert.equal(priority()[5].querySelector('.row-body'), null);
	assert.doesNotMatch(document_.getText(), /autocast_other_cooldowns/);
});

test('a spell picked for a tagged one is written as its own name, with no tag carried over', async () => {
	stand.change(document_, document_.getText().replace('priority:\n', 'priority:\n  cast innervate\n'));
	// The chip writes the tag, -1, after the name.
	await until(() => rowText(priority()[0]) === 'Cast Innervate-1');
	click(priority()[0].querySelector('.chevron'));
	await until(() => priority()[0].querySelector('.row-body .id-picker .picker-trigger'));
	click(priority()[0].querySelector('.row-body .id-picker .picker-trigger'));
	await until(() => priority()[0].querySelector('.picker-pop input'));
	const input = priority()[0].querySelector('.picker-pop input');
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'raptor');
	input.dispatchEvent(new Event('input', { bubbles: true }));
	const option = () => [...priority()[0].querySelectorAll('.picker-pop li')].find(li => li.textContent.startsWith('Raptor Strike'));
	await until(option);
	option().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
	await settled();
	const edit = sent.filter(m => m.type === 'edit').at(-1);
	assert.deepEqual(edit.edits[0].value, { spellId: 14266, rank: 8 });
	assert.match(document_.getText(), /\npriority:\n {2}cast raptor_strike\n/);
});

test('a pet picked as the unit of an aura is written with its owner, as the sim reads one', async () => {
	const mark = () => priority().find(row => rowText(row).startsWith("Cast Hunter's Mark"));
	click(mark().querySelector('.chevron'));
	// The condition `not target.aura(hunters_mark).is_active`: open the `not`, then the aura value inside it.
	await until(() => mark().querySelector('.row-body .value-preview'));
	click(mark().querySelector('.row-body .value-preview'));
	await until(() => mark().querySelectorAll('.row-body .value-preview').length > 1);
	click(mark().querySelectorAll('.row-body .value-preview')[1]);
	await until(() => [...mark().querySelectorAll('.unit-picker select')].some(select => select.value === 'CurrentTarget'));
	const select = [...mark().querySelectorAll('.unit-picker select')].find(s => s.value === 'CurrentTarget');
	assert.deepEqual(
		[...select.options].map(option => option.value),
		['', 'Pet', 'CurrentTarget', 'PreviousTarget', 'NextTarget', 'Player', 'Target'],
		"the units the site's aura sources offer",
	);
	select.value = 'Pet';
	select.dispatchEvent(new Event('change', { bubbles: true }));
	await settled();
	assert.deepEqual(sent.filter(m => m.type === 'edit').at(-1).edits[0].value, { type: 'Pet', owner: { type: 'Self' } });
	assert.match(document_.getText(), /cast hunters_mark if not pet1\.aura\(/);
});

test('nothing is sent while the text has errors', async () => {
	stand.change(document_, document_.getText().replace('cast mongoose_bite', 'cast mongoose_bit'));
	await until(() => document.querySelector('.error'));
	assert.match(document.querySelector('.error').textContent, /^The text has errors/);
	assert.equal(document.querySelector('fieldset').disabled, true);
	const edits = sent.filter(m => m.type === 'edit').length;
	const summary = priority()[3].querySelector('.summary');
	summary.focus();
	key(summary, { key: 'ArrowUp', altKey: true });
	click(priority()[1].querySelector('button[title="Delete"]'));
	await new Promise(resolve => setTimeout(resolve, 100));
	assert.equal(sent.filter(m => m.type === 'edit').length, edits);
});
