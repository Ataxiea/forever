import i18n from '@i18n/config';
import { translatePlayerSpec } from '@i18n/localization';
import { PlayerSpecs } from '@sim/player/specs/index';
import { RELEASE, withRelease } from '@testing/build_info';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import english from '../../../assets/locales/en/translation.json';
import { SpecReleaseInfo } from './SpecReleaseInfo';

beforeAll(() => {
	i18n.addResourceBundle('en', 'translation', english, true, true);
});
afterAll(() => {
	i18n.removeResourceBundle('en', 'translation');
});

let restore = () => {};
afterEach(() => restore());

const details = () => {
	fireEvent.click(screen.getByRole('button', { name: 'Release details' }));
	return {
		labels: [...document.querySelectorAll('dt')].map(dt => dt.textContent),
		values: [...document.querySelectorAll('dd')].map(dd => dd.textContent),
	};
};

describe('SpecReleaseInfo', () => {
	it("names the game build of the spec's own spell data", () => {
		restore = withRelease(RELEASE);
		render(<SpecReleaseInfo spec={PlayerSpecs.FeralCatDruid} />);
		expect(screen.getByRole('paragraph').textContent).toBe('Game 1.60.1.70425 · Built 2026-10-18 · 2fe052c');
	});

	it('lists the sim build and the last preset and engine changes on clicking its info button', () => {
		restore = withRelease(RELEASE);
		render(<SpecReleaseInfo spec={PlayerSpecs.FeralCatDruid} />);
		expect(document.querySelector('dd')).toBeNull();

		const { labels, values } = details();
		const spec = translatePlayerSpec(PlayerSpecs.FeralCatDruid);
		expect(labels).toEqual(['Sim build', `${spec} presets`, `${spec} engine`]);
		expect(values).toEqual(['Built 2026-10-18 · 2fe052c', 'Changed 2026-10-17 · 8109a4c', 'Changed 2026-10-16 · 474c498']);
		const engine = RELEASE.specs['druid/feralcat'].engine!.commit;
		expect(screen.getByRole('link', { name: '474c498' }).getAttribute('href')).toBe(`https://github.com/wowsims/forever/commit/${engine}`);
	});

	it('lists only the sim build when the build read no change for the spec', () => {
		restore = withRelease(RELEASE);
		render(<SpecReleaseInfo spec={PlayerSpecs.DpsWarrior} />);
		expect(details().labels).toEqual(['Sim build']);
	});

	it('renders nothing when the build read nothing', () => {
		const { container } = render(<SpecReleaseInfo spec={PlayerSpecs.FeralCatDruid} />);
		expect(container.innerHTML).toBe('');
	});
});
