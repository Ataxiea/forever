import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

// What the panel shows for an id: the name and the icon file name from the database.
export type Named = [name: string, icon: string];

export interface AplDatabase {
	spells: Record<number, Named>;
	items: Record<number, Named>;
}

const DB_PATH = join('assets', 'database', 'db.json');

let cached: { path: string; mtimeMs: number; db: AplDatabase } | undefined;

// The repository root above an APL file: the first folder up that holds the database.
export function repositoryRoot(file: string): string | undefined {
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		if (existsSync(join(dir, DB_PATH))) {
			return dir;
		}
		if (dirname(dir) === dir) {
			return undefined;
		}
	}
}

interface IconEntry {
	id: number;
	name?: string;
	icon?: string;
}

// The spell and item names and icons from `assets/database/db.json`, read again whenever `make db` rewrites it.
export function loadDatabase(root: string): AplDatabase {
	const path = join(root, DB_PATH);
	const { mtimeMs } = statSync(path);
	if (cached?.path === path && cached.mtimeMs === mtimeMs) {
		return cached.db;
	}

	const raw = JSON.parse(readFileSync(path, 'utf8')) as { spellIcons?: IconEntry[]; itemIcons?: IconEntry[]; items?: IconEntry[] };
	const index = (entries: IconEntry[] = []) =>
		Object.fromEntries(entries.filter(entry => entry.name).map(entry => [entry.id, [entry.name!, entry.icon ?? ''] as Named]));
	const db = { spells: index(raw.spellIcons), items: { ...index(raw.itemIcons), ...index(raw.items) } };
	cached = { path, mtimeMs, db };
	return db;
}

// The class whose spec folder holds the file (`ui/specs/hunter/dps/apls/...` is a hunter's), or undefined
// for a file outside the spec folders.
export function classOfPath(file: string): string | undefined {
	return /[\\/]ui[\\/]specs[\\/]([a-z]+)[\\/]/.exec(file)?.[1];
}

// The spec folder the file sits in (`hunter/dps` for `ui/specs/hunter/dps/apls/...`), which names its
// entry in what `tools/aplspells` prints.
export function specOfPath(file: string): string | undefined {
	const match = /[\\/]ui[\\/]specs[\\/]([a-z]+)[\\/]([a-z]+)[\\/]/.exec(file);
	return match ? `${match[1]}/${match[2]}` : undefined;
}
