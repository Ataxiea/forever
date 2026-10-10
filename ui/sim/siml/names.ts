// The name table (SPEC.md §7): what each name of a file means, looked up by the file's class and the namespace its
// position reads, and the name each id prints by. The table is sim/siml/names.json, which hosts pass in as data.

import { isObject, normalize } from './json.ts';
import type { KindForm, SchemaField, SchemaIndex, SpecDef } from './schema.ts';
import type { JsonObject, JsonValue, Namespace, NameTable, SpellName, SpellNamespace } from './types.ts';

// Every namespace, in the order of SPEC.md §7.1.
const NAMESPACES: readonly Namespace[] = ['spell', 'aura', 'target_aura', 'target_spell', 'pet_aura', 'item', 'enchant', 'suffix'];
const SPELL_LIKE: ReadonlySet<Namespace> = new Set(['spell', 'aura', 'target_aura', 'target_spell', 'pet_aura']);
export const isSpellLike = (ns: Namespace): ns is SpellNamespace => SPELL_LIKE.has(ns);

const CLASS_ENUM = 'proto.Class';
const NAME = /^[a-z_][a-z0-9_]*$/;
// The keys of the table, of a spell-like entry and of an enchant entry (SPEC.md §7.4).
const SECTIONS = ['classes', 'enchants', 'items', 'shared', 'suffixes'];
const SPELL_KEYS = ['spellId', 'tag', 'rank', 'registeredBy'];
const ENCHANT_KEYS = ['effectId', 'slots'];
const BOSS_SPELL_KIND = 'boss_spell_';
const AURA_FIELD = 'aura_id';
const PET_UNIT = 'Pet';
const SELF = 'self';
const INDEXED_UNIT = /^([a-z_]+?)([1-9][0-9]*)$/; // targetN, playerN, petN with N ≥ 1.
// The unit types whose auras are the player's; a pet's are its own, and any other unit's are a target's.
const PLAYER_UNITS: ReadonlySet<JsonValue> = new Set(['Self', 'Player', 'AllPlayers', 'Unknown']);

// What each namespace holds, and what a position of it takes, in a diagnostic's words.
export const THINGS: Record<Namespace, string> = {
	spell: 'a spell',
	aura: 'an aura',
	target_aura: 'an aura on a target',
	target_spell: 'a boss spell',
	pet_aura: 'a pet aura',
	item: 'an item',
	enchant: 'an enchant',
	suffix: 'a random suffix',
};

type SpellIndex = Map<SpellNamespace, Map<string, SpellName>>;

// The table, indexed both ways. Looking a name up never reads a key the table's JSON inherits, such as
// `constructor`.
export class Names {
	private readonly classes = new Map<string, SpellIndex>();
	private readonly shared: SpellIndex;
	private readonly spellNames = new Map<string, string>(); // `<class or shared> <namespace> <spell id> <tag>` → its name.
	private readonly items: Map<string, number>;
	private readonly itemNames = new Map<number, string>();
	private readonly enchants: Map<string, { effectId: number; slots: string[] }>;
	private readonly enchantNames = new Map<number, string[]>(); // An effect's names, in byte order.
	private readonly suffixes: Map<string, number>;
	private readonly suffixNames = new Map<number, string>();

