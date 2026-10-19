import { ISSUES_REPO, REPO_NAME, REPO_URL } from './other';

// The release this page was built as. vite.config.mts defines the values at build time
// (tools/vite/build_info.mts); a build that cannot read one leaves it empty.
export interface BuildInfo {
	/** The UTC date of the build, as YYYY-MM-DD. */
	date: string;
	/** The full hash of the commit built, or empty. */
	commit: string;
	/** The newest game build the sim's data is taken from, such as 1.60.1.70450, or empty. */
	gameVersion: string;
}

/** The game build and hotfix push one part of the spell store was generated from. */
export interface SpellDataVersion {
	build: string;
	hotfix: number;
}

/** The last commit that changed a spec's presets. */
export interface SpecVersion {
	commit: string;
	/** The commit's date, as YYYY-MM-DD. */
	date: string;
}

export const BUILD_INFO: BuildInfo = {
	date: import.meta.env.VITE_BUILD_DATE ?? '',
	commit: import.meta.env.VITE_BUILD_COMMIT ?? '',
	gameVersion: import.meta.env.VITE_GAME_VERSION ?? '',
};

// Keyed by part: each class, `items`, `racials` and `shared`, as the spell store stamps them.
const SPELL_DATA: Readonly<Record<string, SpellDataVersion>> = import.meta.env.VITE_SPELL_DATA ?? {};
// Keyed `<class>/<spec>`; a build made from a shallow clone carries none.
const SPEC_VERSIONS: Readonly<Record<string, SpecVersion>> = import.meta.env.VITE_SPEC_VERSIONS ?? {};

const specKey = (simLink: string): string => simLink.replace(new RegExp(`^/${REPO_NAME}/`), '').replace(/\/$/, '');

/** The last preset change of the spec whose page is at `simLink` (`/forever/<class>/<spec>/`), if the build read it. */
export const specVersion = (simLink: string): SpecVersion | undefined => SPEC_VERSIONS[specKey(simLink)];

/** The spell data parts a spec's sim reads, in the order the page lists them: its class, racials, items and shared. */
export const specSpellData = (simLink: string): { part: string; version: SpellDataVersion }[] =>
	[specKey(simLink).split('/')[0], 'racials', 'items', 'shared'].flatMap(part => (SPELL_DATA[part] ? [{ part, version: SPELL_DATA[part] }] : []));

// The repository whose CI built the page, as for the issue links, so a fork's build links its own commit.
export const commitUrl = (commit: string): string => `${ISSUES_REPO ? `https://github.com/${ISSUES_REPO}` : REPO_URL}/commit/${commit}`;
