import { Class } from '@generated/proto/common';
import i18n from '@i18n/config';
import { translatePlayerClass, translatePlayerSpec, translateStatus } from '@i18n/localization';
import type { PlayerClass } from '@sim/player/player_class';
import type { PlayerSpec } from '@sim/player/player_spec';
import { Dialog } from '@ui-kit/Dialog';
import { Icon } from '@ui-kit/Icon';
import { SimLinkContent } from '@ui-kit/SimLinkContent';

export interface LandingSpecModalProps {
	playerClass: PlayerClass<Class> | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onNavigate: (href: string) => void;
	container?: HTMLElement | null;
}

export const LandingSpecModal = ({ playerClass, open, onOpenChange, onNavigate, container }: LandingSpecModalProps) => {
	if (playerClass === null) return null;
	const specs = Object.values(playerClass.specs) as Array<PlayerSpec<any>>;
	const className = translatePlayerClass(playerClass);

	return (
		<Dialog
			open={open}
			onOpenChange={onOpenChange}
			container={container}
			testId="landing-spec-modal"
			className="ui-landing-dialog"
			size="md"
			verticalAlign="center"
			scrollContents
			keepMounted
			title={
				<span className="flex items-center gap-3">
					<img src={playerClass.getIcon('small')} className="h-9 w-9 rounded-full" alt="" />
					<span>
						<span className="ui-landing-modal-kicker">{i18n.t('landing.home.hero.chooseSpec')}</span>
						<span className="ui-landing-modal-title">{className}</span>
					</span>
				</span>
			}>
			<ul className="ui-landing-spec-list">
				{specs.map(spec => (
					<li key={spec.simLink}>
						<a
							href={spec.simLink}
							className="ui-landing-spec-row"
							data-testid="landing-spec-link"
							onClick={event => {
								event.preventDefault();
								onNavigate(spec.simLink);
							}}>
							<SimLinkContent
								iconPath={spec.getIcon('large')}
								label={className}
								title={translatePlayerSpec(spec)}
								status={translateStatus(spec.launch.status)}
							/>
							<Icon name="chevron-right" size="lg" className="ui-landing-spec-chevron" />
						</a>
					</li>
				))}
			</ul>
		</Dialog>
	);
};
