import * as PresetUtils from '@app/preset_utils';

import DefaultApl from './apls/default.apl.siml';
import DefaultGear from './gear_sets/default.gear.siml';

// Seal of Righteousness, Judgement and Holy Strike on cooldown. A rotation worth the name waits
// for the Forever numbers above level 20.
export const APL_PRESET = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

// Level 60 blues from dungeons, quests, reputations and crafting: a placeholder until Phase 1
// gear is known.
export const GEAR_DEFAULT = PresetUtils.makePresetGear('Default', DefaultGear, {
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});
