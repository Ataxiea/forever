import { ActionCategory } from '@generated/proto/api';
import { Class } from '@generated/proto/common';
import type { UnitMetadata } from '@sim/player/player';
import { ActionId } from '@sim/proto/action_id';
import { stubMetadata } from '@testing/apl/player';
import { describe, expect, it, vi } from 'vitest';

import { actionIdSets } from './action_id_sets';

vi.mock('@i18n/config', () => ({ default: { t: (key: string) => key } }));

const named = (spellId: number, name: string, rank = 0) =>
	Object.assign(Object.create(ActionId.prototype), ActionId.fromSpellId(spellId), { name, baseName: name.replace(/ \(Rank \d+\)/, ''), rank }) as ActionId;

const aura = (id: ActionId, category = ActionCategory.ActionCategoryUnknown, extra: object = {}) => ({
	id,
	data: { maxStacks: 0, hasIcd: false, hasExclusiveEffect: false, category, ...extra },
});

const spell = (id: ActionId, category = ActionCategory.ActionCategoryUnknown, extra: object = {}) => ({
	id,
	data: { isCastable: true, prepullOnly: false, encounterOnly: false, category, ...extra },
});

const metadata = (
	auras: Array<ReturnType<typeof aura>>,
	spells: Array<ReturnType<typeof spell>> = [],
	shiftSpells: Array<ActionId> = [],
	unitClass = Class.ClassUnknown,
) =>
	stubMetadata({
		getAuras: () => auras,
		getSpells: () => spells,
		getShiftSpells: () => shiftSpells,
		getClass: () => unitClass,
	}) as unknown as UnitMetadata;

// In form id order, as the sim lists them.
const stances = [named(2457, 'Battle Stance'), named(71, 'Defensive Stance'), named(2458, 'Berserker Stance')];

const menu = (options: Array<{ value: ActionId; submenu?: Array<unknown> }>) =>
	options.map(option => [option.value.name, ...(option.submenu ?? []).map(segment => (segment instanceof ActionId ? segment.name : segment))].join(' > '));

describe('aura sets', () => {
	// Sorted by name, as the metadata arrives.
	const auras = [
		aura(named(1, 'Battle Shout')),
		aura(named(2, 'Battle Shout (External)'), ActionCategory.ActionCategoryExternalBuff),
		aura(named(3, 'Flurry'), ActionCategory.ActionCategoryTalent, { maxStacks: 3 }),
		aura(named(4, 'Mighty Rage Potion'), ActionCategory.ActionCategoryConsumable),
		aura(named(5, 'Recklessness'), ActionCategory.ActionCategoryCooldown),
		aura(named(6, 'Unbridled Wrath (Rank 1)', 1), ActionCategory.ActionCategoryTalent),
		aura(named(7, 'Unbridled Wrath (Rank 2)', 2), ActionCategory.ActionCategoryTalent),
	];

	it('lists the categories in a fixed order ahead of the class auras', async () => {
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras)))).toEqual([
			'Recklessness > cooldowns',
			'Mighty Rage Potion > consumables',
			'Flurry > talents',
			'Unbridled Wrath (Rank 1) > talents > Unbridled Wrath (Rank 2)',
			'Unbridled Wrath (Rank 2) > talents',
			'Battle Shout (External) > external_buffs',
			'Battle Shout',
		]);
	});

	it('categorises the filtered sets the same way', async () => {
		expect(menu(await actionIdSets.stackable_auras.getActionIDs(metadata(auras)))).toEqual(['Flurry > talents']);
	});
});

