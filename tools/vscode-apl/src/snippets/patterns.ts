// Common APL patterns as JSON fragments of an APLRotation, each with the values a reader fills in. The shapes
// are the ones the repository's APL files use: the toggle groups of the warrior files, the `Use ...` switch
// variables of the hunter and retribution files, DoT and debuff refreshes, execute rows and prepull casts.

import type { AplEdit, JsonPath } from '../protocol';

// What a placeholder takes. A spell, an aura on the player (`aura`) or one on the target (`target_aura`) is an
// ActionID of the spec's names, which reads in the namespace of the position the pattern writes it in.
export type PlaceholderKind = 'spell' | 'aura' | 'target_aura' | 'duration' | 'number' | 'group' | 'variable' | 'choice';

export interface AplPlaceholder {
	name: string;
	label: string;
	kind: PlaceholderKind;
	default?: unknown; // Left out when the reader must give one, or when `optional` lets it be left out.
	optional?: boolean;
	existing?: boolean; // A group or variable the rotation has, rather than a new one's name.
	options?: string[]; // What a `choice` takes.
}

// Where a pattern's main piece goes: a row of the priority list or a group, a condition, a group with the row
// that references it, or prepull rows.
export type PatternTarget = 'row' | 'condition' | 'group' | 'prepull';

// What a pattern builds, by the part of the rotation each piece belongs to.
export interface AplFragment {
	rows?: unknown[]; // APLListItem, for the row list the pattern is inserted into.
	prepullRows?: unknown[]; // APLPrepullAction.
	groups?: unknown[]; // APLGroup, appended to `groups`.
	valueVariables?: unknown[]; // APLValueVariable, appended to `valueVariables`.
	condition?: unknown; // APLValue.
}

export interface AplPattern {
	id: string;
	label: string;
	description: string;
	target: PatternTarget;
	placeholders: AplPlaceholder[];
	build(values: Record<string, unknown>): AplFragment;
}

type Json = Record<string, unknown>;

// An action id from a placeholder: a spell id number, or an action id object as the file writes one.
function actionId(value: unknown): Json {
	if (typeof value === 'number') return { spellId: value };
	if (value && typeof value === 'object' && !Array.isArray(value)) return value as Json;
	return { spellId: Number(value) || 0 };
}

// A time as `const` takes it: a string as written ("1.5s", "-3s"), a number as seconds.
function duration(value: unknown): string {
	return typeof value === 'number' ? `${value}s` : String(value);
}

const constant = (val: string) => ({ const: { val } });
const cast = (spell: unknown) => ({ castSpell: { spellId: actionId(spell) } });
const cmp = (op: string, lhs: unknown, rhs: unknown) => ({ cmp: { op, lhs, rhs } });
const row = (action: Json, condition?: unknown) => ({ action: condition === undefined ? action : { condition, ...action } });

// The resources a threshold reads, and whether the amount is a percent.
const RESOURCES: Record<string, { label: string; percent: boolean }> = {
	currentManaPercent: { label: 'mana %', percent: true },
	currentHealthPercent: { label: 'health %', percent: true },
	currentRage: { label: 'rage', percent: false },
	currentEnergy: { label: 'energy', percent: false },
	currentComboPoints: { label: 'combo points', percent: false },
};

function resourceAtLeast(values: Record<string, unknown>) {
	const resource = String(values.resource);
	const amount = String(values.amount);
	return cmp('OpGe', { [resource]: {} }, constant(RESOURCES[resource]?.percent ? `${amount}%` : amount));
}

const EXECUTE_THRESHOLDS = ['E20', 'E25', 'E35', 'E45', 'E90'];

const spell = (name = 'spell', label = 'Spell'): AplPlaceholder => ({ name, label, kind: 'spell' });
const threshold: AplPlaceholder = { name: 'threshold', label: 'Execute below', kind: 'choice', options: EXECUTE_THRESHOLDS, default: 'E20' };
const resource: AplPlaceholder = { name: 'resource', label: 'Resource', kind: 'choice', options: Object.keys(RESOURCES), default: 'currentManaPercent' };

