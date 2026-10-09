import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { manifestText } from './manifest.mjs';

const source = dirname(dirname(fileURLToPath(import.meta.url)));
const repository = join(source, '..', '..');
const installed = join(repository, '.vscode', 'extensions', 'wowsims-apl');
const schemaPath = join(repository, 'schemas', 'apl_rotation.schema.json');
const outputs = ['package.json', 'README.md', join('out', 'extension.js'), join('out', 'webview.js'), join('out', 'webview.css')];

// The site's i18n config imports its strings from a vite plugin's virtual module; the panel takes the
// English ones, which is the language the site's APL labels are written in.
const i18nLoader = {
	name: 'i18next-loader',
	setup(bundle) {
		bundle.onResolve({ filter: /^virtual:i18next-loader$/ }, args => ({ path: args.path, namespace: 'i18next-loader' }));
		bundle.onLoad({ filter: /.*/, namespace: 'i18next-loader' }, () => {
			const dir = join(repository, 'assets', 'locales', 'en');
			const en = Object.fromEntries(
				readdirSync(dir)
					.filter(file => file.endsWith('.json'))
					.sort()
					.map(file => [basename(file, '.json'), JSON.parse(readFileSync(join(dir, file), 'utf8'))]),
			);
			return { contents: `export default ${JSON.stringify({ en })};`, loader: 'js' };
		});
	},
};

// The JSON Schema `.vscode/settings.json` gives `*.apl.json` files, built from the generated protos'
// reflection so the JSON editor completes and checks field and enum names.
async function schemaText() {
	const bundled = await build({
		absWorkingDir: source,
		entryPoints: ['src/schema.ts'],
		bundle: true,
		write: false,
		platform: 'node',
		format: 'esm',
		tsconfig: join(repository, 'tsconfig.json'),
		logLevel: 'warning',
	});
	const { aplRotationSchema } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
	return `${JSON.stringify(aplRotationSchema(), null, '\t')}\n`;
}

function typecheck(project) {
	const tsc = spawnSync(join(source, 'node_modules', '.bin', 'tsc'), ['--noEmit', '-p', join(source, project)], { stdio: 'inherit' });
	if (tsc.status !== 0) {
		process.exit(tsc.status ?? 1);
	}
}

async function buildInto(target) {
	typecheck('tsconfig.json');
	typecheck('tsconfig.webview.json');

	rmSync(target, { recursive: true, force: true });
	mkdirSync(join(target, 'out'), { recursive: true });
	await build({
		absWorkingDir: source,
		entryPoints: ['src/extension.ts'],
		outfile: join(target, 'out', 'extension.js'),
		bundle: true,
		platform: 'node',
		format: 'cjs',
		target: 'node20',
		external: ['vscode'],
		// jsonc-parser's main build is UMD and requires its own files at run time, which a bundle cannot
		// follow; its ES module build bundles whole.
		mainFields: ['module', 'main'],
		minify: true,
		logLevel: 'warning',
	});
	// The webview imports the site's APL model through the repository's path aliases and packages.
	await build({
		absWorkingDir: source,
		entryPoints: { webview: 'src/webview/main.tsx' },
		outdir: join(target, 'out'),
		bundle: true,
		platform: 'browser',
		format: 'iife',
		target: 'es2022',
		tsconfig: join(repository, 'tsconfig.json'),
		jsx: 'automatic',
		plugins: [i18nLoader],
		define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
		loader: { '.svg': 'empty', '.png': 'empty', '.jpg': 'empty', '.webp': 'empty' },
		minify: true,
		legalComments: 'none',
		logLevel: 'warning',
	});
	writeFileSync(join(target, 'package.json'), manifestText(JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))));
	copyFileSync(join(source, 'README.md'), join(target, 'README.md'));
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
		if (!existsSync(schemaPath) || readFileSync(schemaPath, 'utf8') !== (await schemaText())) {
			stale.push(relative(installed, schemaPath));
		}
		const extra = existsSync(installed) ? filesUnder(installed).filter(file => !outputs.includes(file)) : [];
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
	writeFileSync(schemaPath, await schemaText());
	console.log(`built ${relative(process.cwd(), installed)} and ${relative(process.cwd(), schemaPath)}`);
}
