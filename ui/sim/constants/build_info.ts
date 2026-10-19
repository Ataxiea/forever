import type { BuildInfo, SpecRelease } from '../../../tools/vite/build_info.mjs';
import { ISSUES_REPO, REPO_NAME, REPO_URL } from './other';

export type { BuildInfo, Change, SpecRelease } from '../../../tools/vite/build_info.mjs';

// The release this page was built as. vite.config.mts defines it at build time (tools/vite/build_info.mts,
// which owns the types); a build that cannot read a value leaves it empty.
export const BUILD_INFO: BuildInfo = import.meta.env.VITE_BUILD_INFO ?? { date: '', commit: '', gameVersion: '', specs: {} };

/** The release of the spec whose page is at `simLink` (`/forever/<class>/<spec>/`). */
export const specRelease = (simLink: string): SpecRelease => BUILD_INFO.specs[simLink.replace(new RegExp(`^/${REPO_NAME}/`), '').replace(/\/$/, '')] ?? {};

// The repository whose CI built the page, as for the issue links, so a fork's build links its own commit.
export const commitUrl = (commit: string): string => `${ISSUES_REPO ? `https://github.com/${ISSUES_REPO}` : REPO_URL}/commit/${commit}`;
