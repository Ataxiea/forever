import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';

import DefaultsJson from './defaults.siml';
import DefaultApl from './apls/default.apl.siml';
import P1ArcaneGearJson from './gear_sets/p1Arcane.gear.siml';

// The spec's defaults, from defaults.siml.
export const Defaults = PresetUtils.specDefaultsFromSettings(Spec.SpecMage, DefaultsJson);

export const P1ArcaneGear = PresetUtils.makePresetGear('P1 Arcane', P1ArcaneGearJson);

export const ArcaneTalents = {
	name: 'Arcane',
	data: Defaults.talents,
};

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const DEFAULT_APL = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

export const APL_ARCANE_SIMPLE = PresetUtils.makePresetSimpleRotation('Simple', Spec.SpecMage, Defaults.simpleRotation!);
