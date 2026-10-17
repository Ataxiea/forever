import * as PresetUtils from '@app/preset_utils';
import { Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import SmiteTestingBuildJson from './builds/smite_testing.siml';
import ShadowTestingBuildJson from './builds/testing.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', ShadowTestingBuildJson.player.rotation);
export const ROTATION_SMITE_DEFAULT = PresetUtils.makePresetAPLRotation('Smite', SmiteTestingBuildJson.player.rotation);

export const ShadowTestingGear = PresetUtils.makePresetGear('Shadow Testing', ShadowTestingBuildJson.player.equipment);
export const SmiteTestingGear = PresetUtils.makePresetGear('Smite Testing', SmiteTestingBuildJson.player.equipment);

export const StandardTalents = PresetUtils.makePresetTalents('Standard', SavedTalents.create({ talentsString: ShadowTestingBuildJson.player.talentsString }));
export const ShadowTestingBuild = PresetUtils.makePresetBuildFromJSON('Shadow Testing', Spec.SpecDpsPriest, ShadowTestingBuildJson);

export const SmiteTalents = PresetUtils.makePresetTalents('Smite', SavedTalents.create({ talentsString: SmiteTestingBuildJson.player.talentsString }));
export const SmiteTestingBuild = PresetUtils.makePresetBuildFromJSON('Smite Testing', Spec.SpecDpsPriest, SmiteTestingBuildJson);

export const ShadowEpWeights = PresetUtils.makePresetEpWeights(
	'Shadow',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.24,
		[Stat.StatSpellDamage]: 1.0,
		[Stat.StatShadowDamage]: 1.0,
		[Stat.StatSpirit]: 0.01,
		[Stat.StatHitRating]: 1.14,
		[Stat.StatCritRating]: 0.84,
		[Stat.StatHasteRating]: 0.73,
	}),
);

export const SmiteEpWeights = PresetUtils.makePresetEpWeights(
	'Smite',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.58,
		[Stat.StatSpellDamage]: 1.0,
		[Stat.StatHolyDamage]: 0.81,
		[Stat.StatShadowDamage]: 0.19,
		[Stat.StatSpirit]: 0.57,
		[Stat.StatHitRating]: 0.37,
		[Stat.StatCritRating]: 0.32,
		[Stat.StatHasteRating]: 0.43,
		[Stat.StatMP5]: 1.46,
	}),
);