export const APL_PATTERNS: AplPattern[] = [
	{
		id: 'refresh-dot',
		label: 'Refresh a DoT',
		description: 'Casts a DoT when it is off the target or its remaining time is at or below a threshold.',
		target: 'row',
		placeholders: [spell('spell', 'DoT'), { name: 'remaining', label: 'Refresh at', kind: 'duration', default: '1.5s' }],
		build: v => ({ rows: [row(cast(v.spell), cmp('OpLe', { dotRemainingTime: { spellId: actionId(v.spell) } }, constant(duration(v.remaining))))] }),
	},
	{
		id: 'keep-debuff',
		label: 'Keep a debuff on the target',
		description: 'Casts a spell when its debuff on the current target is missing or about to run out.',
		target: 'row',
		placeholders: [
			spell('spell', 'Spell'),
			{ name: 'aura', label: 'Debuff (default: the spell)', kind: 'target_aura', optional: true },
			{ name: 'remaining', label: 'Refresh at', kind: 'duration', default: '3s' },
		],
		build: v => ({
			rows: [
				row(
					cast(v.spell),
					cmp(
						'OpLe',
						{ auraRemainingTime: { sourceUnit: { type: 'CurrentTarget' }, auraId: actionId(v.aura ?? v.spell) } },
						constant(duration(v.remaining)),
					),
				),
			],
		}),
	},
	{
		id: 'keep-buff',
		label: 'Keep a buff up',
		description: 'Casts a spell whenever its buff is not on you.',
		target: 'row',
		placeholders: [spell('spell', 'Spell'), { name: 'aura', label: 'Buff (default: the spell)', kind: 'aura', optional: true }],
		build: v => ({ rows: [row(cast(v.spell), { not: { val: { auraIsActive: { auraId: actionId(v.aura ?? v.spell) } } } })] }),
	},
	{
		id: 'cooldown-during-aura',
		label: 'Use a cooldown while another is active',
		description: 'Casts a spell only while an aura, such as another cooldown, is on you.',
		target: 'row',
		placeholders: [spell('spell', 'Cooldown'), { name: 'aura', label: 'While active', kind: 'aura' }],
		build: v => ({ rows: [row(cast(v.spell), { auraIsActive: { auraId: actionId(v.aura) } })] }),
	},
	{
		id: 'line-up-cooldowns',
		label: 'Line up two cooldowns',
		description: 'Casts a cooldown while another one is active, or when the other is too far from ready to wait for.',
		target: 'row',
		placeholders: [
			spell('spell', 'Cooldown'),
			spell('other', 'Line up with'),
			{ name: 'otherAura', label: 'Its aura (default: that spell)', kind: 'aura', optional: true },
			{ name: 'maxWait', label: 'Wait at most', kind: 'duration', default: '20s' },
		],
		build: v => ({
			rows: [
				row(cast(v.spell), {
					or: {
						vals: [
							{ auraIsActive: { auraId: actionId(v.otherAura ?? v.other) } },
							cmp('OpGt', { spellTimeToReady: { spellId: actionId(v.other) } }, constant(duration(v.maxWait))),
						],
					},
				}),
			],
		}),
	},
	{
		id: 'execute-cast',
		label: 'Cast in the execute phase',
		description: 'Casts a spell only once the target is below the execute threshold.',
		target: 'row',
		placeholders: [spell('spell', 'Spell'), threshold],
		build: v => ({ rows: [row(cast(v.spell), { isExecutePhase: { threshold: v.threshold } })] }),
	},
	{
		id: 'execute-group',
		label: 'Execute-phase block',
		description: 'A group of rows that runs only in the execute phase, and the row that references it.',
		target: 'group',
		placeholders: [{ name: 'group', label: 'Group name', kind: 'group', default: 'Execute' }, threshold],
		build: v => ({
			groups: [{ name: String(v.group), actions: [] }],
			rows: [row({ groupReference: { groupName: String(v.group) } }, { isExecutePhase: { threshold: v.threshold } })],
		}),
	},
	{
		id: 'outside-execute',
		label: 'Outside the execute phase',
		description: 'True while the target is above the execute threshold.',
		target: 'condition',
		placeholders: [threshold],
		build: v => ({ condition: { not: { val: { isExecutePhase: { threshold: v.threshold } } } } }),
	},
	{
		id: 'resource-above',
		label: 'Resource at or above',
		description: 'True while a resource is at or above an amount; percent resources take a percent.',
		target: 'condition',
		placeholders: [resource, { name: 'amount', label: 'At least', kind: 'number', default: 10 }],
		build: v => ({ condition: resourceAtLeast(v) }),
	},
	{
		id: 'cast-above-resource',
		label: 'Cast above a resource amount',
		description: 'Casts a spell only while a resource is at or above an amount, keeping some back for higher rows.',
		target: 'row',
		placeholders: [spell('spell', 'Spell'), resource, { name: 'amount', label: 'At least', kind: 'number', default: 10 }],
		build: v => ({ rows: [row(cast(v.spell), resourceAtLeast(v))] }),
	},
	{
		id: 'toggle-group',
		label: 'On/off toggle',
		description:
			'An empty group and the row that references it: hiding the row turns the toggle off. Conditions read it with "Toggle is on" (actionGroupUsed).',
		target: 'group',
		placeholders: [{ name: 'group', label: 'Toggle name', kind: 'group', default: 'Toggle ON/OFF' }],
		build: v => ({
			groups: [{ name: String(v.group), actions: [{ action: {} }] }],
			rows: [row({ groupReference: { groupName: String(v.group) } })],
		}),
	},
	{
		id: 'toggle-is-on',
		label: 'Toggle is on',
		description: 'True while the row referencing a toggle group is shown.',
		target: 'condition',
		placeholders: [{ name: 'group', label: 'Toggle', kind: 'group', existing: true }],
		build: v => ({ condition: { actionGroupUsed: { name: String(v.group) } } }),
	},
	{
		id: 'switch-variable',
		label: 'Row behind a switch variable',
		description: 'A "Use ..." variable set to true or false, and a row that casts the spell only while it is true.',
		target: 'row',
		placeholders: [spell('spell', 'Spell'), { name: 'variable', label: 'Variable name', kind: 'variable', default: 'Use spell' }],
		build: v => ({
			valueVariables: [{ name: String(v.variable), value: constant('true') }],
			rows: [row(cast(v.spell), { variableRef: { name: String(v.variable) } })],
		}),
	},
	{
		id: 'potion-at-pull',
		label: 'Potion',
		description: 'Drinks the selected potion as soon as it is ready; placed near the top, that is at the pull.',
		target: 'row',
		placeholders: [],
		build: () => ({ rows: [row({ castSpell: { spellId: { otherId: 'OtherActionPotion' } } })] }),
	},
	{
		id: 'prepull-cast',
		label: 'Prepull cast',
		description: 'Casts a spell at a time before the pull.',
		target: 'prepull',
		placeholders: [spell('spell', 'Spell'), { name: 'at', label: 'At', kind: 'duration', default: '-1.5s' }],
		build: v => ({ prepullRows: [{ action: cast(v.spell), doAtValue: constant(duration(v.at)) }] }),
	},
	{
		id: 'prepull-sequence',
		label: 'Prepull sequence',
		description: 'Casts up to three spells before the pull, the first at a start time and each next one a gap later.',
		target: 'prepull',
		placeholders: [
			spell('first', 'First spell'),
			spell('second', 'Second spell'),
			{ name: 'third', label: 'Third spell', kind: 'spell', optional: true },
			{ name: 'start', label: 'First at', kind: 'duration', default: '-3s' },
			{ name: 'gap', label: 'Gap', kind: 'duration', default: '1.5s' },
		],
		build: v => {
			const start = seconds(v.start);
			const gap = seconds(v.gap);
			const spells = [v.first, v.second, v.third].filter(spell => spell !== undefined && spell !== null && spell !== '');
			return { prepullRows: spells.map((spell, i) => ({ action: cast(spell), doAtValue: constant(`${Number((start + i * gap).toFixed(3))}s`) })) };
		},
	},
];

