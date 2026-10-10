// Static checks on an APL rotation's JSON: what the sim would skip, warn about or never reach, found without
// running it. Every finding points at the most specific JSON node it is about.
//
// | Code                    | Severity | Catches                                                                                           |
// | ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
// | `empty-action`          | error    | An action with no kind set (`{}`); the sim skips the row. Toggle groups are exempt (below).       |
// | `empty-value`           | warning  | A value with no kind set; the sim drops it, so a condition made of it is no condition. An empty   |
// |                         |          | item of an `and`, `or`, `max` or `min`, an empty overlap or offset (0s) and an empty channel      |
// |                         |          | interrupt (a plain cast) are `info`. A move's range or duration, empty or missing, and a          |
// |                         |          | reference's value for a placeholder are errors: the sim fails to run.                             |
// | `undefined-group`       | error    | A group reference to a group no `groups` entry names, or with no name.                            |
// | `group-never-used`      | warning  | `actionGroupUsed` of a group that no row references, hidden or not: it is always false.           |
// | `undefined-sequence`    | warning  | A sequence name no live sequence in the priority list or a group carries (prepull ones don't).    |
// | `undefined-variable`    | error    | A `variableRef` to a name no value variable has. A group's variables and those a reference sets   |
// |                         |          | only replace a value variable of the same name, so a name only they set is dropped too.           |
// | `placeholder-unset`     | error    | A group reference that leaves one of the group's `variablePlaceholder`s unfilled.                 |
// | `placeholder-outside`   | warning  | A `variablePlaceholder` outside a group, which nothing replaces.                                  |
// | `duplicate-variable`    | warning  | A value variable whose name an earlier one already takes; references read the first.              |
// | `unused-variable`       | info     | A value variable nothing references.                                                              |
// | `unused-group`          | info     | A group nothing references, by group reference or `actionGroupUsed`.                              |
// | `prepull-no-time`       | warning  | A prepull row with no Do At time; the sim skips it.                                               |
// | `prepull-positive-time` | warning  | A prepull Do At time after the pull; the sim ignores the row.                                     |
// | `prepull-not-time`      | warning  | A Do At value read from the fight; the sim reads it once, before the fight, and can fail on it.   |
// |                         |          | Constant times and spell and aura durations, which need no fight, are fine.                       |
// | `prepull-order`         | info     | A prepull row listed after one with a later time; prepull rows run in time order, not list order. |
// | `prepull-condition`     | warning  | A condition on a prepull row; the sim runs the action at its Do At time without reading it.       |
// | `never-runs`            | warning  | A condition that is always false (the sim drops the row). A literal `false` is `info`: it keeps   |
// |                         |          | the spell out of automatic cooldown use, a deliberate way to turn a cooldown off.                 |
// | `always-true`           | info     | A condition, or a comparison, `not`, `and` or `or` inside one, that is always true or false.      |
// | `shadowed-row`          | warning  | A row whose action an earlier row in the same list takes with no condition or the same one: the   |
// |                         |          | later row is only reached when that action cannot run, so it never runs.                          |
//
// Hidden rows: the sim parses none of them, so every check skips them except the references. A hidden
// row's references are still checked and still count as uses, since unhiding the row brings them back
// (a hidden group reference is how a toggle group is switched off). A sequence that only a hidden row
// carries is reported, as the sim does not find it.
//
// Toggle groups: a group whose rows all have empty actions is a switch (`"Stance Dance ON/OFF"`): hiding or
// unhiding the row that references it turns `actionGroupUsed` of it off or on. Its empty actions are not
// reported; `unused-group` still reports one nothing references.
//
// Not followed: value variables. A condition that reads a variable holding a constant is a setting the
// reader flips, not a mistake, so constant checks stop at a `variableRef`.

import type { JsonPath } from '../protocol';

export type LintSeverity = 'error' | 'warning' | 'info';

export interface LintFinding {
	path: JsonPath;
	severity: LintSeverity;
	code: string;
	message: string;
}

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(json: Json): json is JsonObject {
	return !!json && typeof json === 'object' && !Array.isArray(json);
}

function asArray(json: Json): Json[] {
	return Array.isArray(json) ? json : [];
}

