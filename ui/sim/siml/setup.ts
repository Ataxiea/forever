// A whole file of any kind (SPEC.md §1, §5, §9): the `spec` and `talents` lines, every section typed into the
// IndividualSimSettings JSON, what a present section sets, the categories, and the files `use` takes in.

import { checkReferences, type Declared, declaredBy, resolveVariable } from './check.ts';
import { isObject, normalize, objectAt, valueAt } from './json.ts';
import { sourceText } from './lexer.ts';
import { classOf, type Names } from './names.ts';
import { isEntry, rotationPath, type RotationTyping, TYPE_APL, TYPE_SIMPLE, typeRotation } from './rotation.ts';
import {
	type Placed,
	PLAYER_MESSAGE,
	type SchemaField,
	type SchemaIndex,
	type SectionDef,
	sectionFields,
	SETTINGS_MESSAGE,
	SLOT_ENUM,
	type SpecDef,
	specPath,
} from './schema.ts';
import { fileSections, kindOf, parseSyntax } from './syntax.ts';
import type {
	JsonObject,
	JsonPath,
	JsonValue,
	Name,
	ParseOptions,
	SimlDiagnostic,
	SimlKind,
	SlotRowStatement,
	Statement,
	SyntaxTree,
	UseStatement,
} from './types.ts';
import { diagnostic, didYouMean, isList, sortDiagnostics, Typer, type VariableDecl } from './typing.ts';

const APL = 'apl';
const SIMPLE = 'simple';
const GROUP = 'group';
const ROTATION_CATEGORY = 'r';
const TALENTS = 'talents'; // The talents line, which counts as a section where files are put together.
const TALENTS_CATEGORY = 't';
const CATEGORY_ORDER = 'gtrcmxeu'; // The site's import categories, in its order (SIM_CATEGORY_KEYS).

// A typed file, before its diagnostics decide whether it yields a proto.
export interface TypedFile {
	kind: SimlKind;
	tree: SyntaxTree;
	spec?: SpecDef;
	settings: JsonObject; // The IndividualSimSettings JSON, normalized.
	json: JsonObject; // The settings with each string `simple:` encodes read as its JSON: what the paths below lead into.
	present: Set<string>; // The sections present, a group as `group "Name"`, and `talents` for the talents line.
	categories: string[];
	typer: Typer;
	paths: Map<Statement, JsonPath>; // Each row's and var line's path.
	entries: Map<Statement, JsonPath[]>; // The paths of the values each entry line and slot row writes.
	withs: Map<Statement, JsonValue[]>; // The values each `use` line's `with` list gives.
	declarations: VariableDecl[];
	explicitType: boolean; // Whether an `apl:` entry of the file, or of a file it uses, sets the rotation type.
	diagnostics: SimlDiagnostic[]; // In the order SPEC.md §13 fixes.
}

// How `use` lines are read: through `open`, with the chain of files being read for cycles; refused, by a host
// that cannot read files; or not at all, by `format` and the printer, which handle one file's text.
export type Uses = { path: string; open: NonNullable<ParseOptions['open']>; chain: string[] } | 'refused' | undefined;

// A file's text, read and typed with the name table `names`; `uses` says how its `use` lines are read.
export function readFile(index: SchemaIndex, names: Names, text: string, kind: SimlKind, uses: Uses): TypedFile {
	const { tree, diagnostics } = parseSyntax(text, index, kind);
	const file = typeFile(index, names, tree, kind, uses);
	file.diagnostics = sortDiagnostics([...diagnostics, ...file.diagnostics]);
	return file;
}

// The path `target` names, read against the folder of `from`, with / between its parts.
export function resolveUse(from: string, target: string): string {
	const absolute = /^([A-Za-z]:)?[\\/]/.test(target);
	const parts = [...(absolute ? [] : from.split(/[\\/]/).slice(0, -1)), ...target.split(/[\\/]/)];
	const out: string[] = [];
	parts.forEach((part, i) => {
		if (part === '.' || (part === '' && i > 0)) return;
		if (part === '..' && out.length > 0 && out.at(-1) !== '..' && out.at(-1) !== '') out.pop();
		else out.push(part);
	});
	return out.join('/');
}