// Seconds from a placeholder time: a number, or a simple time string ("1.5s", "500ms", "-3").
function seconds(value: unknown): number {
	if (typeof value === 'number') return value;
	const match = /^([-+]?\d*\.?\d+)(ms|s|m)?$/.exec(String(value).trim());
	if (!match) return 0;
	const amount = Number(match[1]);
	return match[2] === 'ms' ? amount / 1000 : match[2] === 'm' ? amount * 60 : amount;
}

// A pattern's values with the defaults filled in for those the reader left out.
export function withDefaults(pattern: AplPattern, values: Record<string, unknown> = {}): Record<string, unknown> {
	const filled: Record<string, unknown> = { ...values };
	for (const placeholder of pattern.placeholders) {
		if (filled[placeholder.name] === undefined && placeholder.default !== undefined) filled[placeholder.name] = placeholder.default;
	}
	return filled;
}

export interface PatternPlacement {
	list?: JsonPath; // The row list a row pattern goes in: ['priorityList'] or ['groups', g, 'actions'].
	index?: number; // Where in that list; the end when left out.
	condition?: JsonPath; // The action whose condition a condition pattern joins, e.g. ['priorityList', 3, 'action'].
}

// Where a pattern goes for a rotation path: after the row the path is in (an index of -1 is the start of an empty
// list), and for a condition pattern, onto that row's action. A condition has no place outside a priority or group
// row: the sim does not read a prepull row's condition. Outside any row, a row pattern goes at the end of the priority
// list.
export function placementAt(path: JsonPath, target: PatternTarget): PatternPlacement {
	const row =
		path[0] === 'groups' && typeof path[1] === 'number' && path[2] === 'actions' && typeof path[3] === 'number'
			? path.slice(0, 4)
			: (path[0] === 'priorityList' || path[0] === 'prepullActions') && typeof path[1] === 'number'
				? path.slice(0, 2)
				: undefined;
	if (!row || row[0] === 'prepullActions') return {};
	const index = row[row.length - 1] as number;
	if (target === 'condition') return index >= 0 ? { condition: [...row, 'action'] } : {};
	return { list: row.slice(0, -1), index: index + 1 };
}

