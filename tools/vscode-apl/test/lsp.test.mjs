import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

// The built language server, driven over stdio the way any editor's client drives it.
const server = fileURLToPath(new URL('../../../.vscode/extensions/wowsims-apl/out/lsp.js', import.meta.url));
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const file = pathToFileURL(`${repository}ui/specs/hunter/dps/apls/smoke.apl.siml`).href;
// default.apl.siml declares ${Use Summon Hawk}, which hawks.apl.siml beside it sets.
const fixture = name => ({ uri: new URL(`fixtures/${name}`, import.meta.url).href, text: readFileSync(new URL(`fixtures/${name}`, import.meta.url), 'utf8') });

// A JSON-RPC client over the server's stdin and stdout.
function connect() {
	const child = spawn(process.execPath, [server, '--stdio'], { cwd: repository, stdio: ['pipe', 'pipe', 'inherit'] });
	let buffer = Buffer.alloc(0);
	let nextId = 1;
	const pending = new Map();
	const notifications = [];
	const waiters = [];
	child.stdout.on('data', chunk => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const end = buffer.indexOf('\r\n\r\n');
			if (end < 0) return;
			const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
			if (buffer.length < end + 4 + length) return;
			const message = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString());
			buffer = buffer.subarray(end + 4 + length);
			if (message.method === undefined && pending.has(message.id)) {
				pending.get(message.id)(message);
				pending.delete(message.id);
			} else if (message.method) {
				// A request from the server, such as client/registerCapability, is answered as a client answers it.
				if (message.id !== undefined) send({ id: message.id, result: null });
				notifications.push(message);
				waiters.splice(0).forEach(wake => wake());
			}
		}
	});
	const send = message => {
		const body = JSON.stringify({ jsonrpc: '2.0', ...message });
		child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
	};
	return {
		child,
		request(method, params) {
			const id = nextId++;
			send({ id, method, params });
			return new Promise(resolve => pending.set(id, resolve));
		},
		notify(method, params) {
			send({ method, params });
		},
		async notification(method, matches = () => true, ms = 10000) {
			const end = Date.now() + ms;
			for (;;) {
				const found = notifications.find(n => n.method === method && matches(n.params));
				if (found) return found.params;
				if (Date.now() > end) throw new Error(`the server sent no ${method} that matches within ${ms} ms`);
				await new Promise(resolve => {
					waiters.push(resolve);
					setTimeout(resolve, 100);
				});
			}
		},
	};
}

let lsp;

before(() => {
	lsp = connect();
});

after(async () => {
	await lsp.request('shutdown');
	lsp.notify('exit');
	await new Promise(resolve => lsp.child.on('exit', resolve));
});

test('the server answers initialize with what it provides', async () => {
	// No go binary: a hover answers at once, without the spell's game files row.
	const response = await lsp.request('initialize', {
		processId: process.pid,
		rootUri: pathToFileURL(repository).href,
		capabilities: {},
		initializationOptions: { goBinary: '/no/go' },
	});
	const { capabilities } = response.result;
	assert.ok(capabilities.completionProvider.triggerCharacters.includes('.'));
	assert.equal(capabilities.hoverProvider, true);
	assert.equal(capabilities.documentFormattingProvider, true);
	assert.ok(capabilities.semanticTokensProvider.legend.tokenTypes.length > 0);
	assert.ok(capabilities.codeActionProvider.codeActionKinds.includes('quickfix'));
	assert.deepEqual(capabilities.documentLinkProvider, { resolveProvider: false });
	lsp.notify('initialized', {});
});

test('an opened file gets its diagnostics published', async () => {
	const text = ['siml 1', 'spec hunter', '', 'priority:', '  cast hunters_mrk', '  ', ''].join('\n');
	lsp.notify('textDocument/didOpen', { textDocument: { uri: file, languageId: 'siml', version: 1, text } });
	const { diagnostics } = await lsp.notification('textDocument/publishDiagnostics', params => params.uri === file);
	assert.deepEqual(
		diagnostics.map(d => [d.range.start.line, d.range.start.character, d.code]),
		[[4, 7, 'unknown-name']],
	);
	assert.match(diagnostics[0].message, /did you mean hunters_mark/);
});

