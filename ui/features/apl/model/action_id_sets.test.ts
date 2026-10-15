import { ActionCategory } from '@generated/proto/api';
import { Class } from '@generated/proto/common';
import type { UnitMetadata } from '@sim/player/player';
import { ActionId } from '@sim/proto/action_id';
import { stubMetadata } from '@testing/apl/player';
import { describe, expect, it, vi } from 'vitest';

import { actionIdSets } from './action_id_sets';

// Form labels in English; every other key gives its default value, else passes through, as the existing cases expect.
vi.mock('@i18n/config', () => {
	const strings: Record<string, string> = {
		'rotation_tab.apl.forms.any_stance': 'Any stance',
		'rotation_tab.apl.forms.any_form': 'Any form',
		'rotation_tab.apl.forms.no_form': 'Caster',
		'rotation_tab.apl.forms.names.5': 'Bear',
		'rotation_tab.apl.forms.names.8': 'Bear',
		'rotation_tab.apl.forms.names.17': 'Battle',
		'rotation_tab.apl.forms.names.18': 'Defensive',
		'rotation_tab.apl.forms.names.19': 'Berserker',
	};
	return {
		default: {
			t: (key: string, options?: { form?: string; defaultValue?: string }) =>
				key === 'rotation_tab.apl.forms.only' ? `${options?.form} only` : (strings[key] ?? options?.defaultValue ?? key),
		},
	};
});

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

const form = (id: number, name: string, stance = true) => ({ id, actionId: named(id * 1000, name), stance });

const metadata = (
	auras: Array<ReturnType<typeof aura>>,
	spells: Array<ReturnType<typeof spell>> = [],
	forms: Array<ReturnType<typeof form>> = [],
	alwaysInForm = false,
	unitClass = Class.ClassUnknown,
) =>
	stubMetadata({
		getAuras: () => auras,
		getSpells: () => spells,
		getForms: () => forms,
		isAlwaysInForm: () => alwaysInForm,
		getClass: () => unitClass,
	}) as unknown as UnitMetadata;

const stances = [form(17, 'Battle Stance'), form(18, 'Defensive Stance'), form(19, 'Berserker Stance')];

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

