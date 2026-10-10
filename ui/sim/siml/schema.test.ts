import { describe, expect, it } from 'vitest';

import { indexSchema } from './schema.ts';
import { testSchema } from './test_schema.ts';

describe('indexSchema', () => {
	const index = indexSchema(testSchema);

	it('builds one index per schema', () => {
		expect(indexSchema(testSchema)).toBe(index);
		expect(index.schema).toBe(testSchema);
	});

	it('finds sections, kinds and specs by name', () => {
		expect(index.sections.get('gear')?.body).toEqual(['slot_rows', 'entries']);
		expect([...index.sections.keys()].at(-1)).toBe('group');
		expect(index.actionKinds.get('cast_spell')?.form).toBe('short');
		expect(index.valueKinds.get('aura_is_active')?.accessor?.prop).toBe('is_active');
		expect(index.actionKinds.get('aura_is_active')).toBeUndefined();
		expect(index.specs.get('hunter')?.rotation).toBe('proto.Hunter.Rotation');
	});

	it('holds the heads and the slot words', () => {
		expect(index.heads.has('boss_spell')).toBe(true);
		expect(index.slots.size).toBe(17);
		expect(['head', 'finger1', 'main_hand', 'off_hand', 'ranged'].every(s => index.slots.has(s))).toBe(true);
	});

	it('finds a field by the name a file writes or by an alias', () => {
		expect(index.field('proto.ConsumesSpec', 'pot')?.json).toBe('potId');
		expect(index.field('proto.ConsumesSpec', 'pot_id')?.json).toBe('potId');
		expect(index.field('proto.ConsumesSpec', 'elixir')?.repeated).toBe(true);
		expect(index.field('proto.ConsumesSpec', 'potId')).toBeUndefined();
		expect(index.field('proto.Nothing', 'pot')).toBeUndefined();
	});

	it('finds an enum value by its short name or its proto name', () => {
		expect(index.enumValue('proto.TristateEffect', 'improved')?.number).toBe(2);
		expect(index.enumValue('proto.TristateEffect', 'TristateEffectRegular')?.short).toBe('regular');
		expect(index.enumValue('proto.TristateEffect', 'Improved')).toBeUndefined();
		expect(index.enumValue('proto.ItemSlot', 'main_hand')?.name).toBe('ItemSlotMainHand');
	});
});
