// The release a build is: the commit it is built from, the UTC date it is built on, and the game build of
// the data it carries. vite.config.mts defines them into the page, so every build, the deploy's included,
// states its own release with nothing written into the source tree.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface BuildInfo {
	/** The UTC date of the build, as YYYY-MM-DD. */
	date: string;
	/** The full hash of the commit built, or empty when neither git nor GITHUB_SHA names it. */
	commit: string;
	/** The newest game build the spell store was generated from, such as 1.60.1.70450, or empty. */
	gameVersion: string;
}

export const readBuildInfo = (root: string): BuildInfo => ({
	date: new Date().toISOString().slice(0, 10),
	commit: gitCommit(root),
	gameVersion: gameVersion(root),
});

// The deploy checks out the commit it builds, so git names it; GITHUB_SHA covers a tree without .git.
const gitCommit = (root: string): string => {
	try {
		return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
			.toString()
			.trim();
	} catch {
		return process.env.GITHUB_SHA ?? '';
	}
};

// assets/db_inputs/spell_store_inputs.json is gzipped despite its name. Its Builds map names the game
// build each part of the store was taken from; the newest is the build the data is current to.
const gameVersion = (root: string): string => {
	try {
		const inputs = JSON.parse(gunzipSync(readFileSync(path.join(root, 'assets/db_inputs/spell_store_inputs.json'))).toString());
		const builds = Object.values<string>(inputs.Builds ?? {});
		return builds.sort(compareBuilds).at(-1) ?? '';
	} catch {
		return '';
	}
};

const compareBuilds = (a: string, b: string): number => {
	const left = a.split('.').map(Number);
	const right = b.split('.').map(Number);
	for (let i = 0; i < Math.max(left.length, right.length); i++) {
		const difference = (left[i] ?? 0) - (right[i] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
};
