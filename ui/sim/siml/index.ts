// SIML (SimLanguage): the text form of a rotation, a gear set or a whole sim setup. sim/siml/SPEC.md is the
// language; the Go package sim/siml implements the same and must agree byte for byte.

import { formatFile } from './format.ts';
import { valueAt } from './json.ts';
import { sourceText } from './lexer.ts';
import { Names } from './names.ts';
import { printFile } from './print.ts';
import { rotationPath } from './rotation.ts';
import { indexSchema, type SchemaIndex, type SimlSchema } from './schema.ts';
import { readFile, resolveUse } from './setup.ts';
import { splice } from './splice.ts';
import { kindOf } from './syntax.ts';
import type { JsonObject, JsonPath, NameTable, ParseOptions, Siml, SimlParse } from './types.ts';
import { sortDiagnostics } from './typing.ts';

export type * from './types.ts';
export type { EnumValue, KindForm, Printed, SchemaEnum, SchemaField, SectionBody, SectionDef, SectionSource, SimlSchema, SpecDef } from './schema.ts';

const APL = 'apl';
const GEAR = 'gear';
const ROTATION_CATEGORY = 'r';

// `schema` is ui/generated/siml/schema.json and `table` sim/siml/names.json, as their JSON. A table that breaks the
// rules of SPEC.md §7.4 is refused with an error.
export function createSiml(schema: SimlSchema, table: NameTable): Siml {
	const index = indexSchema(schema);
	const names = new Names(index, table);
	return {
		kindOf,
		parse: (text, o) => parse(index, names, sourceText(text), o),
		print: doc => printFile(index, names, doc),
		format: (text, o) => formatFile(index, names, sourceText(text), kindOf(o?.path ?? '')),
		splice: (text, parsed, edits) => splice(index, names, sourceText(text), parsed, edits),
	};
}

// A file's text into the JSON of its loader's message (SPEC.md §1). Its spans and the paths of its refs lead into that
// message: the rotation of an x.apl.siml, the equipment of an x.gear.siml, and the settings of any other file.
function parse(index: SchemaIndex, names: Names, text: string, o: ParseOptions = {}): SimlParse {
	const kind = kindOf(o.path ?? '');
	const self = resolveUse('', o.path ?? '');
	const file = readFile(index, names, text, kind, o.open ? { path: self, open: o.open, chain: [self] } : 'refused');
	const gear = index.sections.get(GEAR)!.presence!;
	const root = kind.section === APL ? rotationPath(index) : kind.section === GEAR ? gear : [];
	const under = (path: JsonPath) => root.every((k, i) => path[i] === k);
	const result: SimlParse = {
		kind,
		spec: file.spec?.field,
		categories: [],
		diagnostics: file.diagnostics,
		rawRefs: sortDiagnostics(file.typer.rawRefs),
		refs: file.typer.refs
			.map(r => ({ ...r, path: under(r.path) ? r.path.slice(root.length) : undefined }))
			.sort((a, b) => a.range.start.offset - b.range.start.offset),
		spans: file.typer.spans.filter(s => under(s.path)).map(s => ({ ...s, path: s.path.slice(root.length) })),
		tree: file.tree,
	};
	if (file.diagnostics.some(d => d.severity === 'error')) return result;
	result.settings = file.settings;
	result.categories = file.categories;
	if (file.categories.includes(ROTATION_CATEGORY)) result.rotation = valueAt(file.settings, rotationPath(index)) as JsonObject;
	if (kind.section === GEAR || file.present.has(GEAR)) result.equipment = valueAt(file.settings, gear) as JsonObject;
	return result;
}