describe('castable_spells', () => {
	const spells = [
		spell(named(10, 'Bloodthirst')),
		spell(named(11, 'Heroic Strike')),
		spell(named(12, 'Mighty Rage Potion'), ActionCategory.ActionCategoryConsumable, { encounterOnly: true }),
		spell(named(13, 'Recklessness'), ActionCategory.ActionCategoryCooldown),
	];

	it('keeps the class spells under Spell, then the categories, then the placeholders', async () => {
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], spells));
		expect(menu(options).slice(0, 4)).toEqual([
			'Bloodthirst > spell',
			'Heroic Strike > spell',
			'Recklessness > cooldowns',
			'Mighty Rage Potion > consumables',
		]);
		expect(options.at(-1)?.submenu).toEqual(['placeholders']);
		expect(options.find(option => option.value.name === 'Mighty Rage Potion')?.listScope).toBe('priority');
	});

	it('files the lower ranks of a spell under its highest rank, so the submenu row picks the highest', async () => {
		const ranked = [spell(named(20, 'Fireball (Rank 1)', 1)), spell(named(21, 'Fireball (Rank 3)', 3)), spell(named(22, 'Fireball (Rank 2)', 2))];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], ranked))).slice(0, 3)).toEqual([
			'Fireball (Rank 1) > spell > Fireball (Rank 3)',
			'Fireball (Rank 3) > spell',
			'Fireball (Rank 2) > spell > Fireball (Rank 3)',
		]);
	});
});

describe('shift spells and manual groups', () => {
	it('lists the shift spells first, then the talent trees, the groups, Spell and the categories', async () => {
		const warrior = [
			spell(named(2457, 'Battle Stance'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
			spell(named(30, 'Bloodthirst'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
			spell(named(31, 'Heroic Strike'), ActionCategory.ActionCategoryUnknown, { group: 'my_group' }),
			spell(named(32, 'Mortal Strike'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
			spell(named(33, 'Overpower')),
			spell(named(34, 'Recklessness'), ActionCategory.ActionCategoryCooldown),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], warrior, stances, Class.ClassWarrior))).slice(0, 6)).toEqual([
			'Battle Stance',
			'Mortal Strike > Arms',
			'Bloodthirst > Fury',
			'Heroic Strike > my_group',
			'Overpower > spell',
			'Recklessness > cooldowns',
		]);
	});

	it('lists the shift auras first, whatever their group, then the trees, the groups, the categories and the rest', async () => {
		const auras = [
			aura(named(60, 'Battle Shout')),
			aura(named(2457, 'Battle Stance')),
			aura(named(61, 'Bloodrage'), ActionCategory.ActionCategoryUnknown, { group: 'my_group' }),
			aura(named(62, 'Charge')),
			aura(named(71, 'Defensive Stance'), ActionCategory.ActionCategoryUnknown, { group: 'my_group' }),
			aura(named(63, 'Flurry'), ActionCategory.ActionCategoryTalent),
			aura(named(64, 'Recklessness'), ActionCategory.ActionCategoryCooldown),
		];
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], stances, Class.ClassWarrior)))).toEqual([
			'Battle Stance',
			'Defensive Stance',
			'Flurry > Fury',
			'Bloodrage > my_group',
			'Recklessness > cooldowns',
			'Battle Shout',
			'Charge',
		]);
	});

	it('files a cooldown with a group under the group, not cooldowns', async () => {
		const grouped = [spell(named(72, 'Recklessness'), ActionCategory.ActionCategoryCooldown, { group: 'my_group' })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], grouped)))[0]).toBe('Recklessness > my_group');
	});

	it('files a talent spell with a group under the group, not its tree', async () => {
		const grouped = [spell(named(73, 'Bloodthirst'), ActionCategory.ActionCategoryUnknown, { fromTalent: true, group: 'my_group' })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], grouped, [], Class.ClassWarrior)))[0]).toBe('Bloodthirst > my_group');
	});

	it('lists the shift spells in the sim’s form order, not by name', async () => {
		// Sorted by name, as the metadata arrives.
		const shifts = [spell(named(2457, 'Battle Stance')), spell(named(2458, 'Berserker Stance')), spell(named(71, 'Defensive Stance'))];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], shifts, stances))).slice(0, 3)).toEqual([
			'Battle Stance',
			'Defensive Stance',
			'Berserker Stance',
		]);
	});

	it('lists every rank of a shift spell at the top level, behind its highest rank', async () => {
		const ranked = [spell(named(74, 'Cat Form (Rank 1)', 1)), spell(named(75, 'Cat Form (Rank 2)', 2)), spell(named(76, 'Claw'))];
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], ranked, [named(74, 'Cat Form (Rank 1)', 1)]));
		expect(menu(options).slice(0, 3)).toEqual(['Cat Form (Rank 1) > Cat Form (Rank 2)', 'Cat Form (Rank 2)', 'Claw > spell']);
	});

	it('keeps a talent aura that is a shift aura at the top level, not under its tree', async () => {
		const auras = [aura(named(15473, 'Shadowform'), ActionCategory.ActionCategoryTalent)];
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], [named(15473, 'Shadowform')], Class.ClassPriest)))).toEqual(['Shadowform']);
	});
});

