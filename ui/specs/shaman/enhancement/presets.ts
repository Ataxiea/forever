import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import DefaultApl from './apls/default.apl.siml';
import TestingBuildJson from './builds/testing.siml';
import PreBiSGearJson from './gear_sets/prebis.gear.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

// Dungeon and world drops, the shaman's dungeon tier set, crafted items whose reagents include no raid
// materials and vendor items; no reputation or PvP rewards. The cloak, the second ring and the Adaptive
// Combat Assistant are sold by the Undermine Trader in Stranglethorn Vale. The patterns of the head, chest and
// leggings, the shoulders and the first ring have no known source.
export const PreBiSGear = PresetUtils.makePresetGear('Pre-BiS', PreBiSGearJson);

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecEnhancementShaman, TestingBuildJson);

export const StandardTalents = {
	name: 'Standard',
	data: SavedTalents.create({
		talentsString: '050533102-053030031005112251',
	}),
};

// Measured on the Pre-BiS gear with the Standard talents over a three minute fight. Hit is its value below the
// 8% cap.
export const PreBiSEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.2,
			[Stat.StatAgility]: 1.82,
			[Stat.StatIntellect]: 2.72,
			[Stat.StatAttackPower]: 1,
			[Stat.StatHitRating]: 5.36,
			[Stat.StatCritRating]: 3.13,
			[Stat.StatHasteRating]: 2.51,
			[Stat.StatExpertiseRating]: 3.66,
			[Stat.StatArmorPenetration]: 0.5,
			[Stat.StatSpellDamage]: 1.15,
			[Stat.StatNatureDamage]: 0.63,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 14.2,
		},
	),
);
