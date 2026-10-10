// tools/vite/siml.mts: a .siml import is the JSON of the message its file kind loads into, and a file that does not
// read fails the import at its file, line and column.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSiml, type JsonObject } from '@sim/siml';
import { committedNames } from '@sim/siml/test_names';
import { testSchema } from '@sim/siml/test_schema';
import { describe, expect, it } from 'vitest';

// A module of tools/, which TypeScript finds by its extension only.
// oxlint-disable-next-line import/extensions
import { simlPlugin } from '../../../tools/vite/siml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SPECS = path.join(ROOT, 'ui/specs');
const TESTDATA = path.join(ROOT, 'ui/features/import-export/testdata');

const siml = createSiml(testSchema, committedNames);

// The plugin's transform, called as Vite calls it, with what it watches and warns of written down.
const transform = (text: string, id: string) => {
	const watched: string[] = [];
	const warnings: string[] = [];
	const context = {
		addWatchFile: (file: string) => watched.push(file),
		warn: (message: string) => warnings.push(message),
		error: (error: string | { message: string }) => {
			throw new Error(typeof error === 'string' ? error : error.message);
		},
	};
	const hook = simlPlugin().transform as unknown as (this: typeof context, code: string, id: string) => { code: string; moduleType: string } | null;
	const result = hook.call(context, text, id);
	const exported = result ? /^export default (.*);\n$/s.exec(result.code)?.[1] : undefined;
	return { json: exported === undefined ? undefined : (JSON.parse(exported) as JsonObject), result, watched, warnings };
};

const HUNTERS_MARK = { spellId: 14325, rank: 4 };
const ROTATION = {
	type: 'TypeAPL',
	prepullActions: [{ action: { castSpell: { spellId: HUNTERS_MARK } }, doAtValue: { const: { val: '-22s' } } }],
	priorityList: [
		{
			action: {
				condition: { not: { val: { auraIsActive: { sourceUnit: { type: 'CurrentTarget' }, auraId: { spellId: 14325 } } } } },
				castSpell: { spellId: HUNTERS_MARK },
			},
		},
		{ action: { condition: { variableRef: { name: 'Use Summon Hawk' } }, castSpell: { spellId: { spellId: 1293527, rank: 4 } } } },
		{ action: { castSpell: { spellId: { spellId: 2643 } } } },
	],
	valueVariables: [{ name: 'Use Summon Hawk', value: { const: { val: 'false' } } }],
};

describe('a .siml import', () => {
	it('is the APLRotation JSON of an x.apl.siml', async () => {
		expect((await import('./testdata/rotation.apl.siml')).default).toEqual(ROTATION);
	});

	it('reads the files a `use` line names, with the values its `with` gives', async () => {
		expect((await import('./testdata/hawks.apl.siml')).default).toEqual({
			...ROTATION,
			valueVariables: [{ name: 'Use Summon Hawk', value: { const: { val: 'true' } } }],
		});
	});

	it('fails at the file, line and column of what does not read, with the did-you-mean', async () => {
		await expect(import('./testdata/broken.apl.siml')).rejects.toThrow(
			'ui/features/import-export/testdata/broken.apl.siml:5:8: error unknown-name: no spell is named hunters_mrak; did you mean hunters_mark?',
		);
	});
});

describe('the transform', () => {
	it('gives JavaScript, and watches the schema, the name table and every used file', () => {
		const file = path.join(TESTDATA, 'hawks.apl.siml');
		const { result, watched } = transform(readFileSync(file, 'utf8'), file);
		expect(result?.moduleType).toBe('js');
		expect(watched).toEqual(
			expect.arrayContaining([
				path.join(ROOT, 'ui/generated/siml/schema.json'),
				path.join(ROOT, 'sim/siml/names.json'),
				path.join(TESTDATA, 'rotation.apl.siml'),
			]),
		);
	});

	it('leaves an id with a query to the plugin that owns it', () => {
		expect(transform('export default "siml 1"', path.join(TESTDATA, 'rotation.apl.siml?raw')).result).toBeNull();
	});

	const undefinedGroup = 'siml 1\nspec hunter\n\npriority:\n  group "Nowhere"\n';
	const rawRef = 'siml 1\nspec hunter\n\npriority:\n  cast `{"spellId":2643}`\n';

	it('passes a warning outside ui/specs on to Vite', () => {
		const { json, warnings } = transform(undefinedGroup, path.join(TESTDATA, 'nowhere.apl.siml'));
		expect(json).toEqual({ type: 'TypeAPL', priorityList: [{ action: { groupReference: { groupName: 'Nowhere' } } }] });
		expect(warnings).toEqual([expect.stringMatching(/^ui\/features\/import-export\/testdata\/nowhere\.apl\.siml:5:9: undefined-group: /)]);
	});

	it('fails a warning under ui/specs, where warnings are errors', () => {
		expect(() => transform(undefinedGroup, path.join(SPECS, 'hunter/dps/apls/nowhere.apl.siml'))).toThrow(
			/^ui\/specs\/hunter\/dps\/apls\/nowhere\.apl\.siml:5:9: warning undefined-group: /,
		);
	});

	it('fails a raw ref under ui/specs, which writes names only, and reads it anywhere else', () => {
		expect(() => transform(rawRef, path.join(SPECS, 'hunter/dps/apls/raw.apl.siml'))).toThrow(
			/^ui\/specs\/hunter\/dps\/apls\/raw\.apl\.siml:5:8: error raw-ref: /,
		);
		expect(transform(rawRef, path.join(TESTDATA, 'raw.apl.siml')).json).toEqual({
			type: 'TypeAPL',
			priorityList: [{ action: { castSpell: { spellId: { spellId: 2643 } } } }],
		});
	});
});

// A committed rotation, gear set and build, each with what it uses, imports as its parse gives it.
describe('the presets under ui/specs', () => {
	for (const file of ['hunter/dps/apls/default_hawks.apl.siml', 'hunter/dps/gear_sets/p1.gear.siml', 'hunter/dps/builds/mm.siml']) {
		it(`imports ${file} as its parse gives it`, () => {
			const at = path.join(SPECS, file);
			const text = readFileSync(at, 'utf8');
			const parsed = siml.parse(text, { path: at, open: used => (existsSync(used) ? readFileSync(used, 'utf8') : undefined) });
			const loaded = parsed.kind.section === 'apl' ? parsed.rotation : parsed.kind.section === 'gear' ? parsed.equipment : parsed.settings;
			expect(parsed.diagnostics).toEqual([]);
			expect(transform(text, at).json).toEqual(loaded);
		});
	}
});
