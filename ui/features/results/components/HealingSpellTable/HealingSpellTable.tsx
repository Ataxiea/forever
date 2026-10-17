import { HealingSpellStats } from '@generated/proto/api';
import i18n from '@i18n/config';
import { useSimHost } from '@sim/context/SimHostContext';
import { useActionId } from '@sim/hooks/useActionId';
import { usePlayerStore } from '@sim/hooks/usePlayerStore';
import { ActionId } from '@sim/proto/action_id';
import { formatToNumber } from '@sim/utils/format';
import { Accordion, AccordionItem } from '@ui-kit/Accordion';
import { Table, TableCell, TableHeaderCell, TableRow } from '@ui-kit/Table';
import { TooltipButton } from '@ui-kit/TooltipButton';
import { WowheadIcon } from '@ui-kit/WowheadIcon';
import { useMemo, useState } from 'react';

import { useSimResult } from '../../hooks/useSimResult';

export interface HealingSpellTableViewProps {
	spells: ReadonlyArray<HealingSpellStats>;
	procUptimes?: ReadonlyArray<{ name: string; target: string; uptime: number }>;
	spellOrder?: ReadonlyArray<string>;
}

const displayAmount = (value: number) => formatToNumber(value, { maximumFractionDigits: 1 });
const displayPercent = (value: number) => `${displayAmount(value * 100)}%`;

const HealingSpellRankCell = ({ spell }: { spell: HealingSpellStats }) => {
	const { iconUrl, href } = useActionId(ActionId.fromProto(spell.id!));
	const rankLabel = i18n.t('results_tab.details.healing_spells.rank_label', { rank: spell.rank });

	return (
		<TableCell>
			<span className="inline-flex items-center gap-2">
				{iconUrl && <WowheadIcon href={href} iconUrl={iconUrl} label={spell.name} className="rounded h-5 w-5" />}
				<span>{rankLabel}</span>
			</span>
		</TableCell>
	);
};

const HealingSpellGroupTitle = ({ name, id }: { name: string; id?: HealingSpellStats['id'] }) => {
	const { iconUrl } = useActionId(id ? ActionId.fromProto(id) : undefined);

	return (
		<span className="inline-flex items-center gap-2">
			{iconUrl && <WowheadIcon as="div" iconUrl={iconUrl} label={name} className="rounded h-6 w-6 shrink-0" />}
			<span>{name}</span>
		</span>
	);
};

