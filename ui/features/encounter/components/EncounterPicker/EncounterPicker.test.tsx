import { Encounter } from '@sim/raid/encounter';
import type { Sim } from '@sim/sim';
import { createSimStore } from '@sim/state/sim_store';
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EncounterPickerView, type EncounterPickerViewProps } from './EncounterPicker';
import { executeConfigs } from './utils/configs';

const renderView = (props: Partial<EncounterPickerViewProps> = {}) =>
	render(
		<EncounterPickerView
			duration={<span>duration</span>}
			zone={<span>zone</span>}
			areaTypes={<span>area types</span>}
			targetInputs={<span>target inputs</span>}
			onAdvancedClick={() => {}}
			{...props}
		/>,
	);

describe('EncounterPickerView', () => {
	it('lays out the fields in order, and leaves out the ones not given', () => {
		const { getByTestId } = renderView({ execute: <span>execute</span>, allies: <span>allies</span> });
		const root = getByTestId('encounter-picker-root');
		expect([...root.children].map(child => child.textContent)).toEqual([
			'duration',
			'execute',
			'zone',
			'area types',
			'allies',
			'target inputs',
			'settings_tab.encounter.advanced',
		]);
	});

	it('reports the Advanced press', () => {
		const onAdvancedClick = vi.fn();
		const { getByTestId } = renderView({ onAdvancedClick });
		fireEvent.click(getByTestId('advanced-button'));
		expect(onAdvancedClick).toHaveBeenCalledTimes(1);
	});
});

describe('executeConfigs', () => {
	it('preserves integer percentages without floating-point artifacts', () => {
		const encounter = new Encounter({ store: createSimStore(), db: { getZone: () => null, getNpc: () => null } } as unknown as Sim);
		const configs = executeConfigs(encounter);
		const config90 = configs.find(c => c.id === 'encounter-execute-proportion-90')!;

		config90.setValue(encounter, 15);
		for (const config of configs) {
			const val = config.getValue(encounter);
			expect(Number.isInteger(val)).toBe(true);
			expect(val).toBe(15);
		}
	});
});
