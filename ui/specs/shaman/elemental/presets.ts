import * as PresetUtils from '@app/preset_utils';
import { Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import TestingBuildJson from './builds/testing.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', TestingBuildJson.player.rotation);

export const DefaultGear = PresetUtils.makePresetGear('Testing', TestingBuildJson.player.equipment);

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecElementalShaman, TestingBuildJson);

// Measured on the Testing gear with the Standard talents over a three minute fight. Hit is its value below the
// 17% cap.
export const DefaultEpWeights = PresetUtils.makePresetEpWeights(
	'Testing',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.17,
		[Stat.StatSpirit]: 0.05,
		[Stat.StatSpellDamage]: 1,
		[Stat.StatFireDamage]: 0.32,
		[Stat.StatNatureDamage]: 0.68,
		[Stat.StatHitRating]: 1.16,
		[Stat.StatCritRating]: 0.59,
		[Stat.StatHasteRating]: 1.33,
		[Stat.StatMP5]: 0.04,
	}),
);

export const StandardTalents = {
	name: 'Standard',
	data: SavedTalents.create({
		talentsString: TestingBuildJson.player.talentsString,
	}),
};