// Equal as the sim reads them: a `uuid` only tags a value for the editor.
function sameJson(a: Json, b: Json): boolean {
	if (a === b) return true;
	if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => sameJson(x, b[i]));
	if (!isObject(a) || !isObject(b)) return false;
	const keys = (o: JsonObject) => Object.keys(o).filter(k => k !== 'uuid' && o[k] !== undefined);
	const ka = keys(a);
	return ka.length === keys(b).length && ka.every(k => sameJson(a[k], b[k]));
}

// The kind an action or value is: its one key other than the condition and the editor's uuid.
function kindOf(json: Json, ignore: string): string | undefined {
	if (!isObject(json)) return undefined;
	return Object.keys(json).find(k => k !== ignore && k !== 'uuid' && json[k] !== undefined);
}

const actionKind = (action: Json) => kindOf(action, 'condition');
const valueKind = (value: Json) => kindOf(value, '');

// Where a row sits: the list it belongs to, for the checks that compare rows of one list.
type ListName = 'prepullActions' | 'priorityList' | 'groupActions';

interface Scope {
	hidden: boolean;
	list: ListName;
	group?: number; // The `groups` index a group row belongs to.
}

interface ActionSite {
	path: JsonPath;
	action: JsonObject;
	scope: Scope;
	nested: boolean; // Inside a sequence or a schedule rather than a row's own action.
}

interface ValueSite {
	path: JsonPath;
	value: JsonObject;
	scope: Scope | undefined; // Undefined for a value variable's value.
	condition: boolean; // The condition of an action, as opposed to an operand or an action's setting.
}

interface NameSite {
	path: JsonPath; // The name string itself.
	name: string;
	scope: Scope | undefined;
}

interface Collected {
	actions: ActionSite[];
	values: ValueSite[];
	groupReferences: Array<NameSite & { variables: Map<string, JsonPath> }>; // The values it sets, by name.
	groupUsed: NameSite[];
	sequences: NameSite[];
	sequenceRefs: NameSite[];
	variableRefs: NameSite[];
	placeholders: NameSite[];
	missing: Array<{ path: JsonPath; what: string; scope: Scope }>; // An action body without the value it needs.
}

// The fields of an action body that hold values, and those that hold actions.
const ACTION_VALUE_FIELDS = new Set(['interruptIf', 'maxOverlap', 'duration', 'condition', 'rangeFromTarget']);
// The fields of a value body that hold values.
const VALUE_VALUE_FIELDS = new Set(['val', 'lhs', 'rhs', 'targetEnergy', 'maxOverlap', 'offset']);
const VALUE_LIST_FIELDS = new Set(['vals']);
const SEQUENCE_VALUES = new Set(['sequenceIsComplete', 'sequenceIsReady', 'sequenceTimeToReady']);
// The action kinds whose value the sim reads with no check, and fails without: the move's range and duration.
const REQUIRED_VALUES: Record<string, { field: string; what: string }> = {
	move: { field: 'rangeFromTarget', what: 'range' },
	moveDuration: { field: 'duration', what: 'duration' },
};
// How the sim reads an empty value in a field it has a fallback for, by `kind.field`.
const EMPTY_FALLBACK: Record<string, string> = {
	'multidot.maxOverlap': 'reads as 0s',
	'strictMultidot.maxOverlap': 'reads as 0s',
	'multishield.maxOverlap': 'reads as 0s',
	'auraShouldRefresh.maxOverlap': 'reads as 0s',
	'multipleCdUsages.offset': 'reads as 0s',
	'channelSpell.interruptIf': 'casts the channel with no interrupt condition',
};

// A name as the sim reads it: a missing one is ''.
const nameOf = (name: Json) => (typeof name === 'string' ? name : '');

