import * as PresetUtils from '@app/preset_utils';
import { PseudoStat, Spec, Stat } from '@generated/proto/common';
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

// DPS weights for Dream, Cat 9/35/7 and 180s ±120s, averaged across the four races.
// Rating weights measure hit at 7% and expertise at 5.5%.
export const DefaultEp = Stats.fromMap(
	{
		[Stat.StatStrength]: 0.5699,
		[Stat.StatAgility]: 0.5815,
		[Stat.StatAttackPower]: 0.2351,
		[Stat.StatFeralAttackPower]: 0.2351,
		[Stat.StatPhysicalDamage]: 2.1248,
		[Stat.StatHitRating]: 4.8332 / 10,
		[Stat.StatExpertiseRating]: 4.57 / 10,
		[Stat.StatCritRating]: 5.9088 / 14,
		[Stat.StatHasteRating]: 4.1595 / 10,
	},
	{
		[PseudoStat.PseudoStatMainHandDps]: 2.2704,
	},
);

export const DefaultEpWeights = PresetUtils.makePresetEpWeights('Feral Cat', DefaultEp);

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

// Naturalist in place of Natural Shapeshifter.
export const CatTalents = PresetUtils.makePresetTalents('Cat', Defaults.talents);
export const HybridTalents = PresetUtils.makePresetTalents('Hybrid', SavedTalents.create({ talentsString: '050022-05230332121131212051-04' }));

export const BearweaveBuild = PresetUtils.makePresetBuild('Bearweave (45s fights)', {
	talents: CatTalents,
	rotation: BEARWEAVE_APL,
});
