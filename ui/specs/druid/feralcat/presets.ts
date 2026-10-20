import * as PresetUtils from '@app/preset_utils';
import { Spec, Stat } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';
import { Stats } from '@sim/proto/stats';

import DefaultsJson from './defaults.siml';
import BearweaveApl from './apls/bearweave.apl.siml';
import DefaultApl from './apls/default.apl.siml';
import EnergizedApl from './apls/energized.apl.siml';
import JvmesApl from './apls/jvmes.apl.siml';
import PounceApl from './apls/pounce.apl.siml';
import RavageApl from './apls/ravage.apl.siml';
import ShadowmeldApl from './apls/shadowmeld.apl.siml';
import Level60GearJson from './gear_sets/default.gear.siml';
import PreRaidGearJson from './gear_sets/pre_raid.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecFeralCatDruid, DefaultsJson);

// Leather at 60 with no set bonus and no proc. The stand-in the rotation was tuned on.
export const Level60Gear = PresetUtils.makePresetGear('Level 60', Level60GearJson, {
	devOnly: true,
	tooltip: 'Leather at level 60 with no set bonus and no proc. Fist of Cenarius and the Howling Idol.',
});

// Pre-raid leather on a Night Elf with The Unstoppable Force and Wolfshead Helm. Shifting Cloak, Dunestalker's
// Boots, Ferocious Watcher's Signet and the two hit and attack power trinkets stand in for Cape of the Black
// Baron, Swiftwalker Boots, Tarnished Elven Ring, Blackhand's Breadth and Hand of Justice, which the item
// database does not carry.
export const PreRaidGear = PresetUtils.makePresetGear('Pre-raid', PreRaidGearJson, {
	devOnly: true,
	tooltip: 'Pre-raid leather with The Unstoppable Force, Wolfshead Helm and full enchants.',
});

// EP estimates with agility as 1. Hit is weighed 2% below the 8% cap.
// Feral attack power uses attack power's weight through the form-only dependency.
export const Level60Ep = Stats.fromMap({
	[Stat.StatStrength]: 0.98,
	[Stat.StatAgility]: 1,
	[Stat.StatAttackPower]: 0.41,
	[Stat.StatFeralAttackPower]: 0.41,
	[Stat.StatPhysicalDamage]: 3.72,
	[Stat.StatHitRating]: 0.73,
	[Stat.StatExpertiseRating]: 0.69,
	[Stat.StatCritRating]: 0.72,
	[Stat.StatHasteRating]: 0.38,
	[Stat.StatArmorPenetration]: 0.12,
});

export const Level60EpWeights = PresetUtils.makePresetEpWeights('Level 60', Level60Ep);

// EP estimates with agility as 1. Hit is weighed 2% below the 8% cap.
export const PreRaidEp = Stats.fromMap({
	[Stat.StatStrength]: 0.97,
	[Stat.StatAgility]: 1,
	[Stat.StatAttackPower]: 0.39,
	[Stat.StatFeralAttackPower]: 0.39,
	[Stat.StatPhysicalDamage]: 3.56,
	[Stat.StatHitRating]: 0.75,
	[Stat.StatExpertiseRating]: 0.73,
	[Stat.StatCritRating]: 0.75,
	[Stat.StatHasteRating]: 0.43,
	[Stat.StatArmorPenetration]: 0.13,
});

export const PreRaidEpWeights = PresetUtils.makePresetEpWeights('Pre-raid', PreRaidEp);

// The cat stays in Cat Form: Shifting Power, Rip, Rake and Shred, Faerie Fire for Omen of Clarity,
// and a self-Innervate when mana would run short.
export const MONOCAT_APL = PresetUtils.makePresetAPLRotation('Monocat', DefaultApl);
// Monocat with Shadowmeld into Ravage on cooldown, for a Night Elf.
export const SHADOWMELD_APL = PresetUtils.makePresetAPLRotation('Monocat, Shadowmeld Ravage (Night Elf)', ShadowmeldApl);
// Monocat with Read Ley Line, for a High Order Skyborne: cast in an idle GCD under 1400 mana. 0 to 4 DPS
// from 60 to 300 seconds.
export const ENERGIZED_APL = PresetUtils.makePresetAPLRotation('Monocat, Energized (High Order Skyborne)', EnergizedApl);
// Uses Thistle Tea and optional Sapper, with racial actions gated by availability.
// The Prowl opener requires prepull Clearcasting; Shadowmeld enables Ravage during combat.
export const JVMES_APL = {
	...PresetUtils.makePresetAPLRotation('Monocat, adaptive racials and Sapper', JvmesApl),
	tooltip:
		'Maintains Rip and Rake, saves Bite for fight end, and uses available racial abilities and optional Sapper. Opens with Ravage when prepull Clearcasting is enabled.',
};
export const RAVAGE_APL = PresetUtils.makePresetAPLRotation('Ravage opener', RavageApl);
export const POUNCE_APL = PresetUtils.makePresetAPLRotation('Pounce opener', PounceApl);
// Monocat with Dire Bear trips for Primal Bite and Maul, only on mana the Shifting Powers to the end
// of the fight do not need. Needs the Primal Bite talent.
export const BEARWEAVE_APL = PresetUtils.makePresetAPLRotation('Bearweave', BearweaveApl);

export const CatTalents = PresetUtils.makePresetTalents('Cat', Defaults.talents);
export const HybridTalents = PresetUtils.makePresetTalents('Hybrid', SavedTalents.create({ talentsString: '050022-05230332121131212051-04' }));

export const BearweaveBuild = PresetUtils.makePresetBuild('Bearweave (45s fights)', {
	talents: CatTalents,
	rotation: BEARWEAVE_APL,
});
