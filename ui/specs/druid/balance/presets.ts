import * as PresetUtils from '@app/preset_utils';
import { Spec, Stat } from '@generated/proto/common';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import DefaultAPL from './apls/default.apl.siml';
import P1GearJson from './gear_sets/p1.gear.siml';
import PreBiSGearJson from './gear_sets/prebis.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecBalanceDruid, DefaultsJson);

export const StandardRotation = PresetUtils.makePresetAPLRotation('Default', DefaultAPL);

export const StandardTalents = PresetUtils.makePresetTalents('Moonkin', Defaults.talents);

// Dungeon drops, world-drop greens with the "of Magic" suffix and crafted items whose reagents include no
// raid materials; no reputation or PvP rewards, and no Scourge Invasion drops. The neck is a Dire Maul
// quest reward. The cloak, the rings, the trinkets and the idol are sold by the Undermine Trader in
// Stranglethorn Vale. The staff, and the Pristine Scale and Fel Leather the leggings take, have no known source.
export const PreBiSGear = PresetUtils.makePresetGear('Pre-BiS', PreBiSGearJson);

export const P1Gear = PresetUtils.makePresetGear('P1', P1GearJson);

// Measured on the P1 gear with the Moonkin talents and the default consumables and buffs.
export const P1EpWeights = PresetUtils.makePresetEpWeights(
	'P1',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.28,
		[Stat.StatSpirit]: 0,
		[Stat.StatSpellDamage]: 1,
		[Stat.StatArcaneDamage]: 0.68,
		[Stat.StatNatureDamage]: 0.32,
		[Stat.StatHitRating]: 1.48,
		[Stat.StatCritRating]: 0.76,
		[Stat.StatHasteRating]: 0.99,
		[Stat.StatMP5]: 0.15,
	}),
);

// Measured on the Pre-BiS gear with the Moonkin talents and the default consumables and buffs.
export const PreBiSEpWeights = PresetUtils.makePresetEpWeights(
	'Pre-BiS',
	Stats.fromMap({
		[Stat.StatIntellect]: 0.2,
		[Stat.StatSpirit]: 0,
		[Stat.StatSpellDamage]: 1,
		[Stat.StatArcaneDamage]: 0.68,
		[Stat.StatNatureDamage]: 0.32,
		[Stat.StatHitRating]: 1.45,
		[Stat.StatCritRating]: 0.76,
		[Stat.StatHasteRating]: 0.95,
		[Stat.StatMP5]: 0,
	}),
);
