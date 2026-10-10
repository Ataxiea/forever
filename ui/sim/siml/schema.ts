// The schema Go generates from the protos (`go run ./sim/siml/cmd/simlschema`, written to
// ui/generated/siml/schema.json): every name and form SPEC.md §8 derives, which this module reads and never
// derives again.

import type { JsonObject } from './types.ts';

export interface SimlSchema {
	version: 1;
	keywords: string[]; // The reserved words (SPEC.md §4 note 6), without the heads and unit words.
	heads: string[]; // The accessor heads: aura, dot, spell, boss_spell, sequence.
	units: {
		words: Record<string, JsonObject>; // Each unit word's UnitReference JSON.
		indexed: Record<string, 'Target' | 'Player' | 'Pet'>; // `target2`, `player3`, `pet1`.
	};
	messages: Record<string, { fields: SchemaField[] }>; // Keyed "proto.X".
	enums: Record<string, SchemaEnum>;
	kinds: { action: KindForm[]; value: KindForm[] };
	sections: SectionDef[]; // In canonical order.
	specs: SpecDef[];
	skip: string[];
}

export type Printed =
	| 'bool'
	| 'number'
	| 'string'
	| 'enum'
	| 'flag_enum'
	| 'stat'
	| 'ref'
	| 'action_id'
	| 'unit'
	| 'value'
	| 'action'
	| 'message'
	| 'indexed'
	| 'map';

export interface SchemaField {
	name: string; // The proto name.
	siml: string; // The name a file writes.
	aliases: string[]; // Other names a file may write.
	json: string;
	number: number;
	scalar?: 'bool' | 'int32' | 'uint32' | 'int64' | 'uint64' | 'double' | 'float' | 'string' | 'bytes'; // A map's value scalar.
	type?: string; // "proto.X" for enums and messages; a map's value type.
	key?: string; // A map's key scalar.
	repeated: boolean;
	oneof?: string;
	printed: Printed;
	ref?: 'item' | 'enchant' | 'suffix'; // When printed is 'ref'.
	index?: string; // When printed is 'indexed': the enum that indexes the array.
}

export interface EnumValue {
	name: string;
	number: number;
	short: string;
}

export interface SchemaEnum {
	values: EnumValue[];
	flag?: string; // The value a bare field name sets.
}

export interface KindForm {
	kind: string; // The oneof field's proto name: "aura_is_active".
	json: string;
	message: string;
	form: 'short' | 'accessor' | 'bare' | 'unit_prefix' | 'list_args' | 'generic';
	positional?: string;
	accessor?: { head: string; prop: string; subject: string; unit?: string };
	unitField?: string;
	listField?: string;
}

export type SectionBody = 'entries' | 'slot_rows' | 'rows' | 'var';

export interface SectionSource {
	path: string[]; // JSON names from IndividualSimSettings, "*" for the spec field.
	fields?: string[]; // JSON names; all of the message's fields when absent.
	flatten?: 'spec_options' | 'spec_rotation_json';
}

export interface SectionDef {
	name: string;
	category: 'g' | 't' | 'r' | 'c' | 'm' | 'x' | 'e' | 'u' | '';
	body: SectionBody[];
	sources: SectionSource[];
	presence?: string[]; // The path of the message a present section sets.
}

export interface SpecDef {
	field: string; // The oneof field of Player's spec: "hunter", "dps_warrior".
	message: string;
	spec: string;
	class: string;
	options: string;
	classOptions?: string;
	rotation: string;
}

// The enum whose short names are the slot words of slot rows, and whose numbers are their places in the items.
export const SLOT_ENUM = 'proto.ItemSlot';
// The enum stat fields (printed 'stat') hold a value of.
export const STAT_ENUM = 'proto.Stat';
// The enum `other.<short>` names a value of.
export const OTHER_ENUM = 'proto.OtherAction';

// A message the grammar writes with a fixed form (SPEC.md §6), with its kind's JSON name in APLAction or
// APLValue ('' for a message that is no kind) and its fields' JSON names by proto name.
export interface Fixed {
	message: string;
	json: string;
	f: Record<string, string>;
}

// Every message and kind the grammar's fixed forms write. Their field names are fixed by the grammar, so a
// schema that lacks one is not a schema of these protos, and indexing it throws.
export interface Vocabulary {
	rotation: Fixed;
	listItem: Fixed;
	prepullAction: Fixed;
	group: Fixed;
	variable: Fixed;
	action: Fixed;
	value: Fixed;
	actionId: Fixed;
	unit: Fixed;
	itemSpec: Fixed;
	castSpell: Fixed;
	channelSpell: Fixed;
	wait: Fixed;
	waitUntil: Fixed;
	move: Fixed;
	moveDuration: Fixed;
	groupReference: Fixed;
	schedule: Fixed;
	sequence: Fixed;
	const: Fixed;
	and: Fixed;
	or: Fixed;
	not: Fixed;
	cmp: Fixed;
	math: Fixed;
	variableRef: Fixed;
	variablePlaceholder: Fixed;
}