export const HealingSpellTableView = ({ spells, procUptimes = [], spellOrder = [] }: HealingSpellTableViewProps) => {
	const [expanded, setExpanded] = useState<Array<string>>([]);
	const groups = useMemo(() => {
		const byName = new Map<string, Array<HealingSpellStats>>();
		for (const spell of spells) {
			const group = byName.get(spell.name) ?? [];
			group.push(spell);
			byName.set(spell.name, group);
		}
		const order = new Map(spellOrder.map((name, index) => [name, index]));
		return [...byName.entries()].sort(([nameA], [nameB]) => {
			const orderA = order.get(nameA);
			const orderB = order.get(nameB);
			if (orderA !== undefined && orderB !== undefined) return orderA - orderB;
			if (orderA !== undefined) return -1;
			if (orderB !== undefined) return 1;
			return nameA.localeCompare(nameB);
		});
	}, [spells, spellOrder]);
	const metricNotes = [...new Set(spells.flatMap(spell => spell.additionalMetrics.map(metric => metric.noteKey).filter(Boolean)))];

	if (!groups.length) return <p className="p-4 text-sm opacity-70">{i18n.t('results_tab.details.healing_spells.no_spells')}</p>;

	return (
		<div className="p-2">
			<Accordion value={expanded} onValueChange={setExpanded} variant="boxed" testId="healing-spell-accordion">
				{groups.map(([name, ranks]) => {
					const highestRank = ranks.reduce((highest, spell) => (spell.rank > highest.rank ? spell : highest), ranks[0]);
					const metricsByGroup = new Map<string, Array<string>>();
					for (const spell of ranks) {
						for (const metric of spell.additionalMetrics) {
							const labels = metricsByGroup.get(metric.groupKey) ?? [];
							if (!labels.includes(metric.labelKey)) labels.push(metric.labelKey);
							metricsByGroup.set(metric.groupKey, labels);
						}
					}
					const periodic = ranks[0].periodic;
					const criticalMetrics = ranks[0].absorb ? [] : (metricsByGroup.get('critical') ?? []);
					const periodicTotalMetrics = ['normal_total', 'expected_total', 'all_crit_total'];
					const extraMetricGroups = [...metricsByGroup.entries()].filter(
						([groupKey]) => (ranks[0].absorb || groupKey !== 'critical') && (!periodic || groupKey !== 'periodic_total'),
					);
					const metricColumnCount =
						(ranks[0].absorb ? 3 : periodic ? 6 + criticalMetrics.length : 7 + criticalMetrics.length) +
						extraMetricGroups.reduce((total, [, labels]) => total + labels.length, 0);
					const metricColumnWidth = `${84 / metricColumnCount}%`;
					return (
						<AccordionItem
							key={name}
							value={name}
							title={<HealingSpellGroupTitle name={name} id={highestRank.id} />}
							testId={`healing-spell-${name}`}
							panelClassName="overflow-x-auto p-2">
							<Table dense striped className="w-full table-fixed text-center" testId={`healing-spell-table-${name}`}>
								<colgroup>
									<col style={{ width: '16%' }} />
									{Array.from({ length: metricColumnCount }, (_, index) => (
										<col key={index} style={{ width: metricColumnWidth }} />
									))}
								</colgroup>
								<thead>
									<TableRow>
										<TableHeaderCell rowSpan={2} wrap>
											<span className="inline-flex items-center justify-center">
												{i18n.t('results_tab.details.healing_spells.rank')}
												<TooltipButton tooltip={i18n.t('results_tab.details.healing_spells.periodic_tooltip')} className="ml-1" />
											</span>
										</TableHeaderCell>
										{ranks[0].absorb ? (
											<TableHeaderCell colSpan={3} wrap>
												{i18n.t('results_tab.details.healing_spells.absorb')}
											</TableHeaderCell>
										) : periodic ? (
											<>
												<TableHeaderCell colSpan={2} wrap>
													{i18n.t('results_tab.details.healing_spells.per_tick')}
												</TableHeaderCell>
												<TableHeaderCell colSpan={periodicTotalMetrics.length} wrap>
													{i18n.t('results_tab.details.healing_spells.full_duration')}
												</TableHeaderCell>
												<TableHeaderCell colSpan={1 + criticalMetrics.length} wrap>
													{i18n.t('results_tab.details.healing_spells.critical')}
												</TableHeaderCell>
											</>
										) : (
											<>
												<TableHeaderCell colSpan={3} wrap>
													{i18n.t('results_tab.details.healing_spells.normal')}
												</TableHeaderCell>
												<TableHeaderCell colSpan={4 + criticalMetrics.length} wrap>
													{i18n.t('results_tab.details.healing_spells.critical')}
												</TableHeaderCell>
											</>
										)}
										{extraMetricGroups.map(([groupKey, labels]) => (
											<TableHeaderCell key={groupKey} colSpan={labels.length} wrap>
												{i18n.t(`results_tab.details.healing_spells.${groupKey}`)}
											</TableHeaderCell>
										))}
									</TableRow>
									<TableRow>
										{(ranks[0].absorb
											? ['min', 'mean', 'max']
											: periodic
												? ['normal_tick', 'crit_tick', ...periodicTotalMetrics, 'crit_chance', ...criticalMetrics]
												: ['min', 'mean', 'max', 'crit_chance', ...criticalMetrics, 'min', 'mean', 'max']
										).map((column, index) => (
											<TableHeaderCell key={`${index}-${column}`} wrap>
												{i18n.t(`results_tab.details.healing_spells.${column}`)}
											</TableHeaderCell>
										))}
										{extraMetricGroups.flatMap(([groupKey, labels]) =>
											labels.map(labelKey => (
												<TableHeaderCell key={`${groupKey}-${labelKey}`} wrap>
													{i18n.t(`results_tab.details.healing_spells.${labelKey}`)}
												</TableHeaderCell>
											)),
										)}
									</TableRow>
								</thead>
								<tbody>
									{ranks.map((spell, index) => (
										<TableRow key={`${spell.name}-${spell.rank}-${index}`}>
											<HealingSpellRankCell spell={spell} />
											{spell.absorb ? (
												<>
													<TableCell>{displayAmount(spell.absorbMin)}</TableCell>
													<TableCell>{displayAmount(spell.absorbMean)}</TableCell>
													<TableCell>{displayAmount(spell.absorbMax)}</TableCell>
													{extraMetricGroups.flatMap(([groupKey, labels]) =>
														labels.map(labelKey => {
															const metric = spell.additionalMetrics.find(
																candidate => candidate.groupKey === groupKey && candidate.labelKey === labelKey,
															);
															return (
																<TableCell key={`${groupKey}-${labelKey}`}>
																	{metric ? displayAmount(metric.value) : ''}
																</TableCell>
															);
														}),
													)}
												</>
											) : periodic ? (
												<>
													<TableCell>{displayAmount(spell.mean)}</TableCell>
													<TableCell>{displayAmount(spell.critMean)}</TableCell>
													{periodicTotalMetrics.map(labelKey => {
														const metric = spell.additionalMetrics.find(
															candidate => candidate.groupKey === 'periodic_total' && candidate.labelKey === labelKey,
														);
														return <TableCell key={labelKey}>{metric ? displayAmount(metric.value) : ''}</TableCell>;
													})}
													<TableCell>{displayPercent(spell.critChance)}</TableCell>
													{criticalMetrics.map(labelKey => {
														const metric = spell.additionalMetrics.find(
															candidate => candidate.groupKey === 'critical' && candidate.labelKey === labelKey,
														);
														return <TableCell key={labelKey}>{metric ? displayPercent(metric.value) : ''}</TableCell>;
													})}
													{extraMetricGroups.flatMap(([groupKey, labels]) =>
														labels.map(labelKey => {
															const metric = spell.additionalMetrics.find(
																candidate => candidate.groupKey === groupKey && candidate.labelKey === labelKey,
															);
															return (
																<TableCell key={`${groupKey}-${labelKey}`}>
																	{metric ? displayAmount(metric.value) : ''}
																</TableCell>
															);
														}),
													)}
												</>
											) : (
												<>
													<TableCell>{displayAmount(spell.min)}</TableCell>
													<TableCell>{displayAmount(spell.mean)}</TableCell>
													<TableCell>{displayAmount(spell.max)}</TableCell>
													<TableCell>{displayPercent(spell.critChance)}</TableCell>
													{criticalMetrics.map(labelKey => {
														const metric = spell.additionalMetrics.find(
															candidate => candidate.groupKey === 'critical' && candidate.labelKey === labelKey,
														);
														return <TableCell key={labelKey}>{metric ? displayPercent(metric.value) : ''}</TableCell>;
													})}
													<TableCell>{displayAmount(spell.critMin)}</TableCell>
													<TableCell>{displayAmount(spell.critMean)}</TableCell>
													<TableCell>{displayAmount(spell.critMax)}</TableCell>
													{extraMetricGroups.flatMap(([groupKey, labels]) =>
														labels.map(labelKey => {
															const metric = spell.additionalMetrics.find(
																candidate => candidate.groupKey === groupKey && candidate.labelKey === labelKey,
															);
															return (
																<TableCell key={`${groupKey}-${labelKey}`}>
																	{metric ? displayAmount(metric.value) : ''}
																</TableCell>
															);
														}),
													)}
												</>
											)}
										</TableRow>
									))}
								</tbody>
							</Table>
						</AccordionItem>
					);
				})}
			</Accordion>
			{procUptimes.length > 0 && (
				<div className="mt-3">
					<h3 className="px-2 pb-2 text-sm font-semibold">{i18n.t('results_tab.details.healing_spells.proc_uptimes')}</h3>
					<Table dense striped testId="healing-proc-uptime-table">
						<thead>
							<TableRow>
								<TableHeaderCell>{i18n.t('results_tab.details.healing_spells.proc')}</TableHeaderCell>
								<TableHeaderCell>{i18n.t('results_tab.details.healing_spells.target')}</TableHeaderCell>
								<TableHeaderCell>{i18n.t('results_tab.details.healing_spells.uptime')}</TableHeaderCell>
							</TableRow>
						</thead>
						<tbody>
							{procUptimes.map((proc, index) => (
								<TableRow key={`${proc.name}-${proc.target}-${index}`}>
									<TableCell>{proc.name}</TableCell>
									<TableCell>{proc.target}</TableCell>
									<TableCell>{`${proc.uptime.toFixed(2)}%`}</TableCell>
								</TableRow>
							))}
						</tbody>
					</Table>
				</div>
			)}
			<p className="pt-2 text-xs opacity-70">
				{i18n.t('results_tab.details.healing_spells.uptime_note')}
				{metricNotes.map(noteKey => ` ${i18n.t(`results_tab.details.healing_spells.${noteKey}`)}`)}
			</p>
		</div>
	);
};