function isObject(json: unknown): json is Json {
	return !!json && typeof json === 'object' && !Array.isArray(json);
}

function at(json: unknown, path: JsonPath): unknown {
	return path.reduce<unknown>((node, key) => (node !== null && typeof node === 'object' ? (node as Record<string | number, unknown>)[key] : undefined), json);
}

// Appends items to a top-level list, writing the list when the file has none.
function append(apl: Json, key: string, items: unknown[] | undefined, edits: AplEdit[]): void {
	if (!items?.length) return;
	const list = Array.isArray(apl[key]) ? (apl[key] as unknown[]) : undefined;
	if (!list) {
		edits.push({ op: 'set', path: [key], value: items });
		return;
	}
	items.forEach((item, i) => edits.push({ op: 'insert', path: [key], index: list.length + i, value: item }));
}

// The prepull time a row runs at, when it is a plain constant time.
function prepullSeconds(row: unknown): number | undefined {
	const val = at(row, ['doAtValue', 'const', 'val']);
	return typeof val === 'string' && /^[-+]?\d*\.?\d+(ms|s|m)?$/.test(val.trim()) ? seconds(val) : undefined;
}

// The edits that put a built pattern into the rotation. Prepull rows go where their time keeps the prepull
// list in time order; a condition joins an action's existing condition with `and`; groups and variables are
// appended.
export function patternEdits(apl: unknown, pattern: AplPattern, values: Record<string, unknown>, placement: PatternPlacement = {}): AplEdit[] {
	const root: Json = isObject(apl) ? apl : {};
	const fragment = pattern.build(withDefaults(pattern, values));
	const edits: AplEdit[] = [];

	append(root, 'valueVariables', fragment.valueVariables, edits);
	append(root, 'groups', fragment.groups, edits);

	if (fragment.prepullRows?.length) {
		const existing = Array.isArray(root.prepullActions) ? [...root.prepullActions] : undefined;
		if (!existing) {
			edits.push({ op: 'set', path: ['prepullActions'], value: fragment.prepullRows });
		} else {
			for (const row of fragment.prepullRows) {
				const time = prepullSeconds(row);
				let index = existing.length;
				if (time !== undefined) {
					const later = existing.findIndex(other => (prepullSeconds(other) ?? -Infinity) > time);
					if (later >= 0) index = later;
				}
				edits.push({ op: 'insert', path: ['prepullActions'], index, value: row });
				existing.splice(index, 0, row);
			}
		}
	}

	if (fragment.rows?.length) {
		const listPath = placement.list ?? ['priorityList'];
		const list = at(root, listPath);
		if (!Array.isArray(list)) {
			edits.push({ op: 'set', path: listPath, value: fragment.rows });
		} else {
			const start = Math.min(Math.max(placement.index ?? list.length, 0), list.length);
			fragment.rows.forEach((row, i) => edits.push({ op: 'insert', path: listPath, index: start + i, value: row }));
		}
	}

	if (fragment.condition !== undefined && placement.condition) {
		const conditionPath = [...placement.condition, 'condition'];
		const existing = at(root, conditionPath);
		if (!isObject(existing) || Object.keys(existing).filter(key => key !== 'uuid').length === 0) {
			edits.push({ op: 'set', path: conditionPath, value: fragment.condition });
		} else if (isObject(existing.and) && Array.isArray(existing.and.vals)) {
			edits.push({ op: 'insert', path: [...conditionPath, 'and', 'vals'], index: existing.and.vals.length, value: fragment.condition });
		} else {
			edits.push({ op: 'set', path: conditionPath, value: { and: { vals: [existing, fragment.condition] } } });
		}
	}
	return edits;
}
