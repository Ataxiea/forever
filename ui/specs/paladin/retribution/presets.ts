import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import HolyShockApl from './apls/holy_shock.apl.siml';
import TwistOfLightApl from './apls/twist_of_light.apl.siml';
import HolyShockBuildJson from './builds/holy_shock.siml';
import TwistOfLightBuildJson from './builds/twist_of_light.siml';
import HolyShockGear from './gear_sets/holy_shock.gear.siml';
import TwistOfLightGear from './gear_sets/twist_of_light.gear.siml';

export const HolyShockAplPreset = PresetUtils.makePresetAPLRotation('Holy Shock', HolyShockApl);
export const TwistOfLightAplPreset = PresetUtils.makePresetAPLRotation('Twist of Light', TwistOfLightApl);

export const HolyShockGearPreset = PresetUtils.makePresetGear('Holy Shock', HolyShockGear, {
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});
export const TwistOfLightGearPreset = PresetUtils.makePresetGear('Twist of Light', TwistOfLightGear, {
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});

export const HolyShockTalents = PresetUtils.makePresetTalents('Holy Shock', SavedTalents.create({ talentsString: '550030032101012--052252300012303' }));
export const TwistOfLightTalents = PresetUtils.makePresetTalents('Twist of Light', SavedTalents.create({ talentsString: '55003003--05225331101330321' }));

export const HolyShockEpWeights = PresetUtils.makePresetEpWeights(
	'Holy Shock',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.5,
			[Stat.StatAgility]: 3.11,
			[Stat.StatIntellect]: 4.53,
			[Stat.StatSpellDamage]: 5.78,
			[Stat.StatSpellPiercing]: 0.01,
			[Stat.StatAttackPower]: 1,
			[Stat.StatHitRating]: 10.25,
			[Stat.StatCritRating]: 4.66,
			[Stat.StatHasteRating]: 4.06,
			[Stat.StatArmorPenetration]: 0.26,
			[Stat.StatExpertiseRating]: 6.2,
			[Stat.StatMP5]: 0.01,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 13.04,
			[PseudoStat.PseudoStatSchoolHitPercentHoly]: 2.32,
		},
	),
);

export const TwistOfLightEpWeights = PresetUtils.makePresetEpWeights(
	'Twist of Light',
	Stats.fromMap(
		{
			[Stat.StatStrength]: 2.4,
			[Stat.StatAgility]: 2.23,
			[Stat.StatIntellect]: 2.06,
			[Stat.StatSpellDamage]: 2.36,
			[Stat.StatSpellPiercing]: 0.01,
			[Stat.StatAttackPower]: 1,
			[Stat.StatHitRating]: 6.83,
			[Stat.StatCritRating]: 3.08,
			[Stat.StatHasteRating]: 22.87,
			[Stat.StatArmorPenetration]: 0.24,
			[Stat.StatExpertiseRating]: 5.1,
			[Stat.StatMP5]: 0.23,
		},
		{
			[PseudoStat.PseudoStatMainHandDps]: 13.85,
			[PseudoStat.PseudoStatSchoolHitPercentHoly]: 0.6,
		},
	),
);

// The settings and the build of each talent tree. The Auto rotation picks the Twist of Light or the Holy Shock APL from
// the talents; the Holy Shock build swaps in Shin Blade while the Manual Crowd Pummeler is on cooldown.
export const TwistOfLightSettings = PresetUtils.makePresetSettingsFromJSON('Twist of Light', Spec.SpecRetributionPaladin, TwistOfLightBuildJson);
export const HolyShockSettings = PresetUtils.makePresetSettingsFromJSON('Holy Shock', Spec.SpecRetributionPaladin, HolyShockBuildJson);

export const TwistOfLightBuild = PresetUtils.makePresetBuildFromJSON('Twist of Light', Spec.SpecRetributionPaladin, TwistOfLightBuildJson);
export const HolyShockBuild = PresetUtils.makePresetBuildFromJSON('Holy Shock', Spec.SpecRetributionPaladin, HolyShockBuildJson);
