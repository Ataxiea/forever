// The SIML importer reads real text with the committed name table, and loads into a host that records what it
// is given: which categories, and the settings they come from.
import { Spec } from '@generated/proto/common';
import type { IndividualSimSettings } from '@generated/proto/ui';
import { SimSettingCategories } from '@sim/constants/sim_settings';
import { fakeHost } from '@testing/sim/fake_host';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIML_IMPORTER, SIML_ROTATION_IMPORTER } from './siml';
import { ImportProblems } from './types';

const loadLeftovers = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@sim/proto/database', () => ({ Database: { loadLeftoversIfNecessary: loadLeftovers } }));

// The key, and what it is filled with, so a test can tell which message was given and about what.
vi.mock('@i18n/config', () => ({ default: { t: (key: string, values?: object) => (values ? `${key} ${JSON.stringify(values)}` : key) } }));

const toasts = vi.hoisted(() => [] as Array<{ variant: string; body: unknown }>);
vi.mock('@ui-kit/Toast', async importOriginal => ({
	...(await importOriginal<typeof import('@ui-kit/Toast')>()),
	toastManager: {
		add: (options: { variant: string; body: unknown }) => {
			toasts.push(options);
			return '';
		},
		close: () => {},
	},
}));

const fromProto = vi.fn<(settings: IndividualSimSettings, categories: Array<SimSettingCategories>) => void>();
const hostFor = (spec: Spec) => fakeHost({ player: { getSpec: () => spec }, fromProto });
const hunter = hostFor(Spec.SpecHunter);

const loaded = () => {
	expect(fromProto).toHaveBeenCalledTimes(1);
	const [settings, categories] = fromProto.mock.calls[0];
	return { settings, categories: [...categories].sort() };
};

const problems = async (promise: Promise<void>) => {
	const error = await promise.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(ImportProblems);
	return (error as ImportProblems).problems;
};

const ROTATION = `siml 1
spec hunter

priority:
  cast multi_shot
`;

beforeEach(() => {
	toasts.length = 0;
	fromProto.mockClear();
	loadLeftovers.mockClear();
});

describe('a rotation', () => {
	it('loads the rotation alone, so the gear and the talents stay as they are', async () => {
		await SIML_ROTATION_IMPORTER.onImport(hunter, ROTATION);
		const { settings, categories } = loaded();
		expect(categories).toEqual([SimSettingCategories.Rotation]);
		expect(settings.player?.rotation?.priorityList).toHaveLength(1);
		expect(settings.player?.equipment).toBeUndefined();
		expect(loadLeftovers).not.toHaveBeenCalled();
	});

	it('reads as an x.apl.siml whatever the uploaded file is named', async () => {
		await SIML_ROTATION_IMPORTER.onImport(hunter, ROTATION, 'wowsims.siml');
		expect(loaded().categories).toEqual([SimSettingCategories.Rotation]);
	});

	it('refuses a type the player would load as Auto', async () => {
		const unknown = 'siml 1\nspec hunter\n\ntype unknown\n\npriority:\n  cast multi_shot\n';
		await expect(SIML_ROTATION_IMPORTER.onImport(hunter, unknown)).rejects.toThrow('import.siml.error_unknown_type');
		expect(fromProto).not.toHaveBeenCalled();
	});
});

describe('pasted text', () => {
	it('reads as a full setup, and an empty section resets its category', async () => {
		await SIML_IMPORTER.onImport(hunter, `siml 1\nspec hunter\ntalents "-0053"\n\nconsumables:\n\npriority:\n  cast multi_shot\n`);
		const { settings, categories } = loaded();
		expect(categories).toEqual([SimSettingCategories.Talents, SimSettingCategories.Rotation, SimSettingCategories.Consumes]);
		expect(settings.player?.talentsString).toBe('-0053');
		expect(settings.player?.consumables).toEqual(expect.objectContaining({ potId: 0, foodId: 0 }));
	});

	it('refuses text that holds no category, which would load every one', async () => {
		await expect(SIML_IMPORTER.onImport(hunter, 'siml 1\nspec hunter\n')).rejects.toThrow('import.siml.error_empty');
		expect(fromProto).not.toHaveBeenCalled();
	});
});