const MESSAGES = {
	rotation: 'proto.APLRotation',
	listItem: 'proto.APLListItem',
	prepullAction: 'proto.APLPrepullAction',
	group: 'proto.APLGroup',
	variable: 'proto.APLValueVariable',
	action: 'proto.APLAction',
	value: 'proto.APLValue',
	actionId: 'proto.ActionID',
	unit: 'proto.UnitReference',
	itemSpec: 'proto.ItemSpec',
};
const ACTIONS = {
	castSpell: 'cast_spell',
	channelSpell: 'channel_spell',
	wait: 'wait',
	waitUntil: 'wait_until',
	move: 'move',
	moveDuration: 'move_duration',
	groupReference: 'group_reference',
	schedule: 'schedule',
	sequence: 'sequence',
};
const VALUES = {
	const: 'const',
	and: 'and',
	or: 'or',
	not: 'not',
	cmp: 'cmp',
	math: 'math',
	variableRef: 'variable_ref',
	variablePlaceholder: 'variable_placeholder',
};

export interface SchemaIndex {
	schema: SimlSchema;
	sections: Map<string, SectionDef>;
	actionKinds: Map<string, KindForm>;
	valueKinds: Map<string, KindForm>;
	actionKindsByJson: Map<string, KindForm>;
	valueKindsByJson: Map<string, KindForm>;
	accessors: Map<string, KindForm>; // Keyed "head.prop".
	specs: Map<string, SpecDef>;
	heads: Set<string>;
	slots: Set<string>;
	unitWords: Map<string, JsonObject>; // Each unit word's UnitReference JSON, as the schema gives it.
	unitPrefixes: Map<string, string>; // `target` → Target: the prefixes of targetN, playerN and petN.
	vocabulary: Vocabulary;
	// A message's fields in declaration order.
	fields(message: string): SchemaField[];
	// A message's field by the name a file writes or one of its aliases.
	field(message: string, name: string): SchemaField | undefined;
	// A message's field by its proto name.
	protoField(message: string, name: string): SchemaField | undefined;
	// An enum's value by its short name or its proto name.
	enumValue(enumName: string, name: string): EnumValue | undefined;
	// An enum's value by its number.
	enumNumber(enumName: string, number: number): EnumValue | undefined;
	// The length of an array an enum indexes: one more than its largest number.
	enumLength(enumName: string): number;
	// The message a section source's path names, from IndividualSimSettings; `*` is the spec's field.
	messageAt(path: string[], spec?: SpecDef): string | undefined;
}

// The messages section paths start from: IndividualSimSettings, and the Player in it.
export const SETTINGS_MESSAGE = 'proto.IndividualSimSettings';
export const PLAYER_MESSAGE = 'proto.Player';

// A field a section's entries set, with the JSON path from IndividualSimSettings of the message that holds it.
export interface Placed {
	field: SchemaField;
	at: string[];
}

// A section source's path with `*` read as the spec's field; undefined when it names the spec and there is none.
export function specPath(index: SchemaIndex, path: string[], spec: SpecDef | undefined): string[] | undefined {
	const field = spec && index.protoField(PLAYER_MESSAGE, spec.field)?.json;
	if (path.includes('*') && !field) return undefined;
	return path.map(segment => (segment === '*' ? field! : segment));
}

// The fields of a section (SPEC.md §5.1) in its order: each source's fields in declaration order, with a spec's
// Options flattened (its own fields, then its class options') and the spec's Rotation in place of the string
// `simple:` encodes it into. The spec's fields are left out when there is no spec.
export function sectionFields(index: SchemaIndex, def: SectionDef, spec: SpecDef | undefined): Placed[] {
	const out: Placed[] = [];
	for (const src of def.sources) {
		const at = specPath(index, src.path, spec);
		const message = at && index.messageAt(src.path, spec);
		if (!at || !message) continue;
		const fields = index.fields(message);
		const chosen = src.fields ? src.fields.flatMap(json => fields.filter(f => f.json === json)) : fields;
		if (src.flatten === 'spec_options') {
			const classOptions = spec?.classOptions ? fields.find(f => f.type === spec.classOptions) : undefined;
			out.push(...fields.filter(f => f !== classOptions).map(field => ({ field, at })));
			if (classOptions) out.push(...index.fields(classOptions.type!).map(field => ({ field, at: [...at, classOptions.json] })));
		} else if (src.flatten === 'spec_rotation_json') {
			if (spec) for (const holder of chosen) out.push(...index.fields(spec.rotation).map(field => ({ field, at: [...at, holder.json] })));
		} else out.push(...chosen.map(field => ({ field, at })));
	}
	return out;
}