	// Refuses a table that breaks the rules of SPEC.md §7.4: the form's keys and types, every name an identifier and
	// every id a positive int32, no name or id with two meanings, and every class, namespace, slot and spec one the
	// schema knows. A null reads as absent, as it does in Go.
	constructor(index: SchemaIndex, table: NameTable) {
		if (table === null) throw new Error('siml: the name table is null');
		const top = object('', table, SECTIONS);
		const classes = new Set((index.schema.enums[CLASS_ENUM]?.values ?? []).filter(v => v.number !== 0).map(v => v.short));
		this.shared = this.spells(index, 'shared', top.shared);
		for (const [cls, entries] of Object.entries(object('classes', top.classes))) {
			if (!classes.has(cls)) throw new Error(`siml: the name table holds the class ${cls}, which is no class`);
			const names = this.spells(index, cls, entries);
			for (const [ns, byName] of names) {
				for (const [name, e] of byName) {
					const s = this.shared.get(ns)?.get(name);
					if (s && (s.spellId !== e.spellId || (s.tag ?? 0) !== (e.tag ?? 0)))
						throw new Error(`siml: the name table gives ${name} two meanings in ${cls}.${ns} and shared.${ns}`);
				}
			}
			this.classes.set(cls, names);
		}
		this.items = ids(index, 'items', top.items, this.itemNames);
		this.suffixes = ids(index, 'suffixes', top.suffixes, this.suffixNames);
		this.enchants = new Map();
		for (const [name, value] of Object.entries(object('enchants', top.enchants)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
			const where = `enchants.${name}`;
			const e = object(where, value, ENCHANT_KEYS);
			named(index, where, name, e.effectId);
			const effectId = e.effectId as number;
			const slots = strings(`${where}.slots`, e.slots);
			const slot = slots.find(s => !index.slots.has(s));
			if (slot !== undefined) throw new Error(`siml: the name table's ${where} fits ${slot}, which is no slot`);
			this.enchants.set(name, { effectId, slots });
			this.enchantNames.set(effectId, [...(this.enchantNames.get(effectId) ?? []), name]);
		}
	}

	private spells(index: SchemaIndex, scope: string, value: unknown): SpellIndex {
		const out: SpellIndex = new Map();
		for (const [ns, byName] of Object.entries(object(scope, value))) {
			if (!SPELL_LIKE.has(ns as Namespace)) throw new Error(`siml: the name table holds ${scope}.${ns}, which is no spell-like namespace`);
			const names = new Map<string, SpellName>();
			out.set(ns as SpellNamespace, names);
			for (const [name, v] of Object.entries(object(`${scope}.${ns}`, byName))) {
				const where = `${scope}.${ns}.${name}`;
				const e = object(where, v, SPELL_KEYS);
				named(index, where, name, e.spellId);
				const tag = e.tag ?? 0;
				const rank = e.rank ?? 0;
				if (!isInt32(tag) || !isInt32(rank)) throw new Error(`siml: the name table's ${where} has a tag or rank that is no int32`);
				const registeredBy = strings(`${where}.registeredBy`, e.registeredBy);
				const spec = registeredBy.find(s => !index.specs.has(s));
				if (spec !== undefined) throw new Error(`siml: the name table's ${where} is registered by ${spec}, which is no spec`);
				const entry: SpellName = { spellId: e.spellId as number, registeredBy };
				if (tag) entry.tag = tag;
				if (rank) entry.rank = rank;
				const at = `${scope} ${ns} ${entry.spellId} ${tag}`;
				const other = this.spellNames.get(at);
				if (other !== undefined) throw new Error(`siml: the name table names spell ${entry.spellId} twice in ${scope}.${ns}: ${other} and ${name}`);
				this.spellNames.set(at, name);
				names.set(name, entry);
			}
		}
		return out;
	}

	// The entry a spell-like name means for a file of class `cls`: the class's own, else the shared one. A file with
	// no class reads the shared entries only.
	spell(cls: string | undefined, ns: SpellNamespace, name: string): SpellName | undefined {
		return (cls === undefined ? undefined : this.classes.get(cls)?.get(ns)?.get(name)) ?? this.shared.get(ns)?.get(name);
	}

	// The name of a spell id and tag, whatever the rank: the class's own, else the shared one.
	spellName(cls: string | undefined, ns: SpellNamespace, spellId: number, tag: number): string | undefined {
		return (cls === undefined ? undefined : this.spellNames.get(`${cls} ${ns} ${spellId} ${tag}`)) ?? this.spellNames.get(`shared ${ns} ${spellId} ${tag}`);
	}

	item(name: string): number | undefined {
		return this.items.get(name);
	}

	itemName(id: number): string | undefined {
		return this.itemNames.get(id);
	}

	enchant(name: string): number | undefined {
		return this.enchants.get(name)?.effectId;
	}

	// The name an effect prints by on an item in `slot`: the first in byte order of its names whose slots hold the
	// slot, else its first name.
	enchantName(effectId: number, slot: string): string | undefined {
		const names = this.enchantNames.get(effectId) ?? [];
		return names.find(name => this.enchants.get(name)!.slots.includes(slot)) ?? names[0];
	}

	suffix(name: string): number | undefined {
		return this.suffixes.get(name);
	}

	suffixName(id: number): string | undefined {
		return this.suffixNames.get(id);
	}

	// Every name of `ns` a file of class `cls` reads.
	visible(cls: string | undefined, ns: Namespace): string[] {
		switch (ns) {
			case 'item':
				return [...this.items.keys()];
			case 'enchant':
				return [...this.enchants.keys()];
			case 'suffix':
				return [...this.suffixes.keys()];
		}
		const own = cls === undefined ? undefined : this.classes.get(cls)?.get(ns);
		return [...new Set([...(own?.keys() ?? []), ...(this.shared.get(ns)?.keys() ?? [])])];
	}

	// The namespaces in which `name` means something for a file of class `cls`, in the order of SPEC.md §7.1.
	holding(cls: string | undefined, name: string): Namespace[] {
		return NAMESPACES.filter(ns => {
			switch (ns) {
				case 'item':
					return this.items.has(name);
				case 'enchant':
					return this.enchants.has(name);
				case 'suffix':
					return this.suffixes.has(name);
				default:
					return this.spell(cls, ns as SpellNamespace, name) !== undefined;
			}
		});
	}
}

const isInt32 = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= -(2 ** 31) && (v as number) < 2 ** 31;

// The JSON object `value` at `where`, '' for the table itself: empty when it is null or absent, and with `keys`, an
// object whose keys are among them.
function object(where: string, value: unknown, keys?: readonly string[]): Record<string, unknown> {
	const at = where ? `the name table's ${where}` : 'the name table';
	if (value === null || value === undefined) return {};
	if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`siml: ${at} is no object`);
	const key = keys && Object.keys(value).find(k => !keys.includes(k));
	if (key !== undefined) throw new Error(`siml: ${at} has no key ${key}`);
	return value as Record<string, unknown>;
}