function collect(apl: JsonObject): Collected {
	const out: Collected = {
		actions: [],
		values: [],
		groupReferences: [],
		groupUsed: [],
		sequences: [],
		sequenceRefs: [],
		variableRefs: [],
		placeholders: [],
		missing: [],
	};

	const visitValue = (value: Json, path: JsonPath, scope: Scope | undefined, condition: boolean) => {
		if (!isObject(value)) return;
		out.values.push({ path, value, scope, condition });
		const kind = valueKind(value);
		if (!kind) return;
		const body = value[kind];
		if (!isObject(body)) return;
		const at = [...path, kind];
		// A reference with no name set reads as one to the name '', which nothing has.
		if (kind === 'variableRef' || kind === 'actionGroupUsed') {
			(kind === 'variableRef' ? out.variableRefs : out.groupUsed).push({ path: [...at, 'name'], name: nameOf(body.name), scope });
		}
		if (kind === 'variablePlaceholder' && typeof body.name === 'string') out.placeholders.push({ path: [...at, 'name'], name: body.name, scope });
		if (SEQUENCE_VALUES.has(kind)) out.sequenceRefs.push({ path: [...at, 'sequenceName'], name: nameOf(body.sequenceName), scope });
		for (const [field, child] of Object.entries(body)) {
			if (VALUE_VALUE_FIELDS.has(field)) visitValue(child, [...at, field], scope, false);
			else if (VALUE_LIST_FIELDS.has(field)) asArray(child).forEach((item, i) => visitValue(item, [...at, field, i], scope, false));
		}
	};

	const visitAction = (action: Json, path: JsonPath, scope: Scope, nested: boolean) => {
		if (!isObject(action)) action = {};
		const site = action as JsonObject;
		out.actions.push({ path, action: site, scope, nested });
		if (site.condition !== undefined) visitValue(site.condition, [...path, 'condition'], scope, true);
		const kind = actionKind(site);
		if (!kind) return;
		const body = site[kind];
		if (!isObject(body)) {
			if (REQUIRED_VALUES[kind]) out.missing.push({ path: [...path, kind], what: REQUIRED_VALUES[kind].what, scope });
			return;
		}
		const at = [...path, kind];
		if (kind === 'groupReference') {
			const variables = new Map<string, JsonPath>();
			asArray(body.variables).forEach((variable, i) => {
				if (!isObject(variable)) return;
				const path = [...at, 'variables', i, 'value'];
				if (typeof variable.name === 'string') variables.set(variable.name, path);
				visitValue(variable.value, path, scope, false);
			});
			out.groupReferences.push({ path: [...at, 'groupName'], name: nameOf(body.groupName), scope, variables });
			return;
		}
		if (kind === 'sequence' && typeof body.name === 'string') out.sequences.push({ path: [...at, 'name'], name: body.name, scope });
		if (kind === 'resetSequence') out.sequenceRefs.push({ path: [...at, 'sequenceName'], name: nameOf(body.sequenceName), scope });
		const required = REQUIRED_VALUES[kind];
		if (required && body[required.field] === undefined) out.missing.push({ path: at, what: required.what, scope });
		for (const [field, child] of Object.entries(body)) {
			if (ACTION_VALUE_FIELDS.has(field)) visitValue(child, [...at, field], scope, false);
			else if (field === 'innerAction') visitAction(child, [...at, field], scope, true);
			else if (field === 'actions') asArray(child).forEach((item, i) => visitAction(item, [...at, field, i], scope, true));
		}
	};

	asArray(apl.prepullActions).forEach((row, i) => {
		if (!isObject(row)) return;
		const scope: Scope = { hidden: row.hide === true, list: 'prepullActions' };
		visitAction(row.action, ['prepullActions', i, 'action'], scope, false);
		visitValue(row.doAtValue, ['prepullActions', i, 'doAtValue'], scope, false);
	});
	asArray(apl.priorityList).forEach((row, i) => {
		if (!isObject(row)) return;
		visitAction(row.action, ['priorityList', i, 'action'], { hidden: row.hide === true, list: 'priorityList' }, false);
	});
	asArray(apl.groups).forEach((group, g) => {
		if (!isObject(group)) return;
		asArray(group.variables).forEach((variable, v) => {
			if (isObject(variable))
				visitValue(variable.value, ['groups', g, 'variables', v, 'value'], { hidden: false, list: 'groupActions', group: g }, false);
		});
		asArray(group.actions).forEach((row, i) => {
			if (!isObject(row)) return;
			visitAction(row.action, ['groups', g, 'actions', i, 'action'], { hidden: row.hide === true, list: 'groupActions', group: g }, false);
		});
	});
	asArray(apl.valueVariables).forEach((variable, i) => {
		if (isObject(variable)) visitValue(variable.value, ['valueVariables', i, 'value'], undefined, false);
	});
	return out;
}

