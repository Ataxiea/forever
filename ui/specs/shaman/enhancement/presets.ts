import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import DefaultApl from './apls/default.apl.siml';
import TestingBuildJson from './builds/testing.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecEnhancementShaman, DefaultsJson);

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

export const DefaultGear = PresetUtils.makePresetGear('Testing', TestingBuildJson.player.equipment, { devOnly: true });

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecEnhancementShaman, TestingBuildJson, { gear: DefaultGear });

export const StandardTalents = {
	name: 'Standard',
	data: Defaults.talents,
};

// Measured on the Testing gear with the Standard talents over a three minute fight. The gear has 8.2% hit, so hit
// is measured with 40 hit rating taken off, for its value below the 8% cap.
export const PreBiSEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.2,
			[Stat.StatAgility]: 1.32,
			[Stat.StatIntellect]: 1.99,
			[Stat.StatAttackPower]: 1,
			[Stat.StatHitRating]: 5.2,
			[Stat.StatCritRating]: 2.42,
			[Stat.StatHasteRating]: 2.81,
			[Stat.StatExpertiseRating]: 3.5,
			[Stat.StatArmorPenetration]: 0.37,
			[Stat.StatSpellDamage]: 1.27,
			[Stat.StatNatureDamage]: 0.72,
			[Stat.StatSpellPiercing]: 2.52,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 14.18,
		},
	),
);
