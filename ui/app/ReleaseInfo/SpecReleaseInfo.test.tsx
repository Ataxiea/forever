import i18n from '@i18n/config';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import english from '../../../assets/locales/en/translation.json';
import { SpecReleaseInfo } from './SpecReleaseInfo';

beforeAll(() => {
	i18n.addResourceBundle('en', 'translation', english, true, true);
});
afterAll(() => {
	i18n.removeResourceBundle('en', 'translation');
});

const info = { date: '2026-10-18', commit: '2fe052cd96a4b1f0e2d3c4b5a697887766554433', gameVersion: '1.60.1.70450' };

describe('SpecReleaseInfo', () => {
	it('shows the release line under the stats', () => {
		render(<SpecReleaseInfo info={info} specName="Feral Cat" specVersion={{ commit: '8109a4ce0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6', date: '2026-10-17' }} />);
		expect(screen.getByRole('paragraph').textContent).toBe('Game 1.60.1.70450 · Built 2026-10-18 · 2fe052c');
	});

	it('renders nothing when the build read nothing', () => {
		const { container } = render(<SpecReleaseInfo info={{ date: '', commit: '', gameVersion: '' }} specName="Feral Cat" />);
		expect(container.innerHTML).toBe('');
	});
});
