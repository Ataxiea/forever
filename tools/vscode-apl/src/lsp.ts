// The SIML language server: diagnostics, completion, hover, navigation, rename, outline, folding, semantic tokens,
// formatting and code actions for every *.siml file, over stdio (`node out/lsp.js --stdio`) or the transport the
// client passes. It reads the schema, the name table and the database from the repository the file sits in.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	CodeActionKind,
	createConnection,
	type Diagnostic,
	DiagnosticSeverity,
	DidChangeWatchedFilesNotification,
	ErrorCodes,
	ProposedFeatures,
	ResponseError,
	TextDocuments,
	TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { findGo } from './go';
import { codeActions } from './lang/actions';
import { complete } from './lang/complete';
import { DATABASE_FILES } from './lang/database';
import { diagnose } from './lang/diagnostics';
import { type Parsed, parseText, readDisk, samePath } from './lang/document';
import { formatting } from './lang/format';
import { hover } from './lang/hover';
import { LEGEND, semanticTokens } from './lang/semantic';
import { definition, documentLinks, documentSymbols, foldingRanges, prepareRename, references, rename } from './lang/symbols';
import { loadWorkspace, repositoryRoot, SCHEMA_FILE, TABLE_FILE, type Workspace } from './lang/workspace';

const TRIGGERS = [' ', '(', '.', '"', '$', '%', ',', '=', '[', '+'];

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
let goBinary = 'go';
let fallbackRoot: string | undefined;
let watchesFiles = false;

const pathOf = (uri: string) => {
	try {
		return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
	} catch {
		return undefined;
	}
};
// A file that ends in .siml, or a document in the siml language, such as one not saved yet.
const isSiml = (uri: string, languageId = documents.get(uri)?.languageId) => /\.siml$/.test(uri) || languageId === 'siml';

function workspaceOf(path: string | undefined): Workspace | { error: string } {
	const root = (path && repositoryRoot(path)) || fallbackRoot;
	return root ? loadWorkspace(root) : { error: 'the file is not in a WoWSims repository: no sim/siml/names.json above it' };
}

// An open editor's text for a file `use` names, else the file on disk.
const open = (path: string) =>
	documents
		.all()
		.find(d => samePath(pathOf(d.uri) ?? '', path))
		?.getText() ?? readDisk(path);

// A parse is kept while the document's version and the workspace hold: loadWorkspace reads the schema and the table
// again when either changes on disk.
const parses = new Map<string, { version: number; ws: Workspace | { error: string }; parsed: Parsed | { error: string } }>();

function parsed(uri: string): Parsed | { error: string } | undefined {
	const document = documents.get(uri);
	if (!document || !isSiml(uri)) return undefined;
	const path = pathOf(uri) ?? '';
	const ws = workspaceOf(path);
	const cached = parses.get(uri);
	if (cached?.version === document.version && cached.ws === ws) return cached.parsed;
	const result = 'error' in ws ? ws : parseText(ws, path, document.getText(), open);
	parses.set(uri, { version: document.version, ws, parsed: result });
	return result;
}

function withParsed<T>(uri: string, fallback: T, run: (p: Parsed) => T): T {
	const p = parsed(uri);
	return p && !('error' in p) ? run(p) : fallback;
}

