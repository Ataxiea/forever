import i18n from '@i18n/config';
import { render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import english from '../../../assets/locales/en/translation.json';
import { ReleaseInfo } from './ReleaseInfo';

beforeAll(() => {
	i18n.addResourceBundle('en', 'translation', english, true, true);
});
afterAll(() => {
	i18n.removeResourceBundle('en', 'translation');
});

const commit = '2fe052cd96a4b1f0e2d3c4b5a697887766554433';

describe('ReleaseInfo', () => {
	it('shows the game build, the build date and the short commit, linked to GitHub', () => {
		render(<ReleaseInfo info={{ date: '2026-10-18', commit, gameVersion: '1.60.1.70450' }} />);
		expect(screen.getByRole('paragraph').textContent).toBe('Game 1.60.1.70450 · Built 2026-10-18 · 2fe052c');
		const link = screen.getByRole('link', { name: '2fe052c' });
		expect(link.getAttribute('href')).toBe(`https://github.com/wowsims/forever/commit/${commit}`);
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
	});

	it('leaves out what the build could not read', () => {
		render(<ReleaseInfo info={{ date: '2026-10-18', commit: '', gameVersion: '' }} />);
		expect(screen.getByRole('paragraph').textContent).toBe('Built 2026-10-18');
		expect(screen.queryByRole('link')).toBeNull();
	});

	it('renders nothing when the build read nothing', () => {
		const { container } = render(<ReleaseInfo info={{ date: '', commit: '', gameVersion: '' }} />);
		expect(container.innerHTML).toBe('');
	});
});