describe('talent trees', () => {
	// Sorted by name, as the metadata arrives.
	const spells = [
		spell(named(80, 'Blessing of Kings'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
		spell(named(81, 'Divine Favor'), ActionCategory.ActionCategoryCooldown, { fromTalent: true }),
		spell(named(82, 'Flash of Light')),
		spell(named(83, 'Holy Shield'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
		spell(named(84, 'Holy Shock (Rank 1)', 1), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
		spell(named(85, 'Holy Shock (Rank 2)', 2), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
		spell(named(86, 'Repentance'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
		spell(named(87, 'Seal of Command'), ActionCategory.ActionCategoryUnknown, { fromTalent: true }),
	];
	const auras = [
		aura(named(90, 'Divine Favor'), ActionCategory.ActionCategoryCooldown),
		aura(named(91, 'Holy Might'), ActionCategory.ActionCategoryTalent),
		aura(named(92, 'Holy Shield'), ActionCategory.ActionCategoryTalent),
		aura(named(93, 'Redoubt'), ActionCategory.ActionCategoryTalent),
		aura(named(94, 'Righteous Fury')),
		aura(named(95, 'Vengeance'), ActionCategory.ActionCategoryTalent),
	];

	it('files talent spells under their trees in the talent calculator’s order, ranks behind the highest', async () => {
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], spells, [], Class.ClassPaladin));
		expect(menu(options).slice(0, 8)).toEqual([
			'Holy Shock (Rank 1) > Holy > Holy Shock (Rank 2)',
			'Holy Shock (Rank 2) > Holy',
			'Holy Shield > Protection',
			'Repentance > Retribution',
			'Seal of Command > Retribution',
			'Blessing of Kings > spell',
			'Flash of Light > spell',
			'Divine Favor > cooldowns',
		]);
	});

	it('files talent auras under their trees and keeps an unmatched one under Talents', async () => {
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], [], Class.ClassPaladin)))).toEqual([
			'Holy Shield > Protection',
			'Redoubt > Protection',
			'Vengeance > Retribution',
			'Divine Favor > cooldowns',
			'Holy Might > talents',
			'Righteous Fury',
		]);
	});

	it('files an entry by its talent link first, and by its name when the link names no talent of the class', async () => {
		// 1310735 is Twist of Light in the Retribution tree.
		const linkedAuras = [
			aura(named(100, 'Echo of Command'), ActionCategory.ActionCategoryTalent, { talent: 1310735 }),
			aura(named(101, 'Echo of Fury'), ActionCategory.ActionCategoryTalent, { talent: 999 }),
			aura(named(102, 'Redoubt'), ActionCategory.ActionCategoryTalent, { talent: 999 }),
		];
		const linkedSpells = [spell(named(103, 'Echo Strike'), ActionCategory.ActionCategoryUnknown, { fromTalent: true, talent: 1310735 })];
		const options = await actionIdSets.auras.getActionIDs(metadata(linkedAuras, [], [], Class.ClassPaladin));
		expect(menu(options)).toEqual(['Redoubt > Protection', 'Echo of Command > Retribution', 'Echo of Fury > talents']);
		const spellOptions = await actionIdSets.castable_spells.getActionIDs(metadata([], linkedSpells, [], Class.ClassPaladin));
		expect(menu(spellOptions)[0]).toBe('Echo Strike > Retribution');
	});

	it('keeps the filing of a unit with no class, such as a pet', async () => {
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], spells))).slice(0, 7)).toEqual([
			'Blessing of Kings > spell',
			'Flash of Light > spell',
			'Holy Shield > spell',
			'Holy Shock (Rank 1) > spell > Holy Shock (Rank 2)',
			'Holy Shock (Rank 2) > spell',
			'Repentance > spell',
			'Seal of Command > spell',
		]);
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras)))).toEqual([
			'Divine Favor > cooldowns',
			'Holy Might > talents',
			'Holy Shield > talents',
			'Redoubt > talents',
			'Vengeance > talents',
			'Righteous Fury',
		]);
	});
});
