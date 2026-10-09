import assert from 'node:assert/strict';
import Module from 'node:module';
import { test } from 'node:test';

const require = Module.createRequire(import.meta.url);
const built = new URL('../../../.vscode/extensions/wowsims-apl/out/extension.js', import.meta.url).pathname;

// Just enough of the vscode module for activate: it records what the extension registers.
function stubVscode() {
	const registered = { commands: [], serializers: [] };
	const vscode = {
		commands: { registerCommand: id => (registered.commands.push(id), { dispose() {} }) },
		window: { registerWebviewPanelSerializer: viewType => (registered.serializers.push(viewType), { dispose() {} }) },
	};
	return { vscode, registered };
}

test('the built extension loads on its own and registers its command and panel', () => {
	const { vscode, registered } = stubVscode();
	const load = Module._load;
	Module._load = function (request, ...rest) {
		return request === 'vscode' ? vscode : load.call(this, request, ...rest);
	};
	try {
		const extension = require(built);
		extension.activate({ subscriptions: [], extensionUri: {} });
	} finally {
		Module._load = load;
	}
	assert.deepEqual(registered.commands, ['wowsims-apl.openToSide', 'wowsims-apl.reloadRegistered']);
	assert.deepEqual(registered.serializers, ['wowsims-apl.editor']);
});
