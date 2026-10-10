import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// What the editor reads from the item database (assets/database/db.json, then leftover_db.json): names and icons,
// which slots an item goes in, which enchants fit it and which random suffixes it rolls, and the kind of each
// consumable. Enum fields hold the proto enums' numbers, as the database writes them.

export interface DbItem {
	id: number;
	name: string;
	icon?: string;
	type?: number; // ItemType.
	handType?: number;
	weaponType?: number;
	rangedWeaponType?: number;
	armorType?: number;
	quality?: number;
	phase?: number;
	ilvl?: number;
	setName?: string;
	randomSuffixOptions?: number[];
	effects: string[]; // The buff names of its item effects.
	onUse: boolean;
}

export interface DbEnchant {
	effectId: number;
	name: string;
	spellId?: number;
	itemId?: number;
	type: number; // ItemType.
	extraTypes?: number[];
	enchantType?: number;
}

export interface DbConsumable {
	id: number;
	name: string;
	type?: number; // ConsumableType.
	onUse: boolean;
}

export interface DbSuffix {
	id: number;
	name: string;
	stats: number[];
}

export interface Database {
	items: Map<number, DbItem>;
	consumables: Map<number, DbConsumable>;
	itemIcons: Map<number, { name: string; icon?: string }>;
	spells: Map<number, { name: string; icon?: string }>;
	enchants: Map<number, DbEnchant[]>; // The rows of each effect id.
	suffixes: Map<number, DbSuffix>;
}

// The proto enum numbers of core.EligibleSlotsForItem and core.EnchantAppliesToItem, which the rules below follow;
// test/db.test.mjs holds them to the generated protos.
// ItemType numbers.
const ITEM_TYPE_WEAPON = 13;
const ITEM_TYPE_RANGED = 14;
// ItemSlot numbers of each ItemType but the weapon, whose slots its hand type gives.
const TYPE_SLOTS: Record<number, number[]> = {
	1: [0],
	2: [1],
	3: [2],
	4: [3],
	5: [4],
	6: [5],
	7: [6],
	8: [7],
	9: [8],
	10: [9],
	11: [10, 11],
	12: [12, 13],
	14: [16],
};
const SLOT_MAIN_HAND = 14;
const SLOT_OFF_HAND = 15;
const HAND_MAIN = 1;
const HAND_ONE = 2;
const HAND_OFF = 3;
const HAND_TWO = 4;
const WEAPON_OFF_HAND = 5;
const WEAPON_SHIELD = 7;
const WEAPON_STAFF = 8;
const ENCHANT_TWO_HAND = 1;
const ENCHANT_SHIELD = 2;
const ENCHANT_STAFF = 4;
const ENCHANT_OFF_HAND = 5;
const RANGED_UNKNOWN = 0;
const RANGED_WAND = 5;
// Bows, crossbows and guns: the ranged weapons a ranged enchant fits.
const SCOPED = new Set([1, 2, 3]);

export const DATABASE_FILES = [join('assets', 'database', 'db.json'), join('assets', 'database', 'leftover_db.json')];

interface RawEntry {
	id?: number;
	name?: string;
	icon?: string;
	type?: number;
	itemEffects?: Array<{ buffName?: string; onUse?: unknown }>;
	scalingOptions?: Record<string, { ilvl?: number }>;
	[key: string]: unknown;
}

interface RawDatabase {
	items?: RawEntry[];
	consumables?: RawEntry[];
	itemIcons?: RawEntry[];
	spellIcons?: RawEntry[];
	enchants?: Array<DbEnchant & { [key: string]: unknown }>;
	randomSuffixes?: DbSuffix[];
}

let cached: { root: string; stamp: string; db: Database } | undefined;

