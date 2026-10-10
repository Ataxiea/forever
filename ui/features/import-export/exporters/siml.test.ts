// The SIML exporters print what the host gives them with the committed name table, after loading the module.
import { Player } from '@generated/proto/api';
import { APLRotation } from '@generated/proto/apl';
import { Spec } from '@generated/proto/common';
import { IndividualSimSettings } from '@generated/proto/ui';
import { SimSettingCategories } from '@sim/constants/sim_settings';
import { getEnumValues } from '@sim/utils/collections';
import { fakeHost } from '@testing/sim/fake_host';
import { describe, expect, it, vi } from 'vitest';

import { SIML_EXPORTER, SIML_ROTATION_EXPORTER } from './siml';
import type { ExportCategories } from './types';

const rotation = APLRotation.fromJson({ type: 'TypeAPL', priorityList: [{ action: { castSpell: { spellId: { spellId: 2643 } } } }] });
const settings = IndividualSimSettings.create({ player: Player.create({ talentsString: '-0053', rotation }) });

const toProto = vi.fn((_categories: Array<SimSettingCategories>) => settings);
const host = fakeHost({ player: { getSpec: () => Spec.SpecHunter, getResolvedAplRotation: () => rotation }, toProto });

const ticked = (...categories: Array<SimSettingCategories>) =>
	Object.fromEntries(
		(getEnumValues(SimSettingCategories) as Array<SimSettingCategories>).map(category => [category, categories.includes(category)]),
	) as ExportCategories;

describe('SIML_EXPORTER', () => {
	it('gives a promise of the text, as it loads the module first', async () => {
		const data = SIML_EXPORTER.getData(host, ticked(SimSettingCategories.Rotation));
		expect(data).toBeInstanceOf(Promise);
		expect(await data).toBe('siml 1\nspec hunter\n\npriority:\n  cast multi_shot\n');
		expect(toProto).toHaveBeenLastCalledWith([SimSettingCategories.Rotation]);
	});

	// So that importing the file resets that category, as a JSON import of the same categories does.
	it('writes a ticked category with nothing set as an empty section', async () => {
		const text = await SIML_EXPORTER.getData(host, ticked(SimSettingCategories.Talents, SimSettingCategories.Rotation, SimSettingCategories.Consumes));
		expect(text).toBe('siml 1\nspec hunter\ntalents "-0053"\n\nconsumables:\n\npriority:\n  cast multi_shot\n');
	});

	it('writes every section the settings hold when no category is ticked, as the JSON export does', async () => {
		const text = await SIML_EXPORTER.getData(host, ticked());
		expect(toProto).toHaveBeenLastCalledWith([]);
		expect(text).toBe('siml 1\nspec hunter\ntalents "-0053"\n\npriority:\n  cast multi_shot\n');
	});

	it('downloads as a full setup', () => {
		expect(SIML_EXPORTER.downloadFileName).toBe('wowsims.siml');
	});
});

describe('SIML_ROTATION_EXPORTER', () => {
	it('prints the rotation the sim runs as an x.apl.siml', async () => {
		expect(await SIML_ROTATION_EXPORTER.getData(host, ticked())).toBe('siml 1\nspec hunter\n\npriority:\n  cast multi_shot\n');
		expect(SIML_ROTATION_EXPORTER.downloadFileName).toBe('rotation.apl.siml');
	});
});
