import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import type { Registered, RegisteredSpec } from './protocol';

type AllSpecs = Record<string, RegisteredSpec | { error: string }>;

// VS Code started from a desktop launcher or a WSL/remote server does not read the shell profile, so a Go
// install the terminal finds is often missing from its PATH.
export function findGo(configured: string): string | undefined {
	if (configured !== 'go') {
		return configured;
	}
	const exe = process.platform === 'win32' ? 'go.exe' : 'go';
	const candidates = [
		...(process.env.PATH ?? '').split(delimiter).map(dir => join(dir, exe)),
		...(process.env.GOROOT ? [join(process.env.GOROOT, 'bin', exe)] : []),
		'/usr/local/go/bin/go',
		'/usr/lib/go/bin/go',
		'/opt/homebrew/bin/go',
		join(homedir(), 'go', 'bin', exe),
		'C:\\Program Files\\Go\\bin\\go.exe',
	];
	return candidates.find(path => path !== exe && isFile(path));
}

function isFile(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

// One run of `tools/aplspells` per repository, shared by every panel until the cache is dropped.
const runs = new Map<string, Promise<AllSpecs>>();

function run(root: string, go: string): Promise<AllSpecs> {
	return new Promise((resolve, reject) => {
		execFile(go, ['run', '--tags=with_db', './tools/aplspells'], { cwd: root, maxBuffer: 64 << 20 }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(stderr.trim().split('\n').slice(-3).join('\n') || error.message));
				return;
			}
			try {
				resolve(JSON.parse(stdout) as AllSpecs);
			} catch (e) {
				reject(e as Error);
			}
		});
	});
}

export function forgetRegistered(): void {
	runs.clear();
}

export async function registeredFor(root: string | undefined, spec: string | undefined, goSetting: string): Promise<Registered> {
	if (!root || !spec) {
		return { status: 'unavailable', reason: 'the file is not in a spec folder under ui/specs' };
	}
	const go = findGo(goSetting);
	if (!go) {
		return { status: 'unavailable', reason: 'no go binary found; set wowsims-apl.goBinary' };
	}
	let all = runs.get(root);
	if (!all) {
		all = run(root, go);
		runs.set(root, all);
		// A failed run is not kept, so the next panel tries again.
		all.catch(() => runs.delete(root));
	}
	try {
		const entry = (await all)[spec];
		if (!entry) {
			return { status: 'unavailable', reason: `the sim has no spec for ${spec}` };
		}
		if ('error' in entry) {
			return { status: 'unavailable', reason: `the sim cannot build ${spec} yet (${entry.error})` };
		}
		return { status: 'ready', spec, registered: entry };
	} catch (e) {
		return { status: 'unavailable', reason: `tools/aplspells failed: ${(e as Error).message}` };
	}
}