// The JSON list of strings `value`, empty when it is null or absent.
function strings(where: string, value: unknown): string[] {
	if (value === null || value === undefined) return [];
	if (!Array.isArray(value) || value.some(s => typeof s !== 'string')) throw new Error(`siml: the name table's ${where} is no list of strings`);
	return value as string[];
}

// Refuses an entry whose name is no identifier or a reserved word, or whose id is not a positive int32.
function named(index: SchemaIndex, entry: string, name: string, id: unknown) {
	if (!NAME.test(name) || !isInt32(id) || id <= 0) throw new Error(`siml: the name table's ${entry} is no name of a positive id`);
	if (isReserved(index, name)) throw new Error(`siml: the name table's ${entry} is a reserved word`);
}

function ids(index: SchemaIndex, what: string, value: unknown, reverse: Map<number, string>): Map<string, number> {
	const out = new Map<string, number>();
	for (const [name, id] of Object.entries(object(what, value))) {
		named(index, `${what}.${name}`, name, id);
		const other = reverse.get(id as number);
		if (other !== undefined) throw new Error(`siml: the name table names ${what} ${id} twice: ${other} and ${name}`);
		reverse.set(id as number, name);
		out.set(name, id as number);
	}
	return out;
}

// The short name of the class a spec's file reads its names with (SPEC.md §7.1): `warrior` for dps_warrior.
export function classOf(index: SchemaIndex, spec: SpecDef | undefined): string | undefined {
	return spec && index.enumValue(CLASS_ENUM, spec.class)?.short;
}

// The UnitReference a unit word writes (SPEC.md §6.6), or undefined for a word that is no unit.
export function unitReference(index: SchemaIndex, word: string): JsonObject | undefined {
	const U = index.vocabulary.unit;
	const json = index.unitWords.get(word);
	if (json) return normalize(index, U.message, json) as JsonObject;
	const m = INDEXED_UNIT.exec(word);
	const type = m ? index.unitPrefixes.get(m[1]) : undefined;
	// UnitReference.index is an int32.
	if (!m || !type || Number(m[2]) - 1 > 2 ** 31 - 1) return undefined;
	const out: JsonObject = { [U.f.type]: type };
	if (m[2] !== '1') out[U.f.index] = Number(m[2]) - 1;
	if (type === PET_UNIT) out[U.f.owner] = unitReference(index, SELF)!;
	return out;
}

