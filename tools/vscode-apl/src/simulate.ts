import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { basename, relative, sep } from 'node:path';

import * as vscode from 'vscode';

import { isAplSiml, rowLine, usedFiles } from './apl';
import { readDocument } from './host';
import { samePath } from './lang/document';
import { deadRows, runSim, type SimResult } from './sim/tool';

// The last sim of each rotation file, with the document version it ran against.
export interface SimRecord {
	result: SimResult;
	version: number;
	// What the compare's base was, when the run was a compare.
	baseline?: 'saved' | 'HEAD';
}

const records = new Map<string, SimRecord>();
const listeners = new Set<(uri: string, record: SimRecord | undefined) => void>();

export function simRecord(uri: string): SimRecord | undefined {
	return records.get(uri);
}

export function onSimRecord(listener: (uri: string, record: SimRecord | undefined) => void): vscode.Disposable {
	listeners.add(listener);
	return { dispose: () => listeners.delete(listener) };
}

function setRecord(uri: string, record: SimRecord): void {
	records.set(uri, record);
	listeners.forEach(listener => listener(uri, record));
}

let decorations: { counts: vscode.TextEditorDecorationType; dead: vscode.TextEditorDecorationType };

function format(executions: number): string {
	return executions >= 10 ? executions.toFixed(0) : executions.toFixed(executions >= 1 ? 1 : 2);
}

// The count after each row's line and the never-ran marker after each row the sim never ran, while the editor's text
// is the version that was simmed. Rows of a used file have no line here.
function decorate(editor: vscode.TextEditor): void {
	const { document } = editor;
	if (!isAplSiml(document.uri.path)) return;
	const record = records.get(document.uri.toString());
	const ran: vscode.DecorationOptions[] = [];
	const never: vscode.DecorationOptions[] = [];
	const read = record?.version === document.version ? readDocument(document) : undefined;
	if (record && read && !('error' in read)) {
		const run = record.result.compare ?? record.result;
		const dead = new Set(deadRows(run));
		for (const [key, stats] of Object.entries(run.rows)) {
			const line = stats.hidden ? undefined : rowLine(read, key);
			if (line === undefined) continue;
			const range = new vscode.Range(line, Number.MAX_SAFE_INTEGER, line, Number.MAX_SAFE_INTEGER);
			if (dead.has(key)) never.push({ range, renderOptions: { after: { contentText: 'never ran' } } });
			else ran.push({ range, renderOptions: { after: { contentText: `▸ ${format(stats.executions)} per fight` } } });
		}
	}
	editor.setDecorations(decorations.counts, ran);
	editor.setDecorations(decorations.dead, never);
}

function git(root: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) =>
		execFile('git', args, { cwd: root, maxBuffer: 16 << 20 }, (error, stdout) => (error ? reject(error) : resolve(stdout))),
	);
}

