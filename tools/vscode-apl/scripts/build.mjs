import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPanel, bundleExtension } from './bundle.mjs';
import { manifestText } from './manifest.mjs';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = join(source, '..', '..');
const installed = join(repository, '.vscode', 'extensions', 'wowsims-apl');
// The committed outputs, which the extension's sources decide; `--check` holds the committed build to them.
const outputs = ['package.json', 'README.md', 'language-configuration.json', join('out', 'extension.js')];
// The grammar is committed too, but written by `go run ./cmd/wowsimcli siml grammar` (the makefile's vscode-apl rule)
// and checked by that command's test.
const grammar = join('syntaxes', 'siml.tmLanguage.json');
// The panel's page also takes in the generated protos, the site's APL model and its English strings, so it is built
// here but not committed (.gitignore): a change to those needs no extension rebuild in the same commit.
const panel = [join('out', 'webview.js'), join('out', 'webview.css')];

// tsc runs through node: the `.bin` entry is a shell script on Windows, which cannot be spawned without a shell.
function typecheck(project) {
	const tsc = spawnSync(process.execPath, [join(source, 'node_modules', 'typescript', 'bin', 'tsc'), '--noEmit', '-p', join(source, project)], {
		stdio: 'inherit',
	});
	if (tsc.error) console.error(tsc.error.message);
	if (tsc.status !== 0) {
		process.exit(tsc.status ?? 1);
	}
}

async function buildInto(target) {
	typecheck('tsconfig.json');
	typecheck('tsconfig.webview.json');

	rmSync(join(target, 'out'), { recursive: true, force: true });
	mkdirSync(join(target, 'out'), { recursive: true });
	await bundleExtension(join(target, 'out', 'extension.js'));
	await buildPanel(join(target, 'out'));
	writeFileSync(join(target, 'package.json'), manifestText(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))));
	copyFileSync(join(source, 'README.md'), join(target, 'README.md'));
	copyFileSync(join(source, 'language-configuration.json'), join(target, 'language-configuration.json'));
}

function filesUnder(dir) {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter(entry => entry.isFile())
		.map(entry => relative(dir, join(entry.parentPath, entry.name)));
}

if (process.argv.includes('--check')) {
	const fresh = mkdtempSync(join(tmpdir(), 'wowsims-apl-'));
	try {
		await buildInto(fresh);
		const stale = outputs.filter(file => {
			const committed = join(installed, file);
			return !existsSync(committed) || !readFileSync(committed).equals(readFileSync(join(fresh, file)));
		});
		const extra = existsSync(installed) ? filesUnder(installed).filter(file => !outputs.includes(file) && !panel.includes(file) && file !== grammar) : [];
		if (stale.length > 0 || extra.length > 0) {
			const where = relative(process.cwd(), installed);
			for (const file of stale) {
				console.error(`${join(where, file)} is not what the build writes`);
			}
			for (const file of extra) {
				console.error(`${join(where, file)} is not a build output`);
			}
			console.error('run `make vscode-apl` and commit the result');
			process.exit(1);
		}
		console.log(`${relative(process.cwd(), installed)} matches a fresh build`);
	} finally {
		rmSync(fresh, { recursive: true, force: true });
	}
} else {
	await buildInto(installed);
	console.log(`built ${relative(process.cwd(), installed)}`);
}