const indexes = new WeakMap<SimlSchema, SchemaIndex>();

function fixed(schema: SimlSchema, message: string, json: string): Fixed {
	const fields = schema.messages[message]?.fields;
	if (!fields) throw new Error(`siml: the schema has no ${message}`);
	return { message, json, f: Object.fromEntries(fields.map(f => [f.name, f.json])) };
}

function kindFixed(schema: SimlSchema, kinds: KindForm[], kind: string): Fixed {
	const form = kinds.find(k => k.kind === kind);
	if (!form) throw new Error(`siml: the schema has no kind ${kind}`);
	return fixed(schema, form.message, form.json);
}

function vocabularyOf(schema: SimlSchema): Vocabulary {
	const out: Record<string, Fixed> = {};
	for (const [key, message] of Object.entries(MESSAGES)) out[key] = fixed(schema, message, '');
	for (const [key, kind] of Object.entries(ACTIONS)) out[key] = kindFixed(schema, schema.kinds.action, kind);
	for (const [key, kind] of Object.entries(VALUES)) out[key] = kindFixed(schema, schema.kinds.value, kind);
	return out as unknown as Vocabulary;
}

export function indexSchema(schema: SimlSchema): SchemaIndex {
	const cached = indexes.get(schema);
	if (cached) return cached;
	const fields = new Map<string, Map<string, SchemaField>>();
	const protoFields = new Map<string, Map<string, SchemaField>>();
	const values = new Map<string, Map<string, EnumValue>>();
	const numbers = new Map<string, Map<number, EnumValue>>();
	const index: SchemaIndex = {
		schema,
		sections: new Map(schema.sections.map(s => [s.name, s])),
		actionKinds: new Map(schema.kinds.action.map(k => [k.kind, k])),
		valueKinds: new Map(schema.kinds.value.map(k => [k.kind, k])),
		actionKindsByJson: new Map(schema.kinds.action.map(k => [k.json, k])),
		valueKindsByJson: new Map(schema.kinds.value.map(k => [k.json, k])),
		accessors: new Map(schema.kinds.value.flatMap(k => (k.accessor ? [[`${k.accessor.head}.${k.accessor.prop}`, k]] : []))),
		specs: new Map(schema.specs.map(s => [s.field, s])),
		heads: new Set(schema.heads),
		slots: new Set((schema.enums[SLOT_ENUM]?.values ?? []).map(v => v.short)),
		unitWords: new Map(Object.entries(schema.units.words)),
		unitPrefixes: new Map(Object.entries(schema.units.indexed)),
		vocabulary: vocabularyOf(schema),
		fields(message) {
			return schema.messages[message]?.fields ?? [];
		},
		protoField(message, name) {
			let byName = protoFields.get(message);
			if (!byName) {
				byName = new Map((schema.messages[message]?.fields ?? []).map(f => [f.name, f]));
				protoFields.set(message, byName);
			}
			return byName.get(name);
		},
		messageAt(path, spec) {
			let message: string | undefined = SETTINGS_MESSAGE;
			for (const segment of path) {
				const json = segment === '*' ? spec && index.protoField(PLAYER_MESSAGE, spec.field)?.json : segment;
				message = index.fields(message!).find(f => f.json === json)?.type;
				if (!message || !schema.messages[message]) return undefined;
			}
			return message;
		},
		enumLength(enumName) {
			return Math.max(-1, ...(schema.enums[enumName]?.values ?? []).map(v => v.number)) + 1;
		},
		enumNumber(enumName, number) {
			let byNumber = numbers.get(enumName);
			if (!byNumber) {
				byNumber = new Map();
				for (const v of schema.enums[enumName]?.values ?? []) if (!byNumber.has(v.number)) byNumber.set(v.number, v);
				numbers.set(enumName, byNumber);
			}
			return byNumber.get(number);
		},
		field(message, name) {
			let byName = fields.get(message);
			if (!byName) {
				byName = new Map();
				for (const f of schema.messages[message]?.fields ?? []) {
					byName.set(f.siml, f);
					for (const alias of f.aliases) byName.set(alias, f);
				}
				fields.set(message, byName);
			}
			return byName.get(name);
		},
		enumValue(enumName, name) {
			let byName = values.get(enumName);
			if (!byName) {
				byName = new Map();
				for (const v of schema.enums[enumName]?.values ?? []) {
					byName.set(v.short, v);
					byName.set(v.name, v);
				}
				values.set(enumName, byName);
			}
			return byName.get(name);
		},
	};
	indexes.set(schema, index);
	return index;
}
