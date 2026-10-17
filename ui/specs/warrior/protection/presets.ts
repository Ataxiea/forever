import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import GenericApl from './apls/default.apl.siml';
import PreBiSGearJson from './gear_sets/prebis.gear.siml';
import PreBiSThreatGearJson from './gear_sets/prebis_threat.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecProtectionWarrior, DefaultsJson);

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const ROTATION_DEFAULT = PresetUtils.makePresetAPLRotation('Generic', GenericApl);

// Dungeon and world drops, the warrior's dungeon tier set, crafted items whose reagents include no raid
// materials and vendor items; no reputation, PvP or Silithus rewards. The most threat at 142 defense, past the 140
// that makes a level 63 boss unable to crit. The "of Defense" and "of the Tiger" pieces are world-drop greens; the
// cloak, the first ring and Defender's Grip Stabilizer are sold by the Undermine Trader in Stranglethorn Vale; Beads
// of Ogre Might is a Dire Maul quest reward. Horned Pauldron, the Dawn Armor pattern, the second ring and the
// Sentinel's Gloves plans have no known source.
export const PreBiSGear = PresetUtils.makePresetGear('Pre-BiS (Defense Cap)', PreBiSGearJson);

// The same sources with no defense floor: the most threat that survives the default target on the default healing.
// Heart of the Scale drops in Lower Blackrock Spire; Cutthroat's Signet is sold by the Undermine Trader.
export const PreBiSThreatGear = PresetUtils.makePresetGear('Pre-BiS (Threat)', PreBiSThreatGearJson);

export const ProtectionTalents = PresetUtils.makePresetTalents('Protection', Defaults.talents);

// Measured on each gear set with the Protection talents: 0.6 x the threat weights (Strength = 1) plus 1.15 x the
// TMI weights (Stamina = 1). On the defense cap gear, defense is its value past the cap; on the threat gear, hit is
// its value past the 8% cap. ArmorNoMods weighs as Armor, since nothing in the build scales armor.
export const PreBiSEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS (Defense Cap)',
	Stats.fromMap(
		{
			[Stat.StatStamina]: 1.15,
			[Stat.StatStrength]: 0.62,
			[Stat.StatAgility]: 0.66,
			[Stat.StatAttackPower]: 0.27,
			[Stat.StatHitRating]: 1.13,
			[Stat.StatCritRating]: 0.58,
			[Stat.StatHasteRating]: 0.36,
			[Stat.StatExpertiseRating]: 2.32,
			[Stat.StatArmorPenetration]: 0.12,
			[Stat.StatDefenseRating]: 0.22,
			[Stat.StatBlockRating]: 0.02,
			[Stat.StatBlockValue]: 0.6,
			[Stat.StatDodgeRating]: 0.17,
			[Stat.StatParryRating]: 0.18,
			[Stat.StatArmor]: 0.05,
			[Stat.StatBonusArmor]: 0.05,
			[Stat.StatArmorNoMods]: 0.05,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 2.16,
		},
	),
);

export const PreBiSThreatEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS (Threat)',
	Stats.fromMap(
		{
			[Stat.StatStamina]: 1.15,
			[Stat.StatStrength]: 0.62,
			[Stat.StatAgility]: 0.61,
			[Stat.StatAttackPower]: 0.27,
			[Stat.StatHitRating]: 0.05,
			[Stat.StatCritRating]: 0.55,
			[Stat.StatHasteRating]: 0.38,
			[Stat.StatExpertiseRating]: 2.35,
			[Stat.StatArmorPenetration]: 0.13,
			[Stat.StatDefenseRating]: 0.26,
			[Stat.StatBlockRating]: 0.01,
			[Stat.StatBlockValue]: 0.6,
			[Stat.StatDodgeRating]: 0.13,
			[Stat.StatParryRating]: 0.15,
			[Stat.StatArmor]: 0.05,
			[Stat.StatBonusArmor]: 0.05,
			[Stat.StatArmorNoMods]: 0.05,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 2.29,
		},
	),
);
