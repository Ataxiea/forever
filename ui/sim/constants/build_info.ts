import { REPO_URL } from './other';

// The release this page was built as. vite.config.mts defines the values at build time
// (tools/vite/build_info.mts); a build that cannot read one leaves it empty.
export interface BuildInfo {
	/** The UTC date of the build, as YYYY-MM-DD. */
	date: string;
	/** The full hash of the commit built. */
	commit: string;
	/** The newest game build the sim's data is taken from, such as 1.60.1.70450. */
	gameVersion: string;
}

export const BUILD_INFO: BuildInfo = {
	date: import.meta.env.VITE_BUILD_DATE ?? '',
	commit: import.meta.env.VITE_BUILD_COMMIT ?? '',
	gameVersion: import.meta.env.VITE_GAME_VERSION ?? '',
};

export const commitUrl = (commit: string): string => `${REPO_URL}/commit/${commit}`;
