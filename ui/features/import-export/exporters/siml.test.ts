// The SIML exporters print what the host gives them with the committed name table, after loading the module.
import { Player } from '@generated/proto/api';
import { APLListItem, APLRotation, APLRotation_Type as APLRotationType } from '@generated/proto/apl';
import { Spec } from '@generated/proto/common';
import { IndividualSimSettings } from '@generated/proto/ui';
import { SimSettingCategories } from '@sim/constants/sim_settings';
import { getEnumValues } from '@sim/utils/collections';
import { fakeHost } from '@testing/sim/fake_host';
import { describe, expect, it, vi } from 'vitest';

import { loadSiml } from '../load_siml';
import { SIML_EXPORTER, SIML_ROTATION_EXPORTER } from './siml';
import type { ExportCategories } from './types';

// The key, and what it is filled with, so a test can tell which message was given and about what.
vi.mock('@i18n/config', () => ({ default: { t: (key: string, values?: object) => (values ? `${key} ${JSON.stringify(values)}` : key) } }));

const rotation = APLRotation.fromJson({ type: 'TypeAPL', priorityList: [{ action: { castSpell: { spellId: { spellId: 2643 } } } }] });
// What an Auto or Simple rotation resolves to: the list the sim generates for it, beside the type and the simple settings.
const generated = (type: 'TypeAuto' | 'TypeSimple') =>
	APLRotation.fromJson({
		type,
		simple: { cooldowns: { hpPercentForDefensives: 0.4 } },
		priorityList: rotation.priorityList.map(item => APLListItem.toJson(item)),
	});
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

	// The full setup is exact: the player's own Auto rotation imports back as Auto, not as the list it generates.
	it('keeps the type of an Auto rotation', async () => {
		const auto = IndividualSimSettings.create({ player: Player.create({ rotation: APLRotation.create({ type: APLRotationType.TypeAuto }) }) });
		const text = await SIML_EXPORTER.getData(
			fakeHost({ player: { getSpec: () => Spec.SpecHunter }, toProto: () => auto }),
			ticked(SimSettingCategories.Rotation),
		);
		expect(text).toBe('siml 1\nspec hunter\n\napl: type auto\n');
	});

	it('refuses text that would not import, with its problems', async () => {
		// With no spec line, a file holding a rotation does not read.
		const noSpec = fakeHost({ player: { getSpec: () => Spec.SpecUnknown }, toProto });
		await expect(SIML_EXPORTER.getData(noSpec, ticked(SimSettingCategories.Rotation))).rejects.toThrow(/^export\.siml\.error_unreadable .*spec/);
	});

	it('downloads as a full setup', () => {
		expect(SIML_EXPORTER.downloadFileName).toBe('wowsims.siml');
	});
});

describe('SIML_ROTATION_EXPORTER', () => {
	// Kept as Auto or Simple, the import would have the sim generate the list again, and the edits would be lost.
	it.each(['TypeAuto', 'TypeSimple'] as const)('writes the list a %s rotation generates as an APL rotation, to edit', async type => {
		const resolved = fakeHost({ player: { getSpec: () => Spec.SpecHunter, getResolvedAplRotation: () => generated(type) } });
		const text = await SIML_ROTATION_EXPORTER.getData(resolved, ticked());
		expect(text).toBe('siml 1\nspec hunter\n\npriority:\n  cast multi_shot\n');
		const { siml } = await loadSiml();
		expect(siml.parse(text, { path: 'rotation.apl.siml' }).rotation).toEqual({ type: 'TypeAPL', priorityList: expect.any(Array) });
	});

	it('refuses text that would not import, with its problems', async () => {
		const noSpec = fakeHost({ player: { getSpec: () => Spec.SpecUnknown, getResolvedAplRotation: () => rotation } });
		await expect(SIML_ROTATION_EXPORTER.getData(noSpec, ticked())).rejects.toThrow(/^export\.siml\.error_unreadable .*spec/);
	});

	it('prints the rotation the sim runs as an x.apl.siml', async () => {
		expect(await SIML_ROTATION_EXPORTER.getData(host, ticked())).toBe('siml 1\nspec hunter\n\npriority:\n  cast multi_shot\n');
		expect(SIML_ROTATION_EXPORTER.downloadFileName).toBe('rotation.apl.siml');
	});
});