const live = (scope: Scope | undefined) => !scope?.hidden;

// Whether a live row of group `g` reads the placeholder `name`.
const groupReadsPlaceholder = (c: Collected, g: number, name: string) =>
	c.placeholders.some(placeholder => live(placeholder.scope) && placeholder.scope?.group === g && placeholder.name === name);

// --- Constants ---

// A Go duration: an optional sign, then one or more number-unit pairs.
const GO_DURATION = /^[-+]?(?:(?:\d+\.?\d*|\.\d+)(?:ns|us|µs|μs|ms|s|m|h))+$/;
const UNIT_SECONDS: Record<string, number> = { ns: 1e-9, us: 1e-6, µs: 1e-6, μs: 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 };

// A constant's number as the sim parses `const`: a duration in seconds, an integer, a percent as a
// fraction, or a float. Every number type reads as the same value in seconds when compared with a duration.
function constNumber(val: string): number | undefined {
	if (val === '0') return 0;
	if (GO_DURATION.test(val)) {
		const sign = val.startsWith('-') ? -1 : 1;
		let seconds = 0;
		for (const [, amount, unit] of val.matchAll(/(\d+\.?\d*|\.\d+)(ns|us|µs|μs|ms|s|m|h)/g)) seconds += Number(amount) * UNIT_SECONDS[unit];
		return sign * seconds;
	}
	if (/^[-+]?\d+$/.test(val)) return Number(val);
	if (val.length > 1 && val.endsWith('%')) {
		const number = Number(val.slice(0, -1));
		if (val.slice(0, -1).trim() !== '' && Number.isFinite(number)) return number / 100;
	}
	const number = Number(val);
	return val.trim() !== '' && Number.isFinite(number) ? number : undefined;
}

function constOf(value: Json): string | undefined {
	if (valueKind(value) !== 'const') return undefined;
	const body = (value as JsonObject).const;
	return isObject(body) && typeof body.val === 'string' ? body.val : isObject(body) ? '' : undefined;
}

// What a constant reads as for a condition: `true`/`false` in any case, otherwise true unless empty
// (a `const` of "0" coerced to a condition is true).
function constBool(val: string): boolean {
	const lower = val.toLowerCase();
	if (lower === 'false') return false;
	return lower === 'true' || val !== '';
}

const COMPARE: Record<string, (a: number, b: number) => boolean> = {
	OpEq: (a, b) => a === b,
	OpNe: (a, b) => a !== b,
	OpLt: (a, b) => a < b,
	OpLe: (a, b) => a <= b,
	OpGt: (a, b) => a > b,
	OpGe: (a, b) => a >= b,
};

// Whether a value present in the file is one the sim builds: an empty value, or an operator whose
// operands are all empty, comes out as nothing.
function absent(value: Json): boolean {
	const kind = valueKind(value);
	if (!kind) return true;
	const body = (value as JsonObject)[kind];
	if (kind === 'and' || kind === 'or') return !isObject(body) || asArray(body.vals).every(absent);
	if (kind === 'not') return !isObject(body) || absent(body.val);
	if (kind === 'cmp') return !isObject(body) || absent(body.lhs) || absent(body.rhs);
	return false;
}

// The value's truth if it is the same whatever happens in the fight, read as a condition.
function constantTruth(value: Json): boolean | undefined {
	const kind = valueKind(value);
	if (!kind) return undefined;
	const body = (value as JsonObject)[kind];
	if (kind === 'const') return constBool(constOf(value) ?? '');
	if (!isObject(body)) return undefined;
	if (kind === 'not') return absent(body.val) ? undefined : negate(constantTruth(body.val));
	if (kind === 'and' || kind === 'or') {
		const vals = asArray(body.vals).filter(val => !absent(val));
		if (vals.length === 0) return undefined;
		const truths = vals.map(constantTruth);
		const decisive = kind === 'or';
		if (truths.includes(decisive)) return decisive;
		return truths.every(truth => truth === !decisive) ? !decisive : undefined;
	}
	if (kind === 'cmp') {
		const lhs = constOf(body.lhs);
		const rhs = constOf(body.rhs);
		const compare = typeof body.op === 'string' ? COMPARE[body.op] : undefined;
		if (lhs === undefined || rhs === undefined || !compare) return undefined;
		const a = constNumber(lhs);
		const b = constNumber(rhs);
		return a === undefined || b === undefined ? undefined : compare(a, b);
	}
	return undefined;
}

