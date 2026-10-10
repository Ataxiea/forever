// A stand-in for the vscode module, enough to run the built extension's host in Node: documents in memory that
// WorkspaceEdits change, webview panels whose messages a test sends and reads, and the registered commands. Every other
// name the API exports is a value that takes any use, because the bundled language client reads many of them when it
// loads.

import { readFileSync } from 'node:fs';
import Module from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = Module.createRequire(import.meta.url);

// Anything at all: callable, constructible, and each of its properties is anything again.
const anything = () =>
	new Proxy(function () {}, {
		get: (_, key) => (key === 'prototype' ? {} : key === Symbol.toPrimitive ? () => 0 : anything()),
		apply: () => anything(),
		construct: () => anything(),
	});

class Emitter {
	listeners = new Set();
	event = listener => {
		this.listeners.add(listener);
		return { dispose: () => this.listeners.delete(listener) };
	};
	fire(value) {
		for (const listener of [...this.listeners]) listener(value);
	}
}

class Uri {
	constructor(path) {
		this.scheme = 'file';
		this.path = path;
		this.fsPath = path;
	}
	static file(path) {
		return new Uri(path);
	}
	static parse(text) {
		return new Uri(fileURLToPath(text));
	}
	static joinPath(base, ...parts) {
		return new Uri([base.path, ...parts].join('/'));
	}
	toString() {
		return pathToFileURL(this.path).href;
	}
}

class Position {
	constructor(line, character) {
		this.line = line;
		this.character = character;
	}
}

class Range {
	constructor(a, b, c, d) {
		[this.start, this.end] = typeof a === 'number' ? [new Position(a, b), new Position(c, d)] : [a, b];
	}
}

class Selection extends Range {}

class WorkspaceEdit {
	edits = [];
	replace(uri, range, newText) {
		this.edits.push({ uri, range, newText });
	}
}

class ThemeColor {
	constructor(id) {
		this.id = id;
	}
}

// A document in memory, as VS Code keeps one: its text, a version each change counts up, and offset conversion.
class TextDocument {
	constructor(uri, text) {
		this.uri = uri;
		this.fileName = uri.fsPath;
		this.text = text;
		this.version = 1;
		this.isDirty = false;
		this.isClosed = false;
	}
	getText() {
		return this.text;
	}
	offsetAt(position) {
		const lines = this.text.split('\n');
		let offset = 0;
		for (let line = 0; line < position.line && line < lines.length; line++) offset += lines[line].length + 1;
		return Math.min(offset + Math.min(position.character, lines[position.line]?.length ?? 0), this.text.length);
	}
	positionAt(offset) {
		const before = this.text.slice(0, offset);
		const line = before.split('\n').length - 1;
		return new Position(line, offset - (before.lastIndexOf('\n') + 1));
	}
}

