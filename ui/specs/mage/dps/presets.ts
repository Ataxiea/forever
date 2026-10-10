import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { Mage_Rotation } from '@generated/proto/mage';
import { SavedTalents } from '@generated/proto/ui';

import DefaultApl from './apls/default.apl.siml';

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const DEFAULT_APL = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

export const ArcaneMageSimpleRotation = Mage_Rotation.create({
	conserveStart: 20,
	conserveEnd: 30,
	delayMajorCDs: 10,
});

export const APL_ARCANE_SIMPLE = PresetUtils.makePresetSimpleRotation('Simple', Spec.SpecMage, ArcaneMageSimpleRotation);

export const Talents = {
	name: 'Blank',
	data: SavedTalents.create({
		talentsString: '',
	}),
};