function negate(truth: boolean | undefined): boolean | undefined {
	return truth === undefined ? undefined : !truth;
}

// The most specific operators inside a condition that read the same whatever happens, when the
// condition as a whole does not.
function constantParts(value: Json, path: JsonPath, found: Array<{ path: JsonPath; truth: boolean; kind: string }>): void {
	const kind = valueKind(value);
	if (!kind || kind === 'const') return;
	const body = (value as JsonObject)[kind];
	if (!isObject(body)) return;
	if (kind === 'cmp' || kind === 'not' || kind === 'and' || kind === 'or') {
		const truth = absent(value) ? undefined : constantTruth(value);
		if (truth !== undefined) {
			found.push({ path, truth, kind });
			return;
		}
	}
	for (const field of ['val', 'lhs', 'rhs']) if (body[field] !== undefined) constantParts(body[field], [...path, kind, field], found);
	asArray(body.vals).forEach((val, i) => constantParts(val, [...path, kind, 'vals', i], found));
}

// --- Names ---

function rowLabel(path: JsonPath): string {
	if (path[0] === 'groups') return `row ${Number(path[3]) + 1} of the group`;
	return `row ${Number(path[1]) + 1}`;
}

// The kinds whose state lasts between evaluations: two of them are two separate states, never a copy.
const STATEFUL = new Set(['sequence', 'strictSequence', 'groupReference', 'schedule']);

// --- Checks ---

