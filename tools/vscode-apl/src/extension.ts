import { join } from 'node:path';

import * as vscode from 'vscode';
import { LanguageClient, TransportKind } from 'vscode-languageclient/node';

import { forgetDocument } from './host';
import { registerInsertPattern } from './insert_pattern';
import { registerPanel } from './panel';
import { registerSim } from './simulate';

// The SIML language server's client.
let client: LanguageClient | undefined;

// Starts the SIML language server (out/lsp.js) for every *.siml file, with this extension as its client.
async function startClient(context: vscode.ExtensionContext): Promise<void> {
	const server = { module: context.asAbsolutePath(join('out', 'lsp.js')), transport: TransportKind.ipc };
	client = new LanguageClient(
		'wowsims-siml',
		'WoWSims SIML',
		{ run: server, debug: server },
		{
			documentSelector: [{ language: 'siml' }],
			initializationOptions: { goBinary: vscode.workspace.getConfiguration('wowsims-apl').get<string>('goBinary', 'go') },
			synchronize: { configurationSection: 'wowsims-apl' },
		},
	);
	await client.start();
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	registerSim(context);
	registerInsertPattern(context);
	registerPanel(context);
	context.subscriptions.push(vscode.workspace.onDidCloseTextDocument(forgetDocument));
	await startClient(context);
}

export function deactivate(): Promise<void> | undefined {
	return client?.stop();
}