describe('an uploaded file', () => {
	it('reads as the kind its name gives, and loads the leftover items its gear needs', async () => {
		await SIML_IMPORTER.onImport(hunter, 'siml 1\n\nhead lieutenant_commanders_chain_helmet + falcons_call\n', 'p1.gear.siml');
		const { settings, categories } = loaded();
		expect(categories).toEqual([SimSettingCategories.Gear]);
		expect(settings.player?.equipment?.items).toHaveLength(17);
		expect(loadLeftovers).toHaveBeenCalledTimes(1);
		expect(loadLeftovers.mock.calls[0][0].items[0].id).toBe(settings.player!.equipment!.items[0].id);
	});
});

describe('a file a browser renamed on download', () => {
	it.each(['p1.gear (1).siml', 'p1.gear(1).siml', 'P1.GEAR.siml', 'P1.Gear (12).siml'])('reads %s as a gear file', async name => {
		await SIML_IMPORTER.onImport(hunter, 'siml 1\n\nhead lieutenant_commanders_chain_helmet\n', name);
		expect(loaded().categories).toEqual([SimSettingCategories.Gear]);
	});

	it.each(['rotation.apl (1).siml', 'rotation.apl(1).siml', 'Rotation.APL.siml'])('reads %s as a rotation', async name => {
		await SIML_IMPORTER.onImport(hunter, ROTATION, name);
		expect(loaded().categories).toEqual([SimSettingCategories.Rotation]);
	});
});

describe('a gear planner', () => {
	const ENCOUNTER = 'siml 1\n\nencounter:\n  duration 180\n';
	const planner = fakeHost({ player: { getSpec: () => Spec.SpecHolyPaladin }, simDisabled: true, fromProto });

	it('refuses a file holding only the encounter, which it does not import', async () => {
		await expect(SIML_IMPORTER.onImport(planner, ENCOUNTER, 'raid.encounter.siml')).rejects.toThrow('import.siml.error_nothing_here');
		expect(fromProto).not.toHaveBeenCalled();
	});

	it('imports a file holding the encounter and more', async () => {
		await SIML_IMPORTER.onImport(planner, `siml 1\nspec holy_paladin\ntalents "-0053"\n\nencounter:\n  duration 180\n`);
		expect(loaded().categories).toEqual([SimSettingCategories.Talents, SimSettingCategories.Encounter].sort());
	});

	it('leaves a page that sims to import the encounter', async () => {
		await SIML_IMPORTER.onImport(hunter, ENCOUNTER, 'raid.encounter.siml');
		expect(loaded().categories).toEqual([SimSettingCategories.Encounter]);
	});
});

describe('what the importer refuses or warns of', () => {
	it('shows an unknown name at its line and column, with the did-you-mean', async () => {
		expect(await problems(SIML_IMPORTER.onImport(hunter, 'siml 1\nspec hunter\n\npriority:\n  cast hunters_mrak\n'))).toEqual([
			'5:8 no spell is named hunters_mrak; did you mean hunters_mark?',
		]);
		expect(fromProto).not.toHaveBeenCalled();
	});

	it('refuses `use`, as the site reads no other files', async () => {
		const [problem] = await problems(SIML_IMPORTER.onImport(hunter, 'siml 1\nspec hunter\n\nuse "default.apl.siml"\n'));
		expect(problem).toMatch(/^4:5 this host reads no other files/);
		expect(fromProto).not.toHaveBeenCalled();
	});

	it("warns that the text is for another spec than the page's, and imports it", async () => {
		await SIML_IMPORTER.onImport(hostFor(Spec.SpecDpsWarrior), ROTATION);
		expect(toasts).toEqual([{ variant: 'warning', body: 'import.siml.warning_spec {"file":"hunter","page":"dps_warrior"}', delay: 8000 }]);
		expect(loaded().categories).toEqual([SimSettingCategories.Rotation]);
	});

	it('lists the warnings in a toast, and imports', async () => {
		await SIML_ROTATION_IMPORTER.onImport(hunter, `${ROTATION}  group "Nowhere"\n`);
		expect(toasts).toHaveLength(1);
		expect(toasts[0].variant).toBe('warning');
		expect(loaded().settings.player?.rotation?.priorityList).toHaveLength(2);
	});
});
