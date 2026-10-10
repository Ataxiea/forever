import * as vscode from 'vscode';

import { isAplSiml, readOnlyReason, spliceApl } from './apl';
import { aplDatabase } from './db';
import { documentFor, readDocument, vscodeRange } from './host';
import { pathAt } from './lang/document';
import type { JsonObject, JsonPath, RegisteredName } from './protocol';
import { registeredFor } from './registered';
import { APL_PATTERNS, type AplPattern, type AplPlaceholder, patternEdits, placementAt } from './snippets/patterns';

const SECONDS = /^-?\d+(\.\d+)?(ms|s)?$/;

interface NamePick extends vscode.QuickPickItem {
	id: RegisteredName['id'];
}

// The names a placeholder offers: the spec's spells, or its auras on the unit the pattern reads them on.
type Names = Record<'spell' | 'aura' | 'target_aura', NamePick[]>;

// The value of a placeholder, asked with its default filled in; undefined when the reader cancels, and null when an
// optional one is left out.
async function ask(placeholder: AplPlaceholder, names: Names, taken: { groups: string[]; variables: string[] }): Promise<unknown> {
	const fallback = placeholder.default === undefined ? '' : String(placeholder.default);
	const skip = placeholder.optional ? ' (Escape leaves it out)' : '';
	let answer: unknown;
	switch (placeholder.kind) {
		case 'spell':
		case 'aura':
		case 'target_aura':
			answer = (
				await vscode.window.showQuickPick(names[placeholder.kind], {
					title: `${placeholder.label}${skip}`,
					matchOnDescription: true,
					placeHolder: 'Search by name',
				})
			)?.id;
			break;
		case 'choice': {
			const options = (placeholder.options ?? []).map(option => ({ label: option, picked: option === placeholder.default }));
			const first = options.findIndex(option => option.picked);
			answer = (
				await vscode.window.showQuickPick(first > 0 ? [options[first], ...options.filter((_, i) => i !== first)] : options, {
					title: placeholder.label,
				})
			)?.label;
			break;
		}
		case 'duration':
			answer = await vscode.window.showInputBox({
				title: `${placeholder.label}${skip}`,
				value: fallback,
				validateInput: value => (SECONDS.test(value.trim()) ? undefined : 'A time such as 1.5s or 300ms'),
			});
			break;
		case 'number': {
			const value = await vscode.window.showInputBox({
				title: placeholder.label,
				value: fallback,
				validateInput: v => (v.trim() !== '' && Number.isFinite(Number(v)) ? undefined : 'A number'),
			});
			answer = value === undefined ? undefined : Number(value);
			break;
		}
		case 'group':
		case 'variable': {
			const used = placeholder.kind === 'group' ? taken.groups : taken.variables;
			if (placeholder.existing) {
				answer = await vscode.window.showQuickPick(used, { title: `${placeholder.label}${skip}` });
				break;
			}
			// A new group or variable takes a name the rotation does not have: references read the first of two.
			answer = await vscode.window.showInputBox({
				title: placeholder.label,
				value: fallback,
				validateInput: v => (!v.trim() ? 'A name' : used.includes(v) ? `The rotation has a ${placeholder.kind} named ${v} already` : undefined),
			});
			break;
		}
	}
	return answer === undefined && placeholder.optional ? null : answer;
}

// The spec's names for the pickers, each with its ActionID, tag and rank included.
function namePicks(document: vscode.TextDocument): Names {
	const read = readDocument(document);
	const registered = 'error' in read ? undefined : registeredFor(read);
	if (registered?.status !== 'ready') return { spell: [], aura: [], target_aura: [] };
	const root = 'error' in read ? undefined : read.ws.root;
	const db = root ? aplDatabase(root) : { spells: {}, items: {} };
	const picks = (entries: RegisteredName[]) =>
		entries.map(entry => ({
			label: (entry.id.spellId !== undefined && db.spells[entry.id.spellId]?.[0]) || entry.name,
			description: entry.name,
			id: entry.id,
		}));
	const { spells, auras, targetAuras } = registered.registered;
	return { spell: picks(spells), aura: picks(auras), target_aura: picks(targetAuras) };
}

// Inserts a pattern at a rotation path: after the row it is in, or onto that row's condition. The values are asked
// first; the text is read again after, and a pattern whose place the text moved meanwhile is not inserted.
export async function insertPattern(uri: vscode.Uri, path: JsonPath): Promise<void> {
	const pattern = (
		await vscode.window.showQuickPick(
			APL_PATTERNS.map(p => ({ label: p.label, detail: p.description, description: p.target, pattern: p })),
			{ title: 'Insert APL pattern', matchOnDetail: true },
		)
	)?.pattern;
	if (!pattern) return;
	const placement = placementAt(path, pattern.target);
	if (pattern.target === 'condition' && !placement.condition) {
		void vscode.window.showInformationMessage(`${pattern.label} is a condition: put the cursor on a priority or group row to add it there.`);
		return;
	}

	let document = await documentFor(uri);
	const version = document.version;
	const first = readDocument(document);
	if ('error' in first || readOnlyReason(first)) {
		void vscode.window.showWarningMessage(`Cannot insert a pattern: ${'error' in first ? first.error : readOnlyReason(first)}`);
		return;
	}
	const rotation: JsonObject = first.parse.rotation ?? {};
	const names = (list: unknown) => (Array.isArray(list) ? list.map(item => String((item as JsonObject)?.name ?? '')) : []);
	const taken = { groups: names(rotation.groups), variables: names(rotation.valueVariables) };
	const values = await askAll(pattern, namePicks(document), taken);
	if (!values) return;

	document = await documentFor(uri);
	if (document.version !== version) {
		void vscode.window.showWarningMessage('The rotation changed while the pattern was being filled in; insert it again.');
		return;
	}
	const result = spliceApl(first, patternEdits(rotation, pattern, values, placement));
	if ('error' in result) {
		void vscode.window.showWarningMessage(`The pattern was not inserted: ${result.error}.`);
		return;
	}
	const edit = new vscode.WorkspaceEdit();
	for (const e of result.edits) edit.replace(document.uri, vscodeRange(e.range), e.newText);
	await vscode.workspace.applyEdit(edit);
}

// Every placeholder's value, or undefined when the reader cancels one that is not optional.
async function askAll(pattern: AplPattern, names: Names, taken: { groups: string[]; variables: string[] }): Promise<Record<string, unknown> | undefined> {
	const values: Record<string, unknown> = {};
	for (const placeholder of pattern.placeholders) {
		const value = await ask(placeholder, names, taken);
		if (value === undefined) return undefined;
		if (value !== null && value !== '') values[placeholder.name] = value;
	}
	return values;
}

export function registerInsertPattern(context: vscode.ExtensionContext): void {
	context.subscriptions.push(
		vscode.commands.registerCommand('wowsims-apl.insertPattern', async () => {
			const editor = vscode.window.activeTextEditor;
			if (!editor || !isAplSiml(editor.document.uri.path)) return;
			const read = readDocument(editor.document);
			const path = 'error' in read ? [] : pathAt(read, editor.document.offsetAt(editor.selection.active));
			await insertPattern(editor.document.uri, path);
		}),
	);
}
