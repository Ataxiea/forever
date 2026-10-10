import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { FeralBearDruid_Rotation as DruidRotation, FeralBearDruid_Rotation_SwipeUsage as SwipeUsage } from '@generated/proto/druid';

export const DefaultSimpleRotation = DruidRotation.create({
	maintainFaerieFire: true,
	maintainDemoralizingRoar: true,
	maulRageThreshold: 50,
	swipeUsage: SwipeUsage.SwipeUsage_WithEnoughAP,
	swipeApThreshold: 2700,
});

import DefaultApl from './apls/default.apl.siml';
export const ROTATION_SIMPLE = PresetUtils.makePresetSimpleRotation('Simple', Spec.SpecFeralBearDruid, DefaultSimpleRotation);
export const ROTATION_DEFAULT = PresetUtils.makePresetAPLRotation('APL', DefaultApl);
