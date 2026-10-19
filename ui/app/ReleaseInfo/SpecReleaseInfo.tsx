import i18n from '@i18n/config';
import { translatePlayerSpec } from '@i18n/localization';
import { BUILD_INFO, type Change, commitUrl, specRelease } from '@sim/constants/build_info';
import type { PlayerSpec } from '@sim/player/player_spec';
import { Button } from '@ui-kit/Button';
import { Icon } from '@ui-kit/Icon';
import { Tooltip, tooltipAnchorProps } from '@ui-kit/Tooltip';
import clsx from 'clsx';
import { type ReactNode, useId } from 'react';

import { ReleaseInfo } from './ReleaseInfo';

export interface SpecReleaseInfoProps {
	/** The spec the page sims. */
	spec: PlayerSpec<any>;
	className?: string;
}

const CommitLink = ({ commit }: { commit: string }) => (
	<Button href={commitUrl(commit)} target="_blank" variant="unstyled">
		{commit.slice(0, 7)}
	</Button>
);

const joined = (parts: ReactNode[]) => parts.filter(Boolean).flatMap((part, index) => (index > 0 ? [' · ', part] : [part]));

const changed = (change: Change) => joined([i18n.t('common.release_info.changed', { date: change.date }), <CommitLink key="commit" commit={change.commit} />]);

// The page's release, under the sidebar's stats: the game build of the spell data the spec reads, the
// build date and the commit. The info button beside it opens the details: the sim's build, and the last
// changes to the spec's presets and to its engine, each left out when the build could not read it. They
// open on click, so the links in them are reachable by keyboard and on a touch screen. The caller sets
// the text size and colour.
export const SpecReleaseInfo = ({ spec, className }: SpecReleaseInfoProps) => {
	const id = useId();
	const release = specRelease(spec.simLink);
	const rows: { label: string; value: ReactNode[] }[] = [];
	if (BUILD_INFO.date || BUILD_INFO.commit) {
		rows.push({
			label: i18n.t('common.release_info.sim_build'),
			value: joined([
				BUILD_INFO.date && i18n.t('common.release_info.built', { date: BUILD_INFO.date }),
				BUILD_INFO.commit && <CommitLink key="commit" commit={BUILD_INFO.commit} />,
			]),
		});
	}
	if (release.presets) {
		rows.push({ label: i18n.t('common.release_info.presets', { spec: translatePlayerSpec(spec) }), value: changed(release.presets) });
	}
	if (release.engine) {
		rows.push({ label: i18n.t('common.release_info.engine', { spec: translatePlayerSpec(spec) }), value: changed(release.engine) });
	}
	if (rows.length === 0 && !release.gameVersion) {
		return null;
	}
	return (
		<div className={clsx('flex items-center gap-2', className)}>
			<ReleaseInfo gameVersion={release.gameVersion ?? ''} />
			{rows.length > 0 && (
				<>
					<Button variant="unstyled" aria-label={i18n.t('common.release_info.details')} {...tooltipAnchorProps(id)}>
						<Icon name="circle-info" />
					</Button>
					<Tooltip
						id={id}
						place="top"
						align="start"
						openOnClick
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
				</>
			)}
		</div>
	);
};