function validate(uri: string): void {
	const p = parsed(uri);
	if (!p) return;
	const diagnostics: Diagnostic[] =
		'error' in p
			? [
					{
						range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
						severity: DiagnosticSeverity.Error,
						source: 'siml',
						message: p.error,
					},
				]
			: diagnose(p);
	void connection.sendDiagnostics({ uri, diagnostics });
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

// Checks a changed file soon, and the other open files after it, read again, since a file they use may be the one that
// changed. With no file, a file on disk changed, and every open file is checked again.
function schedule(uri?: string): void {
	for (const other of documents.keys()) {
		if (!isSiml(other)) continue;
		clearTimeout(timers.get(other));
		timers.set(
			other,
			setTimeout(
				() => {
					if (other !== uri) parses.delete(other);
					validate(other);
				},
				other === uri ? 150 : 400,
			),
		);
	}
}

// The game files' row of each spell, once per repository and id.
const cards = new Map<string, Promise<string | undefined>>();

function spellCard(root: string, spellId: number): Promise<string | undefined> {
	const key = `${root}|${spellId}`;
	let card = cards.get(key);
	if (!card) {
		const go = findGo(goBinary);
		card = go
			? new Promise(resolve =>
					execFile(go, ['run', './tools/spelldata', String(spellId)], { cwd: root, timeout: 60000 }, (error, stdout) =>
						resolve(error ? undefined : stdout.trim()),
					),
				)
			: Promise.resolve(undefined);
		cards.set(key, card);
	}
	return card;
}

connection.onInitialize(params => {
	const options = params.initializationOptions as { goBinary?: string } | undefined;
	goBinary = options?.goBinary ?? goBinary;
	const folder = params.workspaceFolders?.[0]?.uri ?? params.rootUri ?? undefined;
	const folderPath = folder ? pathOf(folder) : undefined;
	fallbackRoot = folderPath && existsSync(join(folderPath, TABLE_FILE)) ? folderPath : undefined;
	watchesFiles = params.capabilities.workspace?.didChangeWatchedFiles?.dynamicRegistration === true;
	return {
		capabilities: {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: { triggerCharacters: TRIGGERS },
			hoverProvider: true,
			definitionProvider: true,
			referencesProvider: true,
			renameProvider: { prepareProvider: true },
			documentSymbolProvider: true,
			foldingRangeProvider: true,
			semanticTokensProvider: { legend: LEGEND, full: true },
			documentFormattingProvider: true,
			codeActionProvider: { codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.RefactorRewrite] },
			documentLinkProvider: { resolveProvider: false },
		},
		serverInfo: { name: 'wowsims-siml' },
	};
});

// The files every check reads from the repository: when the editor reports a change to one, such as a `make
// sim/siml/names.json`, the open files are checked again.
connection.onInitialized(() => {
	if (!watchesFiles) return;
	void connection.client.register(DidChangeWatchedFilesNotification.type, {
		watchers: [SCHEMA_FILE, TABLE_FILE, ...DATABASE_FILES].map(file => ({ globPattern: `**/${file.split(/[\\/]/).join('/')}` })),
	});
});
connection.onDidChangeWatchedFiles(() => schedule());

connection.onDidChangeConfiguration(change => {
	const settings = (change.settings as { 'wowsims-apl'?: { goBinary?: string } } | undefined)?.['wowsims-apl'];
	if (settings?.goBinary) goBinary = settings.goBinary;
});

documents.onDidOpen(event => schedule(event.document.uri));
documents.onDidChangeContent(event => schedule(event.document.uri));
// A file closed unsaved is read from disk again by the open files that use it.
documents.onDidClose(event => {
	const { uri, languageId } = event.document;
	clearTimeout(timers.get(uri));
	parses.delete(uri);
	if (!isSiml(uri, languageId)) return;
	void connection.sendDiagnostics({ uri, diagnostics: [] });
	schedule(uri);
});

connection.onCompletion(params => withParsed(params.textDocument.uri, [], p => complete(p, params.position)));
connection.onHover(params => withParsed(params.textDocument.uri, undefined, p => hover(p, params.position, id => spellCard(p.ws.root, id))));
connection.onDefinition(params => withParsed(params.textDocument.uri, [], p => definition(p, params.textDocument.uri, params.position)));
connection.onReferences(params =>
	withParsed(params.textDocument.uri, [], p => references(p, params.textDocument.uri, params.position, params.context.includeDeclaration)),
);
connection.onPrepareRename(params =>
	withParsed(params.textDocument.uri, null, p => {
		const result = prepareRename(p, params.position);
		return 'error' in result ? new ResponseError(ErrorCodes.InvalidRequest, result.error) : result;
	}),
);
connection.onRenameRequest(params =>
	withParsed(params.textDocument.uri, null, p => {
		const result = rename(p, params.textDocument.uri, params.position, params.newName);
		return result && 'error' in result ? new ResponseError(ErrorCodes.InvalidRequest, result.error) : (result ?? null);
	}),
);
connection.onDocumentSymbol(params => withParsed(params.textDocument.uri, [], documentSymbols));
connection.onFoldingRanges(params => withParsed(params.textDocument.uri, [], foldingRanges));
connection.languages.semanticTokens.on(params => withParsed(params.textDocument.uri, { data: [] }, semanticTokens));
connection.onDocumentFormatting(params => withParsed(params.textDocument.uri, [], formatting));

connection.onCodeAction(params =>
	withParsed(params.textDocument.uri, [], p => codeActions(p, params.textDocument.uri, params.range, params.context.diagnostics)),
);
connection.onDocumentLinks(params => withParsed(params.textDocument.uri, [], documentLinks));

documents.listen(connection);
connection.listen();