export function lintApl(apl: unknown): LintFinding[] {
	if (!isObject(apl)) return [];
	const findings: LintFinding[] = [];
	const report = (path: JsonPath, severity: LintSeverity, code: string, message: string) => findings.push({ path, severity, code, message });
	const c = collect(apl);

	const groups = asArray(apl.groups).map(group => (isObject(group) ? group : {}));
	const groupNames = new Set(groups.map(group => group.name).filter((name): name is string => typeof name === 'string'));
	const referencedGroups = new Set(c.groupReferences.map(ref => ref.name));
	const usedGroups = new Set(c.groupUsed.map(ref => ref.name));

	// Toggle groups: every row's action empty.
	const toggles = new Set<number>();
	groups.forEach((group, g) => {
		const rows = asArray(group.actions);
		if (rows.length && rows.every(row => !actionKind(isObject(row) ? row.action : undefined))) toggles.add(g);
	});

	for (const site of c.actions) {
		if (!live(site.scope) || actionKind(site.action)) continue;
		if (!site.nested && site.scope.group !== undefined && toggles.has(site.scope.group)) continue;
		report(site.path, 'error', 'empty-action', 'No action set; the sim skips this.');
	}

	// The reference values that fill a placeholder: the sim fails on an empty one.
	const filling = new Set<string>();
	for (const ref of c.groupReferences) {
		const g = groups.findIndex(group => group.name === ref.name);
		if (g < 0) continue;
		for (const [name, path] of ref.variables) if (groupReadsPlaceholder(c, g, name)) filling.add(path.join('/'));
	}
	for (const site of c.values) {
		if (!live(site.scope) || valueKind(site.value)) continue;
		const fallback = EMPTY_FALLBACK[site.path.slice(-2).join('.')];
		const crashes = REQUIRED_VALUES[String(site.path.at(-2))]?.field === site.path.at(-1) || filling.has(site.path.join('/'));
		if (site.condition) report(site.path, 'warning', 'empty-value', 'No value set; the sim reads it as no condition, so the row always runs.');
		else if (site.path.at(-2) === 'vals') report(site.path, 'info', 'empty-value', 'No value set; the sim leaves it out of the list.');
		else if (fallback) report(site.path, 'info', 'empty-value', `No value set; the sim ${fallback}.`);
		else if (crashes) report(site.path, 'error', 'empty-value', 'No value set; the sim fails to run.');
		else report(site.path, 'warning', 'empty-value', 'No value set; the sim drops it and what holds it.');
	}
	for (const site of c.missing) {
		if (live(site.scope)) report(site.path, 'error', 'empty-value', `No ${site.what} set; the sim fails to run.`);
	}

	for (const ref of c.groupReferences) {
		if (!groupNames.has(ref.name))
			report(ref.path, 'error', 'undefined-group', ref.name ? `No group is named "${ref.name}".` : 'No group name set; the sim skips this.');
	}
	for (const ref of c.groupUsed) {
		if (!live(ref.scope)) continue;
		if (!groupNames.has(ref.name))
			report(
				ref.path,
				'warning',
				'group-never-used',
				ref.name ? `No group is named "${ref.name}", so this is always false.` : 'No group name set, so this is always false.',
			);
		else if (!referencedGroups.has(ref.name))
			report(ref.path, 'warning', 'group-never-used', `No row references group "${ref.name}", so this is always false.`);
	}
	groups.forEach((group, g) => {
		if (typeof group.name === 'string' && !referencedGroups.has(group.name) && !usedGroups.has(group.name)) {
			report(['groups', g, 'name'], 'info', 'unused-group', `Nothing references group "${group.name}".`);
		}
	});

	// Sequences: the sim finds them among the live priority list and group rows.
	const liveSequences = new Set(c.sequences.filter(seq => live(seq.scope) && seq.scope?.list !== 'prepullActions').map(seq => seq.name));
	const anySequences = new Set(c.sequences.map(seq => seq.name));
	for (const ref of c.sequenceRefs) {
		if (liveSequences.has(ref.name)) continue;
		const where = !ref.name
			? 'No sequence name set.'
			: anySequences.has(ref.name)
				? `Only a hidden or prepull row carries sequence "${ref.name}"; the sim does not find it.`
				: `No sequence is named "${ref.name}".`;
		report(ref.path, 'warning', 'undefined-sequence', where);
	}

	// Variables.
	const variables = asArray(apl.valueVariables).map(variable => (isObject(variable) ? variable : {}));
	const variableNames = new Set<string>();
	variables.forEach((variable, i) => {
		if (typeof variable.name !== 'string') return;
		if (variableNames.has(variable.name)) {
			report(
				['valueVariables', i, 'name'],
				'warning',
				'duplicate-variable',
				`An earlier variable is also named "${variable.name}"; references read that one.`,
			);
		}
		variableNames.add(variable.name);
	});
	// What a group's variables and its references set. The sim reads a group row's references as the value variables'
	// and lets these replace one only where a value variable of the name exists.
	const groupVariables = groups.map(group => {
		const names = new Set<string>();
		for (const variable of asArray(group.variables)) if (isObject(variable) && typeof variable.name === 'string') names.add(variable.name);
		for (const ref of c.groupReferences) if (ref.name === group.name) for (const name of ref.variables.keys()) names.add(name);
		return names;
	});
	const referencedVariables = new Set(c.variableRefs.map(ref => ref.name));
	for (const ref of c.variableRefs) {
		if (variableNames.has(ref.name)) continue;
		const message = !ref.name
			? 'No variable name set; the sim drops this.'
			: ref.scope?.group !== undefined && groupVariables[ref.scope.group].has(ref.name)
				? `Only the group's variables or a reference to it set "${ref.name}"; they replace a value variable of that name, and there is none, so the sim drops this.`
				: `No variable is named "${ref.name}".`;
		report(ref.path, 'error', 'undefined-variable', message);
	}
	variables.forEach((variable, i) => {
		if (typeof variable.name === 'string' && !referencedVariables.has(variable.name)) {
			report(['valueVariables', i, 'name'], 'info', 'unused-variable', `Nothing references variable "${variable.name}".`);
		}
	});

	// Placeholders: each live reference to a group must fill every placeholder the group's live rows read.
	const groupPlaceholders = groups.map(() => new Set<string>());
	for (const placeholder of c.placeholders) {
		if (!live(placeholder.scope)) continue;
		if (placeholder.scope?.group === undefined) {
			report(
				placeholder.path,
				'warning',
				'placeholder-outside',
				`Placeholder "${placeholder.name}" is outside a group; nothing fills it, so it reads as 0 or false.`,
			);
		} else {
			groupPlaceholders[placeholder.scope.group].add(placeholder.name);
		}
	}
	for (const ref of c.groupReferences) {
		const g = groups.findIndex(group => group.name === ref.name);
		if (g < 0) continue;
		const missing = [...groupPlaceholders[g]].filter(name => !ref.variables.has(name));
		if (missing.length) {
			report(ref.path, 'error', 'placeholder-unset', `Group "${ref.name}" needs ${missing.map(name => `"${name}"`).join(', ')} set on this reference.`);
		}
	}

	lintPrepull(apl, variables, report);
	lintConditions(c, report);
	lintShadowed(apl, report);
	return findings;
}