// Sims the editor's text of an .apl.siml. A compare sims the saved file, or HEAD when nothing is unsaved, as the base,
// and the editor's text against it on the same seed.
async function simulate(document: vscode.TextDocument, compare: boolean): Promise<void> {
	const text = document.getText();
	const version = document.version;
	const read = readDocument(document);
	if (!isAplSiml(document.uri.path) || 'error' in read) {
		void vscode.window.showWarningMessage(`The sim runs an .apl.siml rotation in a WoWSims repository${'error' in read ? `: ${read.error}` : '.'}`);
		return;
	}
	const error = read.parse.diagnostics.find(d => d.severity === 'error');
	if (error) {
		void vscode.window.showWarningMessage(`The rotation does not read (line ${error.range.start.line + 1}: ${error.message}); fix it before simming it.`);
		return;
	}
	const used = usedFiles(read);
	const unsaved = vscode.workspace.textDocuments.find(d => d.isDirty && d.uri.scheme === 'file' && used.some(path => samePath(path, d.uri.fsPath)));
	if (unsaved) {
		void vscode.window.showWarningMessage(`${basename(unsaved.uri.fsPath)} has unsaved changes; the sim reads it from disk. Save it first.`);
		return;
	}
	const root = read.ws.root;
	const file = relative(root, document.uri.fsPath).split(sep).join('/');

	let base: string | undefined;
	let baseline: SimRecord['baseline'];
	if (compare) {
		try {
			baseline = document.isDirty ? 'saved' : 'HEAD';
			base = document.isDirty ? await readFile(document.uri.fsPath, 'utf8') : await git(root, ['show', `HEAD:${file}`]);
		} catch (e) {
			void vscode.window.showWarningMessage(`Nothing to compare with: ${(e as Error).message.split('\n')[0]}`);
			return;
		}
	}

	const config = vscode.workspace.getConfiguration('wowsims-apl');
	const spec = read.parse.spec ?? '';
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: compare ? `Comparing ${spec} with ${baseline}` : `Simming ${spec}`, cancellable: true },
		async (_, token) => {
			const controller = new AbortController();
			token.onCancellationRequested(() => controller.abort());
			try {
				const result = await runSim(
					root,
					config.get<string>('goBinary', 'go'),
					{
						siml: base ?? text,
						path: file,
						compare: base === undefined ? undefined : { siml: text },
						settingsFile: config.get<string>('simSettingsFile') || undefined,
						iterations: config.get<number>('simIterations', 1000),
						timeline: true,
					},
					controller.signal,
				);
				setRecord(document.uri.toString(), { result, version, baseline });
				vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === document.uri.toString()).forEach(decorate);
				const run = result.compare ?? result;
				const summary = result.difference
					? `${run.dps.mean.toFixed(1)} DPS, ${result.difference.delta >= 0 ? '+' : ''}${result.difference.delta.toFixed(1)} (${result.difference.percent.toFixed(2)}%) against ${baseline}${result.difference.significant ? '' : ', within noise'}`
					: `${run.dps.mean.toFixed(1)} DPS ± ${(run.dps.stdev / Math.sqrt(run.iterations)).toFixed(1)}`;
				void vscode.window.setStatusBarMessage(`$(pulse) ${spec}: ${summary}`, 30000);
				if (result.character.warnings?.length) void vscode.window.showWarningMessage(`Sim character: ${result.character.warnings.join('; ')}`);
			} catch (e) {
				if ((e as Error).name !== 'AbortError') void vscode.window.showErrorMessage(`Sim failed: ${(e as Error).message}`);
			}
		},
	);
}

export function registerSim(context: vscode.ExtensionContext): void {
	decorations = {
		counts: vscode.window.createTextEditorDecorationType({
			after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground'), fontStyle: 'italic' },
		}),
		dead: vscode.window.createTextEditorDecorationType({
			after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorWarning.foreground'), fontStyle: 'italic' },
		}),
	};
	const target = (uri?: vscode.Uri) => (uri ? vscode.workspace.openTextDocument(uri) : Promise.resolve(vscode.window.activeTextEditor?.document));
	context.subscriptions.push(
		decorations.counts,
		decorations.dead,
		vscode.commands.registerCommand('wowsims-apl.sim', async (uri?: vscode.Uri) => {
			const document = await target(uri);
			if (document) await simulate(document, false);
		}),
		vscode.commands.registerCommand('wowsims-apl.compare', async (uri?: vscode.Uri) => {
			const document = await target(uri);
			if (document) await simulate(document, true);
		}),
		vscode.window.onDidChangeVisibleTextEditors(editors => editors.forEach(decorate)),
		vscode.workspace.onDidChangeTextDocument(event => {
			const key = event.document.uri.toString();
			if (!records.has(key) || event.contentChanges.length === 0) return;
			vscode.window.visibleTextEditors.filter(editor => editor.document.uri.toString() === key).forEach(decorate);
		}),
	);
}

// Run by the panel: the same commands for the file the panel shows.
export function simDocument(document: vscode.TextDocument, compare: boolean): Promise<void> {
	return simulate(document, compare);
}
