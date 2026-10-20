import * as PresetUtils from '@app/preset_utils';
import { Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import TestingBuildJson from './builds/testing.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', TestingBuildJson.player.rotation);

export const DefaultGear = PresetUtils.makePresetGear('Testing', TestingBuildJson.player.equipment, { devOnly: true });

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecElementalShaman, TestingBuildJson, { gear: DefaultGear });

// Measured on the Testing gear with the Standard talents over a three minute fight. Hit is its value below the
// 17% cap.
export const DefaultEpWeights = PresetUtils.makePresetEpWeights(
	'Testing',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.19,
		[Stat.StatSpirit]: 0.02,
		[Stat.StatSpellDamage]: 1,
		[Stat.StatFireDamage]: 0.31,
		[Stat.StatNatureDamage]: 0.69,
		[Stat.StatSpellPiercing]: 1.81,
		[Stat.StatHitRating]: 1.18,
		[Stat.StatCritRating]: 0.61,
		[Stat.StatHasteRating]: 1.23,
		[Stat.StatMP5]: 0.04,
	}),
);

export const StandardTalents = {
	name: 'Standard',
	data: SavedTalents.create({
		talentsString: TestingBuildJson.player.talentsString,
	}),
};