function typeFile(index: SchemaIndex, names: Names, tree: SyntaxTree, kind: SimlKind, uses: Uses): TypedFile {
	const typer = new Typer(index, names);
	const spec = typeSpec(typer, tree, kind);
	typer.cls = classOf(index, spec);
	const settings: JsonObject = {};
	const paths = new Map<Statement, JsonPath>();
	const entries = new Map<Statement, JsonPath[]>();
	const withs = new Map<Statement, JsonValue[]>();
	const present = presentSections(index, tree);
	const player = () => objectAt(settings, [index.protoField(SETTINGS_MESSAGE, 'player')!.json]);

	if (spec) {
		player()[index.protoField(PLAYER_MESSAGE, 'class')!.json] = spec.class;
		objectAt(player(), [index.protoField(PLAYER_MESSAGE, spec.field)!.json]);
	}
	const talents = tree.top.find(s => s.type === 'talents');
	if (talents) {
		const field = index.protoField(PLAYER_MESSAGE, 'talents_string')!;
		player()[field.json] = talents.talents.value;
		typer.span([index.protoField(SETTINGS_MESSAGE, 'player')!.json, field.json], talents.talents.range);
	}

	const used = readUses(typer, tree, kind, spec, present, uses, withs);
	// A section file's own section is present when it writes it, and otherwise when no used file brings it.
	if (kind.section !== undefined && index.sections.has(kind.section) && !used.present.has(kind.section)) present.add(kind.section);
	const rotationStatements = tree.top.some(s => s.type === 'var') || tree.sections.some(s => typedByRotation(index.sections.get(s.name)));
	const rotation: RotationTyping = rotationStatements
		? typeRotation(typer, tree, spec, settings, paths, entries)
		: { explicitType: false, declarations: [], groups: [] };
	for (const section of tree.sections) typeSection(typer, section.name, section.body, spec, settings, entries);
	for (const name of present) setPresent(index, name, spec, settings);
	const decoded = encodeSimple(index, present, spec, settings);

	checkReferences(typer, rotation.declarations, rotation.groups, used.declared);

	for (const s of used.settings) merge(settings, s);
	for (const key of used.present) present.add(key);
	const explicitType = rotation.explicitType || used.explicitType;
	if (kind.section === APL || [...present].some(key => categoryOf(index, key) === ROTATION_CATEGORY)) {
		const R = typer.v.rotation.f;
		const json = objectAt(settings, rotationPath(index));
		if (!explicitType) json[R.type] = present.has(SIMPLE) ? TYPE_SIMPLE : TYPE_APL;
	}
	const normalized = normalize(index, SETTINGS_MESSAGE, settings) as JsonObject;
	const json = decoded.reduce((into, d) => withValue(into, d.path, d.value), normalized);
	const categories = [...new Set([...present].map(key => categoryOf(index, key)).filter(c => c !== ''))].sort(
		(a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
	);
	return {
		kind,
		tree,
		spec,
		settings: normalized,
		json,
		present,
		categories,
		typer,
		paths,
		entries,
		withs,
		declarations: rotation.declarations,
		explicitType,
		diagnostics: typer.diagnostics,
	};
}

// The `spec` line, which a rotation file and a full file must hold (SPEC.md §3.3).
function typeSpec(typer: Typer, tree: SyntaxTree, kind: SimlKind): SpecDef | undefined {
	const line = tree.top.find(s => s.type === 'spec');
	if (!line) {
		if (kind.section !== undefined && kind.section !== APL) return undefined;
		const version = tree.top.find(s => s.type === 'version');
		const range = version?.range ?? { start: { line: 0, character: 0, offset: 0 }, end: { line: 0, character: 0, offset: 0 } };
		const what = kind.section === APL ? 'a rotation file' : 'a setup file';
		typer.diagnostics.push(diagnostic('spec-required', `${what} names its spec: spec <field>, such as spec hunter`, range));
		return undefined;
	}
	const spec = typer.index.specs.get(line.spec.text);
	if (!spec) typer.report('unknown-spec', `no spec is named ${line.spec.text}${didYouMean(line.spec.text, typer.index.specs.keys())}`, line.spec.range);
	return spec;
}

// The sections a file writes, a group by its name, and `talents` when it has a talents line. A file's top-level
// var lines are its `apl:` section. A section file's own section counts when it holds a statement.
function presentSections(index: SchemaIndex, tree: SyntaxTree): Set<string> {
	const present = new Set<string>();
	for (const s of tree.sections) {
		const written = s.header !== undefined || s.body.length > 0;
		if (index.sections.has(s.name) && written) present.add(s.group === undefined ? s.name : groupKey(s.group));
	}
	if (tree.top.some(s => s.type === 'var')) present.add(APL);
	if (tree.top.some(s => s.type === 'talents')) present.add(TALENTS);
	return present;
}

const groupKey = (name: string) => `${GROUP} ${JSON.stringify(name)}`;
const sectionOf = (key: string) => (key.startsWith(`${GROUP} `) ? GROUP : key);
const categoryOf = (index: SchemaIndex, key: string) => (key === TALENTS ? TALENTS_CATEGORY : (index.sections.get(sectionOf(key))?.category ?? ''));

// Whether the rotation's typing reads a section: those that hold rows or var lines.
const typedByRotation = (def: SectionDef | undefined) => def !== undefined && (def.body.includes('rows') || def.body.includes('var'));

// --- Setup sections (SPEC.md §5)

// The entries and slot rows of a section, typed into `settings`.
function typeSection(typer: Typer, name: string, body: Statement[], spec: SpecDef | undefined, settings: JsonObject, entries: Map<Statement, JsonPath[]>) {
	const def = typer.index.sections.get(name);
	if (!def || typedByRotation(def)) return;
	const placed = sectionFields(typer.index, def, spec);
	const slots = def.body.includes('slot_rows') ? slotField(typer.index, placed) : undefined;
	const fields = placed.filter(p => p !== slots);
	const set = new Set<SchemaField>();
	const taken = new Set<number>();
	for (const s of body) {
		if (s.type === 'slot_row' && slots) entries.set(s, slotRow(typer, s, slots, settings, taken));
		else if (isEntry(s)) entries.set(s, typer.entry(s, fields, settings, set));
	}
}

// The field a section's slot rows fill: its list of ItemSpecs.
export const slotField = (index: SchemaIndex, placed: Placed[]) => placed.find(p => p.field.type === index.vocabulary.itemSpec.message && isList(p.field));

// `<slot> <item> [<suffix>] [+ <enchant>]`, or `<slot>` and a raw ItemSpec (SPEC.md §5.3).
function slotRow(typer: Typer, s: SlotRowStatement, slots: Placed, settings: JsonObject, taken: Set<number>): JsonPath[] {
	const slot = typer.index.enumValue(SLOT_ENUM, s.slot.text);
	if (!slot) {
		typer.report('unknown-slot', `no slot is named ${s.slot.text}${didYouMean(s.slot.text, typer.index.slots)}`, s.slot.range);
		return [];
	}
	if (taken.has(slot.number)) {
		typer.report('duplicate-slot', `${slot.short} is written twice`, s.slot.range);
		return [];
	}
	taken.add(slot.number);
	const path = [...slots.at, slots.field.json, slot.number];
	const I = typer.v.itemSpec;
	let item: JsonObject | undefined;
	if ('type' in s.item) item = typer.raw(I.message, s.item);
	else {
		const parts: Array<[string, Name | undefined]> = [
			['id', s.item],
			['random_suffix', s.suffix],
			['enchant', s.enchant],
		];
		item = {};
		for (const [name, written] of parts) {
			if (!written) continue;
			const field = typer.index.protoField(I.message, name)!;
			const value = typer.single(field, { type: 'call', name: written, range: written.range }, [...path, field.json]);
			if (value === undefined) item = undefined;
			else if (item) item[field.json] = value;
		}
	}
	if (!item) return [];
	((objectAt(settings, slots.at)[slots.field.json] ??= []) as JsonValue[])[slot.number] = item;
	typer.span(path, s.range);
	return [path];
}

// What a present section sets (SPEC.md §5.1): its message, even when its body is empty; the class options of
// the spec's options; and all of a section's items, a slot not written being empty.
function setPresent(index: SchemaIndex, key: string, spec: SpecDef | undefined, settings: JsonObject) {
	const def = index.sections.get(sectionOf(key));
	const at = def?.presence && specPath(index, def.presence, spec);
	if (!def || !at) return;
	objectAt(settings, at);
	for (const src of def.sources) {
		const options = src.flatten === 'spec_options' && specPath(index, src.path, spec);
		const message = options && index.messageAt(src.path, spec);
		const classOptions = message && spec?.classOptions ? index.fields(message).find(f => f.type === spec.classOptions) : undefined;
		if (options && classOptions) objectAt(settings, [...options, classOptions.json]);
	}
	const slots = def.body.includes('slot_rows') ? slotField(index, sectionFields(index, def, spec)) : undefined;
	if (!slots) return;
	const holder = objectAt(settings, slots.at);
	const items = (holder[slots.field.json] ??= []) as JsonValue[];
	for (let i = 0; i < index.enumLength(SLOT_ENUM); i++) items[i] ??= {};
}

// The paths of the strings a section encodes the spec's Rotation into (SPEC.md §5.4): `simple:`'s
// spec_rotation_json.
export function simplePaths(index: SchemaIndex, def: SectionDef, spec: SpecDef): JsonPath[] {
	return def.sources
		.filter(src => src.flatten === 'spec_rotation_json')
		.flatMap(src => (src.fields ?? []).map(field => [...specPath(index, src.path, spec)!, field]));
}

// Encodes what each present `simple:` section writes as the canonical rotation JSON of SPEC.md §5.4, and gives
// the JSON each string holds.
function encodeSimple(index: SchemaIndex, present: Set<string>, spec: SpecDef | undefined, settings: JsonObject): Array<{ path: JsonPath; value: JsonValue }> {
	if (!spec) return [];
	return [...present].flatMap(key => {
		const def = index.sections.get(key);
		return (def ? simplePaths(index, def, spec) : []).map(path => {
			const value = normalize(index, spec.rotation, valueAt(settings, path) ?? {});
			objectAt(settings, path.slice(0, -1) as string[])[path.at(-1) as string] = JSON.stringify(value);
			return { path, value };
		});
	});
}

// --- Composition (SPEC.md §9)

interface Used {
	settings: JsonObject[]; // Each used file's settings, in the order of the use lines.
	present: Set<string>;
	declared: Declared;
	explicitType: boolean;
}

// Reads each `use` line's file and checks it against this one, `present` holding this file's sections: a
// section in both is `section-conflict`, and the `with` list sets the used rotation's variables. Its values are
// typed in this file, and read its names with this file's class.
function readUses(
	typer: Typer,
	tree: SyntaxTree,
	kind: SimlKind,
	spec: SpecDef | undefined,
	present: Set<string>,
	uses: Uses,
	withs: Map<Statement, JsonValue[]>,
): Used {
	const index = typer.index;
	const R = typer.v.rotation.f;
	const W = typer.v.variable.f;
	const allowed = fileSections(index, kind);
	const used: Used = { settings: [], present: new Set(), declared: { variables: [], groups: new Map() }, explicitType: false };
	const broughtBy = new Map<string, string>(); // The used file that brought each key of `used.present`.
	for (const u of tree.top.filter((s): s is UseStatement => s.type === 'use')) {
		if (uses === undefined) {
			withs.set(
				u,
				u.with.map(b => typer.value(b.value, []) ?? null),
			);
			continue;
		}
		const at = u.path.range;
		if (uses === 'refused') {
			typer.report('use-refused', 'this host reads no other files: write the used sections into this file', at);
			continue;
		}
		const path = resolveUse(uses.path, u.path.value);
		if (uses.chain.includes(path)) {
			typer.report('use-cycle', `${path} uses this file, through ${[...uses.chain.slice(uses.chain.indexOf(path) + 1), path].join(' → ')}`, at);
			continue;
		}
		const text = uses.open(path);
		if (text === undefined) {
			typer.report('use-not-found', `no file is at ${path}`, at);
			continue;
		}
		const file = readFile(index, typer.names, sourceText(text), kindOf(path), { path, open: uses.open, chain: [...uses.chain, path] });
		// The used file's first error stands for all of them; the file itself shows the rest.
		const error = file.diagnostics.find(d => d.severity === 'error');
		if (error) {
			const where = `${path}:${error.range.start.line + 1}:${error.range.start.character + 1}`;
			typer.diagnostics.push({ ...diagnostic(error.code, `${where}: ${error.message}`, at), data: { path, range: error.range } });
			continue;
		}
		if (spec && file.spec && file.spec !== spec)
			typer.report('spec-mismatch', `${path} is for spec ${file.spec.field}, and this file for ${spec.field}`, at);
		// Where each key that is already present came from, this file first.
		const both = new Map<string, string[]>();
		for (const key of file.present) {
			if (!present.has(key) && !used.present.has(key)) continue;
			const source = present.has(key) ? 'this file' : broughtBy.get(key)!;
			both.set(source, [...(both.get(source) ?? []), key]);
		}
		const foreign = [...file.present].filter(key => (key === TALENTS ? kind.section !== undefined : !allowed.has(sectionOf(key))));
		const conflicts = [...both].map(([source, keys]) => `${listed(keys)} ${keys.length > 1 ? 'are' : 'is'} in both ${source} and ${path}`);
		if (conflicts.length) typer.report('section-conflict', conflicts.join('; '), at);
		if (foreign.length) typer.report('section-not-allowed', `${path} brings ${listed(foreign)}, which an x.${kind.section}.siml file does not hold`, at);
		for (const key of file.present) {
			if (!used.present.has(key)) broughtBy.set(key, path);
			used.present.add(key);
		}
		const rotation = valueAt(file.settings, rotationPath(index));
		const variables = isObject(rotation) && Array.isArray(rotation[R.value_variables]) ? (rotation[R.value_variables] as JsonObject[]) : [];
		if (u.with.length && !isObject(rotation))
			typer.report('with-not-rotation', `${path} holds no rotation whose variables with could set`, u.with[0].variable.range);
		else {
			const names = variables.map(v => v[W.name] as string);
			const values: JsonValue[] = [];
			for (const b of u.with) {
				const resolution = resolveVariable(b.variable.name, b.variable.braced, names);
				const written = b.variable.braced ? `\${${b.variable.name}}` : `$${b.variable.name}`;
				if ('ambiguous' in resolution) {
					const exact = resolution.ambiguous.map(n => `\${${n}}`).join(', ');
					typer.report('ambiguous-variable', `${written} could be any of ${exact}; write the exact name`, b.variable.range);
				} else if ('undefined' in resolution) {
					typer.report('with-unknown-variable', `${path} declares no variable ${written}${didYouMean(b.variable.name, names)}`, b.variable.range);
				} else {
					const k = names.indexOf(resolution.name);
					const value = typer.value(b.value, [...rotationPath(index), R.value_variables, k, W.value]);
					if (value) variables[k][W.value] = value;
					values.push(value ?? null);
				}
			}
			withs.set(u, values);
		}
		used.settings.push(file.settings);
		used.explicitType ||= file.explicitType;
		const declared = declaredBy(index, rotation);
		used.declared.variables.push(...declared.variables);
		for (const [group, names] of declared.groups) used.declared.groups.set(group, names);
	}
	return used;
}

// `a`, `a and b`, `a, b and c` of the sections `keys` name.
function listed(keys: string[]): string {
	const names = keys.map(key => (key === TALENTS ? 'the talents line' : `${key}:`));
	return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
}

// Merges `from` into `into`: objects field by field, lists one after the other, and a value `into` already has
// kept. Files that are put together write no field twice, except the class and the spec's message, which agree.
function merge(into: JsonObject, from: JsonObject) {
	for (const [key, value] of Object.entries(from)) {
		const mine = into[key];
		if (isObject(mine) && isObject(value)) merge(mine, value);
		else if (Array.isArray(mine) && Array.isArray(value)) mine.push(...value);
		else if (mine === undefined) into[key] = value;
	}
}

// `root` with `value` at `path`, copying the objects on the way.
function withValue(root: JsonObject, path: JsonPath, value: JsonValue): JsonObject {
	const [key, ...rest] = path as string[];
	const child = isObject(root[key]) ? (root[key] as JsonObject) : {};
	return { ...root, [key]: rest.length ? withValue(child, rest, value) : value };
}
