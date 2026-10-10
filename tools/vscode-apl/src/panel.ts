import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import * as vscode from 'vscode';

import { isAplSiml, movedOnlyBy, panelFindings, readOnlyReason, spliceApl, usedFiles } from './apl';
import { aplDatabase } from './db';
import { documentFor, readDocument, vscodeRange } from './host';
import { insertPattern } from './insert_pattern';
import { pathAt, samePath, spanFor } from './lang/document';
import { repositoryRoot } from './lang/workspace';
import type { FromPanel, PanelState, ToPanel } from './protocol';
import { registeredFor } from './registered';
import { onSimRecord, simDocument, type SimRecord, simRecord } from './simulate';

const VIEW_TYPE = 'wowsims-apl.editor';
const ICON_HOST = 'https://wow.zamimg.com';
// How long the panel waits for typing to pause before it reads the text again.
const SETTLE_MS = 60;

// One panel per rotation file; opening the editor for a file that has one reveals it.
const panels = new Map<string, vscode.WebviewPanel>();

// The panel's page. Its bundle is built by `make vscode-apl` and not committed, so a checkout may not have it yet.
function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	if (!existsSync(vscode.Uri.joinPath(extensionUri, 'out', 'webview.js').fsPath)) {
		return `<!doctype html>
<html lang="en">
<body>
<p>The panel is not built yet: run <code>make vscode-apl</code> in the repository, then open the panel again.</p>
</body>
</html>`;
	}
	const nonce = randomBytes(16).toString('base64');
	const asset = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'out', file));
	const csp = [
		`default-src 'none'`,
		`img-src ${webview.cspSource} ${ICON_HOST} data:`,
		`style-src ${webview.cspSource} 'unsafe-inline'`,
		`script-src 'nonce-${nonce}'`,
	].join('; ');
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('webview.css')}">
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${asset('webview.js')}"></script>
</body>
</html>`;
}

// Ties a panel to its file. The panel holds the file's URI only, and finds the open document by it on every message.
function bind(panel: vscode.WebviewPanel, uri: vscode.Uri, extensionUri: vscode.Uri): void {
	const key = uri.toString();
	panels.set(key, panel);
	panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')] };
	panel.title = `APL: ${basename(uri.fsPath)}`;
	panel.webview.html = html(panel.webview, extensionUri);

	const post = (message: ToPanel) => void panel.webview.postMessage(message);
	// The last of the panel's edits made or refused, and the document versions its own edits made.
	let handled = 0;
	const own = new Set<number>();
	let spec: string | undefined;
	// The files the rotation's `use` lines name, whose text it is read with.
	let used: string[] = [];
	const uses = (file: vscode.Uri) => file.scheme === 'file' && used.some(path => samePath(path, file.fsPath));

	const postRotation = (document: vscode.TextDocument) => {
		const read = readDocument(document);
		if ('error' in read) {
			post({ type: 'rotation', version: document.version, handled, readOnly: read.error, findings: [] });
			return;
		}
		used = usedFiles(read);
		post({
			type: 'rotation',
			version: document.version,
			handled,
			rotation: read.parse.rotation,
			readOnly: readOnlyReason(read),
			className: read.cls,
			findings: panelFindings(read),
		});
		if (read.parse.spec !== undefined && read.parse.spec !== spec) {
			spec = read.parse.spec;
			post({ type: 'registered', registered: registeredFor(read) });
		}
	};
	const postSim = (version: number, record: SimRecord | undefined = simRecord(key), running = false) =>
		post({ type: 'sim', running, sim: record && { result: record.result, stale: record.version !== version, baseline: record.baseline } });

	// While an edit of the panel is being made, the text's changes are not posted: the edit posts the text it leaves,
	// with the count of edits made that it holds.
	let editing = false;
	let settle: ReturnType<typeof setTimeout> | undefined;
	const changed = () => {
		clearTimeout(settle);
		settle = setTimeout(async () => {
			if (editing) return;
			const document = await documentFor(uri);
			postRotation(document);
			postSim(document.version);
		}, SETTLE_MS);
	};

	// The panel's edits, one at a time in the order it sent them. An edit made against a version that only the panel's
	// own edits have moved past is made on the text as it is; the panel computed it with those edits applied. One that
	// someone else's change moved past is dropped.
	const make = async (message: Extract<FromPanel, { type: 'edit' }>, document: vscode.TextDocument) => {
		if (!movedOnlyBy(own, message.version, document.version)) return;
		const read = readDocument(document);
		const result = 'error' in read ? read : spliceApl(read, message.edits);
		if ('error' in result) {
			void vscode.window.showWarningMessage(`The panel's edit was not made: ${result.error}.`);
			return;
		}
		if (result.edits.length === 0) return;
		const workspaceEdit = new vscode.WorkspaceEdit();
		for (const e of result.edits) workspaceEdit.replace(document.uri, vscodeRange(e.range), e.newText);
		const before = document.version;
		if (await vscode.workspace.applyEdit(workspaceEdit)) for (let version = before + 1; version <= document.version; version++) own.add(version);
	};
	const edit = async (message: Extract<FromPanel, { type: 'edit' }>) => {
		editing = true;
		try {
			await make(message, await documentFor(uri));
		} finally {
			editing = false;
			handled = message.seq;
			postRotation(await documentFor(uri));
		}
	};
	let edits = Promise.resolve();

	const reveal = async (path: (string | number)[]) => {
		const document = await documentFor(uri);
		const read = readDocument(document);
		const range = 'error' in read ? undefined : spanFor(read, path);
		if (!range) return;
		const visible = vscode.window.visibleTextEditors.find(editor => editor.document.uri.toString() === key);
		const editor = await vscode.window.showTextDocument(document, { viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One, preserveFocus: true });
		const selection = vscodeRange(range);
		editor.selection = new vscode.Selection(selection.start, selection.end);
		editor.revealRange(new vscode.Range(selection.start, selection.start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
	};

	const disposables: vscode.Disposable[] = [
		panel.webview.onDidReceiveMessage(async (message: FromPanel) => {
			switch (message.type) {
				case 'ready': {
					// A page loaded again counts its edits from the start.
					const document = await documentFor(uri);
					const root = repositoryRoot(uri.fsPath);
					handled = 0;
					spec = undefined;
					post({ type: 'init', db: root ? aplDatabase(root) : { spells: {}, items: {} }, fileName: basename(uri.fsPath), uri: key });
					postRotation(document);
					postSim(document.version);
					break;
				}
				case 'edit':
					edits = edits.then(() => edit(message)).catch(e => void vscode.window.showErrorMessage(`The panel's edit failed: ${(e as Error).message}`));
					break;
				case 'sim': {
					const document = await documentFor(uri);
					postSim(document.version, undefined, true);
					await simDocument(document, message.compare);
					postSim(document.version);
					break;
				}
				case 'pattern':
					await insertPattern(uri, message.path);
					break;
				case 'reveal':
					await reveal(message.path);
					break;
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.contentChanges.length > 0 && (event.document.uri.toString() === key || uses(event.document.uri))) changed();
		}),
		// A used file closed unsaved is read from disk again.
		vscode.workspace.onDidCloseTextDocument(document => {
			if (uses(document.uri)) changed();
		}),
		onSimRecord(changedUri => {
			if (changedUri === key) changed();
		}),
		vscode.window.onDidChangeTextEditorSelection(event => {
			const document = event.textEditor.document;
			if (document.uri.toString() !== key || event.kind === vscode.TextEditorSelectionChangeKind.Command) return;
			const read = readDocument(document);
			if (!('error' in read)) post({ type: 'cursor', path: pathAt(read, document.offsetAt(event.selections[0].active)) });
		}),
	];

	panel.onDidDispose(() => {
		clearTimeout(settle);
		panels.delete(key);
		disposables.forEach(d => d.dispose());
	});
}

// Opens the panel beside an .apl.siml file, or reveals the one it has.
async function openToSide(extensionUri: vscode.Uri, uri: vscode.Uri | undefined): Promise<void> {
	const chosen = uri ?? vscode.window.activeTextEditor?.document.uri;
	if (!chosen || !isAplSiml(chosen.path)) {
		void vscode.window.showInformationMessage('The APL editor opens on an .apl.siml file.');
		return;
	}
	const open = panels.get(chosen.toString());
	if (open) {
		open.reveal(vscode.ViewColumn.Beside, true);
		return;
	}
	const panel = vscode.window.createWebviewPanel(VIEW_TYPE, basename(chosen.fsPath), { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
	bind(panel, chosen, extensionUri);
}

export function registerPanel(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('wowsims-apl.openToSide', (uri?: vscode.Uri) => openToSide(context.extensionUri, uri)),
		vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel, state?: PanelState) {
				if (state?.uri && isAplSiml(state.uri)) bind(panel, vscode.Uri.parse(state.uri), context.extensionUri);
				else panel.dispose();
			},
		}),
	);
}
