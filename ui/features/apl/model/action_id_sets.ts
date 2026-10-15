import { ActionCategory } from '@generated/proto/api';
import { OtherAction } from '@generated/proto/common';
import i18n from '@i18n/config';
import { AuraStats, SpellStats, UnitMetadata } from '@sim/player/player';
import { ActionId } from '@sim/proto/action_id';

import { formBuckets } from './form_buckets';

export type ACTION_ID_SET =
	| 'auras'
	| 'stackable_auras'
	| 'icd_auras'
	| 'exclusive_effect_auras'
	| 'spells'
	| 'castable_spells'
	| 'channel_spells'
	| 'dot_spells'
	| 'castable_dot_spells'
	| 'shield_spells'
	| 'non_instant_spells'
	| 'friendly_spells'
	| 'expected_dot_spells'
	| 'spells_with_travelTime'
	| 'potions'
	| 'conjured_items';

/** True when two or more of `spells` share `actionId`'s base name and tag — i.e. `actionId` has ranks. */
const spellHasRanks = (actionId: ActionId, spells: Array<AuraStats | SpellStats>) =>
	spells.filter(spell => actionId.baseName === spell.id.baseName && actionId.tag === spell.id.tag && spell.id.hasRank).length > 1;

/** The highest rank `offered` of `actionId`'s spell, when one ranks above `actionId`. */
const higherRank = <T extends AuraStats | SpellStats>(actionId: ActionId, offered: Array<T>): T | undefined =>
	offered
		.filter(spell => actionId.baseName === spell.id.baseName && actionId.tag === spell.id.tag && spell.id.hasRank)
		.reduce<T | undefined>((top, spell) => (spell.id.rank > (top?.id.rank ?? actionId.rank) ? spell : top), undefined);

/**
 * The menu path `actionId` is filed under. The ranks of a spell are filed under the highest rank
 * `offered`, which makes that rank the submenu's own row: picking the row picks the highest rank,
 * and the lower ranks sit behind it. `spells` decides whether `actionId` has ranks at all.
 */
const createSpellSubmenu = (
	actionId: ActionId,
	spells: Array<AuraStats | SpellStats>,
	baseMenuEntry: Array<string> = [],
	offered: Array<AuraStats | SpellStats> = spells,
): Array<string | ActionId> => {
	if (!spellHasRanks(actionId, spells)) return baseMenuEntry;
	const highest = higherRank(actionId, offered);
	return highest ? [...baseMenuEntry, highest.id] : baseMenuEntry;
};

/** The submenus the sim's categories are filed under, in the order they are listed. */
const CATEGORY_SUBMENUS: Array<[ActionCategory, string]> = [
	[ActionCategory.ActionCategoryCooldown, 'cooldowns'],
	[ActionCategory.ActionCategoryConsumable, 'consumables'],
	[ActionCategory.ActionCategoryItem, 'items'],
	[ActionCategory.ActionCategoryTalent, 'talents'],
	[ActionCategory.ActionCategoryRacial, 'racials'],
	[ActionCategory.ActionCategoryProfession, 'professions'],
	[ActionCategory.ActionCategoryExternalBuff, 'external_buffs'],
	[ActionCategory.ActionCategoryExternalCooldown, 'external_cooldowns'],
	[ActionCategory.ActionCategoryExternalDebuff, 'external_debuffs'],
];

/**
 * Files `entries` under, in this order, the form buckets of the uncategorised ones, the manual
 * groups the sim names, and their category's submenu, one category after another. Hands back the
 * rest for the caller to place.
 *
 * The categories are emitted in a fixed order because the menu places a submenu where its first
 * option appears, and the metadata arrives sorted by name.
 */
const categorise = <T extends AuraStats | SpellStats>(
	metadata: UnitMetadata,
	entries: Array<T>,
	toOption: (entry: T, submenu: Array<string | ActionId>) => ActionIdOption,
	allEntries: Array<T> = entries,
	bucketAll = true,
) => {
	const bucket = formBuckets(metadata.getForms(), metadata.isAlwaysInForm());
	const path = (entry: T, segment: string) => createSpellSubmenu(entry.id, allEntries, [segment], entries);
	const highest = new Map(entries.map(entry => [entry, higherRank(entry.id, entries) ?? entry]));
	const groupOf = (entry: T) => highest.get(entry)!.data.group;
	const grouped = entries.filter(entry => groupOf(entry));
	const groupedSet = new Set(grouped);
	const rest = entries.filter(entry => !groupedSet.has(entry));
	const uncategorised = rest.filter(entry => !CATEGORY_SUBMENUS.some(([category]) => entry.data.category === category));
	const bucketOf = new Map(uncategorised.map(entry => [entry, bucket(highest.get(entry)!.data.forms)]));
	// One bucket alone only renames Spell; an aura that works everywhere stays at the top level.
	const oneBucket = new Set([...bucketOf.values()].filter(entryBucket => entryBucket !== undefined)).size <= 1;
	const bucketed = oneBucket
		? []
		: uncategorised.filter(entry => {
				const entryBucket = bucketOf.get(entry);
				return entryBucket !== undefined && (bucketAll || !entryBucket.any);
			});
	const bucketedSet = new Set(bucketed);
	const groups = [...new Set(grouped.map(groupOf))];

	return {
		bucketed: [...bucketed]
			.sort((a, b) => bucketOf.get(a)!.order - bucketOf.get(b)!.order)
			.map(entry => toOption(entry, path(entry, bucketOf.get(entry)!.label))),
		grouped: groups.flatMap(group => grouped.filter(entry => groupOf(entry) === group).map(entry => toOption(entry, path(entry, group)))),
		categorised: CATEGORY_SUBMENUS.flatMap(([category, key]) =>
			rest.filter(entry => entry.data.category === category).map(entry => toOption(entry, path(entry, key))),
		),
		uncategorised: uncategorised.filter(entry => !bucketedSet.has(entry)),
	};
};