type Report = (path: JsonPath, severity: LintSeverity, code: string, message: string) => void;

// The seconds a Do At value reads as before the fight: a constant, a variable holding one, or arithmetic
// on those. Undefined when it reads something only the fight knows.
function constantSeconds(value: Json, variables: JsonObject[], seen: Set<string> = new Set()): number | undefined {
	const kind = valueKind(value);
	if (!kind) return undefined;
	const body = (value as JsonObject)[kind];
	if (kind === 'const') return constNumber(constOf(value) ?? '') ?? NaN;
	if (!isObject(body)) return undefined;
	if (kind === 'variableRef' && typeof body.name === 'string' && !seen.has(body.name)) {
		const variable = variables.find(v => v.name === body.name);
		return variable ? constantSeconds(variable.value, variables, new Set([...seen, body.name])) : undefined;
	}
	if (kind === 'math') {
		const a = constantSeconds(body.lhs, variables, seen);
		const b = constantSeconds(body.rhs, variables, seen);
		if (a === undefined || b === undefined) return undefined;
		return body.op === 'OpAdd' ? a + b : body.op === 'OpSub' ? a - b : body.op === 'OpMul' ? a * b : body.op === 'OpDiv' ? a / b : undefined;
	}
	if (kind === 'max' || kind === 'min') {
		const all = asArray(body.vals).map(val => constantSeconds(val, variables, seen));
		if (!all.length || all.some(n => n === undefined)) return undefined;
		return (kind === 'max' ? Math.max : Math.min)(...(all as number[]));
	}
	return undefined;
}

// The value kinds whose duration needs no fight: the sim reads them before the pull with no harm.
const STATIC_DURATIONS = new Set(['spellCastTime', 'spellGcdHastedDuration', 'inputDelay', 'channelClipDelay', 'dotBaseDuration', 'auraDuration']);

// Whether a Do At value reads nothing of the fight: constants, those durations, and variables and arithmetic on them.
function isStatic(value: Json, variables: JsonObject[], seen: Set<string> = new Set()): boolean {
	const kind = valueKind(value);
	if (!kind) return false;
	const body = (value as JsonObject)[kind];
	if (kind === 'const' || STATIC_DURATIONS.has(kind)) return true;
	if (!isObject(body)) return false;
	if (kind === 'variableRef') {
		const variable = typeof body.name === 'string' && !seen.has(body.name) ? variables.find(v => v.name === body.name) : undefined;
		return !!variable && isStatic(variable.value, variables, new Set([...seen, String(body.name)]));
	}
	if (kind === 'math') return isStatic(body.lhs, variables, seen) && isStatic(body.rhs, variables, seen);
	if (kind === 'max' || kind === 'min') return asArray(body.vals).length > 0 && asArray(body.vals).every(val => isStatic(val, variables, seen));
	return false;
}

function formatSeconds(seconds: number): string {
	return `${Number(seconds.toFixed(3))}s`;
}

