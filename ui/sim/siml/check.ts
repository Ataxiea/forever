// The checks that need the whole file: the references between variables, groups, placeholders and sequences
// (SPEC.md §7.5).

import { identifier } from './identifier.ts';
import { isObject } from './json.ts';
import type { SchemaIndex } from './schema.ts';
import type { JsonValue, Range } from './types.ts';
import type { Typer, VariableDecl, VariableUse } from './typing.ts';

export type Resolution = { name: string } | { ambiguous: string[] } | { undefined: true };

// What `$written` (or `${written}` when braced) refers to among the names declared in its scope: the exact
// name, else the one name whose identifier is `written` (SPEC.md §7.5).
export function resolveVariable(written: string, braced: boolean, declared: string[]): Resolution {
	if (declared.includes(written)) return { name: written };
	if (braced) return { undefined: true };
	const folded = [...new Set(declared.filter(d => identifier(d) === written))];
	if (folded.length === 1) return { name: folded[0] };
	return folded.length ? { ambiguous: folded } : { undefined: true };
}

// The names a reference in `scope` sees: the value variables, and inside a group that group's variables.
export function declaredIn(declarations: ReadonlyArray<{ name: string; scope: string | undefined }>, scope: string | undefined): string[] {
	return [...new Set(declarations.filter(d => d.scope === undefined || (scope !== undefined && d.scope === scope)).map(d => d.name))];
}

// The variables and groups a used file's rotation declares (SPEC.md §9), which this file's references may name.
export interface Declared {
	variables: Array<{ name: string; scope: string | undefined }>;
	groups: Map<string, Set<string>>; // Each group's placeholders.
}

// The variables, groups and placeholders the rotation JSON `rotation` declares.
export function declaredBy(index: SchemaIndex, rotation: JsonValue | undefined): Declared {
	const V = index.vocabulary;
	const declared: Declared = { variables: [], groups: new Map() };
	const list = (json: JsonValue | undefined, key: string) => (isObject(json) && Array.isArray(json[key]) ? (json[key] as JsonValue[]) : []);
	const text = (json: JsonValue, key: string) => (isObject(json) && typeof json[key] === 'string' ? (json[key] as string) : '');
	for (const v of list(rotation, V.rotation.f.value_variables)) declared.variables.push({ name: text(v, V.variable.f.name), scope: undefined });
	for (const g of list(rotation, V.rotation.f.groups)) {
		const group = text(g, V.group.f.name);
		for (const v of list(g, V.group.f.variables)) declared.variables.push({ name: text(v, V.variable.f.name), scope: group });
		declared.groups.set(group, placeholders(index, g, new Set()));
	}
	return declared;
}

// The names of the placeholders `json` holds.
function placeholders(index: SchemaIndex, json: JsonValue, into: Set<string>): Set<string> {
	const P = index.vocabulary.variablePlaceholder;
	if (Array.isArray(json)) for (const x of json) placeholders(index, x, into);
	else if (isObject(json)) {
		const p = json[P.json];
		if (isObject(p) && typeof p[P.f.name] === 'string') into.add(p[P.f.name] as string);
		for (const x of Object.values(json)) placeholders(index, x, into);
	}
	return into;
}

export function checkReferences(typer: Typer, declarations: VariableDecl[], groups: Array<{ name: string; range: Range }>, used: Declared) {
	const V = typer.v;
	const visible = [...declarations, ...used.variables];
	for (const scope of new Set(declarations.map(d => d.scope))) {
		const seen = new Set<string>();
		for (const d of declarations.filter(x => x.scope === scope)) {
			if (seen.has(d.name))
				typer.report('duplicate-variable', `${d.name} is declared twice${scope === undefined ? '' : ` in group "${scope}"`}`, d.range);
			seen.add(d.name);
		}
	}

	const targets = new Map<VariableUse, VariableDecl>();
	for (const use of typer.variableUses) {
		const { node } = use;
		const resolution = resolveVariable(node.name, node.braced, declaredIn(visible, use.scope));
		const name = 'name' in resolution ? resolution.name : node.name;
		use.body[V.variableRef.f.name] = name;
		if ('ambiguous' in resolution) {
			const exact = resolution.ambiguous.map(n => `\${${n}}`).join(', ');
			typer.report('ambiguous-variable', `$${node.name} could be any of ${exact}; write the exact name`, node.range);
		} else if ('undefined' in resolution) {
			typer.report('undefined-variable', `no variable here is named ${node.braced ? `\${${node.name}}` : `$${node.name}`}`, node.range, 'warning');
		} else {
			const decl =
				declarations.find(d => d.name === name && use.scope !== undefined && d.scope === use.scope) ??
				declarations.find(d => d.name === name && d.scope === undefined);
			if (decl) targets.set(use, decl);
		}
	}
	for (const d of declarations) {
		if (reaches(d, d, x => x.uses.flatMap(u => (targets.has(u) ? [targets.get(u)!] : [])))) {
			typer.report('reference-cycle', `${d.name} refers to itself through other variables`, d.range);
		}
	}

	const defined = new Set([...groups.map(g => g.name), ...used.groups.keys()]);
	for (const use of typer.groupUses) {
		if (!defined.has(use.name)) {
			typer.report('undefined-group', `no group is named "${use.name}"`, use.range, 'warning');
			continue;
		}
		const placeholders = new Set([...(typer.placeholders.get(use.name) ?? []), ...(used.groups.get(use.name) ?? [])]);
		for (const w of use.with)
			if (!placeholders.has(w.name)) typer.report('undefined-placeholder', `group "${use.name}" holds no %${w.name}`, w.range, 'warning');
	}
	const referenced = (name: string) => [...new Set(typer.groupUses.filter(u => u.scope === name && defined.has(u.name)).map(u => u.name))];
	const reported = new Set<string>();
	for (const g of groups) {
		if (reported.has(g.name) || !reaches(g.name, g.name, referenced)) continue;
		reported.add(g.name);
		typer.report('reference-cycle', `group "${g.name}" refers to itself through group references`, g.range);
	}

	for (const use of typer.sequenceUses) {
		if (!typer.sequenceDefs.has(use.name)) typer.report('undefined-sequence', `no sequence is named "${use.name}"`, use.range, 'warning');
	}
}

// Whether `to` is reachable from `from` in one step or more.
function reaches<T>(from: T, to: T, next: (x: T) => T[]): boolean {
	const seen = new Set<T>();
	const stack = [...next(from)];
	while (stack.length) {
		const x = stack.pop()!;
		if (x === to) return true;
		if (seen.has(x)) continue;
		seen.add(x);
		stack.push(...next(x));
	}
	return false;
}
