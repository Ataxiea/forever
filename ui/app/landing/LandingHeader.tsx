import i18n from '@i18n/config';
import { REPO_URL } from '@sim/constants/other';
import { Icon } from '@ui-kit/Icon';
import clsx from 'clsx';
import { useState } from 'react';

import { LandingLanguageMenu } from './LandingLanguageMenu';

const COLLAPSE_ID = 'homepageHeaderCollapse';

export const LandingHeader = () => {
	const [open, setOpen] = useState(false);
	const toggleLabel = i18n.t('landing.navigation.toggle');

	const toggler = (icon: 'bars' | 'times') => (
		<button
			className="ui-landing-header-fg border-0 px-3 py-1 text-lg leading-none md:hidden"
			type="button"
			aria-controls={COLLAPSE_ID}
			aria-expanded={open}
			aria-label={toggleLabel}
			data-testid="navbar-toggler"
			onClick={() => setOpen(current => !current)}>
			<Icon name={icon} size="2x" />
		</button>
	);

	return (
		<header>
			<div className="ui-landing-bar">
				<img className="ui-landing-version" src="/forever/assets/img/forever-emblem.png" alt={i18n.t('landing.header.expansion')} />
				<nav className="relative flex items-center justify-end">
					{toggler('bars')}
					<div
						id={COLLAPSE_ID}
						className={clsx(
							'ui-landing-menu items-center justify-end max-md:fixed max-md:inset-0 max-md:z-dropdown max-md:p-4 md:flex',
							!open && 'max-md:hidden',
						)}>
						<div className="ui-landing-links flex flex-col max-md:relative max-md:items-start md:flex-row md:items-center" data-testid="navbar-nav">
							{toggler('times')}
							<a
								href="https://discord.gg/p3DgvmnDCS"
								target="_blank"
								rel="noreferrer"
								className="ui-landing-nav-link flex items-center px-0 py-4 text-sm whitespace-nowrap max-md:pt-2 md:px-2">
								<p className="m-0">
									<Icon name="discord" style="brands" size="2x" />
									&nbsp;
								</p>
							</a>
							<a
								href={REPO_URL}
								target="_blank"
								rel="noreferrer"
								className="ui-landing-nav-link flex items-center px-0 py-4 text-sm whitespace-nowrap md:px-2">
								<p className="m-0">
									<Icon name="github" style="brands" size="2x" />
									&nbsp;
								</p>
							</a>
							<a
								href="https://patreon.com/wowsims"
								target="_blank"
								rel="noreferrer"
								className="ui-landing-nav-link flex items-center px-0 py-4 text-sm whitespace-nowrap md:px-2">
								<Icon name="patreon" style="brands" size="2x" className="mr-2" />
								<span className="text-fluid-xl md:hidden lg:block">{i18n.t('landing.header.supportDevs')}</span>
							</a>
							<LandingLanguageMenu />
						</div>
					</div>
				</nav>
			</div>
		</header>
	);
};
