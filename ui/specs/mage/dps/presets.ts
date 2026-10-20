import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';

import arcaneFire from './apls/arcaneFireFill.apl.siml';
import arcaneFrost from './apls/arcaneFrostFill.apl.siml';
import deepFire from './apls/deepFire.apl.siml';
import ffb from './apls/ffb.apl.siml';
import DefaultsJson from './defaults.siml';
import P1ArcaneGearJson from './gear_sets/p1Arcane.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecMage, DefaultsJson);

export const P1ArcaneGear = PresetUtils.makePresetGear('P1 Arcane', P1ArcaneGearJson, { devOnly: true });

export const ArcaneFrostAplPreset = PresetUtils.makePresetAPLRotation('Arcane Frost', arcaneFrost);
export const ArcaneFireAplPreset = PresetUtils.makePresetAPLRotation('Arcane Fire', arcaneFire);
export const FFBAplPreset = PresetUtils.makePresetAPLRotation('FFB', ffb);
export const FireAplPreset = PresetUtils.makePresetAPLRotation('Fire', deepFire);

export const ArcaneFrostTalents = PresetUtils.makePresetTalents('Arcane Frost', Defaults.talents);
export const ArcaneFireTalents = PresetUtils.makePresetTalents('Arcane Fire', SavedTalents.create({ talentsString: '0502205003100311531-230510301001-003' }));
export const FFBTalents = PresetUtils.makePresetTalents('FFB', SavedTalents.create({ talentsString: '-2355000013011503-2035010311013002' }));
export const FireTalents = PresetUtils.makePresetTalents('Fire', SavedTalents.create({ talentsString: '05022050001001-23550000130135031-003' }));

export const ArcaneFrostBuild = PresetUtils.makePresetBuild('Arcane Frost', {
	gear: P1ArcaneGear,
	talents: ArcaneFrostTalents,
	//rotationType: APLRotationType.TypeAuto,
	rotation: ArcaneFrostAplPreset,
});

export const ArcaneFireBuild = PresetUtils.makePresetBuild('Arcane Fire', {
	gear: P1ArcaneGear,
	talents: ArcaneFireTalents,
	//rotationType: APLRotationType.TypeAuto,
	rotation: ArcaneFireAplPreset,
});

export const FFBBuild = PresetUtils.makePresetBuild('FFB', {
	gear: P1ArcaneGear,
	talents: FFBTalents,
	//rotationType: APLRotationType.TypeAuto,
	rotation: FFBAplPreset,
});

export const FireBuild = PresetUtils.makePresetBuild('Fire', {
	gear: P1ArcaneGear,
	talents: FireTalents,
	//rotationType: APLRotationType.TypeAuto,
	rotation: FireAplPreset,
});
