import * as PresetUtils from '@app/preset_utils';

import DefaultApl from './apls/default.apl.siml';

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const DEFAULT_APL = PresetUtils.makePresetAPLRotation('Default', DefaultApl);
