// The conformance corpus of SPEC.md §15 in sim/siml/testdata, which the Go implementation runs too.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { APLRotation } from '@generated/proto/apl';
import { describe, expect, it } from 'vitest';

import { createSiml, type JsonObject, type JsonValue, type SimlKind, type SimlParse } from './index.ts';
import { normalize } from './json.ts';
import { indexSchema } from './schema.ts';
import { entryRanks, exact } from './test_exact.ts';
import { fixtureNames } from './test_names.ts';
import { testSchema } from './test_schema.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TESTDATA = path.resolve(HERE, '../../../sim/siml/testdata');
const SPEC = path.resolve(HERE, '../../../sim/siml/SPEC.md');

const siml = createSiml(testSchema, fixtureNames);
const index = indexSchema(testSchema);

const read = (file: string) => readFileSync(file, 'utf8');
const open = (file: string) => (existsSync(file) ? read(file) : undefined);

// The case files under a corpus folder whose names end in `suffix`. A case in a folder of its own is the
// folder's main file, which uses the others.
function cases(folder: string, suffix: string): string[] {
	const walk = (dir: string, nested: boolean): string[] =>
		readdirSync(dir).flatMap(name => {
			const file = path.join(dir, name);
			if (statSync(file).isDirectory()) return walk(file, true);
			return name.endsWith(suffix) && (!nested || name.startsWith('main.')) ? [file] : [];
		});
	return walk(path.join(TESTDATA, folder), false).sort();
}

const caseName = (file: string) => path.relative(TESTDATA, file);

// A case is read with file access, except an error case that is not in a folder of its own, which is read as
// a host without it (SPEC.md §15).
const parseCase = (file: string, text = read(file)) =>
	siml.parse(text, { path: file, open: path.basename(path.dirname(file)) === 'errors' ? undefined : open });

// The loader's message for a file kind (SPEC.md §1), and the JSON a parse gives for it.
const message = (kind: SimlKind) =>
	kind.section === 'apl' ? 'proto.APLRotation' : kind.section === 'gear' ? 'proto.EquipmentSpec' : 'proto.IndividualSimSettings';
const loaded = (parsed: SimlParse) => (parsed.kind.section === 'apl' ? parsed.rotation : parsed.kind.section === 'gear' ? parsed.equipment : parsed.settings);
const expected = (kind: SimlKind, json: JsonValue) => normalize(index, message(kind), json);
const compared = (kind: SimlKind, json: JsonValue | undefined) => exact(index, message(kind), json ?? null);
// What a print reads back as, against what it was printed from, normalised as SPEC.md §12.4 compares them.
const readBack = (printed: SimlParse, from: JsonValue) => {
	const back = loaded(printed);
	return [compared(printed.kind, back), compared(printed.kind, entryRanks(index, from, printed, back))];
};

const errors = (parsed: SimlParse) => parsed.diagnostics.filter(d => d.severity === 'error').map(diagLine);
const diagLine = (d: SimlParse['diagnostics'][number]) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.severity} ${d.code}`;
const lines = (file: string) => read(file).split('\n').filter(Boolean);
// The raw refs of a case with a .raw file are exactly those it lists (SPEC.md §15).
const checkRawRefs = (file: string, parsed: SimlParse) => {
	if (existsSync(`${file}.raw`)) expect(parsed.rawRefs.map(diagLine)).toEqual(lines(`${file}.raw`));
};

// A print case's spec: the case name starts with the spec's field (SPEC.md §15).
function specOf(file: string): string | undefined {
	const base = path.basename(file);
	return [...index.specs.keys()].filter(field => base.startsWith(`${field}_`) || base.startsWith(`${field}.`)).sort((a, b) => b.length - a.length)[0];
}

// The settings a print case's JSON stands for: the rotation of an apl case, the equipment of a gear case.
const settingsOf = (kind: SimlKind, json: JsonObject): JsonObject =>
	kind.section === 'apl' ? { player: { rotation: json } } : kind.section === 'gear' ? { player: { equipment: json } } : json;

describe('parse cases', () => {
	for (const file of cases('parse', '.siml')) {
		it(`reads ${caseName(file)} to its JSON`, () => {
			const parsed = parseCase(file);
			expect(errors(parsed)).toEqual([]);
			checkRawRefs(file, parsed);
			const json = JSON.parse(read(file.replace(/\.siml$/, '.json'))) as JsonValue;
			expect(loaded(parsed)).toEqual(expected(parsed.kind, json));
			// The site reads the JSON with fromJson, which writes it back unchanged.
			if (parsed.kind.section === 'apl') expect(APLRotation.toJson(APLRotation.fromJson(parsed.rotation!))).toEqual(parsed.rotation);
		});
	}
});

describe('print cases', () => {
	for (const file of cases('print', '.json')) {
		it(`prints ${caseName(file)} and reads it back`, () => {
			const target = file.replace(/\.json$/, '.siml');
			const kind = siml.kindOf(target);
			const json = JSON.parse(read(file)) as JsonObject;
			const letters = file.replace(/\.json$/, '.categories');
			const categories = existsSync(letters) ? [...read(letters).trim()] : undefined;
			const text = siml.print({ kind, spec: specOf(file), settings: settingsOf(kind, json), categories });
			expect(text).toBe(read(target));
			const parsed = siml.parse(text, { path: target });
			expect(errors(parsed)).toEqual([]);
			// Given categories, the file holds exactly those; otherwise it holds the whole input.
			if (categories) expect(parsed.categories).toEqual(categories);
			else {
				const [back, input] = readBack(parsed, json);
				expect(back).toEqual(input);
			}
		});
	}
});

describe('format cases', () => {
	for (const file of cases('format', '.siml')) {
		it(`formats ${caseName(file)}`, () => {
			expect(siml.format(read(file), { path: file }).text).toBe(read(`${file}.want`));
		});
	}
});

describe('error cases', () => {
	for (const file of cases('errors', '.siml')) {
		it(`gives ${caseName(file)} its diagnostics`, () => {
			const parsed = parseCase(file);
			expect(parsed.diagnostics.map(diagLine)).toEqual(lines(`${file}.diag`));
			checkRawRefs(file, parsed);
		});
	}

	it('has a case for every diagnostic code of SPEC.md §13 that the module emits', () => {
		const spec = read(SPEC);
		const table = spec.slice(spec.indexOf('## 13. Diagnostics'), spec.indexOf('**Recovery.**'));
		const codes = new Set(
			table
				.split('\n')
				.filter(line => line.startsWith('| `'))
				.flatMap(line => [...line.split('|')[1].matchAll(/`([a-z-]+)`/g)].map(m => m[1])),
		);
		const sources = readdirSync(HERE)
			.filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && f !== 'types.ts' && !f.startsWith('test_'))
			.map(f => read(path.join(HERE, f)))
			.join('\n');
		const emitted = [...codes].filter(code => sources.includes(`'${code}'`));
		const covered = new Set([...cases('errors', '.diag'), ...cases('errors', '.raw')].flatMap(f => lines(f).map(line => line.split(' ')[2])));
		expect(emitted.length).toBeGreaterThan(50);
		expect(emitted.filter(code => !covered.has(code))).toEqual([]);
		expect([...covered].filter(code => !codes.has(code))).toEqual([]);
	});
});

