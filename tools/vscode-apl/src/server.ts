import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import * as vscode from 'vscode';
import { LanguageClient, RevealOutputChannelOn } from 'vscode-languageclient/node';

import { findGo } from './go';

// The SIML language server, `wowsimcli siml lsp`, built from the repository each file sits in and started there: one
// per repository, which serves its *.siml files and answers the panel's requests about them.

const clients = new Map<string, Promise<LanguageClient>>();
const started = new vscode.EventEmitter<void>();
// Fires when a server starts, after a restart too: what was read from the one before is read again.
export const onServerStarted = started.event;

let context: vscode.ExtensionContext;
let output: vscode.LogOutputChannel;
// Cleared when the extension deactivates, after which nothing starts a server again.
let active = true;

// The repository a file is in: the nearest folder above it with sim/siml/names.json.
function repositoryRoot(file: string): string | undefined {
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		if (existsSync(join(dir, 'sim', 'siml', 'names.json'))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

// The repository a document is read in; for an untitled one, the first workspace folder's.
function rootOf(uri: vscode.Uri): string | undefined {
	if (uri.scheme === 'file') return repositoryRoot(uri.fsPath);
	for (const folder of vscode.workspace.workspaceFolders ?? []) {
		const root = repositoryRoot(join(folder.uri.fsPath, 'x'));
		if (root) return root;
	}
	return undefined;
}

const settings = () => vscode.workspace.getConfiguration('wowsims-apl');

// The server binary for a repository: the `wowsims-apl.server` setting's, or one built from the repository into the
// extension's storage. `go build` relinks nothing when the binary is up to date.
async function serverBinary(root: string): Promise<string> {
	const prebuilt = settings().get<string>('server', '');
	if (prebuilt) return prebuilt;
	const go = findGo(settings().get<string>('goBinary', 'go'));
	if (!go) throw new Error('No go binary was found to build the SIML server; set wowsims-apl.goBinary.');
	const hash = createHash('sha256').update(root).digest('hex').slice(0, 16);
	const binary = join(vscode.Uri.joinPath(context.globalStorageUri, hash).fsPath, process.platform === 'win32' ? 'wowsimcli.exe' : 'wowsimcli');
	await vscode.window.withProgress(
		{ location: vscode.ProgressLocation.Notification, title: 'Building the SIML server' },
		() =>
			new Promise<void>((resolve, reject) =>
				execFile(go, ['build', '--tags=with_db', '-o', binary, './cmd/wowsimcli'], { cwd: root, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
					if (!error) return resolve();
					output.error(`go build --tags=with_db -o ${binary} ./cmd/wowsimcli in ${root}\n${stdout}${stderr || error.message}`);
					output.show(true);
					reject(
						new Error(
							`The SIML server did not build in ${root}: the WoWSims SIML output has the compiler's errors. Run WoWSims: Restart SIML Server once they are fixed.`,
						),
					);
				}),
			),
	);
	return binary;
}

async function start(root: string): Promise<LanguageClient> {
	const command = await serverBinary(root);
	const client = new LanguageClient(
		'wowsims-siml',
		'WoWSims SIML',
		{ command, args: ['siml', 'lsp'], options: { cwd: root } },
		{
			documentSelector: [
				{ scheme: 'file', language: 'siml', pattern: { baseUri: vscode.Uri.file(root).toString(), pattern: '**/*' } },
				// Untitled files are read in the first workspace folder's repository, as the server reads them.
				...(rootOf(vscode.Uri.parse('untitled:x')) === root ? [{ scheme: 'untitled', language: 'siml' }] : []),
			],
			initializationOptions: { goBinary: settings().get<string>('goBinary', 'go') },
			synchronize: { configurationSection: 'wowsims-apl' },
			outputChannel: output,
			revealOutputChannelOn: RevealOutputChannelOn.Never,
		},
	);
	await client.start();
	started.fire();
	return client;
}

// The server of the repository a document is in, built and started on first use. Rejects with a message for the
// reader when the document is in no repository or the server does not build or start; a failed start stays failed
// until WoWSims: Restart SIML Server.
export function serverFor(uri: vscode.Uri): Promise<LanguageClient> {
	const root = rootOf(uri);
	if (!active) return Promise.reject(new Error('The extension is stopping.'));
	if (!root) return Promise.reject(new Error('The file is not in a WoWSims repository: no sim/siml/names.json above it.'));
	let client = clients.get(root);
	if (!client) {
		client = start(root);
		clients.set(root, client);
		client.catch(e => void vscode.window.showErrorMessage((e as Error).message));
	}
	return client;
}

// Sends one of the server's requests about a document; `token` cancels it.
export async function request<R>(uri: vscode.Uri, method: string, params: object, token?: vscode.CancellationToken): Promise<R> {
	const client = await serverFor(uri);
	return token ? client.sendRequest<R>(method, params, token) : client.sendRequest<R>(method, params);
}

// Stops every server, which ends the sims they run; with `last`, for good.
export async function stopServers(last = false): Promise<void> {
	active &&= !last;
	const running = [...clients.values()];
	clients.clear();
	await Promise.all(running.map(client => client.then(c => c.stop()).catch(() => undefined)));
}

function served(document: vscode.TextDocument): void {
	if (document.languageId === 'siml' && (document.uri.scheme === 'file' || document.uri.scheme === 'untitled'))
		serverFor(document.uri).catch(() => undefined);
}

export function registerServer(extensionContext: vscode.ExtensionContext): void {
	context = extensionContext;
	output = vscode.window.createOutputChannel('WoWSims SIML', { log: true });
	context.subscriptions.push(
		output,
		started,
		vscode.workspace.onDidOpenTextDocument(served),
		vscode.commands.registerCommand('wowsims-apl.restartServer', async () => {
			const roots = [...clients.keys()];
			await stopServers();
			for (const document of vscode.workspace.textDocuments) served(document);
			await Promise.all(roots.map(root => serverFor(vscode.Uri.file(join(root, 'x'))).catch(() => undefined)));
		}),
	);
	vscode.workspace.textDocuments.forEach(served);
}
