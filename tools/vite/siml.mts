// SIML files as modules (sim/siml/SPEC.md). Importing `x.apl.siml` gives the APLRotation JSON, `x.gear.siml` the
// EquipmentSpec JSON and any other `.siml` the IndividualSimSettings JSON: the JSON of the message each file kind
// loads into (SPEC.md §1), which reads as the same message as a `.json` file of it.
//
// The plugin reads ui/generated/siml/schema.json and sim/siml/names.json from disk, again whenever either changes,
// and gives the site both through `virtual:siml-data`, which the site imports lazily.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizePath, type Plugin } from 'vite';

import { createSiml, type JsonValue, type NameTable, type Siml, type SimlDiagnostic, type SimlSchema } from '../../ui/sim/siml/index.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCHEMA = path.join(ROOT, 'ui/generated/siml/schema.json');
const NAMES = path.join(ROOT, 'sim/siml/names.json');
// A file under ui/specs is a repository file: its warnings are errors, and it writes no raw ref (SPEC.md §7.3, §13).
const SPECS = `${normalizePath(path.join(ROOT, 'ui/specs'))}/`;

const DATA = 'virtual:siml-data';
const RESOLVED_DATA = `\0${DATA}`;

interface Tables {
	stamp: string;
	schema: string;
	names: string;
	siml: Siml;
}

interface Context {
	error(message: string): never;
}

const relative = (file: string) => normalizePath(path.relative(ROOT, file));

// The modification time and size of each file, which say when they must be read again.
const stampOf = (files: string[]) =>
	files
		.map(file => {
			const stat = fs.statSync(file, { throwIfNoEntry: false });
			return stat ? `${stat.mtimeMs}:${stat.size}` : '-';
		})
		.join('|');

const where = (file: string, d: SimlDiagnostic) => `${relative(file)}:${d.range.start.line + 1}:${d.range.start.character + 1}`;

export function simlPlugin(): Plugin {
	let cached: Tables | undefined;

	const tables = (ctx: Context): Tables => {
		const stamp = stampOf([SCHEMA, NAMES]);
		if (cached?.stamp === stamp) return cached;
		if (!fs.existsSync(SCHEMA)) ctx.error(`${relative(SCHEMA)} is missing: run make ui/generated/siml/schema.json`);
		if (!fs.existsSync(NAMES)) ctx.error(`${relative(NAMES)} is missing: run make sim/siml/names.json`);
		const schema = fs.readFileSync(SCHEMA, 'utf8');
		const names = fs.readFileSync(NAMES, 'utf8');
		let siml: Siml;
		try {
			siml = createSiml(JSON.parse(schema) as SimlSchema, JSON.parse(names) as NameTable);
		} catch (error) {
			return ctx.error(`${relative(SCHEMA)} and ${relative(NAMES)} do not load: ${error instanceof Error ? error.message : String(error)}`);
		}
		cached = { stamp, schema, names, siml };
		return cached;
	};

	return {
		name: 'siml',

		resolveId(id) {
			return id === DATA ? RESOLVED_DATA : null;
		},

		load(id) {
			if (id !== RESOLVED_DATA) return null;
			const { schema, names } = tables(this);
			this.addWatchFile(SCHEMA);
			this.addWatchFile(NAMES);
			// JSON.parse of a string, which engines read faster than the same object as a literal.
			const json = (text: string) => `JSON.parse(${JSON.stringify(JSON.stringify(JSON.parse(text)))})`;
			return `export const schema = ${json(schema)};\nexport const names = ${json(names)};\n`;
		},

		// Only a bare `.siml` id: one with a query, such as `?raw`, is another plugin's.
		transform(text, id) {
			if (!id.endsWith('.siml')) return null;
			const { siml } = tables(this);
			this.addWatchFile(SCHEMA);
			this.addWatchFile(NAMES);
			const parsed = siml.parse(text, {
				path: id,
				open: used => {
					this.addWatchFile(used);
					return fs.existsSync(used) ? fs.readFileSync(used, 'utf8') : undefined;
				},
			});
			const repository = normalizePath(id).startsWith(SPECS);
			const failed = [...parsed.diagnostics.filter(d => repository || d.severity === 'error'), ...(repository ? parsed.rawRefs : [])].sort(
				(a, b) => a.range.start.offset - b.range.start.offset,
			);
			if (failed.length) {
				const first = failed[0].range.start;
				this.error({
					message: failed.map(d => `${where(id, d)}: ${d.severity} ${d.code}: ${d.message}`).join('\n'),
					// Printed as file:line:column, as the message writes the place: both count from 1.
					loc: { file: id, line: first.line + 1, column: first.character + 1 },
				});
			}
			for (const d of parsed.diagnostics) this.warn(`${where(id, d)}: ${d.code}: ${d.message}`);

			const section = siml.kindOf(id).section;
			const json: JsonValue | undefined = section === 'apl' ? parsed.rotation : section === 'gear' ? parsed.equipment : parsed.settings;
			return { code: `export default ${JSON.stringify(json)};\n`, map: { mappings: '' }, moduleType: 'js' };
		},
	};
}
