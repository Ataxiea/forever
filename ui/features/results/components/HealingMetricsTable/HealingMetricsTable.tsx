import i18n from '@i18n/config';
import { useSim, useSimHost } from '@sim/context/SimHostContext';
import { useDisplayMetrics } from '@sim/hooks/useDisplayMetrics';
import type { ActionId } from '@sim/proto/action_id';
import { ActionMetrics } from '@sim/proto/sim_result';
import { formatToNumber } from '@sim/utils/format';
import { percentOf } from '@sim/utils/math';
import { Tooltip } from '@ui-kit/Tooltip';
import { useMemo } from 'react';

import { useSimResult } from '../../hooks/useSimResult';
import { buildMetricRows, filterMetricRows, indexMetricRows, type MetricGrouping, type MetricRow } from '../../model/grouping';
import type { SimResultData } from '../../model/result_data';
import { attackFormat, attackMetricsColumns, threatTooltip, useMetricMax } from '../AttackMetricsColumns';
import { MetricsCombinedTooltip, type MetricsCombinedTooltipGroup } from '../MetricsCombinedTooltip';
import { createMetricsColumnHelper, metricForAnchor, MetricsActionCell, MetricsTable, MetricTooltip } from '../MetricsTable';

const helper = createMetricsColumnHelper<ActionMetrics>();

const NO_ROWS: Array<MetricRow<ActionMetrics>> = [];
const sourceActionTag = (actionId: ActionId) => (actionId.itemId ? -actionId.itemId : actionId.spellId);

const TOOLTIP = {
	healing: 'healing-metrics-healing',
	avgCast: 'healing-metrics-avg-cast',
	avgCastHeader: 'healing-metrics-avg-cast-header',
	hits: 'healing-metrics-hits',
	hitsHeader: 'healing-metrics-hits-header',
	avgHit: 'healing-metrics-avg-hit',
	avgHitHeader: 'healing-metrics-avg-hit-header',
	hps: 'healing-metrics-hps',
};

const healingPlayer = (resultData: SimResultData) => {
	const players = resultData.result.getRaidIndexedPlayers(resultData.filter);
	return players.find(player => player.spec?.isHealingSpec) ?? players[0];
};

const healingGroups = (resultData: SimResultData): Array<Array<ActionMetrics>> => {
	const player = healingPlayer(resultData);
	if (!player) return [];

	const targetIndex = resultData.filter.target;
	return ActionMetrics.groupById(player.getHealingActions()).flatMap(group => {
		const actions =
			targetIndex == null || targetIndex === -1
				? group
				: group.flatMap(action => {
						if (
							!action.targets.some(
								target => target.data.unitIndex === targetIndex && (target.healing > 0 || target.shielding > 0),
							)
						)
							return [];
						return [action.forTarget(resultData.filter)];
					});
		if (!actions.length) return [];

		const merged = ActionMetrics.merge(actions);
		if (merged.hps <= 0) return [];

		const hasCastAndEffectMetrics = actions.some(action => !action.isPassiveAction) && actions.some(action => action.isPassiveAction);
		return [hasCastAndEffectMetrics ? [merged] : actions];
	});
};

const grouping = (sourceActionSpellIds: ReadonlySet<number>): MetricGrouping<ActionMetrics> => ({
	merge: metrics => ActionMetrics.merge(metrics, { removeTag: true, actionIdOverride: metrics[0]?.unit?.petActionId || undefined }),
	shouldCollapse: metric => !metric.unit?.isPet && !sourceActionSpellIds.has(metric.actionId.spellId),
});

const healingGroup = (metric: ActionMetrics): MetricsCombinedTooltipGroup => ({
	spellSchool: metric.spellSchool,
	totalPercentage: 100,
	data: [
		{
			name: i18n.t('results_tab.details.attack_types.hit'),
			value: metric.avgHealing - metric.avgCritHealing,
			percentage: metric.healingPercent,
			average: (metric.avgHealing - metric.avgCritHealing) / (metric.hits || metric.ticks),
		},
		{
			name: i18n.t('results_tab.details.attack_types.critical_hit'),
			value: metric.avgCritHealing,
			percentage: metric.healingCritPercent,
			average: metric.avgCritHealing / (metric.crits || metric.critTicks),
		},
	],
});

