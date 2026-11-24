import type {
  AppQueue,
  MetricsHistoryGranularity,
  MetricsHistoryPoint,
  MetricsLatencyGranularity,
} from '@bull-board/api/typings/app';
import { useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { queryKeys } from '../../hooks/queryKeys';
import { useApi } from '../../hooks/useApi';
import { useHistoryMetrics } from '../../hooks/useHistoryMetrics';
import { useLatencyMetrics } from '../../hooks/useLatencyMetrics';
import { useSettingsStore } from '../../hooks/useSettings';
import { useUIConfig } from '../../hooks/useUIConfig';
import { links } from '../../utils/links';
import { Card } from '../Card/Card';
import { formatDuration } from '../LatencyChart/latencySeries';
import {
  fillBuckets,
  formatHistoryBucket,
  HISTORY_RANGES,
  historyWindow,
  VOLUME_RANGE_LABEL_KEYS,
} from '../QueueCard/QueueVolume/volumeRange';
import type { HistoryVolumeRange } from '../QueueCard/QueueVolume/volumeRange';
import { ThroughputAreaChart } from '../ThroughputAreaChart/ThroughputAreaChart';
import {
  NATIVE_WINDOW,
  sum,
  toHistoryRows,
  toNativeRows,
  toNativeSeries,
} from '../ThroughputAreaChart/throughputSeries';
import type { ThroughputRow } from '../ThroughputAreaChart/throughputSeries';
import { percentChange, sumRows, summarizePeriod } from './periodSummary';
import type { QueueTotal } from './periodSummary';
import s from './OverviewSummary.module.css';

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const LATENCY_PERCENTILES = [50, 95];
const P95 = [95];

interface OverviewSummaryProps {
  /** Every queue on the board, not the filtered list, so totals do not change with search. */
  queues: AppQueue[];
}

/**
 * All-queue totals for the overview's selected range. Per-queue requests use the same query
 * keys as the queue cards, so cards in view share them instead of fetching twice.
 */
export const OverviewSummary = ({ queues }: OverviewSummaryProps) => {
  const { hasHistoryProvider = false } = useUIConfig();
  const savedRange = useSettingsStore((state) => state.overview.volumeRange ?? '60m');
  const range = hasHistoryProvider ? savedRange : '60m';

  return range === '60m' ? (
    <NativeSummary queues={queues} />
  ) : (
    <HistorySummary queues={queues} range={range} />
  );
};

const useRefetchInterval = () => {
  const pollingInterval = useSettingsStore((state) => state.pollingInterval);
  return pollingInterval > 0 ? pollingInterval * 1000 : false;
};

const NativeSummary = ({ queues }: OverviewSummaryProps) => {
  const { t } = useTranslation();
  const api = useApi();
  const refetchInterval = useRefetchInterval();
  const results = useQueries({
    queries: queues.map((queue) => ({
      queryKey: queryKeys.metrics(queue.name),
      queryFn: () => api.getMetrics(queue.name),
      refetchInterval,
    })),
  });

  const hasData = results.some(({ data }) =>
    [data?.completed, data?.failed].some(
      (m) => (m?.meta?.count ?? 0) > 0 || (m?.data?.length ?? 0) > 0
    )
  );
  // Totals come from the same per-queue requests, so a partial sum would undercount.
  if (!hasData || results.some((result) => result.isPending)) {
    return null;
  }

  const now = Date.now();
  const perQueue = results.map(({ data }) =>
    toNativeRows(toNativeSeries(data?.completed, now), toNativeSeries(data?.failed, now))
  );
  // History has no minute buckets, so the 60m view reads latency for the current hour.
  const hourStart = Math.floor(now / HOUR_MS) * HOUR_MS;

  return (
    <SummaryCard
      queues={queues}
      rows={sumRows(perQueue)}
      queueTotals={
        results.every((result) => result.isSuccess)
          ? queues.map((queue, index) => toQueueTotal(queue.name, perQueue[index]))
          : null
      }
      elapsedMinutes={NATIVE_WINDOW}
      rangeLabel={t('METRICS.RANGE_60M')}
      peakUnit={t('METRICS.PER_MIN_UNIT')}
      valueUnit={t('METRICS.PER_MIN_UNIT')}
      formatBucket={(row) =>
        row.x === NATIVE_WINDOW - 1
          ? t('METRICS.NOW')
          : t('METRICS.MINUTES_AGO', { minutes: NATIVE_WINDOW - 1 - row.x })
      }
      change={null}
      latency={{
        from: hourStart,
        to: hourStart + HOUR_MS - 1,
        granularity: 'hour',
        queueAgeGranularity: 'hour',
        label: t('OVERVIEW_SUMMARY.LATENCY_THIS_HOUR'),
      }}
    />
  );
};

interface HistorySummaryProps extends OverviewSummaryProps {
  range: HistoryVolumeRange;
}

const HistorySummary = ({ queues, range }: HistorySummaryProps) => {
  const { t } = useTranslation();
  const api = useApi();
  const refetchInterval = useRefetchInterval();
  const spec = HISTORY_RANGES[range];
  const now = Date.now();
  const { from, to } = historyWindow(spec, now);
  const span = spec.buckets * spec.stepMs;
  const { granularity } = spec;

  const current = useHistoryMetrics({ from, to, granularity });
  const previous = useHistoryMetrics({
    from: from - span,
    to: from - 1,
    granularity,
  });
  const results = useQueries({
    queries: queues.map((queue) => {
      const params = { queue: queue.name, from, to, granularity };
      return {
        queryKey: queryKeys.historyMetrics(params),
        queryFn: () => api.getHistoryMetrics(params),
        refetchInterval,
      };
    }),
  });

  if (current.completed.length === 0 && current.failed.length === 0) {
    return null;
  }

  const rows = fillBuckets(toHistoryRows(current.completed, current.failed), from, spec);
  const processed = sumPoints(current.completed) + sumPoints(current.failed);
  const previousProcessed = sumPoints(previous.completed) + sumPoints(previous.failed);

  return (
    <SummaryCard
      queues={queues}
      rows={rows}
      granularity={granularity}
      queueTotals={
        results.every((result) => result.isSuccess)
          ? queues.map((queue, index) =>
              toQueueTotal(
                queue.name,
                toHistoryRows(
                  results[index].data?.completed ?? [],
                  results[index].data?.failed ?? []
                )
              )
            )
          : null
      }
      elapsedMinutes={(now - from) / MINUTE_MS}
      rangeLabel={t(VOLUME_RANGE_LABEL_KEYS[range])}
      peakUnit={t(
        granularity === 'hour' ? 'OVERVIEW_SUMMARY.PER_HOUR_UNIT' : 'OVERVIEW_SUMMARY.PER_DAY_UNIT'
      )}
      formatBucket={(row) => formatHistoryBucket(row.x, granularity)}
      change={previous.loading ? null : percentChange(processed, previousProcessed)}
      latency={{
        from,
        to,
        granularity: 'range',
        queueAgeGranularity: granularity,
      }}
    />
  );
};

const sumPoints = (points: MetricsHistoryPoint[]) => sum(points.map((point) => point.value));

const toQueueTotal = (queueName: string, rows: ThroughputRow[]): QueueTotal => ({
  queueName,
  completed: sum(rows.map((row) => row.completed)),
  failed: sum(rows.map((row) => row.failed)),
});

interface LatencyWindow {
  from: number;
  to: number;
  granularity: MetricsLatencyGranularity;
  queueAgeGranularity: MetricsHistoryGranularity;
  /** Replaces the default cell label when the window differs from the selected range. */
  label?: string;
}

interface SummaryCardProps {
  queues: AppQueue[];
  rows: ThroughputRow[];
  granularity?: MetricsHistoryGranularity;
  /** Null until every queue's request succeeds, so a partial set is never ranked. */
  queueTotals: QueueTotal[] | null;
  elapsedMinutes: number;
  rangeLabel: string;
  peakUnit: string;
  valueUnit?: string;
  formatBucket: (row: ThroughputRow) => string;
  /** Percent change in processed jobs against the previous period, when one is known. */
  change: number | null;
  latency: LatencyWindow;
}

const SummaryCard = ({
  queues,
  rows,
  granularity,
  queueTotals,
  elapsedMinutes,
  rangeLabel,
  peakUnit,
  valueUnit,
  formatBucket,
  change,
  latency,
}: SummaryCardProps) => {
  const { t } = useTranslation();
  const { hasLatencyHistory = false } = useUIConfig();
  const summary = summarizePeriod({ rows, queueTotals: queueTotals ?? [] });
  const displayName = (queueName: string) =>
    queues.find((queue) => queue.name === queueName)?.displayName || queueName;
  const avgPerMinute = elapsedMinutes > 0 ? summary.processed / elapsedMinutes : 0;

  return (
    <Card className={s.summary}>
      <div className={s.overview}>
        <div className={s.headline}>
          <span className={s.total}>{summary.processed.toLocaleString()}</span>
          <span className={s.muted}>{t('OVERVIEW_SUMMARY.PROCESSED', { range: rangeLabel })}</span>
          {change !== null && (
            <span className={s.change}>
              {t('OVERVIEW_SUMMARY.CHANGE', {
                change: `${change > 0 ? '+' : ''}${change}%`,
                range: rangeLabel,
              })}
            </span>
          )}
        </div>
        <div className={s.legend}>
          <span className={s.legendItem}>
            <span className={s.dot} style={{ backgroundColor: 'var(--status-completed)' }} />
            {t('METRICS.COMPLETED')}
            <span className={s.count}>{summary.completed.toLocaleString()}</span>
          </span>
          <span className={s.legendItem}>
            <span className={s.dot} style={{ backgroundColor: 'var(--status-failed)' }} />
            {t('METRICS.FAILED')}
            <span className={s.count}>{summary.failed.toLocaleString()}</span>
          </span>
          <span className={s.legendItem}>
            {t('OVERVIEW_SUMMARY.AVG')}
            <span className={s.count}>
              {avgPerMinute.toLocaleString(undefined, {
                maximumFractionDigits: avgPerMinute < 10 ? 1 : 0,
              })}
            </span>
            {t('METRICS.PER_MIN_UNIT')}
          </span>
        </div>
        <ThroughputAreaChart
          idPrefix="overview-summary"
          data={rows}
          height={76}
          showLegend={false}
          granularity={granularity}
          valueUnit={valueUnit}
          formatTooltipLabel={formatBucket}
        />
      </div>

      <dl className={s.cells}>
        <div className={s.cell}>
          <dt>{t('OVERVIEW_SUMMARY.SUCCESS_RATE')}</dt>
          <dd className={s.value}>
            {summary.successRate === null
              ? t('METRICS.NOT_AVAILABLE')
              : `${summary.successRate.toLocaleString(undefined, { maximumFractionDigits: 2 })}%`}
          </dd>
          {summary.successRate !== null && (
            <dd className={s.meter}>
              <span style={{ width: `${summary.successRate}%` }} />
            </dd>
          )}
        </div>
        <div className={s.cell}>
          <dt>{t('OVERVIEW_SUMMARY.PEAK')}</dt>
          {summary.peak ? (
            <>
              <dd className={s.value}>
                {(summary.peak.completed + summary.peak.failed).toLocaleString()}{' '}
                <small>{peakUnit}</small>
              </dd>
              <dd className={s.sub}>{formatBucket(summary.peak)}</dd>
            </>
          ) : (
            <dd className={s.value}>{t('METRICS.NOT_AVAILABLE')}</dd>
          )}
        </div>
        {hasLatencyHistory && <LatencyCells window={latency} />}
        <div className={s.cell}>
          <dt>
            {summary.busiest
              ? t('OVERVIEW_SUMMARY.BUSIEST_SHARE', {
                  share: Math.round(
                    ((summary.busiest.completed + summary.busiest.failed) / summary.processed) * 100
                  ),
                })
              : t('OVERVIEW_SUMMARY.BUSIEST')}
          </dt>
          {summary.busiest ? (
            <>
              <dd className={s.queue}>
                <NavLink to={links.queuePage(summary.busiest.queueName)}>
                  {displayName(summary.busiest.queueName)}
                </NavLink>
              </dd>
              <dd className={s.sub}>
                {t('OVERVIEW_SUMMARY.PROCESSED_COUNT', {
                  total: (summary.busiest.completed + summary.busiest.failed).toLocaleString(),
                })}
              </dd>
            </>
          ) : (
            <dd className={s.value}>{t('METRICS.NOT_AVAILABLE')}</dd>
          )}
        </div>
        <div className={s.cell}>
          <dt>{t('OVERVIEW_SUMMARY.MOST_FAILURES')}</dt>
          {summary.mostFailed ? (
            <>
              <dd className={s.queue}>
                <NavLink
                  to={links.queuePage(summary.mostFailed.queueName, {
                    [summary.mostFailed.queueName]: 'failed',
                  })}
                >
                  {displayName(summary.mostFailed.queueName)}
                </NavLink>
              </dd>
              <dd className={s.sub}>
                {t('OVERVIEW_SUMMARY.FAILED_COUNT', {
                  total: summary.mostFailed.failed.toLocaleString(),
                })}
              </dd>
            </>
          ) : (
            <dd className={s.value}>
              {t(queueTotals ? 'OVERVIEW_SUMMARY.NO_FAILURES' : 'METRICS.NOT_AVAILABLE')}
            </dd>
          )}
        </div>
      </dl>
    </Card>
  );
};

const LatencyCells = ({ window }: { window: LatencyWindow }) => {
  const { t } = useTranslation();
  const range = {
    from: window.from,
    to: window.to,
    granularity: window.granularity,
  };
  const { points: runPoints } = useLatencyMetrics({
    ...range,
    metric: 'runtime',
    percentiles: LATENCY_PERCENTILES,
  });
  const { points: waitPoints } = useLatencyMetrics({
    ...range,
    metric: 'waittime',
    percentiles: P95,
  });
  const { points: queueAgePoints } = useHistoryMetrics({
    from: window.from,
    to: window.to,
    granularity: window.queueAgeGranularity,
    metric: 'queueage',
  });

  // 'range' answers one point; the 60m view's hour window answers at most one.
  const run = runPoints[runPoints.length - 1]?.values;
  const wait = waitPoints[waitPoints.length - 1]?.values;
  const oldest = queueAgePoints.length
    ? Math.max(...queueAgePoints.map((point) => point.value))
    : undefined;
  const format = (ms: number | undefined) =>
    ms === undefined ? t('METRICS.NOT_AVAILABLE') : formatDuration(ms);

  return (
    <>
      <div className={s.cell}>
        <dt>{window.label ?? t('OVERVIEW_SUMMARY.LATENCY')}</dt>
        <dd className={s.value}>
          {format(run?.['95'])} <small>/ {format(wait?.['95'])}</small>
        </dd>
        {run?.['50'] !== undefined && (
          <dd className={s.sub}>
            {t('OVERVIEW_SUMMARY.P50_RUN', {
              value: formatDuration(run['50']),
            })}
          </dd>
        )}
      </div>
      <div className={s.cell}>
        <dt>{t('OVERVIEW_SUMMARY.OLDEST_WAITING')}</dt>
        <dd className={s.value}>{format(oldest)}</dd>
        <dd className={s.sub}>{t('OVERVIEW_SUMMARY.ALL_QUEUES')}</dd>
      </div>
    </>
  );
};
