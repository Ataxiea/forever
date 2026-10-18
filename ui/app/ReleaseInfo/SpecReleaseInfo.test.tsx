import i18n from '@i18n/config';
import { fireEvent, render, screen } from '@testing-library/react';
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
const specCommit = '8109a4ce0d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6';

describe('SpecReleaseInfo', () => {
	it('lists the sim build, the spec change and the game data on hovering its info button', () => {
		render(<SpecReleaseInfo info={info} specName="Feral Cat" specVersion={{ commit: specCommit, date: '2026-10-17' }} />);
		expect(screen.queryByText('Changed 2026-10-17')).toBeNull();

		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Release details' }));
		expect([...document.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Sim', 'Feral Cat', 'Game data']);
		expect(screen.getByText('Changed 2026-10-17')).toBeTruthy();
		expect(screen.getByRole('link', { name: '8109a4c' }).getAttribute('href')).toBe(`https://github.com/wowsims/forever/commit/${specCommit}`);
	});

	it('leaves the spec out when the build read no change for it', () => {
		render(<SpecReleaseInfo info={info} specName="Feral Cat" />);
		fireEvent.mouseEnter(screen.getByRole('button', { name: 'Release details' }));
		expect([...document.querySelectorAll('dt')].map(dt => dt.textContent)).toEqual(['Sim', 'Game data']);
	});

	it('renders nothing when the build read nothing', () => {
		const { container } = render(<SpecReleaseInfo info={{ date: '', commit: '', gameVersion: '' }} specName="Feral Cat" />);
		expect(container.innerHTML).toBe('');
	});
});
