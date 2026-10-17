import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import DefaultApl from './apls/default.apl.siml';
import TestingBuildJson from './builds/testing.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecEnhancementShaman, DefaultsJson);

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

export const DefaultGear = PresetUtils.makePresetGear('Testing', TestingBuildJson.player.equipment);

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecEnhancementShaman, TestingBuildJson);

export const StandardTalents = {
	name: 'Standard',
	data: Defaults.talents,
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
