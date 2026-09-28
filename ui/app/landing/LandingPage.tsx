import { Class } from '@generated/proto/common';
import i18n from '@i18n/config';
import { translatePlayerClass, translateStatus } from '@i18n/localization';
import { PlayerClasses } from '@sim/player/classes/index';
import type { PlayerClass } from '@sim/player/player_class';
import type { PlayerSpec } from '@sim/player/player_spec';
import { useCallback, useEffect, useState } from 'react';

import { classLaunchStatus, LANDING_CLASS_ORDER } from './landing_classes';
import { LandingHeader } from './LandingHeader';
import { LandingSpecModal } from './LandingSpecModal';

const LEAVE_MS = 1000;
const REVEAL_AT_MS = 1600;
export const LANDING_INTRO_MS = 3400;

const prefersReducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const LandingPage = () => {
	const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null);
	const [introPhase, setIntroPhase] = useState<'mark' | 'enter' | 'done'>(prefersReducedMotion() ? 'done' : 'mark');
	const [introRun, setIntroRun] = useState(0);
	const [activeClass, setActiveClass] = useState<PlayerClass<Class> | null>(null);
	const [modalOpen, setModalOpen] = useState(false);
	const [leaving, setLeaving] = useState<string | null>(null);

	useEffect(() => {
		if (prefersReducedMotion()) return;
		const revealId = window.setTimeout(() => setIntroPhase('enter'), REVEAL_AT_MS);
		const doneId = window.setTimeout(() => setIntroPhase('done'), LANDING_INTRO_MS);
		return () => {
			window.clearTimeout(revealId);
			window.clearTimeout(doneId);
		};
	}, [introRun]);

	useEffect(() => {
		const onPageShow = (event: PageTransitionEvent) => {
			if (!event.persisted) return;
			setLeaving(null);
			setModalOpen(false);
			if (prefersReducedMotion()) {
				setIntroPhase('done');
				return;
			}
			setIntroPhase('mark');
			setIntroRun(run => run + 1);
		};
		window.addEventListener('pageshow', onPageShow);
		return () => window.removeEventListener('pageshow', onPageShow);
	}, []);

	const openSpecs = useCallback((playerClass: PlayerClass<Class>) => {
		// The value is a class constructor. Passing it straight to setState makes React call it as an updater.
		setActiveClass(() => playerClass);
		setModalOpen(true);
	}, []);

	const navigate = useCallback(
		(href: string) => {
			if (leaving !== null) return;
			if (prefersReducedMotion()) {
				window.location.assign(href);
				return;
			}
			setLeaving(href);
			window.setTimeout(() => window.location.assign(href), LEAVE_MS);
		},
		[leaving],
	);

	return (
		<div ref={setPortalHost} className="ui-landing" data-leaving={leaving !== null ? '' : undefined} data-testid="landing-root">
			{introPhase !== 'mark' && (
				<div className="ui-landing-scene">
					<div className="ui-landing-atmosphere" aria-hidden="true">
						<div className="ui-landing-side-mist">
							<span />
							<span />
							<span />
						</div>
						<div className="ui-landing-starlight">
							<span />
							<span />
							<span />
							<span />
						</div>
					</div>
					<LandingHeader />
					<main className="ui-landing-main">
						<section className="ui-landing-hero">
							<div className="ui-landing-hero-copy ui-landing-stage" data-stage="brand">
								<p className="ui-landing-eyebrow">{i18n.t('landing.home.hero.eyebrow')}</p>
								<img className="ui-landing-logo" src="/forever/assets/img/WoW-Simulator-Icon.png" alt="" />
								<h1 className="ui-landing-wordmark">{i18n.t('landing.header.wowsims')}</h1>
								<p className="ui-landing-description">{i18n.t('landing.home.welcomeDescription')}</p>
							</div>
						</section>
						<section className="ui-landing-classes ui-landing-stage" data-stage="classes" aria-label={i18n.t('landing.home.hero.chooseClass')}>
							<h2 className="ui-landing-section-title">{i18n.t('landing.home.hero.chooseClass')}</h2>
							<div className="ui-landing-class-grid" id="sim-links">
								{LANDING_CLASS_ORDER.map(classId => {
									const playerClass = PlayerClasses.fromProto(classId);
									const specs = Object.values(playerClass.specs) as Array<PlayerSpec<any>>;
									// Priest's class-level icon is a spell icon, not the generic crest every
									// other class returns, so the landing page uses the crest here.
									const iconPath =
										playerClass.classID === Class.ClassPriest
											? 'https://wow.zamimg.com/images/wow/icons/large/class_priest.jpg'
											: playerClass.getIcon('large');
									return (
										<button
											key={classId}
											type="button"
											className="ui-landing-class-card"
											data-testid="landing-class-card"
											style={{ ['--landing-accent' as string]: playerClass.hexColor }}
											onClick={() => openSpecs(playerClass)}>
											<img src={iconPath} className="ui-landing-class-icon" alt="" />
											<span className="ui-landing-class-name">{translatePlayerClass(playerClass)}</span>
											<span className="ui-landing-class-meta">
												{specs.length === 1 ? translateStatus(specs[0].launch.status) : translateStatus(classLaunchStatus(playerClass))}
											</span>
										</button>
									);
								})}
							</div>
						</section>
						<p className="ui-landing-notice">{i18n.t('landing.home.notice')}</p>
					</main>
				</div>
			)}
			{leaving !== null && (
				<div className="ui-landing-exit" aria-hidden="true">
					<div className="ui-landing-mist">
						<span className="ui-landing-mist-layer" />
						<span className="ui-landing-mist-layer" />
						<span className="ui-landing-mist-layer" />
					</div>
				</div>
			)}
			{introPhase !== 'done' && (
				<div key={introRun} className="ui-landing-intro" data-testid="landing-intro" aria-hidden="true">
					<div className="ui-landing-mist">
						<span className="ui-landing-mist-layer" />
						<span className="ui-landing-mist-layer" />
						<span className="ui-landing-mist-layer" />
					</div>
					<img className="ui-landing-intro-mark" src="/forever/assets/img/forever-emblem.png" alt="" data-testid="landing-infinity" />
				</div>
			)}
			<LandingSpecModal playerClass={activeClass} open={modalOpen} onOpenChange={setModalOpen} onNavigate={navigate} container={portalHost} />
		</div>
	);
};
