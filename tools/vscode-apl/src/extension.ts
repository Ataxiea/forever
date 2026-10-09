import { randomBytes } from 'node:crypto';
import { basename } from 'node:path';

import * as vscode from 'vscode';

import { classOfPath, loadDatabase, repositoryRoot, specOfPath } from './db';
import { applyAplEdits, minimalReplace, pathAt, rangeOf } from './edits';
import type { FromPanel, PanelState, ToPanel } from './protocol';
import { forgetRegistered, registeredFor } from './registered';

const VIEW_TYPE = 'wowsims-apl.editor';
const ICON_HOST = 'https://wow.zamimg.com';

// One panel per APL file; opening the editor for a file that has one reveals it.
const panels = new Map<string, vscode.WebviewPanel>();
// Sends each open panel its spec's registered spells again.
const resenders = new Map<string, () => void>();

function isApl(document: vscode.TextDocument): boolean {
	return document.uri.path.endsWith('.apl.json');
}

function html(webview: vscode.Webview, extensionUri: vscode.Uri): string {
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

function bind(panel: vscode.WebviewPanel, document: vscode.TextDocument, extensionUri: vscode.Uri): void {
	const key = document.uri.toString();
	panels.set(key, panel);
	panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'out')] };
	panel.title = `APL: ${basename(document.uri.fsPath)}`;
	panel.webview.html = html(panel.webview, extensionUri);

	const post = (message: ToPanel) => void panel.webview.postMessage(message);
	const postText = () => post({ type: 'text', text: document.getText(), version: document.version });
	// The first run compiles the sim, which takes a while; the panel lists the database until it answers.
	const postRegistered = async () => {
		post({ type: 'registered', registered: { status: 'loading' } });
		const goBinary = vscode.workspace.getConfiguration('wowsims-apl').get<string>('goBinary', 'go');
		post({ type: 'registered', registered: await registeredFor(repositoryRoot(document.uri.fsPath), specOfPath(document.uri.fsPath), goBinary) });
	};
	resenders.set(key, () => void postRegistered());

	const disposables: vscode.Disposable[] = [
		panel.webview.onDidReceiveMessage(async (message: FromPanel) => {
			switch (message.type) {
				case 'ready': {
					const root = repositoryRoot(document.uri.fsPath);
					const db = root ? loadDatabase(root) : { spells: {}, items: {} };
					post({ type: 'init', db, className: classOfPath(document.uri.fsPath), fileName: basename(document.uri.fsPath), uri: key });
					postText();
					void postRegistered();
					break;
				}
				case 'edit': {
					if (message.version !== document.version) {
						postText();
						break;
					}
					const before = document.getText();
					const replace = minimalReplace(before, applyAplEdits(before, message.edits));
					if (replace) {
						const edit = new vscode.WorkspaceEdit();
						edit.replace(document.uri, new vscode.Range(document.positionAt(replace.start), document.positionAt(replace.end)), replace.text);
						await vscode.workspace.applyEdit(edit);
					}
					break;
				}
				case 'reveal': {
					const range = rangeOf(document.getText(), message.path);
					if (!range) {
						break;
					}
					const visible = vscode.window.visibleTextEditors.find(editor => editor.document === document);
					const editor = await vscode.window.showTextDocument(document, {
						viewColumn: visible?.viewColumn ?? vscode.ViewColumn.One,
						preserveFocus: true,
					});
					const start = document.positionAt(range.start);
					editor.selection = new vscode.Selection(start, document.positionAt(range.end));
					editor.revealRange(new vscode.Range(start, start), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
					break;
				}
			}
		}),
		vscode.workspace.onDidChangeTextDocument(event => {
			if (event.document === document && event.contentChanges.length > 0) {
				postText();
			}
		}),
		vscode.window.onDidChangeTextEditorSelection(event => {
			if (event.textEditor.document === document && event.kind !== vscode.TextEditorSelectionChangeKind.Command) {
				post({ type: 'cursor', path: pathAt(document.getText(), document.offsetAt(event.selections[0].active)) });
			}
		}),
	];

	panel.onDidDispose(() => {
		panels.delete(key);
		resenders.delete(key);
		disposables.forEach(d => d.dispose());
	});
}

export function activate(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('wowsims-apl.openToSide', async (uri?: vscode.Uri) => {
			const document = uri ? await vscode.workspace.openTextDocument(uri) : vscode.window.activeTextEditor?.document;
			if (!document || !isApl(document)) {
				void vscode.window.showInformationMessage('The APL editor opens on an .apl.json file.');
				return;
			}
			const open = panels.get(document.uri.toString());
			if (open) {
				open.reveal(vscode.ViewColumn.Beside, true);
				return;
			}
			const panel = vscode.window.createWebviewPanel(VIEW_TYPE, basename(document.uri.fsPath), {
				viewColumn: vscode.ViewColumn.Beside,
				preserveFocus: true,
			});
			bind(panel, document, context.extensionUri);
		}),
		vscode.commands.registerCommand('wowsims-apl.reloadRegistered', () => {
			forgetRegistered();
			resenders.forEach(resend => resend());
		}),
		vscode.window.registerWebviewPanelSerializer(VIEW_TYPE, {
			async deserializeWebviewPanel(panel: vscode.WebviewPanel, state?: PanelState) {
				if (!state?.uri) {
					panel.dispose();
					return;
				}
				try {
					bind(panel, await vscode.workspace.openTextDocument(vscode.Uri.parse(state.uri)), context.extensionUri);
				} catch {
					panel.dispose();
				}
			},
		}),
	);
}

export function deactivate(): void {}