// The stand-in and what it records: documents, panels, commands, messages shown, documents opened from disk, the
// WorkspaceEdits applied and the titles of what it asked.
export function fakeVscode() {
	const changes = new Emitter();
	const closes = new Emitter();
	const selections = new Emitter();
	// `answers` are what the quick picks and input boxes answer, in order: a value, or a function of the items or options.
	const state = { documents: [], panels: [], commands: new Map(), serializers: [], messages: [], opened: [], applied: [], answers: [], asked: [] };
	const answer = async (shown, options) => {
		state.asked.push(options?.title);
		const next = state.answers.shift();
		return typeof next === 'function' ? next(await shown) : next;
	};

	// Replaces a document's text as one change, the way an edit or typing reaches the extension.
	const change = (document, text) => {
		document.text = text;
		document.version++;
		document.isDirty = true;
		changes.fire({ document, contentChanges: [{ text }] });
	};

	const workspace = {
		get textDocuments() {
			return state.documents.filter(d => !d.isClosed);
		},
		async openTextDocument(uri) {
			const open = state.documents.find(d => !d.isClosed && d.uri.toString() === uri.toString());
			if (open) return open;
			const document = new TextDocument(uri, readFileSync(uri.fsPath, 'utf8'));
			state.documents.push(document);
			state.opened.push(uri.toString());
			return document;
		},
		async applyEdit(edit) {
			state.applied.push(edit.edits);
			for (const [key, edits] of Map.groupBy(edit.edits, e => e.uri.toString())) {
				const document = state.documents.find(d => !d.isClosed && d.uri.toString() === key);
				if (!document) return false;
				let text = document.text;
				const located = edits.map(e => ({ start: document.offsetAt(e.range.start), end: document.offsetAt(e.range.end), newText: e.newText }));
				for (const e of located.sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.newText + text.slice(e.end);
				change(document, text);
			}
			return true;
		},
		onDidChangeTextDocument: changes.event,
		onDidCloseTextDocument: closes.event,
		getConfiguration: () => ({ get: (_, fallback) => fallback }),
	};

	const window = {
		visibleTextEditors: [],
		activeTextEditor: undefined,
		createWebviewPanel(viewType, title) {
			const received = new Emitter();
			const disposed = new Emitter();
			const panel = {
				viewType,
				title,
				posted: [],
				webview: {
					options: {},
					html: '',
					cspSource: 'vscode-webview:',
					asWebviewUri: uri => uri,
					postMessage(message) {
						panel.posted.push(message);
						panel.onPost?.(message);
						return Promise.resolve(true);
					},
					onDidReceiveMessage: received.event,
				},
				// Sends a message from the panel's page to the extension.
				send: message => received.fire(message),
				reveal() {},
				onDidDispose: disposed.event,
				dispose: () => disposed.fire(),
			};
			state.panels.push(panel);
			return panel;
		},
		registerWebviewPanelSerializer(viewType) {
			state.serializers.push(viewType);
			return { dispose() {} };
		},
		showQuickPick: (items, options) => answer(items, options),
		showInputBox: options => answer(options, options),
		showInformationMessage: message => void state.messages.push({ severity: 'info', message }),
		showWarningMessage: message => void state.messages.push({ severity: 'warning', message }),
		showErrorMessage: message => void state.messages.push({ severity: 'error', message }),
		setStatusBarMessage: () => ({ dispose() {} }),
		createTextEditorDecorationType: () => ({ dispose() {} }),
		onDidChangeTextEditorSelection: selections.event,
		onDidChangeVisibleTextEditors: () => ({ dispose() {} }),
		withProgress: (_, task) => task({ report() {} }, { onCancellationRequested() {} }),
	};

	const commands = {
		registerCommand(id, handler) {
			state.commands.set(id, handler);
			return { dispose() {} };
		},
	};

	const declarations = readFileSync(require.resolve('@types/vscode/index.d.ts'), 'utf8');
	const vscode = Object.fromEntries([...declarations.matchAll(/^\texport (?:class|enum|namespace) (\w+)/gm)].map(([, name]) => [name, anything()]));
	const stand = (target, real) => new Proxy(real, { get: (r, key) => (key in r ? r[key] : anything()) });
	Object.assign(vscode, {
		Uri,
		Position,
		Range,
		Selection,
		WorkspaceEdit,
		ThemeColor,
		ViewColumn: { One: 1, Two: 2, Beside: -2 },
		TextEditorRevealType: { InCenterIfOutsideViewport: 2 },
		TextEditorSelectionChangeKind: { Keyboard: 1, Mouse: 2, Command: 3 },
		ProgressLocation: { Notification: 15 },
		workspace: stand(vscode.workspace, workspace),
		window: stand(vscode.window, window),
		commands: stand(vscode.commands, commands),
	});

	return {
		vscode,
		state,
		change,
		// Closes a document, as VS Code does with one no editor shows.
		close(document) {
			document.isClosed = true;
			closes.fire(document);
		},
		// Moves the cursor of an editor on the document, as a click in the text does.
		select(document, offset) {
			const position = document.positionAt(offset);
			selections.fire({ textEditor: { document }, selections: [{ active: position }], kind: 2 });
		},
	};
}

// Loads the built extension with the stand-in and activates it as installed at `installed`. Activation stops where it
// would start the language server, after the commands and the panel are registered.
export async function activateBuilt(stand, installed = fileURLToPath(new URL('../../../.vscode/extensions/wowsims-apl', import.meta.url))) {
	const built = fileURLToPath(new URL('../../../.vscode/extensions/wowsims-apl/out/extension.js', import.meta.url));
	const load = Module._load;
	Module._load = function (request, ...rest) {
		return request === 'vscode' ? stand.vscode : load.call(this, request, ...rest);
	};
	let activated;
	try {
		delete require.cache[built];
		const extension = require(built);
		activated = extension.activate({
			subscriptions: [],
			extensionUri: Uri.file(installed),
			asAbsolutePath: () => {
				throw new Error('no language server here');
			},
		});
	} finally {
		Module._load = load;
	}
	await activated.catch(e => {
		if (!/no language server here/.test(e.message)) throw e;
	});
}
