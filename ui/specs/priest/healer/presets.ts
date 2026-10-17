import * as PresetUtils from '@app/preset_utils';
import { Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

export const DiscTalents = PresetUtils.makePresetTalents('Disc', SavedTalents.create({ talentsString: '005025021330011531-335001030301' }));
export const HolyTalents = PresetUtils.makePresetTalents('Holy', SavedTalents.create({ talentsString: '00520101133-33505003030121531' }));

export const DiscSingleTargetEpWeights = PresetUtils.makePresetEpWeights(
	'Disc Single-Target',
	Stats.fromMap({
		[Stat.StatHealingPower]: 1.0,
		[Stat.StatCritRating]: 0.7,
		[Stat.StatHasteRating]: 0.15,
		[Stat.StatIntellect]: 0.2,
		[Stat.StatSpirit]: 0.15,
		[Stat.StatMP5]: 0.4,
	}),
);

export const DiscRaidHealingEpWeights = PresetUtils.makePresetEpWeights(
	'Disc Raid Healing',
	Stats.fromMap({
		[Stat.StatHealingPower]: 1.0,
		[Stat.StatCritRating]: 0.48,
		[Stat.StatHasteRating]: 0.1,
		[Stat.StatIntellect]: 0.2,
		[Stat.StatSpirit]: 0.1,
		[Stat.StatMP5]: 0.19,
	}),
);

export const HolySingleTargetEpWeights = PresetUtils.makePresetEpWeights(
	'Holy Single-Target',
	Stats.fromMap({
		[Stat.StatHealingPower]: 1.0,
		[Stat.StatCritRating]: 0.3,
		[Stat.StatHasteRating]: 0.5,
		[Stat.StatIntellect]: 0.35,
		[Stat.StatSpirit]: 0.3,
		[Stat.StatMP5]: 0.6,
	}),
);

export const HolyRaidHealingEpWeights = PresetUtils.makePresetEpWeights(
	'Holy Raid Healing',
	Stats.fromMap({
		[Stat.StatHealingPower]: 1.0,
		[Stat.StatCritRating]: 0.23,
		[Stat.StatHasteRating]: 0.48,
		[Stat.StatIntellect]: 0.3,
		[Stat.StatSpirit]: 0.25,
		[Stat.StatMP5]: 0.6,
	}),
);