describe('name tables', () => {
	const tables = (folder: string) => readdirSync(path.join(TESTDATA, 'tables', folder)).map(name => path.join(TESTDATA, 'tables', folder, name));
	for (const file of tables('refused')) {
		it(`refuses ${caseName(file)}`, () => {
			expect(() => createSiml(testSchema, JSON.parse(read(file)))).toThrow('siml: the name table');
		});
	}
	for (const file of tables('accepted')) {
		it(`accepts ${caseName(file)}`, () => {
			expect(() => createSiml(testSchema, JSON.parse(read(file)))).not.toThrow();
		});
	}
});

describe('parse cases cover the language (SPEC.md §15)', () => {
	const parsed = cases('parse', '.siml').map(file => parseCase(file));
	const json = JSON.stringify(cases('parse', '.json').map(file => JSON.parse(read(file)) as JsonValue));

	it('every section, written as a header or as a section file', () => {
		const written = new Set(parsed.flatMap(p => p.tree.sections.filter(s => s.header || s.body.length).map(s => s.name)));
		expect(testSchema.sections.map(s => s.name).filter(name => !written.has(name))).toEqual([]);
	});

	it('every form of statement', () => {
		const types = new Set(parsed.flatMap(p => p.tree.statements.flatMap(s => (s.type === 'header' && s.body ? [s.type, s.body.type] : [s.type]))));
		const all = ['version', 'spec', 'talents', 'use', 'header', 'var', 'row', 'slot_row', 'flag_list', 'field_entry', 'message_entry', 'raw_entry'];
		expect(all.filter(t => !types.has(t as never))).toEqual([]);
	});

	it('every short form, and every other form of SPEC.md §8.3', () => {
		const kinds = [...testSchema.kinds.action, ...testSchema.kinds.value];
		expect(kinds.filter(k => k.form === 'short' && !json.includes(`"${k.json}":`)).map(k => k.kind)).toEqual([]);
		const forms = new Set(kinds.filter(k => json.includes(`"${k.json}":`)).map(k => k.form));
		expect(['accessor', 'bare', 'unit_prefix', 'list_args', 'generic'].filter(f => !forms.has(f as never))).toEqual([]);
	});
});

// SPEC.md §15 item 5, for every case file that has no errors.
describe('every corpus file', () => {
	const files = [...cases('parse', '.siml'), ...cases('print', '.siml'), ...cases('format', '.siml')];
	for (const file of files) {
		it(`formats ${caseName(file)} to a fixed point, and reads its print back`, () => {
			const text = read(file);
			const once = siml.format(text, { path: file }).text!;
			expect(siml.format(once, { path: file }).text).toBe(once);
			const parsed = parseCase(file);
			const printed = siml.print({ kind: parsed.kind, spec: parsed.spec, settings: parsed.settings! });
			const [back, input] = readBack(siml.parse(printed, { path: file }), loaded(parsed)!);
			expect(back).toEqual(input);
		});
	}
});