function lintPrepull(apl: JsonObject, variables: JsonObject[], report: Report): void {
	let latest: { seconds: number; row: number } | undefined;
	asArray(apl.prepullActions).forEach((row, i) => {
		if (!isObject(row) || row.hide === true) return;
		const condition = isObject(row.action) ? row.action.condition : undefined;
		if (condition !== undefined && !absent(condition) && constOf(condition) === undefined) {
			report(
				['prepullActions', i, 'action', 'condition'],
				'warning',
				'prepull-condition',
				"The sim does not read a prepull row's condition; the action runs at its Do At time.",
			);
		}
		const path: JsonPath = ['prepullActions', i, 'doAtValue'];
		if (row.doAtValue === undefined || absent(row.doAtValue)) {
			report(row.doAtValue === undefined ? ['prepullActions', i] : path, 'warning', 'prepull-no-time', 'No Do At time; the sim skips this prepull row.');
			return;
		}
		const seconds = constantSeconds(row.doAtValue, variables);
		if (seconds === undefined) {
			if (!isStatic(row.doAtValue, variables))
				report(
					path,
					'warning',
					'prepull-not-time',
					'Do At is read once, before the fight, where a value of the fight is not there to read and can fail the sim: write a time such as "-1.5s".',
				);
			return;
		}
		if (Number.isNaN(seconds)) {
			report(path, 'warning', 'prepull-not-time', 'Do At is not a time; the sim reads it as 0s.');
			return;
		}
		if (seconds > 0) {
			report(
				path,
				'warning',
				'prepull-positive-time',
				`Do At ${formatSeconds(seconds)} is after the pull; the sim ignores this prepull row. Prepull times are 0s or earlier.`,
			);
			return;
		}
		if (latest && seconds < latest.seconds) {
			report(
				path,
				'info',
				'prepull-order',
				`Runs at ${formatSeconds(seconds)}, before row ${latest.row + 1} above it at ${formatSeconds(latest.seconds)}: prepull rows run in time order, not list order.`,
			);
		}
		if (!latest || seconds >= latest.seconds) latest = { seconds, row: i };
	});
}

function lintConditions(c: Collected, report: Report): void {
	for (const site of c.values) {
		if (!site.condition || !live(site.scope) || absent(site.value)) continue;
		const truth = constantTruth(site.value);
		if (truth === false) {
			const literal = constOf(site.value) !== undefined;
			report(
				site.path,
				literal ? 'info' : 'warning',
				'never-runs',
				literal ? 'Always false: this never runs. The sim still keeps its spell out of automatic cooldown use.' : 'Always false: this never runs.',
			);
			continue;
		}
		if (truth === true) {
			report(site.path, 'info', 'always-true', 'Always true: the same as no condition.');
			continue;
		}
		const parts: Array<{ path: JsonPath; truth: boolean; kind: string }> = [];
		constantParts(site.value, site.path, parts);
		for (const part of parts) {
			report(part.path, 'info', 'always-true', `This ${part.kind === 'cmp' ? 'comparison' : `"${part.kind}"`} is always ${part.truth}.`);
		}
	}
}

// A row is shadowed when an earlier live row of the same list takes the same action, with no condition
// or the same one: the later row is only reached when that action cannot run, and then it cannot either.
// Prepull rows each run at their own time, and stateful actions keep a state per row, so neither is compared.
function lintShadowed(apl: JsonObject, report: Report): void {
	const lists: Array<{ rows: Json[]; path: JsonPath }> = [{ rows: asArray(apl.priorityList), path: ['priorityList'] }];
	asArray(apl.groups).forEach((group, g) => {
		if (isObject(group)) lists.push({ rows: asArray(group.actions), path: ['groups', g, 'actions'] });
	});
	for (const { rows, path } of lists) {
		const earlier: Array<{ action: JsonObject; index: number }> = [];
		rows.forEach((row, i) => {
			if (!isObject(row) || row.hide === true || !isObject(row.action)) return;
			const action = row.action;
			const kind = actionKind(action);
			if (!kind || STATEFUL.has(kind)) return;
			const condition = action.condition !== undefined && !absent(action.condition) ? action.condition : undefined;
			if (condition !== undefined && constantTruth(condition) === false) return;
			const by = earlier.find(({ action: before }) => {
				if (!sameJson(before[kind], action[kind]) || actionKind(before) !== kind) return false;
				const beforeCondition = before.condition !== undefined && !absent(before.condition) ? before.condition : undefined;
				return beforeCondition === undefined || constantTruth(beforeCondition) === true || sameJson(beforeCondition, condition);
			});
			if (by) {
				const how = by.action.condition === undefined || absent(by.action.condition) ? 'no condition' : 'the same condition';
				report(
					[...path, i],
					'warning',
					'shadowed-row',
					`${rowLabel([...path, by.index])} above takes this action with ${how}, so this row never runs.`,
				);
			}
			earlier.push({ action, index: i });
		});
	}
}