test("a quick fix changes the unknown name to the parser's candidate", async () => {
	const { diagnostics } = await lsp.notification('textDocument/publishDiagnostics', params => params.uri === file);
	const response = await lsp.request('textDocument/codeAction', { textDocument: { uri: file }, range: diagnostics[0].range, context: { diagnostics } });
	const fix = response.result.find(action => action.kind === 'quickfix');
	assert.equal(fix.title, 'Change to hunters_mark');
	assert.deepEqual(fix.edit.changes[file], [{ range: diagnostics[0].range, newText: 'hunters_mark' }]);
});

test('a use path is a link to the file it names', async () => {
	const path = `${repository}ui/specs/hunter/dps/builds/mm.siml`;
	const uri = pathToFileURL(path).href;
	lsp.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'siml', version: 1, text: readFileSync(path, 'utf8') } });
	const response = await lsp.request('textDocument/documentLink', { textDocument: { uri } });
	assert.deepEqual(
		response.result.map(link => link.target.slice(pathToFileURL(repository).href.length)),
		['ui/specs/hunter/dps/gear_sets/p1.gear.siml', 'ui/specs/hunter/dps/apls/turret.apl.siml'],
	);
	lsp.notify('textDocument/didClose', { textDocument: { uri } });
});

test('completion offers what the position takes', async () => {
	const response = await lsp.request('textDocument/completion', { textDocument: { uri: file }, position: { line: 5, character: 2 } });
	const labels = response.result.map(item => item.label);
	assert.ok(labels.includes('cast'), 'an action keyword at the start of a priority row');
	assert.ok(labels.includes('wait until'));
	const named = await lsp.request('textDocument/completion', { textDocument: { uri: file }, position: { line: 4, character: 12 } });
	assert.ok(
		named.result.some(item => item.label === 'hunters_mark'),
		'a hunter spell after cast',
	);
});

test('hover names a spell of the table', async () => {
	lsp.notify('textDocument/didChange', {
		textDocument: { uri: file, version: 2 },
		contentChanges: [{ text: ['siml 1', 'spec hunter', '', 'priority:', '  cast hunters_mark', ''].join('\n') }],
	});
	const response = await lsp.request('textDocument/hover', { textDocument: { uri: file }, position: { line: 4, character: 9 } });
	assert.match(response.result.contents.value, /Hunter's Mark/);
	assert.match(response.result.contents.value, /spell 14325/);
});

test('a document in the siml language that is not saved yet is served', async () => {
	const uri = 'untitled:Untitled-1';
	const text = ['siml 1', 'spec hunter', '', 'priority:', '  cast hunters_mrk', ''].join('\n');
	lsp.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'siml', version: 1, text } });
	const { diagnostics } = await lsp.notification('textDocument/publishDiagnostics', params => params.uri === uri);
	assert.deepEqual(
		diagnostics.map(d => d.code),
		['unknown-name'],
	);
	const response = await lsp.request('textDocument/completion', { textDocument: { uri }, position: { line: 4, character: 9 } });
	assert.ok(response.result.some(item => item.label === 'hunters_mark'));
});

test('a used file closed without saving is read from disk again by the open file that uses it', async () => {
	const used = fixture('default.apl.siml');
	const using = fixture('hawks.apl.siml');
	const unsaved = used.text.replace('var ${Use Summon Hawk} = false\n', '');
	lsp.notify('textDocument/didOpen', { textDocument: { uri: used.uri, languageId: 'siml', version: 1, text: unsaved } });
	lsp.notify('textDocument/didOpen', { textDocument: { uri: using.uri, languageId: 'siml', version: 1, text: using.text } });
	const before = await lsp.notification('textDocument/publishDiagnostics', params => params.uri === using.uri);
	assert.deepEqual(
		before.diagnostics.map(d => d.code),
		['with-unknown-variable'],
	);
	lsp.notify('textDocument/didClose', { textDocument: { uri: used.uri } });
	await lsp.notification('textDocument/publishDiagnostics', params => params.uri === using.uri && params.diagnostics.length === 0);
});

