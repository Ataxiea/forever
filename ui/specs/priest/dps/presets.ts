import * as PresetUtils from '@app/preset_utils';
import { Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import DefaultApl from './apls/default.apl.siml';
import SmiteApl from './apls/smite.apl.siml';
import PreraidGearJson from './gear_sets/preraid.gear.siml';
import PreraidSmiteGear from './gear_sets/preraid-smite.gear.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', DefaultApl);
export const ROTATION_SMITE_DEFAULT = PresetUtils.makePresetAPLRotation('Smite', SmiteApl);

export const PreraidGear = PresetUtils.makePresetGear('Pre-raid', PreraidGearJson);
export const PreraidSmite = PresetUtils.makePresetGear('Smite Pre-raid', PreraidSmiteGear);

export const StandardTalents = PresetUtils.makePresetTalents('Standard', SavedTalents.create({ talentsString: '005300211303--500320501201312251' }));
export const SmiteTalents = PresetUtils.makePresetTalents('Smite', SavedTalents.create({ talentsString: '525230031305001001-30515100002-3' }));

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
