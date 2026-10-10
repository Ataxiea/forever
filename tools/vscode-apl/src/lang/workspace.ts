import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

import { createSiml, indexSchema, Names, type NameTable, type SchemaIndex, type Siml, type SimlSchema, type SpellName, type SpellNamespace } from './siml.ts';

// The two files every service reads at run time from the repository, never from the bundle: the schema the protos
// derive (`make ui/generated/siml/schema.json`) and the name table (`make sim/siml/names.json`).
export const SCHEMA_FILE = join('ui', 'generated', 'siml', 'schema.json');
export const TABLE_FILE = join('sim', 'siml', 'names.json');

export interface Workspace {
	root: string;
	schema: SimlSchema;
	index: SchemaIndex;
	table: NameTable;
	names: Names;
	siml: Siml;
}

// The repository root above a file: the first folder up that holds the name table.
export function repositoryRoot(file: string): string | undefined {
	for (let dir = dirname(file); ; dir = dirname(dir)) {
		if (existsSync(join(dir, TABLE_FILE))) return dir;
		if (dirname(dir) === dir) return undefined;
	}
}

const loaded = new Map<string, { stamp: string; workspace: Workspace | { error: string } }>();

function stampOf(path: string): string {
	try {
		const { mtimeMs, size } = statSync(path);
		return `${mtimeMs}:${size}`;
	} catch {
		return 'missing';
	}
}

// The schema and table of the repository at `root`, read again whenever either file changes, or why they cannot be
// read.
export function loadWorkspace(root: string): Workspace | { error: string } {
	const schemaPath = join(root, SCHEMA_FILE);
	const tablePath = join(root, TABLE_FILE);
	const stamp = `${stampOf(schemaPath)}|${stampOf(tablePath)}`;
	const cached = loaded.get(root);
	if (cached?.stamp === stamp) return cached.workspace;
	let workspace: Workspace | { error: string };
	if (!existsSync(schemaPath)) {
		workspace = { error: `${SCHEMA_FILE.split(sep).join('/')} is missing: run make ui/generated/siml/schema.json` };
	} else {
		try {
			const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as SimlSchema;
			const table = JSON.parse(readFileSync(tablePath, 'utf8')) as NameTable;
			const index = indexSchema(schema);
			workspace = { root, schema, index, table, names: new Names(index, table), siml: createSiml(schema, table) };
		} catch (e) {
			workspace = { error: (e as Error).message };
		}
	}
	loaded.set(root, { stamp, workspace });
	return workspace;
}

// Whether a file lies under ui/specs, where the repository's files sit: warnings are errors there, and a raw ref is
// reported (SPEC.md §7.3, §13).
export function inSpecs(root: string, file: string): boolean {
	const parts = relative(root, file).split(/[\\/]/);
	return parts[0] === 'ui' && parts[1] === 'specs';
}

export interface NamedEntry {
	name: string;
	entry: SpellName;
	shared: boolean; // A shared entry: a spell or aura that gear, consumables or encounters add (SPEC.md §7.1).
}

// The names of a spell-like namespace a file of class `cls` reads (the class's own, then the shared ones it does not
// hide) that a build of `spec` registers; with no spec, those any build registers.
export function registeredNames(table: NameTable, cls: string | undefined, spec: string | undefined, ns: SpellNamespace): NamedEntry[] {
	const own = (cls !== undefined && table.classes?.[cls]?.[ns]) || {};
	const shared = table.shared?.[ns] ?? {};
	const out: NamedEntry[] = [];
	const registered = (entry: SpellName) => (spec === undefined ? entry.registeredBy.length > 0 : entry.registeredBy.includes(spec));
	const ownNames = new Set(Object.keys(own));
	for (const [name, entry] of Object.entries(own)) if (registered(entry)) out.push({ name, entry, shared: false });
	for (const [name, entry] of Object.entries(shared)) if (!ownNames.has(name) && registered(entry)) out.push({ name, entry, shared: true });
	return out;
}
