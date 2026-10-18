// The release a build is: the commit it is built from, the UTC date it is built on, the game build of
// the data it carries, and the last commit that changed each spec. vite.config.mts defines them into the
// page, so every build, the deploy's included, states its own release with nothing written into the
// source tree.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

export interface SpecVersion {
	/** The full hash of the last commit that changed the spec. */
	commit: string;
	/** That commit's date, as YYYY-MM-DD. */
	date: string;
}

export interface BuildInfo {
	/** The UTC date of the build, as YYYY-MM-DD. */
	date: string;
	/** The full hash of the commit built, or empty when nothing names it. */
	commit: string;
	/** The newest game build the spell store was generated from, such as 1.60.1.70450, or empty. */
	gameVersion: string;
	/** Each spec's last change, keyed `<class>/<spec>` as its page path is; empty in a shallow clone. */
	specs: Record<string, SpecVersion>;
}

export const readBuildInfo = (root: string): BuildInfo => ({
	date: new Date().toISOString().slice(0, 10),
	commit: buildCommit(root),
	gameVersion: gameVersion(root),
	specs: specVersions(root),
});

const git = (root: string, args: string[]): string =>
	execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
		.toString()
		.trim();

// BUILD_COMMIT names the commit when the checkout is not it: a pull request's checkout is the merge
// commit, and its preview names the head. Otherwise git names the checkout; GITHUB_SHA covers a tree
// without .git.
const buildCommit = (root: string): string => {
	if (process.env.BUILD_COMMIT) {
		return process.env.BUILD_COMMIT;
	}
	try {
		return git(root, ['rev-parse', 'HEAD']);
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

// A spec's version is the last change to its presets (presets.ts and the apls, gear_sets and builds
// folders in ui/specs/<class>/<spec>) or its sim code and expected results (the class's own files in
// sim/<class>, plus sim/<class>/<spec> when the spec has a sim folder). Its page's other UI and the class's
// shared UI do not count. The log starts at the commit the release names, so a pull request's preview
// never names its merge commit. A shallow clone has no history to read, so it reports no spec at all
// rather than its one commit for every spec.
const specVersions = (root: string): Record<string, SpecVersion> => {
	try {
		if (git(root, ['rev-parse', '--is-shallow-repository']) === 'true') {
			return {};
		}
	} catch {
		return {};
	}
	const specs: Record<string, SpecVersion> = {};
	const specsDir = path.join(root, 'ui/specs');
	const folders = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true })
			.filter(entry => entry.isDirectory())
			.map(entry => entry.name);
	for (const className of folders(specsDir)) {
		const classDir = path.join(specsDir, className);
		for (const specName of folders(classDir)) {
			const specDir = path.join(classDir, specName);
			if (!existsSync(path.join(specDir, 'spec.ts')) && !existsSync(path.join(specDir, 'spec.tsx'))) {
				continue;
			}
			const sim = [`:(glob)sim/${className}/*`, ...(existsSync(path.join(root, 'sim', className, specName)) ? [`sim/${className}/${specName}`] : [])];
			const presets = ['presets.ts', 'apls', 'gear_sets', 'builds'].map(name => `ui/specs/${className}/${specName}/${name}`);
			const paths = [...presets, ...sim];
			try {
				const [commit, date] = git(root, ['log', '-1', '--format=%H %cs', process.env.BUILD_COMMIT || 'HEAD', '--', ...paths]).split(' ');
				if (commit) {
					specs[`${className}/${specName}`] = { commit, date };
				}
			} catch {
				// A spec git cannot read is left out.
			}
		}
	}
	return specs;
};
