import { createContext, useContext } from 'react';

import type { ACTION_ID_SET } from '@features/apl/model/action_id_sets';

import type { Registered } from '../protocol';
import { type Json, type JsonObject, isObject, submenuLabel } from './model';

export const RegisteredContext = createContext<Registered>({ status: 'loading' });

export const useRegistered = () => useContext(RegisteredContext);

type Stats = JsonObject & { id: JsonObject };

// An action id's identity: what it names and its tag. The rank is the spell id's own and not compared.
export function idKey(json: Json | undefined): string | undefined {
	if (!isObject(json)) return undefined;
	const tag = typeof json.tag === 'number' ? json.tag : 0;
	if (typeof json.spellId === 'number') return `spell:${json.spellId}:${tag}`;
	if (typeof json.itemId === 'number') return `item:${json.itemId}:${tag}`;
	if (typeof json.otherId === 'string') return `other:${json.otherId}:${tag}`;
	return undefined;
}

// The action id an APL file writes for a registered one: the rank is the sim's own and stays out of the file.
export function writtenId(id: JsonObject): JsonObject {
	const { rank: _rank, ...rest } = id;
	return rest;
}

const TARGET_UNITS = new Set(['CurrentTarget', 'Target', 'PreviousTarget', 'NextTarget']);

// The sets the site lists auras for, read off the unit the field points at.
const AURA_SETS: Partial<Record<ACTION_ID_SET, (aura: Stats) => boolean>> = {
	auras: () => true,
	stackable_auras: aura => typeof aura.maxStacks === 'number' && aura.maxStacks > 0,
	icd_auras: aura => aura.hasIcd === true,
	exclusive_effect_auras: aura => aura.hasExclusiveEffect === true,
};

// The spell sets, each with the flags the site filters the sim's spells by.
const SPELL_SETS: Partial<Record<ACTION_ID_SET, (spell: Stats) => boolean>> = {
	spells: spell => spell.isCastable === true,
	castable_spells: spell => spell.isCastable === true,
	channel_spells: spell => spell.isCastable === true && spell.isChanneled === true,
	dot_spells: spell => spell.hasDot === true,
	castable_dot_spells: spell => spell.isCastable === true && spell.hasDot === true,
	shield_spells: spell => spell.hasShield === true,
	non_instant_spells: spell => spell.isCastable === true && spell.hasCastTime === true,
	friendly_spells: spell => spell.isCastable === true && spell.isFriendly === true,
	expected_dot_spells: spell => spell.hasExpectedTick === true,
	spells_with_travelTime: spell => spell.hasMissileSpeed === true,
	potions: spell => spell.isPotion === true,
	conjured_items: spell => spell.isConjured === true,
};

// The sets that also take an item from the database: what an item registers depends on the gear, not the spec.
export const ITEM_SETS = new Set<ACTION_ID_SET>(['spells', 'castable_spells', 'potions', 'conjured_items']);

const CATEGORY_SUBMENUS: Record<string, string> = {
	ActionCategoryCooldown: 'cooldowns',
	ActionCategoryConsumable: 'consumables',
	ActionCategoryItem: 'items',
	ActionCategoryTalent: 'talents',
	ActionCategoryRacial: 'racials',
	ActionCategoryProfession: 'professions',
	ActionCategoryExternalBuff: 'external_buffs',
	ActionCategoryExternalCooldown: 'external_cooldowns',
	ActionCategoryExternalDebuff: 'external_debuffs',
};

export function categoryLabel(stats: JsonObject): string | undefined {
	const key = typeof stats.category === 'string' ? CATEGORY_SUBMENUS[stats.category] : undefined;
	return key && submenuLabel(key);
}

export interface Offered {
	id: JsonObject;
	stats: JsonObject;
	listScope?: 'prepull' | 'priority';
}

// What a field of `set` offers, from the sim's lists for the spec: the spells the set's flags pass, or the
// auras of the unit the field points at (the target's for a target, the pet's for a pet, else the player's).
export function offeredFor(
	registered: Extract<Registered, { status: 'ready' }>,
	set: ACTION_ID_SET,
	unit: Json | undefined,
	defaultUnitRef: 'self' | 'currentTarget',
): Offered[] {
	const spellFilter = SPELL_SETS[set];
	if (spellFilter) {
		return (registered.registered.spells as Stats[])
			.filter(spellFilter)
			.map(spell => ({ id: spell.id, stats: spell, listScope: spell.prepullOnly ? 'prepull' : spell.encounterOnly ? 'priority' : undefined }));
	}
	const auraFilter = AURA_SETS[set] ?? (() => true);
	const type = isObject(unit) && typeof unit.type === 'string' ? unit.type : defaultUnitRef === 'currentTarget' ? 'CurrentTarget' : 'Self';
	const auras = TARGET_UNITS.has(type) ? registered.registered.targetAuras : type === 'Pet' ? registered.registered.petAuras : registered.registered.auras;
	return (auras as Stats[]).filter(auraFilter).map(aura => ({ id: aura.id, stats: aura }));
}

// Every id the sim registers for the spec, as spell, aura or debuff.
export function registeredKeys(registered: Registered): Set<string> | undefined {
	if (registered.status !== 'ready') return undefined;
	const { spells, auras, petAuras, targetAuras } = registered.registered;
	return new Set([...spells, ...auras, ...petAuras, ...targetAuras].map(stats => idKey((stats as Stats).id)).filter((key): key is string => !!key));
}
