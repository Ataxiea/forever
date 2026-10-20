import * as PresetUtils from '@app/preset_utils';
import { makeSpecChangeWarningToast } from '@features/settings/utils/spec_change_warning_toast';
import { HandType, ItemSlot, PseudoStat, Spec, Stat } from '@generated/proto/common';
import { Player } from '@sim/player/player';
import { Stats } from '@sim/proto/stats';

import DefaultArmsApl from './apls/arms.apl.siml';
import DefaultFuryApl from './apls/fury.apl.siml';
import PreBiSArmsBuildJson from './builds/prebis_arms.siml';
import PreBiSFuryBuildJson from './builds/prebis_fury.siml';
import DefaultsJson from './defaults.siml';
import PreBiSArmsGearJson from './gear_sets/prebis_arms.gear.siml';
import PreBiSFuryGearJson from './gear_sets/prebis_fury.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecDpsWarrior, DefaultsJson);

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const isArmsSpec = (player: Player<Spec.SpecDpsWarrior>) =>
	player.getEquippedItem(ItemSlot.ItemSlotMainHand)?.item.handType === HandType.HandTypeTwoHand;

export const isArmsKebabSpec = (player: Player<Spec.SpecDpsWarrior>) => player.getTalents().mortalStrike && isFurySpec(player);

export const isFurySpec = (player: Player<Spec.SpecDpsWarrior>) =>
	player.getTalents().bloodthirst ||
	player.getEquippedItem(ItemSlot.ItemSlotMainHand)?.item.handType === HandType.HandTypeMainHand ||
	player.getEquippedItem(ItemSlot.ItemSlotMainHand)?.item.handType === HandType.HandTypeOneHand;

const FURY_PRESET_OPTIONS = {
	group: 'Fury',
	onLoad: (player: Player<Spec.SpecDpsWarrior>) => {
		makeSpecChangeWarningToast(
			[
				{
					condition: isArmsSpec,
					message: 'Check your gear: You have a two-handed weapon equipped, but the selected option is for dual wield.',
				},
				{
					condition: (player: Player<Spec.SpecDpsWarrior>) => !player.getTalents().dualWieldSpecialization,
					message: "Check your talents: You have selected a dual-wield spec but don't have [Dual Wield Specialization] talented.",
				},
			],
			player,
		);
	},
};

const ARMS_PRESET_OPTIONS = {
	group: 'Arms',
	onLoad: (player: Player<Spec.SpecDpsWarrior>) => {
		makeSpecChangeWarningToast(
			[
				{
					condition: isFurySpec,
					message: 'Check your gear: You have a one-handed weapon equipped, but the selected option is for two-handed weapons.',
				},
			],
			player,
		);
	},
};

// Dungeon and world drops, the warrior's dungeon tier sets and crafted items whose reagents include no
// raid materials; no reputation or PvP rewards. The shoulders and bracers are world-drop greens with the
// "of the Tiger" suffix, and the neck is a Darkmoon Faire ticket reward. The cloak, the first ring and the
// Adaptive Combat Assistant are sold by the Undermine Trader in Stranglethorn Vale; the Dawn Armor pattern and
// the second ring have no known source.
export const PreBiSFuryGear = PresetUtils.makePresetGear('Pre-BiS', PreBiSFuryGearJson, { ...FURY_PRESET_OPTIONS, devOnly: true });

// Measured on the Pre-BiS Fury gear with the Fury talents.
export const PreBiSFuryEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS - Fury',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.2,
			[Stat.StatAgility]: 2.25,
			[Stat.StatAttackPower]: 1,
			[Stat.StatArmorPenetration]: 0.41,
			[Stat.StatHitRating]: 2.29,
			[Stat.StatHasteRating]: 2.29,
			[Stat.StatCritRating]: 2.92,
			[Stat.StatExpertiseRating]: 1.9,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 9.89,
			[PseudoStat.PseudoStatOffHandDps]: 3.15,
		},
	),
);

// The same sources as the Pre-BiS Fury gear; the cloak and the bow are world-drop greens with the "of the
// Tiger" suffix too.
export const PreBiSArmsGear = PresetUtils.makePresetGear('Pre-BiS', PreBiSArmsGearJson, { ...ARMS_PRESET_OPTIONS, devOnly: true });

// Measured on the Pre-BiS Arms gear with the Arms talents. Hit is its value below the 8% cap.
export const PreBiSArmsEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS - Arms',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.2,
			[Stat.StatAgility]: 1.82,
			[Stat.StatAttackPower]: 1,
			[Stat.StatArmorPenetration]: 0.45,
			[Stat.StatHitRating]: 4.59,
			[Stat.StatHasteRating]: 2,
			[Stat.StatCritRating]: 2.36,
			[Stat.StatExpertiseRating]: 2.23,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 17.69,
			[PseudoStat.PseudoStatOffHandDps]: 0,
		},
	),
);

export const FURY_DEFAULT_ROTATION = PresetUtils.makePresetAPLRotation('Fury', DefaultFuryApl);
export const ARMS_DEFAULT_ROTATION = PresetUtils.makePresetAPLRotation('Arms', DefaultArmsApl);

// The simple rotation of the spec's defaults.
export const SIMPLE_DEFAULT_ROTATION = PresetUtils.makePresetSimpleRotation('Simple', Spec.SpecDpsWarrior, Defaults.simpleRotation!);

export const DefaultSettings = PresetUtils.makePresetSettingsFromJSON('Defaults', Spec.SpecDpsWarrior, DefaultsJson);

export const PreBiSFuryBuild = PresetUtils.makePresetBuildFromJSON('Pre-BiS', Spec.SpecDpsWarrior, PreBiSFuryBuildJson, {
	group: 'Fury',
	epWeights: PreBiSFuryEpWeights,
});

export const PreBiSArmsBuild = PresetUtils.makePresetBuildFromJSON('Pre-BiS', Spec.SpecDpsWarrior, PreBiSArmsBuildJson, {
	group: 'Arms',
	epWeights: PreBiSArmsEpWeights,
});

// The Pre-BiS Fury build's talents, the best found on its gear over a three minute fight.
export const FuryTalents = PresetUtils.makePresetTalents('Fury', PreBiSFuryBuild.talents!.data);

// The Pre-BiS Arms build's talents, a Battle Stance build: Rend keeps Bloodthrill's Overpower procs coming, and
// Spearing Strike fills the global cooldowns Mortal Strike and Slam leave.
export const ArmsTalents = PresetUtils.makePresetTalents('Arms', PreBiSArmsBuild.talents!.data);
