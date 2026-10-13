import * as PresetUtils from '@app/preset_utils';
import { SavedTalents } from '@generated/proto/ui';

import DefaultApl from './apls/default.apl.siml';
import DefaultGear from './gear_sets/default.gear.siml';

// Retribution Aura and Seal of the Crusader before the pull, then Judgement, Swift Judgement, Seal
// of Fury, Consecration, Holy Shock while Consecrated Ground is on the target, Holy Shield, Holy
// Strike and Exorcism.
export const APL_PRESET = PresetUtils.makePresetAPLRotation('Default', DefaultApl);

// Level 60 blues from dungeons, quests, reputations and crafting: a placeholder until Phase 1
// gear is known.
export const GEAR_DEFAULT = PresetUtils.makePresetGear('Default', DefaultGear, {
	tooltip: 'Level 60 blues from dungeons, quests, reputations and crafting. A placeholder until the Phase 1 gear is known.',
});

export const DefaultTalents = PresetUtils.makePresetTalents('Default', SavedTalents.create({ talentsString: '50003-0530313321301531-5022' }));