const healingHitGroups = (metric: ActionMetrics): Array<MetricsCombinedTooltipGroup> => [
	{
		spellSchool: metric.spellSchool,
		totalPercentage: 100,
		name: i18n.t('results_tab.details.columns.hits'),
		data: [
			{ name: i18n.t('results_tab.details.attack_types.hit'), value: metric.hits, percentage: percentOf(metric.hits, metric.landedHits) },
			{ name: i18n.t('results_tab.details.attack_types.critical_hit'), value: metric.crits, percentage: percentOf(metric.crits, metric.landedHits) },
			{ name: i18n.t('results_tab.details.attack_types.glancing_blow'), value: metric.glances, percentage: percentOf(metric.glances, metric.landedHits) },
			{ name: i18n.t('results_tab.details.attack_types.blocked_hit'), value: metric.blocks, percentage: percentOf(metric.blocks, metric.landedHits) },
			{
				name: i18n.t('results_tab.details.attack_types.blocked_critical_hit'),
				value: metric.blockedCrits,
				percentage: percentOf(metric.blockedCrits, metric.landedHits),
			},
		],
	},
	{
		spellSchool: metric.spellSchool,
		totalPercentage: 100,
		name: i18n.t('results_tab.details.tooltip_table.ticks'),
		data: [
			{ name: i18n.t('results_tab.details.attack_types.tick'), value: metric.ticks, percentage: percentOf(metric.ticks, metric.landedTicks) },
			{
				name: i18n.t('results_tab.details.attack_types.critical_tick'),
				value: metric.critTicks,
				percentage: percentOf(metric.critTicks, metric.landedTicks),
			},
		],
	},
];

const isThreatOnly = (metric: ActionMetrics) => metric.hitAttempts == 0 && metric.hps == 0;

