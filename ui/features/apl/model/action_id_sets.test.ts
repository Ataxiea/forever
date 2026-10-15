import { ActionCategory } from '@generated/proto/api';
import type { UnitMetadata } from '@sim/player/player';
import { ActionId } from '@sim/proto/action_id';
import { describe, expect, it, vi } from 'vitest';

import { actionIdSets } from './action_id_sets';

// Form labels in English; every other key passes through, as the existing cases expect.
vi.mock('@i18n/config', () => {
	const strings: Record<string, string> = {
		'rotation_tab.apl.forms.any_stance': 'Any stance',
		'rotation_tab.apl.forms.any_form': 'Any form',
		'rotation_tab.apl.forms.no_form': 'Caster',
		'rotation_tab.apl.forms.names.17': 'Battle',
		'rotation_tab.apl.forms.names.18': 'Defensive',
		'rotation_tab.apl.forms.names.19': 'Berserker',
	};
	return {
		default: {
			t: (key: string, options?: { form?: string }) => (key === 'rotation_tab.apl.forms.only' ? `${options?.form} only` : (strings[key] ?? key)),
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
) =>
	({
		getAuras: () => auras,
		getSpells: () => spells,
		getName: () => '',
		getForms: () => forms,
		isAlwaysInForm: () => alwaysInForm,
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
		spell(named(36, 'Battle Stance'), ActionCategory.ActionCategoryUnknown, { forms: [17, 18, 19], group: 'forms' }),
	];

	it('files class spells by form: any first, single forms in form order, then pairs; groups before categories', async () => {
		const options = await actionIdSets.castable_spells.getActionIDs(metadata([], spells, stances, true));
		expect(menu(options).slice(0, 7)).toEqual([
			'Bloodthirst > Any stance',
			'Overpower > Battle only',
			'Revenge > Defensive only',
			'Whirlwind > Berserker only',
			'Rend > Battle + Defensive',
			'Battle Stance > forms',
			'Recklessness > cooldowns',
		]);
	});

	it('keeps Spell when every class spell works in every form', async () => {
		const anyOnly = [spell(named(40, 'Mind Flay'), ActionCategory.ActionCategoryUnknown, { forms: [0, 28] })];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], anyOnly, [form(28, 'Shadowform')])))[0]).toBe('Mind Flay > spell');
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
			spell(named(50, 'Charge (Rank 1)', 1), ActionCategory.ActionCategoryUnknown, { forms: [17, 18] }),
			spell(named(51, 'Charge (Rank 2)', 2), ActionCategory.ActionCategoryUnknown, { forms: [17] }),
		];
		expect(menu(await actionIdSets.castable_spells.getActionIDs(metadata([], charge, stances, true))).slice(0, 2)).toEqual([
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
