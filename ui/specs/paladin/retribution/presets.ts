import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
import * as Mechanics from '@sim/constants/mechanics';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import HolyShockApl from './apls/holy_shock.apl.siml';
import TwistOfLightApl from './apls/twist_of_light.apl.siml';
import HolyShockBuildJson from './builds/holy_shock.siml';
import TwistOfLightBuildJson from './builds/twist_of_light.siml';
import HolyShockGear from './gear_sets/holy_shock.gear.siml';
import TwistOfLightGear from './gear_sets/twist_of_light.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecRetributionPaladin, DefaultsJson);

export const HolyShockAplPreset = PresetUtils.makePresetAPLRotation('Holy Shock', HolyShockApl);
export const TwistOfLightAplPreset = PresetUtils.makePresetAPLRotation('Twist of Light', TwistOfLightApl);

export const HolyShockGearPreset = PresetUtils.makePresetGear('Holy Shock', HolyShockGear, {
	devOnly: true,
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});
export const TwistOfLightGearPreset = PresetUtils.makePresetGear('Twist of Light', TwistOfLightGear, {
	devOnly: true,
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});

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
			[PseudoStat.PseudoStatSchoolHitPercentHoly]: 2.32 * Mechanics.HIT_RATING_PER_HIT_PERCENT,
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
			[PseudoStat.PseudoStatSchoolHitPercentHoly]: 0.6 * Mechanics.HIT_RATING_PER_HIT_PERCENT,
		},
	),
);

// The settings and the build of each talent tree. The Auto rotation picks the Twist of Light or the Holy Shock APL from
// the talents; the Holy Shock build swaps in Shin Blade while the Manual Crowd Pummeler is on cooldown.
export const TwistOfLightBuild = PresetUtils.makePresetBuildFromJSON('Twist of Light', Spec.SpecRetributionPaladin, TwistOfLightBuildJson);
export const HolyShockBuild = PresetUtils.makePresetBuildFromJSON('Holy Shock', Spec.SpecRetributionPaladin, HolyShockBuildJson);
export const TwistOfLightSettings = TwistOfLightBuild.settings!;
export const HolyShockSettings = HolyShockBuild.settings!;
export const TwistOfLightTalents = TwistOfLightBuild.talents!;
export const HolyShockTalents = HolyShockBuild.talents!;