export const HealingMetricsTable = () => {
	const resultData = useSimResult();
	const host = useSimHost();
	const sim = useSim();
	const sourceActionConfigs = host.individualConfig.healingMetricsSourceActions ?? [];
	const { threat: showThreatMetrics } = useDisplayMetrics(sim);

	const rows = useMemo(() => {
		const sourceActionSpellIds = new Set(sourceActionConfigs.map(config => config.spellId));
		const built = resultData ? buildMetricRows(healingGroups(resultData), grouping(sourceActionSpellIds)) : NO_ROWS;
		return showThreatMetrics ? built : filterMetricRows(built, isThreatOnly);
	}, [resultData, showThreatMetrics, sourceActionConfigs]);
	const metricsByRowId = useMemo(() => indexMetricRows(rows), [rows]);
	const damageActionsBySpellId = useMemo(() => {
		const player = resultData ? healingPlayer(resultData) : undefined;
		return new Map<number, ActionId>(player?.getDamageActions().map(action => [action.actionId.spellId, action.actionId] as const) ?? []);
	}, [resultData]);
	const healingActionsBySpellId = useMemo(() => {
		const player = resultData ? healingPlayer(resultData) : undefined;
		return new Map<number, ActionId>(
			player
				?.getHealingActions()
				.map(action => [sourceActionTag(action.actionId), action.actionId] as const)
				.filter(([sourceId]) => sourceId !== 0) ?? [],
		);
	}, [resultData]);
	const maxHealing = useMetricMax(rows, metric => metric.healing);
	const sourceActionBySpellId = useMemo(() => new Map(sourceActionConfigs.map(config => [config.spellId, config.source] as const)), [sourceActionConfigs]);

	const columns = useMemo(
		() =>
			helper.columns([
				helper.accessor(row => row.metric.name, {
					id: 'name',
					header: i18n.t('results_tab.details.columns.name'),
					cell: info => {
						const metric = info.row.original.metric;
						const sourceType = sourceActionBySpellId.get(metric.actionId.spellId);
						const sourceActionId =
							sourceType === 'damage'
								? damageActionsBySpellId.get(metric.actionId.tag)
								: sourceType === 'healing'
									? healingActionsBySpellId.get(metric.actionId.tag)
									: undefined;
						return (
							<MetricsActionCell
								name={sourceActionId?.name ?? metric.name}
								actionId={sourceActionId ?? metric.actionId}
								expandable={info.row.getCanExpand()}
								expanded={info.row.getIsExpanded()}
								onToggle={info.row.getToggleExpandedHandler()}
							/>
						);
					},
				}),
				attackMetricsColumns.primary({
					id: 'healing-done',
					header: i18n.t('results_tab.details.columns.healing_done'),
					total: metric => metric.avgHealing,
					value: metric => metric.healing,
					percentage: metric => metric.totalHealingPercent,
					max: maxHealing,
					overlay: metric => metric.shielding,
					tooltipId: TOOLTIP.healing,
				}),
				attackMetricsColumns.casts(),
				helper.accessor(row => row.metric.castsPerMinute, {
					id: 'cpm',
					header: i18n.t('results_tab.details.columns.cpm'),
					cell: info => attackFormat.number(info.getValue()),
				}),
				helper.accessor(row => row.metric.avgCastTimeMs, {
					id: 'cast-time',
					header: i18n.t('results_tab.details.columns.cast_time'),
					cell: info => formatToNumber(info.getValue() / 1000, { minimumFractionDigits: 2, fallbackString: '-' }),
				}),
				helper.accessor(row => row.metric.avgCastHealing, {
					id: 'avg-cast',
					header: i18n.t('results_tab.details.columns.avg_cast'),
					meta: {
						tooltipId: TOOLTIP.avgCast,
						headerTooltipId: TOOLTIP.avgCastHeader,
						headerTooltip: i18n.t('results_tab.details.tooltips.healing_avg_cast_tooltip'),
					},
					cell: info => attackFormat.compact(info.getValue()),
				}),
				helper.accessor(row => row.metric.landedHits, {
					id: 'hits',
					header: i18n.t('results_tab.details.columns.hits'),
					meta: {
						tooltipId: TOOLTIP.hits,
						headerTooltipId: TOOLTIP.hitsHeader,
						headerTooltip: i18n.t('results_tab.details.tooltips.healing_hits_tooltip'),
					},
					cell: info => {
						const metric = info.row.original.metric;
						return (
							<>
								{attackFormat.number(metric.landedHits)}
								{!!metric.landedTicks && <> ({attackFormat.number(metric.landedTicks)})</>}{' '}
							</>
						);
					},
				}),
				helper.accessor(row => row.metric.avgHitHealing, {
					id: 'avg-hit',
					header: i18n.t('results_tab.details.columns.avg_hit'),
					meta: {
						tooltipId: TOOLTIP.avgHit,
						headerTooltipId: TOOLTIP.avgHitHeader,
						headerTooltip: i18n.t('results_tab.details.tooltips.healing_avg_hit_tooltip'),
					},
					cell: info => attackFormat.compact(info.getValue()),
				}),
				helper.accessor(row => row.metric.hpm, {
					id: 'hpm',
					header: i18n.t('results_tab.details.columns.hpm'),
					cell: info => attackFormat.compact(info.getValue()),
				}),
				helper.accessor(row => row.metric.critPercent || row.metric.critTickPercent, {
					id: 'crit-percent',
					header: i18n.t('results_tab.details.columns.crit_percent'),
					cell: info => attackFormat.percent(info.getValue()),
				}),
				helper.accessor(row => row.metric.healingThroughput, {
					id: 'hpet',
					header: i18n.t('results_tab.details.columns.hpet'),
					cell: info => attackFormat.compact(info.getValue()),
				}),
				attackMetricsColumns.rate({
					id: 'hps',
					header: i18n.t('results_tab.details.columns.hps'),
					value: metric => metric.hps,
					tooltipId: TOOLTIP.hps,
				}),
			]),
		[damageActionsBySpellId, healingActionsBySpellId, maxHealing, sourceActionBySpellId],
	);

	const forAnchor = metricForAnchor(metricsByRowId);

	return (
		<>
			<MetricsTable
				rootTestId="healing-metrics-root"
				columns={columns}
				rows={rows}
				sortColumnId="hps"
				hasResult={!!resultData}
				rowThreatOnly={isThreatOnly}
			/>
			<Tooltip id={TOOLTIP.avgCastHeader} />
			<Tooltip id={TOOLTIP.hitsHeader} />
			<Tooltip id={TOOLTIP.avgHitHeader} />
			<MetricTooltip id={TOOLTIP.healing} forAnchor={forAnchor} body={metric => <MetricsCombinedTooltip groups={[healingGroup(metric)]} />} />
			<MetricTooltip
				id={TOOLTIP.avgCast}
				forAnchor={forAnchor}
				body={metric => (metric.avgCastHealing ? threatTooltip(metric, metric.avgCastThreat, showThreatMetrics) : null)}
			/>
			<MetricTooltip
				id={TOOLTIP.hits}
				forAnchor={forAnchor}
				body={metric => (!metric.landedHits && !metric.landedTicks ? null : <MetricsCombinedTooltip groups={healingHitGroups(metric)} />)}
			/>
			<MetricTooltip
				id={TOOLTIP.avgHit}
				forAnchor={forAnchor}
				body={metric => (metric.avgHitHealing ? threatTooltip(metric, metric.avgHitThreat, showThreatMetrics) : null)}
			/>
			<MetricTooltip id={TOOLTIP.hps} forAnchor={forAnchor} body={metric => threatTooltip(metric, metric.tps, showThreatMetrics)} />
		</>
	);
};