export const HealingSpellTable = () => {
	const host = useSimHost();
	const currentStats = usePlayerStore('currentStats');
	const simResult = useSimResult();
	const procAuraConfigs = host.individualConfig.healingProcAuras ?? [];
	const procUptimes = useMemo(() => {
		if (!simResult) return [];
		const duration = simResult.result.result.avgIterationDuration || 1;
		const procAurasById = new Map(procAuraConfigs.map(config => [config.spellId, config]));
		return (simResult.result.result.raidMetrics?.parties ?? [])
			.flatMap(party => party.players)
			.filter(player => player.name.startsWith('Target Dummy'))
			.flatMap(player =>
				player.auras.flatMap(aura => {
					if (!aura.id) return [];
					const spellId = ActionId.fromProto(aura.id).spellId;
					const config = procAurasById.get(spellId);
					if (!config) return [];
					return [
						{
							name: i18n.t(config.labelKey),
							target: player.name,
							uptime: ((aura.uptimeSecondsAvg || 0) / duration) * 100,
						},
					];
				}),
			)
			.sort((a, b) => a.name.localeCompare(b.name) || a.target.localeCompare(b.target));
	}, [procAuraConfigs, simResult]);
	return <HealingSpellTableView spells={currentStats?.healingSpells ?? []} procUptimes={procUptimes} spellOrder={host.individualConfig.healingSpellOrder} />;
};
