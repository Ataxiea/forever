import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { Hunter_Rotation_Playstyle as Playstyle } from '@generated/proto/hunter';

import WeaveAPL from './apls/default.apl.siml';
import WeaveHawkAPL from './apls/default_hawks.apl.siml';
import MeleeAPL from './apls/melee.apl.siml';
import TurretAPL from './apls/turret.apl.siml';
import TurretHawkAPL from './apls/turret_hawk.apl.siml';
import TurretMultiAPL from './apls/turret_multi.apl.siml';
import BmBuild from './builds/bm.siml';
import BmWeaveBuild from './builds/bm_weave.siml';
import MmBuild from './builds/mm.siml';
import MmWeaveBuild from './builds/mm_weave.siml';
import SvBuild from './builds/sv.siml';
import SvMeleeBuild from './builds/sv_melee.siml';
import SvWeaveBuild from './builds/sv_weave.siml';
import DefaultsJson from './defaults.siml';
import P1GearJson from './gear_sets/p1.gear.siml';
import P1MeleeGearJson from './gear_sets/p1_melee.gear.siml';

// The same armor twice, with the weapons each playstyle swings: a two-hander to weave with, which
// is also the better pair of stats at range, and two one-handers to stand in melee with.
export const P1Gear = PresetUtils.makePresetGear('P1', P1GearJson);
export const P1MeleeGear = PresetUtils.makePresetGear('P1 Dual Wield', P1MeleeGearJson);

// The priority list of each playstyle. Their "Use ..." variables are the simple rotation's toggles.
export const PlaystyleAPLs: Record<Playstyle, any> = {
	[Playstyle.Turret]: TurretAPL,
	[Playstyle.Weave]: WeaveAPL,
	[Playstyle.Melee]: MeleeAPL,
};
// At range with hawks out, the hawks go ahead of Serpent Sting and Aimed Shot.
export const TurretHawkPlaystyleAPL: any = TurretHawkAPL;

export const TurretAPLRotation = PresetUtils.makePresetAPLRotation('Turret', TurretAPL);
export const TurretMultiAPLRotation = PresetUtils.makePresetAPLRotation('Turret (Multi-Shot)', TurretMultiAPL);
export const TurretHawkAPLRotation = PresetUtils.makePresetAPLRotation('Turret (Hawks)', TurretHawkAPL);
export const WeaveAPLRotation = PresetUtils.makePresetAPLRotation('Melee Weave', WeaveAPL);
export const WeaveHawkAPLRotation = PresetUtils.makePresetAPLRotation('Melee Weave (Hawks)', WeaveHawkAPL);
export const MeleeAPLRotation = PresetUtils.makePresetAPLRotation('Melee', MeleeAPL);

export const DefaultRotation = WeaveAPLRotation;

// The simple rotation of the spec's defaults.
export const SimpleRotation = PresetUtils.makePresetSimpleRotation(
	'Simple',
	Spec.SpecHunter,
	PresetUtils.specDefaultsFromSettings(Spec.SpecHunter, DefaultsJson).simpleRotation!,
);

// Gear, talents, rotation, pet and distance together, one per tree and playstyle: the best build found for each on
// the P1 gear over a three minute fight.
export const Builds = [
	PresetUtils.makePresetBuildFromJSON('SV Weave', Spec.SpecHunter, SvWeaveBuild),
	PresetUtils.makePresetBuildFromJSON('MM Weave', Spec.SpecHunter, MmWeaveBuild),
	PresetUtils.makePresetBuildFromJSON('BM Weave', Spec.SpecHunter, BmWeaveBuild),
	PresetUtils.makePresetBuildFromJSON('MM', Spec.SpecHunter, MmBuild),
	PresetUtils.makePresetBuildFromJSON('BM', Spec.SpecHunter, BmBuild),
	PresetUtils.makePresetBuildFromJSON('SV', Spec.SpecHunter, SvBuild),
	PresetUtils.makePresetBuildFromJSON('SV Melee', Spec.SpecHunter, SvMeleeBuild),
];

// Each build's talents, under its name.
export const BuildTalents = Builds.map(build => build.talents!);
