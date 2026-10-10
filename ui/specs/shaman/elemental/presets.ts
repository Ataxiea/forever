import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';

import TestingBuildJson from './builds/testing.siml';

export const ROTATION_PRESET_DEFAULT = PresetUtils.makePresetAPLRotation('Default', TestingBuildJson.player.rotation);

export const TestingGear = PresetUtils.makePresetGear('Testing', TestingBuildJson.player.equipment);

export const TestingBuild = PresetUtils.makePresetBuildFromJSON('Testing', Spec.SpecElementalShaman, TestingBuildJson);

export const StandardTalents = {
	name: 'Standard',
	data: SavedTalents.create({
		talentsString: TestingBuildJson.player.talentsString,
	}),
};