test('rename from a with list edits both files, and a name the used file has is refused with the reason', async () => {
	const using = fixture('hawks.apl.siml');
	const position = { line: 3, character: 30 };
	const renamed = await lsp.request('textDocument/rename', { textDocument: { uri: using.uri }, position, newName: 'Summon hawks' });
	assert.deepEqual(
		Object.entries(renamed.result.changes).map(([uri, edits]) => [basename(fileURLToPath(uri)), edits.length]),
		[
			['default.apl.siml', 5],
			['hawks.apl.siml', 1],
		],
	);
	const refused = await lsp.request('textDocument/rename', { textDocument: { uri: using.uri }, position, newName: 'Use Aimed Shot' });
	assert.equal(refused.error.message, 'default.apl.siml has a variable named Use Aimed Shot already.');
});

test('a regenerated name table is read at once, and the open files are checked again when the editor says it changed', { timeout: 30000 }, async () => {
	const root = mkdtempSync(join(tmpdir(), 'siml-lsp-'));
	const copy = (path, text) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	};
	const tablePath = join('sim', 'siml', 'names.json');
	const table = readFileSync(join(repository, tablePath), 'utf8');
	const older = JSON.parse(table);
	delete older.classes.hunter.spell.hunters_mark;
	copy(join('ui', 'generated', 'siml', 'schema.json'), readFileSync(join(repository, 'ui', 'generated', 'siml', 'schema.json'), 'utf8'));
	copy(tablePath, JSON.stringify(older));
	const watching = connect();
	try {
		await watching.request('initialize', {
			processId: process.pid,
			rootUri: pathToFileURL(root).href,
			capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
			initializationOptions: { goBinary: '/no/go' },
		});
		watching.notify('initialized', {});
		const { registrations } = await watching.notification('client/registerCapability');
		const globs = registrations
			.filter(r => r.method === 'workspace/didChangeWatchedFiles')
			.flatMap(r => r.registerOptions.watchers.map(w => w.globPattern));
		assert.ok(globs.includes('**/sim/siml/names.json'), 'the table is watched');
		assert.ok(globs.includes('**/ui/generated/siml/schema.json'), 'the schema is watched');

		const uri = pathToFileURL(join(root, 'x.apl.siml')).href;
		const text = ['siml 1', 'spec hunter', '', 'priority:', '  cast hunters_mark', ''].join('\n');
		watching.notify('textDocument/didOpen', { textDocument: { uri, languageId: 'siml', version: 1, text } });
		const before = await watching.notification('textDocument/publishDiagnostics', params => params.uri === uri);
		assert.deepEqual(
			before.diagnostics.map(d => d.code),
			['unknown-name'],
		);

		copy(tablePath, table);
		const named = await watching.request('textDocument/completion', { textDocument: { uri }, position: { line: 4, character: 12 } });
		assert.ok(
			named.result.some(item => item.label === 'hunters_mark'),
			'the new table is read by the next request',
		);
		watching.notify('workspace/didChangeWatchedFiles', { changes: [{ uri: pathToFileURL(join(root, tablePath)).href, type: 2 }] });
		await watching.notification('textDocument/publishDiagnostics', params => params.uri === uri && params.diagnostics.length === 0);
	} finally {
		await watching.request('shutdown');
		watching.notify('exit');
		await new Promise(resolve => watching.child.on('exit', resolve));
		rmSync(root, { recursive: true, force: true });
	}
});
