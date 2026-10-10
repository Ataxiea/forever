// The rotation sections (SPEC.md §6): var lines, the `type` entry, `prepull:`, `priority:` and the groups,
// typed into the APLRotation JSON of the settings.

import { objectAt } from './json.ts';
import { type SchemaField, type SchemaIndex, sectionFields, type SpecDef } from './schema.ts';
import type { JsonObject, JsonPath, JsonValue, Range, RowStatement, Statement, SyntaxTree, VarStatement } from './types.ts';
import type { Typer, VariableDecl } from './typing.ts';

const APL = 'apl';
const PREPULL = 'prepull';
const PRIORITY = 'priority';
const GROUP = 'group';
export const TYPE_APL = 'TypeAPL';
export const TYPE_SIMPLE = 'TypeSimple';

// The rotation's place in the settings JSON: the path of the apl section's message.
export const rotationPath = (index: SchemaIndex): string[] => index.sections.get(APL)!.sources[0].path;

export interface RotationTyping {
	explicitType: boolean; // Whether an `apl:` entry sets the type.
	declarations: VariableDecl[];
	groups: Array<{ name: string; range: Range }>;
}

// Every statement in file order, a header's body line right after its header.
export function inFileOrder(tree: SyntaxTree): Statement[] {
	return tree.statements.flatMap(s => (s.type === 'header' && s.body ? [s, s.body] : [s]));
}

// Types the rotation sections and the top-level var lines into the rotation of `settings`, giving each row and
// var line its path in `paths`, and each entry the paths it writes in `entries`.
export function typeRotation(
	typer: Typer,
	tree: SyntaxTree,
	spec: SpecDef | undefined,
	settings: JsonObject,
	paths: Map<Statement, JsonPath>,
	entries: Map<Statement, JsonPath[]>,
): RotationTyping {
	const V = typer.v;
	const R = V.rotation.f;
	const G = V.group.f;
	const base = rotationPath(typer.index);
	const rotation = () => objectAt(settings, base); // Made by the first statement that writes to it.
	const declarations: VariableDecl[] = [];
	const groups: RotationTyping['groups'] = [];
	const sectionOf = new Map<Statement, string>();
	for (const s of tree.sections) for (const b of s.body) sectionOf.set(b, s.name);
	const aplFields = sectionFields(typer.index, typer.index.sections.get(APL)!, spec);
	const entriesSet = new Set<SchemaField>();
	let group: { json: JsonObject; path: JsonPath } | undefined;

	// Types `s` into the next element of the list `key` of `into`, which sits at `at`.
	const append = (into: JsonObject, at: JsonPath, key: string, s: Statement, make: (path: JsonPath) => JsonValue | undefined) => {
		const list = (into[key] ??= []) as JsonValue[];
		const path = [...at, key, list.length];
		paths.set(s, path);
		list.push(make(path) ?? null);
	};
	const declare = (s: VarStatement, scope: string | undefined, path: JsonPath): JsonObject | undefined => {
		const decl: VariableDecl = { name: s.variable.name, range: s.variable.range, scope, uses: [] };
		declarations.push(decl);
		typer.decl = decl;
		const value = typer.value(s.value, [...path, V.variable.f.value]);
		typer.decl = undefined;
		typer.span(path, s.range);
		return value && { [V.variable.f.name]: s.variable.name, [V.variable.f.value]: value };
	};

	for (const s of inFileOrder(tree)) {
		const section = sectionOf.get(s);
		if (s.type === 'header') {
			group = undefined;
			typer.scope = undefined;
			if (s.name.text === GROUP && s.group) {
				const json: JsonObject = { [G.name]: s.group.value };
				const g = ((rotation()[R.groups] ??= []) as JsonValue[]).push(json) - 1;
				group = { json, path: [...base, R.groups, g] };
				typer.scope = s.group.value;
				groups.push({ name: s.group.value, range: s.group.range });
				typer.span(group.path, s.range);
			}
		} else if (s.type === 'var' && (section === undefined || section === APL)) {
			append(rotation(), base, R.value_variables, s, at => declare(s, undefined, at));
		} else if (s.type === 'var' && section === GROUP && group) {
			append(group.json, group.path, G.variables, s, at => declare(s, typer.scope, at));
		} else if (s.type === 'row' && (section === PREPULL || section === PRIORITY)) {
			const prepull = section === PREPULL;
			append(rotation(), base, prepull ? R.prepull_actions : R.priority_list, s, at => row(typer, s, prepull, at));
		} else if (s.type === 'row' && section === GROUP && group) {
			append(group.json, group.path, G.actions, s, at => row(typer, s, false, at));
		} else if (section === APL && isEntry(s)) {
			entries.set(s, typer.entry(s, aplFields, settings, entriesSet));
		}
	}
	typer.scope = undefined;
	return { explicitType: [...entriesSet].some(f => f.json === R.type), declarations, groups };
}

export const isEntry = (s: Statement) => s.type === 'field_entry' || s.type === 'flag_list' || s.type === 'message_entry' || s.type === 'raw_entry';

// A row: an APLPrepullAction in `prepull:`, an APLListItem elsewhere. A row that is raw JSON alone is the
// whole row's JSON.
function row(typer: Typer, s: RowStatement, prepull: boolean, at: JsonPath): JsonObject | undefined {
	const F = prepull ? typer.v.prepullAction : typer.v.listItem;
	typer.span(at, s.range);
	const { step, condition } = s.action;
	if (step.type === 'raw' && !condition && !s.hide && !s.doAt && !s.notes.length) return typer.raw(F.message, step);
	const item: JsonObject = {};
	const action = typer.action(s.action, [...at, F.f.action]);
	// A time outside prepull: is unexpected-time, and is not read.
	const doAt = prepull && s.doAt ? typer.value(s.doAt, [...at, F.f.do_at_value]) : undefined;
	if (!action || (prepull && s.doAt && !doAt)) return undefined;
	item[F.f.action] = action;
	if (doAt) item[F.f.do_at_value] = doAt;
	if (s.hide) item[F.f.hide] = true;
	if (s.notes.length) item[F.f.notes] = s.notes.map(n => n.text).join('\n');
	return item;
}
