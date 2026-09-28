import { PlayerClasses } from '@sim/player/classes/index';
import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LANDING_CLASS_ORDER } from './landing_classes';
import { LANDING_INTRO_MS, LandingPage } from './LandingPage';

const matchMedia = (matches: boolean) => (query: string) => ({
	matches,
	media: query,
	onchange: null,
	addEventListener: () => {},
	removeEventListener: () => {},
	addListener: () => {},
	removeListener: () => {},
	dispatchEvent: () => false,
});

describe('LandingPage', () => {
	beforeEach(() => {
		vi.stubGlobal('matchMedia', matchMedia(true));
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders one card per class', () => {
		const { getAllByTestId } = render(<LandingPage />);
		expect(getAllByTestId('landing-class-card')).toHaveLength(LANDING_CLASS_ORDER.length);
	});

	it('opens the spec modal onto one link per spec', () => {
		const { getAllByTestId, getByTestId } = render(<LandingPage />);
		fireEvent.click(getAllByTestId('landing-class-card')[0]);
		const modal = getByTestId('landing-spec-modal');
		const playerClass = PlayerClasses.fromProto(LANDING_CLASS_ORDER[0]);
		expect(modal.querySelectorAll('[data-testid="landing-spec-link"]')).toHaveLength(Object.values(playerClass.specs).length);
	});

	it('keeps the spec links in the document after the modal closes', () => {
		const { getAllByTestId, getByTestId } = render(<LandingPage />);
		fireEvent.click(getAllByTestId('landing-class-card')[0]);
		fireEvent.click(getByTestId('sim-dialog-close'));
		expect(document.querySelectorAll('[data-testid="landing-spec-link"]').length).toBeGreaterThan(0);
	});

	it('fades out before navigating to the spec page', () => {
		vi.stubGlobal('matchMedia', matchMedia(false));
		vi.useFakeTimers();
		const originalAssign = window.location.assign;
		const assign = vi.fn();
		window.location.assign = assign;
		try {
			const { getAllByTestId, getByTestId } = render(<LandingPage />);
			act(() => {
				vi.advanceTimersByTime(LANDING_INTRO_MS);
			});
			fireEvent.click(getAllByTestId('landing-class-card')[0]);
			fireEvent.click(getByTestId('landing-spec-modal').querySelector('[data-testid="landing-spec-link"]')!);
			expect(getByTestId('landing-root').hasAttribute('data-leaving')).toBe(true);
			expect(assign).not.toHaveBeenCalled();
			act(() => {
				vi.runAllTimers();
			});
			expect(assign).toHaveBeenCalledTimes(1);
		} finally {
			window.location.assign = originalAssign;
			vi.useRealTimers();
		}
	});
});
