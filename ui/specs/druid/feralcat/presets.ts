import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { FeralCatDruid_Rotation as FeralCatDruidRotation, FeralCatDruid_Rotation_FinishingMove as FinishingMove } from '@generated/proto/druid';

import DefaultApl from './apls/default.apl.siml';

export const DefaultRotation = FeralCatDruidRotation.create({
	finishingMove: FinishingMove.Rip,
	biteweave: true,
	ripMinComboPoints: 5,
	biteMinComboPoints: 5,
	mangleTrick: true,
	maintainFaerieFire: true,
});

export const SIMPLE = PresetUtils.makePresetSimpleRotation('Simple', Spec.SpecFeralCatDruid, DefaultRotation);

export const APL = PresetUtils.makePresetAPLRotation('APL', DefaultApl);