// Whether `word` is a reserved word (SPEC.md §4 note 6), which a file never reads as a name.
const isReserved = (index: SchemaIndex, word: string) =>
	index.schema.keywords.includes(word) || index.heads.has(word) || unitReference(index, word) !== undefined;

// The namespace of the auras on a unit (SPEC.md §7.2): a pet's, the player's, or a target's. A unit that does not read
// as a UnitReference is the default, Unknown, whose auras are the player's.
function auraNamespace(index: SchemaIndex, unit: JsonValue | undefined): SpellNamespace {
	const problems: string[] = [];
	const json = isObject(unit) ? normalize(index, index.vocabulary.unit.message, unit, problems) : undefined;
	return auraNamespaceOf(isObject(json) && !problems.length ? json[index.vocabulary.unit.f.type] : undefined);
}

// The namespace of the auras on a unit of `type`, a UnitReference type's JSON name; none is the default, Unknown.
export function auraNamespaceOf(type: JsonValue | undefined): SpellNamespace {
	if (type === PET_UNIT) return 'pet_aura';
	return type === undefined || PLAYER_UNITS.has(type) ? 'aura' : 'target_aura';
}

// The field of a kind whose unit its aura_id is read on: its first UnitReference field, if it has one.
export function unitFieldOf(index: SchemaIndex, kind: KindForm): SchemaField | undefined {
	return index.fields(kind.message).find(f => f.printed === 'unit' && !f.repeated);
}

// The namespace an ActionID field of a kind reads (SPEC.md §7.2), `unit` being what the kind's unit field holds: an
// aura_id field the auras on its unit, the field of a boss_spell_<prop> kind what a target casts, and every other
// ActionID field what the player casts.
export function fieldNamespace(index: SchemaIndex, kind: KindForm | undefined, field: SchemaField, unit: JsonValue | undefined): SpellNamespace {
	if (field.name === AURA_FIELD) return auraNamespace(index, unit);
	return kind?.kind.startsWith(BOSS_SPELL_KIND) ? 'target_spell' : 'spell';
}

// Whether `got`, what a printed text reads back as, is `want`: an ActionID that holds a spell id compares by its spell
// id and tag, since a spell-like name reads back with its entry's rank (SPEC.md §7.3).
export function readsBack(index: SchemaIndex, got: JsonValue | undefined, want: JsonValue | undefined): boolean {
	if (got === want) return true;
	if (Array.isArray(got)) return Array.isArray(want) && got.length === want.length && got.every((x, i) => readsBack(index, x, want[i]));
	if (!isObject(got) || !isObject(want)) return false;
	const A = index.vocabulary.actionId.f;
	const spell = typeof got[A.spell_id] === 'number' && typeof want[A.spell_id] === 'number';
	const keys = (o: JsonObject) => Object.keys(o).filter(k => !spell || k !== A.rank);
	const mine = keys(got);
	return mine.length === keys(want).length && mine.every(k => k in want && readsBack(index, got[k], want[k]));
}

const isId = (v: JsonValue | undefined) => typeof v === 'number' && v !== 0;

// Whether the JSON of `message` holds a spell id, an item id, an enchant effect id or a random suffix id, which a
// file under ui/specs writes by name (SPEC.md §7.3).
export function holdsId(index: SchemaIndex, message: string, json: JsonValue | undefined): boolean {
	if (!isObject(json)) return false;
	const A = index.vocabulary.actionId;
	if (message === A.message) return isId(json[A.f.spell_id]) || isId(json[A.f.item_id]);
	return index.fields(message).some(f => json[f.json] !== undefined && fieldHoldsId(index, f, json[f.json], true));
}

// Whether a value of `field`, its whole list or map when `whole`, holds such an id.
export function fieldHoldsId(index: SchemaIndex, field: SchemaField, value: JsonValue | undefined, whole: boolean): boolean {
	if (whole && field.repeated && Array.isArray(value)) return value.some(v => fieldHoldsId(index, field, v, false));
	if (whole && field.printed === 'map') return isObject(value) && Object.values(value).some(v => fieldHoldsId(index, field, v, false));
	if (field.printed === 'ref') return isId(value);
	if (field.printed === 'action_id') return holdsId(index, index.vocabulary.actionId.message, value);
	return field.type !== undefined && index.schema.messages[field.type] !== undefined && holdsId(index, field.type, value);
}