/** The auras `keep` passes; `allAuras`, the unfiltered list, decides whether an aura has ranks. */
const auraOptions = (metadata: UnitMetadata, allAuras: Array<AuraStats>, keep: (aura: AuraStats) => boolean = () => true): Array<ActionIdOption> => {
	const toOption = (aura: AuraStats, submenu: Array<string | ActionId>) => ({ value: aura.id, submenu });
	const kept = allAuras.filter(keep);
	const { bucketed, grouped, categorised, uncategorised } = categorise(metadata, kept, toOption, allAuras, false);
	return [...bucketed, ...grouped, ...categorised, ...uncategorised.map(aura => toOption(aura, createSpellSubmenu(aura.id, allAuras, [], kept)))];
};

/** The one list a spell may be cast from, for the spells the sim only accepts in one of them. */
export type LIST_SCOPE = 'prepull' | 'priority';

export interface ActionIdOption {
	value: ActionId;
	/** The form bucket, manual group or category submenu the spell or aura is filed under, then the highest rank its lower ranks sit behind. */
	submenu?: Array<string | ActionId>;
	tooltip?: string;
	/**
	 * Read by the field, which drops the entries the list it is in cannot use.
	 *
	 * A CSS rule scoped to the enclosing list cannot hide them: the menu renders in a portal on
	 * `document.body`, where no such rule can reach it.
	 */
	listScope?: LIST_SCOPE;
}

const listScopeOf = (spell: SpellStats): LIST_SCOPE | undefined => (spell.data.prepullOnly ? 'prepull' : spell.data.encounterOnly ? 'priority' : undefined);

export const actionIdSets: Record<
	ACTION_ID_SET,
	{
		defaultLabel: string;
		getActionIDs: (metadata: UnitMetadata) => Promise<Array<ActionIdOption>>;
	}
> = {
	auras: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.auras'),
		getActionIDs: async metadata => auraOptions(metadata, metadata.getAuras()),
	},
	stackable_auras: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.stackable_auras'),
		getActionIDs: async metadata => auraOptions(metadata, metadata.getAuras(), aura => aura.data.maxStacks > 0),
	},
	icd_auras: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.icd_auras'),
		getActionIDs: async metadata => auraOptions(metadata, metadata.getAuras(), aura => aura.data.hasIcd),
	},
	exclusive_effect_auras: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.exclusive_effect_auras'),
		getActionIDs: async metadata => auraOptions(metadata, metadata.getAuras(), aura => aura.data.hasExclusiveEffect),
	},
	// Used for non categorized lists
	spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isCastable);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells, []),
				};
			});
		},
	},
	castable_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.castable_spells'),
		getActionIDs: async metadata => {
			const castableSpells = metadata.getSpells().filter(spell => spell.data.isCastable);
			const toOption = (spell: SpellStats, submenu: Array<string | ActionId>) => ({ value: spell.id, submenu, listScope: listScopeOf(spell) });
			const { bucketed, grouped, categorised, uncategorised } = categorise(metadata, castableSpells, toOption);

			const placeholders: Array<ActionId> = [
				OtherAction.OtherActionOffensivePotion,
				OtherAction.OtherActionDefensivePotion,
				OtherAction.OtherActionResourcePotion,
			].map(otherId => ActionId.fromOtherId(otherId));

			return [
				bucketed,
				grouped,
				uncategorised.map(spell => toOption(spell, createSpellSubmenu(spell.id, castableSpells, ['spell']))),
				categorised,
				placeholders.map(actionId => {
					return {
						value: actionId,
						submenu: ['placeholders'],
						tooltip: i18n.t('rotation_tab.apl.helpers.placeholder_tooltip'),
					};
				}),
			].flat();
		},
	},
	non_instant_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.non_instant_spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isCastable && spell.data.hasCastTime);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	friendly_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.friendly_spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isCastable && spell.data.isFriendly);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	channel_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.channel_spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isCastable && spell.data.isChanneled);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	potions: {
		defaultLabel: i18n.t('rotation_tab.apl.submenus.potions'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isPotion);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	conjured_items: {
		defaultLabel: i18n.t('rotation_tab.apl.submenus.conjured_items'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isConjured);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	dot_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.dot_spells'),
		getActionIDs: async metadata => {
			const spells = metadata
				.getSpells()
				.filter(spell => spell.data.hasDot)
				// filter duplicate dot entries from RelatedDotSpell
				.filter((value, index, self) => self.findIndex(v => v.id.anyId() === value.id.anyId()) === index);

			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	castable_dot_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.castable_dot_spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.isCastable && spell.data.hasDot);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	expected_dot_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.expected_dot_spells'),
		getActionIDs: async metadata => {
			const spells = metadata
				.getSpells()
				.filter(spell => spell.data.hasExpectedTick)
				// filter duplicate dot entries from RelatedDotSpell
				.filter((value, index, self) => self.findIndex(v => v.id.anyId() === value.id.anyId()) === index);

			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	shield_spells: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.shield_spells'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.hasShield);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
	spells_with_travelTime: {
		defaultLabel: i18n.t('rotation_tab.apl.helpers.action_id_sets.spells_with_travelTime'),
		getActionIDs: async metadata => {
			const spells = metadata.getSpells().filter(spell => spell.data.hasMissileSpeed);
			return spells.map(actionId => {
				return {
					value: actionId.id,
					submenu: createSpellSubmenu(actionId.id, spells),
				};
			});
		},
	},
};
