import * as PresetUtils from '@app/preset_utils';
import * as BuffDebuffInputs from '@features/settings/model/buffs_debuffs';
import * as OtherInputs from '@features/settings/model/other_inputs';
import { APLRotation } from '@generated/proto/apl';
import { ItemSlot, PseudoStat, Spec, Stat } from '@generated/proto/common';
import { PlayerClasses } from '@sim/player/classes';
import { Player } from '@sim/player/player';
import { Stats, UnitStat } from '@sim/proto/stats';
import { defineSpec } from '@sim/spec_config';

import Defaults from './defaults.siml';
import * as FeralInputs from './inputs';
import * as Presets from './presets';

export default defineSpec<Spec.SpecFeralCatDruid>({
	spec: Spec.SpecFeralCatDruid,

	className: 'feral-druid-sim-ui',
	cssScheme: PlayerClasses.getCssScheme(PlayerClasses.Druid),
	// List any known bugs / issues here and they'll be shown on the site.
	knownIssues: [],
	warnings: [],

	// Extra stats shown in consumables picker (beyond epStats).
	consumableStats: [Stat.StatHasteRating, Stat.StatMana, Stat.StatSpirit, Stat.StatMP5],

	// All stats for which EP should be calculated.
	epStats: [
		Stat.StatStrength,
		Stat.StatAgility,
		Stat.StatAttackPower,
		Stat.StatFeralAttackPower,
		Stat.StatPhysicalDamage,
		Stat.StatHitRating,
		Stat.StatExpertiseRating,
		Stat.StatCritRating,
		Stat.StatHasteRating,
		Stat.StatArmorPenetration,
	],
	epPseudoStats: [PseudoStat.PseudoStatMainHandDps],
	// Reference stat against which to calculate EP. I think all classes use either spell power or attack power.
	epReferenceStat: Stat.StatAgility,
	// Which stats to display in the Character Stats section, at the bottom of the left-hand sidebar.
	displayStats: UnitStat.createDisplayStatArray(
		[
			Stat.StatHealth,
			Stat.StatStrength,
			Stat.StatAgility,
			Stat.StatStamina,
			Stat.StatIntellect,
			Stat.StatSpirit,
			Stat.StatAttackPower,
			Stat.StatMana,
			Stat.StatArmorPenetration,
		],
		[
			PseudoStat.PseudoStatMeleeHitPercent,
			PseudoStat.PseudoStatMeleeCritPercent,
			PseudoStat.PseudoStatMeleeHastePercent,
			PseudoStat.PseudoStatExpertisePercent,
		],
	),

	defaults: {
		...PresetUtils.specDefaultsFromSettings(Spec.SpecFeralCatDruid, Defaults),
		// Default EP weights for sorting gear in the gear picker.
		epWeights: Presets.PreRaidEp,
		statCaps: (() => {
			return new Stats().withPseudoStat(PseudoStat.PseudoStatMeleeHitPercent, 8).withPseudoStat(PseudoStat.PseudoStatExpertisePercent, 6.5);
		})(),
	},

	// IconInputs to include in the 'Player' section on the settings tab.
	playerIconInputs: [],
	// Buff and Debuff inputs to include/exclude, overriding the EP-based defaults.
	includeBuffDebuffInputs: [Stat.StatMP5, Stat.StatIntellect, Stat.StatStamina],
	excludeBuffDebuffInputs: [BuffDebuffInputs.AtieshMage],
	// Inputs to include in the 'Other' section on the settings tab.
	otherInputs: {
		inputs: [
			OtherInputs.InputDelay,
			OtherInputs.DistanceFromTarget,
			OtherInputs.TankAssignment,
			OtherInputs.InFrontOfTarget,
			FeralInputs.CannotShredTarget,
			FeralInputs.AssumeBleedActive,
			FeralInputs.PrepullClearcasting,
		],
	},
	itemSwapSlots: [ItemSlot.ItemSlotMainHand, ItemSlot.ItemSlotOffHand, ItemSlot.ItemSlotTrinket1, ItemSlot.ItemSlotTrinket2],
	encounterPicker: {
		// Whether to include 'Execute Duration (%)' in the 'Encounter' section of the settings tab.
		showExecuteProportion: true,
	},

	presets: {
		epWeights: [Presets.PreRaidEpWeights, Presets.Level60EpWeights],
		// Preset talents that the user can quickly select.
		talents: [Presets.CatTalents, Presets.BearweaveTalents, Presets.ManaEfficientTalents, Presets.HybridTalents],
		rotations: [
			Presets.MONOCAT_APL,
			Presets.SHADOWMELD_APL,
			Presets.ENERGIZED_APL,
			Presets.RAVAGE_APL,
			Presets.POUNCE_APL,
			Presets.BEARWEAVE_APL,
			Presets.JVMES_APL,
		],
		builds: [Presets.BearweaveBuild],
		// Preset gear configurations that the user can quickly select.
		gear: [Presets.PreRaidGear, Presets.Level60Gear],
	},

	// Auto is the Monocat APL.
	autoRotation: (_player: Player<Spec.SpecFeralCatDruid>): APLRotation => {
		return Presets.MONOCAT_APL.rotation.rotation!;
	},

	hiddenMCDs: [],

	reforge: {},
});
