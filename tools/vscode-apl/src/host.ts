import * as vscode from 'vscode';

import { readApl, usedFiles } from './apl';
import { type Parsed, readDisk, samePath } from './lang/document';

// The open document of a file, looked up when it is needed: VS Code closes a document that no editor shows, and a
// later open gives a new one.
export async function documentFor(uri: vscode.Uri): Promise<vscode.TextDocument> {
	const key = uri.toString();
	return vscode.workspace.textDocuments.find(d => d.uri.toString() === key) ?? (await vscode.workspace.openTextDocument(uri));
}

// A file `use` names: an open editor's text, else the file on disk.
const open = (path: string) => vscode.workspace.textDocuments.find(d => d.uri.scheme === 'file' && samePath(d.uri.fsPath, path))?.getText() ?? readDisk(path);

const reads = new Map<string, { text: string; read: Parsed | { error: string } }>();

// A document's text parsed, once for each text it holds; a text with `use` lines each time, since the files it uses
// change on their own.
export function readDocument(document: vscode.TextDocument): Parsed | { error: string } {
	const key = document.uri.toString();
	const text = document.getText();
	const cached = reads.get(key);
	if (cached?.text === text) return cached.read;
	const read = readApl(document.uri.fsPath, text, open);
	if ('error' in read || usedFiles(read).length === 0) reads.set(key, { text, read });
	return read;
}

export function forgetDocument(document: vscode.TextDocument): void {
	reads.delete(document.uri.toString());
}

// A range of the SIML module, as VS Code's.
export function vscodeRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): vscode.Range {
	return new vscode.Range(range.start.line, range.start.character, range.end.line, range.end.character);
}
