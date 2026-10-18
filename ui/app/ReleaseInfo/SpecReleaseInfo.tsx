import i18n from '@i18n/config';
import { type BuildInfo, commitUrl, type SpecVersion } from '@sim/constants/build_info';
import { Button } from '@ui-kit/Button';
import { Icon } from '@ui-kit/Icon';
import { Tooltip, tooltipAnchorProps } from '@ui-kit/Tooltip';
import clsx from 'clsx';
import { type ReactNode, useId } from 'react';

import { ReleaseInfo } from './ReleaseInfo';

export interface SpecReleaseInfoProps {
	info: BuildInfo;
	/** The spec's name, as the details list it. */
	specName: string;
	/** The spec's last change, when the build read it. */
	specVersion?: SpecVersion;
	className?: string;
}

const CommitLink = ({ commit }: { commit: string }) => (
	<Button href={commitUrl(commit)} target="_blank" variant="unstyled">
		{commit.slice(0, 7)}
	</Button>
);

const joined = (parts: ReactNode[]) => parts.filter(Boolean).flatMap((part, index) => (index > 0 ? [' · ', part] : [part]));

// The page's release, under the sidebar's stats: the game build, the build date and the commit. Hovering it
// lists the sim's build, the spec's last change and the game data, each left out when the build could not
// read it. The caller sets the text size and colour.
export const SpecReleaseInfo = ({ info, specName, specVersion, className }: SpecReleaseInfoProps) => {
	const id = useId();
	if (!info.gameVersion && !info.date && !info.commit && !specVersion) {
		return null;
	}
	const rows: { label: string; value: ReactNode[] }[] = [];
	if (info.date || info.commit) {
		rows.push({
			label: i18n.t('common.release_info.sim'),
			value: joined([
				info.date && i18n.t('common.release_info.built', { date: info.date }),
				info.commit && <CommitLink key="commit" commit={info.commit} />,
			]),
		});
	}
	if (specVersion) {
		rows.push({
			label: specName,
			value: joined([i18n.t('common.release_info.changed', { date: specVersion.date }), <CommitLink key="commit" commit={specVersion.commit} />]),
		});
	}
	if (info.gameVersion) {
		rows.push({ label: i18n.t('common.release_info.game_data'), value: [info.gameVersion] });
	}
	return (
		<div className={clsx('flex items-center gap-2', className)} {...tooltipAnchorProps(id)}>
			<ReleaseInfo info={info} />
			<Icon name="circle-info" />
			<Tooltip
				id={id}
				place="top"
				align="start"
				clickable
				content={
					<dl className="m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
						{rows.map(row => (
							<div key={row.label} className="contents">
								<dt className="font-bold">{row.label}</dt>
								<dd className="m-0">{row.value}</dd>
							</div>
						))}
					</dl>
				}
			/>
		</div>
	);
};
