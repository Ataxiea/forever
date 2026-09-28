import i18n from '@i18n/config';
import { REPO_URL } from '@sim/constants/other';
import { Icon } from '@ui-kit/Icon';
import clsx from 'clsx';
import { useState } from 'react';

import { LandingLanguageMenu } from './LandingLanguageMenu';

const COLLAPSE_ID = 'homepageHeaderCollapse';
const NAV_LINK_CLASS = 'ui-landing-nav-link flex items-center px-0 py-4 text-sm whitespace-nowrap max-md:w-full md:px-2';

export const LandingHeader = () => {
	const [open, setOpen] = useState(false);
	const toggleLabel = i18n.t('landing.navigation.toggle');

	const toggler = (icon: 'bars' | 'times') => (
		<button
			className="ui-landing-menu-toggle ui-landing-header-fg border-0 md:hidden"
			type="button"
			aria-controls={COLLAPSE_ID}
			aria-expanded={open}
			aria-label={toggleLabel}
			data-testid="navbar-toggler"
			onClick={() => setOpen(current => !current)}>
			<Icon name={icon} size="lg" />
		</button>
	);

	return (
		<header>
			<div className="ui-landing-bar">
				<img className="ui-landing-version" src="/forever/assets/img/forever-emblem.png" alt={i18n.t('landing.header.expansion')} />
				<nav className="relative flex items-center justify-end">
					{!open && toggler('bars')}
					<div
						id={COLLAPSE_ID}
						className={clsx(
							'ui-landing-menu max-md:fixed max-md:inset-0 max-md:z-dropdown md:flex md:items-center md:justify-end',
							!open && 'max-md:hidden',
						)}
						onClick={() => setOpen(false)}>
						<div className="ui-landing-menu-sheet" onClick={event => event.stopPropagation()}>
							<div className="ui-landing-menu-bar">{toggler('times')}</div>
							<div className="ui-landing-links flex flex-col md:flex-row md:items-center" data-testid="navbar-nav">
								<a
									href="https://discord.gg/p3DgvmnDCS"
									target="_blank"
									rel="noreferrer"
									className={NAV_LINK_CLASS}>
									<Icon name="discord" style="brands" size="2x" />
									<span className="ui-landing-menu-label">{i18n.t('landing.header.discord')}</span>
								</a>
								<a
									href={REPO_URL}
									target="_blank"
									rel="noreferrer"
									className={NAV_LINK_CLASS}>
									<Icon name="github" style="brands" size="2x" />
									<span className="ui-landing-menu-label">{i18n.t('landing.header.github')}</span>
								</a>
								<a
									href="https://patreon.com/wowsims"
									target="_blank"
									rel="noreferrer"
									className={NAV_LINK_CLASS}>
									<Icon name="patreon" style="brands" size="2x" className="mr-2 max-md:mr-0" />
									<span className="ui-landing-menu-label lg:inline lg:text-fluid-xl">{i18n.t('landing.header.supportDevs')}</span>
								</a>
								<LandingLanguageMenu />
							</div>
						</div>
					</div>
				</nav>
			</div>
		</header>
	);
};
