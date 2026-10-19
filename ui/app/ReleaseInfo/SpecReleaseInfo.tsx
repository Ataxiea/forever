import i18n from '@i18n/config';
import { translateClass } from '@i18n/localization';
import { type BuildInfo, commitUrl, type SpecVersion, type SpellDataVersion } from '@sim/constants/build_info';
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
	/** The spec's last preset change, when the build read it. */
	specVersion?: SpecVersion;
	/** The spell data the spec's sim reads: its class, racials, items and shared, as the store stamps each part. */
	spellData: { part: string; version: SpellDataVersion }[];
	className?: string;
}

const CommitLink = ({ commit }: { commit: string }) => (
	<Button href={commitUrl(commit)} target="_blank" variant="unstyled">
		{commit.slice(0, 7)}
	</Button>
);

const spellDataLabel = (part: string): string => {
	switch (part) {
		case 'racials':
			return i18n.t('common.release_info.racial_data');
		case 'items':
			return i18n.t('common.release_info.item_data');
		case 'shared':
			return i18n.t('common.release_info.shared_data');
		default:
			return i18n.t('common.release_info.class_data', { class: translateClass(part) });
	}
};

const joined = (parts: ReactNode[]) => parts.filter(Boolean).flatMap((part, index) => (index > 0 ? [' · ', part] : [part]));

// The page's release, under the sidebar's stats: the game build, the build date and the commit. The info
// button beside it, on hover or focus, lists the sim's build, the spec's last preset change and the game
// build and hotfix of each part of the spell data the spec reads, each left out when the build could not
// read it. The caller sets the text size and colour.
export const SpecReleaseInfo = ({ info, specName, specVersion, spellData, className }: SpecReleaseInfoProps) => {
	const id = useId();
	if (!info.gameVersion && !info.date && !info.commit && !specVersion && spellData.length === 0) {
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
			label: i18n.t('common.release_info.presets', { spec: specName }),
			value: joined([i18n.t('common.release_info.changed', { date: specVersion.date }), <CommitLink key="commit" commit={specVersion.commit} />]),
		});
	}
	for (const { part, version } of spellData) {
		rows.push({ label: spellDataLabel(part), value: [i18n.t('common.release_info.data_version', { build: version.build, hotfix: version.hotfix })] });
	}
	return (
		<div className={clsx('flex items-center gap-2', className)}>
			<ReleaseInfo info={info} />
			<Button variant="unstyled" aria-label={i18n.t('common.release_info.details')} {...tooltipAnchorProps(id)}>
				<Icon name="circle-info" />
			</Button>
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
