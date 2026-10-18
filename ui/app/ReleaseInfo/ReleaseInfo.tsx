import i18n from '@i18n/config';
import { type BuildInfo, commitUrl } from '@sim/constants/build_info';
import { Button } from '@ui-kit/Button';
import clsx from 'clsx';
import { Fragment, type ReactNode } from 'react';

export interface ReleaseInfoProps {
	info: BuildInfo;
	className?: string;
}

// The game build, the build date and the commit of the running page, each left out when the build could
// not read it. The commit links to it on GitHub. The caller sets the text size and colour.
export const ReleaseInfo = ({ info, className }: ReleaseInfoProps) => {
	const parts: { key: string; node: ReactNode }[] = [];
	if (info.gameVersion) {
		parts.push({ key: 'game', node: i18n.t('common.release_info.game_version', { version: info.gameVersion }) });
	}
	if (info.date) {
		parts.push({ key: 'date', node: i18n.t('common.release_info.built', { date: info.date }) });
	}
	if (info.commit) {
		const short = info.commit.slice(0, 7);
		parts.push({
			key: 'commit',
			node: (
				<Button
					href={commitUrl(info.commit)}
					target="_blank"
					variant="unstyled"
					title={i18n.t('common.release_info.commit_link', { commit: short })}>
					{short}
				</Button>
			),
		});
	}
	if (parts.length === 0) {
		return null;
	}
	return (
		<p className={clsx('m-0', className)}>
			{parts.map((part, index) => (
				<Fragment key={part.key}>
					{index > 0 && ' · '}
					{part.node}
				</Fragment>
			))}
		</p>
	);
};
