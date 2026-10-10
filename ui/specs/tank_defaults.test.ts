import { PlayerSpecs } from '@sim/player/specs';
import type { SpecDefinition } from '@sim/spec_config';
import { describe, expect, it } from 'vitest';

const specs = Object.entries(import.meta.glob<SpecDefinition<any>>('./*/*/spec.ts', { eager: true, import: 'default' }));

describe('defaults.siml', () => {
	it.each(specs)('%s stands a tank in front of the target and has it tank, and no other spec', (_file, def) => {
		const tank = PlayerSpecs.fromProto(def.spec).isTankSpec;

		expect(def.defaults.other?.inFrontOfTarget).toBe(tank);
		expect(def.defaults.other?.tanks).toHaveLength(tank ? 1 : 0);
	});
});
