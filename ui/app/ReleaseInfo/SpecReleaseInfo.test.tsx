import i18n from '@i18n/config';
import { translateClass } from '@i18n/localization';
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
const spellData = [
	{ part: 'druid', version: { build: '1.60.1.70450', hotfix: 112887 } },
	{ part: 'racials', version: { build: '1.60.1.70425', hotfix: 112801 } },
	{ part: 'items', version: { build: '1.60.1.70450', hotfix: 112887 } },
	{ part: 'shared', version: { build: '1.60.1.70450', hotfix: 112887 } },
];

const details = () => {
	fireEvent.mouseEnter(screen.getByRole('button', { name: 'Release details' }));
	return {
		labels: [...document.querySelectorAll('dt')].map(dt => dt.textContent),
		values: [...document.querySelectorAll('dd')].map(dd => dd.textContent),
	};
};

describe('SpecReleaseInfo', () => {
	it('lists the sim build, the preset change and each spell data stamp on hovering its info button', () => {
		render(<SpecReleaseInfo info={info} specName="Feral Cat" specVersion={{ commit: specCommit, date: '2026-10-17' }} spellData={spellData} />);
		expect(document.querySelector('dd')).toBeNull();

		const { labels, values } = details();
		expect(labels).toEqual(['Sim', 'Feral Cat presets', `${translateClass('druid')} spell data`, 'Racial spell data', 'Item data', 'Shared spell data']);
		expect(values).toEqual([
			'Built 2026-10-18 · 2fe052c',
			'Changed 2026-10-17 · 8109a4c',
			'1.60.1.70450, hotfix 112887',
			'1.60.1.70425, hotfix 112801',
			'1.60.1.70450, hotfix 112887',
			'1.60.1.70450, hotfix 112887',
		]);
		expect(screen.getByRole('link', { name: '8109a4c' }).getAttribute('href')).toBe(`https://github.com/wowsims/forever/commit/${specCommit}`);
	});

	it('leaves the presets out when the build read no change for them', () => {
		render(<SpecReleaseInfo info={info} specName="Feral Cat" spellData={spellData.slice(0, 1)} />);
		expect(details().labels).toEqual(['Sim', `${translateClass('druid')} spell data`]);
	});

	it('renders nothing when the build read nothing', () => {
		const { container } = render(<SpecReleaseInfo info={{ date: '', commit: '', gameVersion: '' }} specName="Feral Cat" spellData={[]} />);
		expect(container.innerHTML).toBe('');
	});
});