describe('form buckets', () => {
	const spells = [
		spell(named(30, 'Bloodthirst'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
		spell(named(31, 'Overpower'), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
		spell(named(32, 'Rend'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18] }),
		spell(named(33, 'Revenge'), ActionCategory.ActionCategoryUnknown, { forms: [18] }),
		spell(named(34, 'Whirlwind'), ActionCategory.ActionCategoryUnknown, { forms: [19] }),
		spell(named(35, 'Recklessness'), ActionCategory.ActionCategoryCooldown, { forms: [19] }),
		spell(named(17000, 'Battle Stance'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
	];

	it('files class spells by form: shift spells at the top level, then any, single forms in form order, then pairs', async () => {
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], spells, stances, true));
		expect(menu(options).slice(0, 7)).toEqual([
			'Battle Stance',
			'Bloodthirst > Any stance',
			'Overpower > Battle only',
			'Revenge > Defensive only',
			'Whirlwind > Berserker only',
			'Rend > Battle + Defensive',
			'Recklessness > cooldowns',
		]);
	});

	it('lists the shift auras at the top level ahead of the buckets', async () => {
		const auras = [
			aura(named(60, 'Battle Shout'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
			aura(named(17000, 'Battle Stance'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
			aura(named(61, 'Charge'), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
			aura(named(18000, 'Defensive Stance'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], group: 'my_group' }),
			aura(named(63, 'Revenge'), ActionCategory.ActionCategoryUnknown, { forms: [18] }),
		];
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], stances, true)))).toEqual([
			'Battle Stance',
			'Defensive Stance',
			'Charge > Battle only',
			'Revenge > Defensive only',
			'Battle Shout',
		]);
	});

	it('files a talent spell under its tree, after the buckets and ahead of the groups', async () => {
		const warrior = [
			spell(named(30, 'Bloodthirst'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], fromTalent: true }),
			spell(named(31, 'Heroic Strike'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], group: 'my_group' }),
			spell(named(32, 'Mortal Strike'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], fromTalent: true }),
			spell(named(33, 'Overpower'), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
			spell(named(34, 'Revenge'), ActionCategory.ActionCategoryUnknown, { forms: [18] }),
			spell(named(17000, 'Battle Stance'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], fromTalent: true }),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], warrior, stances, true, Class.ClassWarrior))).slice(0, 6)).toEqual([
			'Battle Stance',
			'Overpower > Battle only',
			'Revenge > Defensive only',
			'Mortal Strike > Arms',
			'Bloodthirst > Fury',
			'Heroic Strike > my_group',
		]);
	});

	it('orders buckets that share a first state by the next state', async () => {
		const pairs = [
			spell(named(70, 'Alpha'), ActionCategory.ActionCategoryUnknown, { forms: [17, 19] }),
			spell(named(71, 'Zulu'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18] }),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], pairs, stances, true))).slice(0, 2)).toEqual([
			'Zulu > Battle + Defensive',
			'Alpha > Battle + Berserker',
		]);
	});

	it('files a cooldown with a group under the group, not cooldowns', async () => {
		const grouped = [spell(named(72, 'Recklessness'), ActionCategory.ActionCategoryCooldown, { forms: [19], group: 'my_group' })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], grouped, stances, true)))[0]).toBe('Recklessness > my_group');
	});

	it('files an aura with a group under the group', async () => {
		const grouped = [aura(named(73, 'Bloodrage'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], group: 'my_group' })];
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(grouped, [], stances, true)))).toEqual(['Bloodrage > my_group']);
	});

	it('keeps Spell when every class spell works in every form', async () => {
		const anyOnly = [spell(named(40, 'Mind Flay'), ActionCategory.ActionCategoryUnknown, { forms: [0, 28] })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], anyOnly, [form(28, 'Shadowform')])))[0]).toBe('Mind Flay > spell');
	});

	it('keeps Spell when every class spell works in the same one form', async () => {
		const casterOnly = [
			spell(named(45, 'Starfire'), ActionCategory.ActionCategoryUnknown, { forms: [0] }),
			spell(named(46, 'Wrath'), ActionCategory.ActionCategoryUnknown, { forms: [0] }),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], casterOnly, [form(1, 'Cat Form', false)]))).slice(0, 2)).toEqual([
			'Starfire > spell',
			'Wrath > spell',
		]);
	});

	it('names forms that share a short name by their spells', async () => {
		const bears = [
			spell(named(47, 'Maul'), ActionCategory.ActionCategoryUnknown, { forms: [5] }),
			spell(named(48, 'Swipe'), ActionCategory.ActionCategoryUnknown, { forms: [8] }),
		];
		const bearForms = [form(5, 'Bear Form', false), form(8, 'Dire Bear Form', false)];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], bears, bearForms))).slice(0, 2)).toEqual([
			'Maul > Bear Form only',
			'Swipe > Dire Bear Form only',
		]);
	});

	it('keeps Spell for a spell the unit cannot cast in any of its forms', async () => {
		const nowhere = [...spells, spell(named(41, 'Gladiator Strike'), ActionCategory.ActionCategoryUnknown, { forms: [] })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], nowhere, stances, true)))).toContain('Gladiator Strike > spell');
	});

	it('names a form without a short name by its spell, and the no-form state Caster', async () => {
		const shadow = [
			spell(named(42, 'Mind Flay'), ActionCategory.ActionCategoryUnknown, { forms: [0, 28] }),
			spell(named(43, 'Greater Heal'), ActionCategory.ActionCategoryUnknown, { forms: [0] }),
			spell(named(44, 'Shadow Word: Death'), ActionCategory.ActionCategoryUnknown, { forms: [28] }),
		];
		// Shadowform has no short-name key in the stub, so its label falls back to the spell's name.
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], shadow, [form(28, 'Shadowform')]))).slice(0, 3)).toEqual([
			'Mind Flay > Any form',
			'Greater Heal > Caster only',
			'Shadow Word: Death > Shadowform only',
		]);
	});

	it('files every rank under the highest rank in the highest rank’s bucket', async () => {
		const charge = [
			spell(named(52, 'Bloodthirst'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
			spell(named(50, 'Charge (Rank 1)', 1), ActionCategory.ActionCategoryUnknown, { forms: [17, 18] }),
			spell(named(51, 'Charge (Rank 2)', 2), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], charge, stances, true))).slice(0, 3)).toEqual([
			'Bloodthirst > Any stance',
			'Charge (Rank 1) > Battle only > Charge (Rank 2)',
			'Charge (Rank 2) > Battle only',
		]);
	});

	it('files class auras that work in some forms; the rest stay at the top level', async () => {
		const auras = [
			aura(named(60, 'Battle Shout'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19] }),
			aura(named(61, 'Charge'), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
			aura(named(62, 'Recklessness'), ActionCategory.ActionCategoryCooldown, { forms: [19] }),
		];
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], stances, true)))).toEqual([
			'Charge > Battle only',
			'Recklessness > cooldowns',
			'Battle Shout',
		]);
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
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], spells, [], false, Class.ClassPaladin));
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
		expect(menu(await actionIdSets.auras.getActionIDs(metadata(auras, [], [], false, Class.ClassPaladin)))).toEqual([
			'Holy Shield > Protection',
			'Redoubt > Protection',
			'Vengeance > Retribution',
			'Divine Favor > cooldowns',
			'Holy Might > talents',
			'Righteous Fury',
		]);
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
