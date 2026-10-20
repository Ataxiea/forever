import * as PresetUtils from '@app/preset_utils';
import { Spec } from '@generated/proto/common';
import { SavedTalents } from '@generated/proto/ui';

import AffWrackBuildJson from './builds/aff_wrack.siml';
import DemoFireBrandBuildJson from './builds/demo_fire_brand.siml';
import DemoShadowBrandBuildJson from './builds/demo_shadow_brand.siml';
import DestroBuildJson from './builds/destro.siml';
import SmRuinBuildJson from './builds/sm_ruin.siml';

// Preset options for this spec.
// Eventually we will import these values for the raid sim too, so its good to
// keep them in a separate file.

export const DEMO_FIRE_BRAND_APL = PresetUtils.makePresetAPLRotation('Demo (Fire Brand)', DemoFireBrandBuildJson.player.rotation);
export const DEMO_SHADOW_BRAND_APL = PresetUtils.makePresetAPLRotation('Demo (Shadow Brand)', DemoShadowBrandBuildJson.player.rotation);
export const DESTRO_APL = PresetUtils.makePresetAPLRotation('Destro', DestroBuildJson.player.rotation);
export const SM_RUIN_APL = PresetUtils.makePresetAPLRotation('SM/Ruin', SmRuinBuildJson.player.rotation);
export const AFF_WRACK_APL = PresetUtils.makePresetAPLRotation('Aff (Wrack)', AffWrackBuildJson.player.rotation);

const talentsOf = (name: string, json: { player: { talentsString: string } }) =>
	PresetUtils.makePresetTalents(name, SavedTalents.create({ talentsString: json.player.talentsString }));

export const DemoFireBrandTalents = talentsOf('Demo (Fire Brand)', DemoFireBrandBuildJson);
export const DemoShadowBrandTalents = talentsOf('Demo (Shadow Brand)', DemoShadowBrandBuildJson);
export const DestroTalents = talentsOf('Destro', DestroBuildJson);
export const SmRuinTalents = talentsOf('SM/Ruin', SmRuinBuildJson);
export const AffWrackTalents = talentsOf('Aff (Wrack)', AffWrackBuildJson);

// Each build file holds the talents, demons, consumables, buffs and rotation of one tree and playstyle.
const build = (name: string, json: unknown) => PresetUtils.makePresetBuildFromJSON(name, Spec.SpecWarlock, json);

export const Builds = [
	build('Demo (Fire Brand)', DemoFireBrandBuildJson),
	build('Demo (Shadow Brand)', DemoShadowBrandBuildJson),
	build('Destro', DestroBuildJson),
	build('SM/Ruin', SmRuinBuildJson),
	build('Aff (Wrack)', AffWrackBuildJson),
];