// The database of the repository at `root`, read again whenever `make db` rewrites it. The first file wins for an
// id both hold.
export function loadDatabase(root: string): Database {
	const paths = DATABASE_FILES.map(file => join(root, file));
	const stamp = paths
		.map(path => {
			try {
				return String(statSync(path).mtimeMs);
			} catch {
				return 'missing';
			}
		})
		.join('|');
	if (cached?.root === root && cached.stamp === stamp) return cached.db;
	const db: Database = { items: new Map(), consumables: new Map(), itemIcons: new Map(), spells: new Map(), enchants: new Map(), suffixes: new Map() };
	for (const path of paths) {
		let raw: RawDatabase;
		try {
			raw = JSON.parse(readFileSync(path, 'utf8')) as RawDatabase;
		} catch {
			continue;
		}
		const onUse = (entry: RawEntry) => (entry.itemEffects ?? []).some(effect => effect.onUse !== undefined);
		for (const item of raw.items ?? []) {
			if (typeof item.id !== 'number' || db.items.has(item.id)) continue;
			db.items.set(item.id, {
				id: item.id,
				name: item.name ?? '',
				icon: item.icon,
				type: item.type,
				handType: item.handType as number | undefined,
				weaponType: item.weaponType as number | undefined,
				rangedWeaponType: item.rangedWeaponType as number | undefined,
				armorType: item.armorType as number | undefined,
				quality: item.quality as number | undefined,
				phase: item.phase as number | undefined,
				ilvl: item.scalingOptions?.['0']?.ilvl,
				setName: item.setName as string | undefined,
				randomSuffixOptions: item.randomSuffixOptions as number[] | undefined,
				effects: (item.itemEffects ?? []).map(effect => effect.buffName ?? '').filter(Boolean),
				onUse: onUse(item),
			});
		}
		for (const c of raw.consumables ?? []) {
			if (typeof c.id === 'number' && !db.consumables.has(c.id))
				db.consumables.set(c.id, { id: c.id, name: c.name ?? '', type: c.type, onUse: onUse(c) });
		}
		for (const icon of raw.itemIcons ?? []) {
			if (typeof icon.id === 'number' && icon.name && !db.itemIcons.has(icon.id)) db.itemIcons.set(icon.id, { name: icon.name, icon: icon.icon });
		}
		for (const icon of raw.spellIcons ?? []) {
			if (typeof icon.id === 'number' && icon.name && !db.spells.has(icon.id)) db.spells.set(icon.id, { name: icon.name, icon: icon.icon });
		}
		for (const e of raw.enchants ?? []) {
			const rows = db.enchants.get(e.effectId) ?? [];
			rows.push({
				effectId: e.effectId,
				name: e.name,
				spellId: e.spellId,
				itemId: e.itemId,
				type: e.type,
				extraTypes: e.extraTypes,
				enchantType: e.enchantType,
			});
			db.enchants.set(e.effectId, rows);
		}
		for (const s of raw.randomSuffixes ?? []) if (!db.suffixes.has(s.id)) db.suffixes.set(s.id, s);
	}
	cached = { root, stamp, db };
	return db;
}

// An item's name: the item's, the consumable's or the item icon's.
export function itemName(db: Database, id: number): string | undefined {
	return db.items.get(id)?.name || db.consumables.get(id)?.name || db.itemIcons.get(id)?.name;
}

// The items with a use, gear and consumables: what a rotation can cast as `item.<name>`.
export function usableItems(db: Database): number[] {
	return [...[...db.items.values()].filter(item => item.onUse), ...[...db.consumables.values()].filter(c => c.onUse)].map(item => item.id);
}

// The ItemSlot numbers an item goes in.
export function itemSlots(item: DbItem): number[] {
	if (item.type === ITEM_TYPE_WEAPON) {
		if (item.handType === HAND_MAIN || item.handType === HAND_TWO) return [SLOT_MAIN_HAND];
		if (item.handType === HAND_OFF) return [SLOT_OFF_HAND];
		return item.handType === HAND_ONE ? [SLOT_MAIN_HAND, SLOT_OFF_HAND] : [];
	}
	return TYPE_SLOTS[item.type ?? 0] ?? [];
}

// The ItemSlot numbers an enchant row's item types go in.
function enchantSlots(row: DbEnchant): number[] {
	return [row.type, ...(row.extraTypes ?? [])].flatMap(type => (type === ITEM_TYPE_WEAPON ? [SLOT_MAIN_HAND, SLOT_OFF_HAND] : (TYPE_SLOTS[type] ?? [])));
}

// Whether a row of the enchant effect fits the item, by the rule the sim checks a gear set with.
export function enchantFits(db: Database, effectId: number, item: DbItem): boolean {
	return (db.enchants.get(effectId) ?? []).some(row => rowFits(row, item));
}

function rowFits(row: DbEnchant, item: DbItem): boolean {
	if (row.enchantType === ENCHANT_TWO_HAND && item.handType !== HAND_TWO) return false;
	if (row.enchantType === ENCHANT_STAFF && item.weaponType !== WEAPON_STAFF) return false;
	if ((row.enchantType === ENCHANT_SHIELD) !== (item.weaponType === WEAPON_SHIELD)) return false;
	if ((row.enchantType === ENCHANT_OFF_HAND) !== (item.weaponType === WEAPON_OFF_HAND)) return false;
	const ranged = item.rangedWeaponType ?? RANGED_UNKNOWN;
	if (row.type === ITEM_TYPE_RANGED) {
		if (!SCOPED.has(ranged)) return false;
	} else if (ranged !== RANGED_UNKNOWN && ranged !== RANGED_WAND) {
		return false;
	}
	const slots = new Set(itemSlots(item));
	return enchantSlots(row).some(slot => slots.has(slot));
}
