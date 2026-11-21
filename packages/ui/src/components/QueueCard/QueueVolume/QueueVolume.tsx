import { useTranslation } from 'react-i18next';
import { useHistoryMetrics } from '../../../hooks/useHistoryMetrics';
import { useMetrics } from '../../../hooks/useMetrics';
import { useSettingsStore } from '../../../hooks/useSettings';
import { useUIConfig } from '../../../hooks/useUIConfig';
import { ThroughputAreaChart } from '../../ThroughputAreaChart/ThroughputAreaChart';
import type { ThroughputAreaChartProps } from '../../ThroughputAreaChart/ThroughputAreaChart';
import {
  NATIVE_WINDOW,
  sum,
  toHistoryRows,
  toNativeRows,
  toNativeSeries,
} from '../../ThroughputAreaChart/throughputSeries';
import { fillBuckets, HISTORY_RANGES, historyWindow } from './volumeRange';
import type { HistoryVolumeRange } from './volumeRange';
import s from './QueueVolume.module.css';

interface QueueVolumeProps {
  queueName: string;
  /** False while the card is off screen, so a long overview does not poll every queue. */
  enabled: boolean;
}

export const QueueVolume = ({ queueName, enabled }: QueueVolumeProps) => {
  const { hasHistoryProvider = false } = useUIConfig();
  const savedRange = useSettingsStore((state) => state.overview.volumeRange ?? '60m');
  const range = hasHistoryProvider ? savedRange : '60m';

  return range === '60m' ? (
    <NativeVolume queueName={queueName} enabled={enabled} />
  ) : (
    <HistoryVolume queueName={queueName} enabled={enabled} range={range} />
  );
};

const NativeVolume = ({ queueName, enabled }: QueueVolumeProps) => {
  const { t } = useTranslation();
  const { metrics, loading } = useMetrics(enabled ? queueName : null);
  const hasData = [metrics?.completed, metrics?.failed].some(
    (m) => (m?.meta?.count ?? 0) > 0 || (m?.data?.length ?? 0) > 0
  );
  const now = Date.now();
  const rows = toNativeRows(
    toNativeSeries(metrics?.completed, now),
    toNativeSeries(metrics?.failed, now)
  );

  return (
    <VolumeChart
      queueName={queueName}
      rows={hasData ? rows : null}
      loading={loading}
      valueUnit={t('METRICS.PER_MIN_UNIT')}
      formatTooltipLabel={(row) =>
        row.x === NATIVE_WINDOW - 1
          ? t('METRICS.NOW')
          : t('METRICS.MINUTES_AGO', { minutes: NATIVE_WINDOW - 1 - row.x })
      }
    />
  );
};

interface HistoryVolumeProps extends QueueVolumeProps {
  range: HistoryVolumeRange;
}

const HistoryVolume = ({ queueName, enabled, range }: HistoryVolumeProps) => {
  const spec = HISTORY_RANGES[range];
  const { from, to } = historyWindow(spec, Date.now());
  const { completed, failed, loading } = useHistoryMetrics({
    queue: queueName,
    from,
    to,
    granularity: spec.granularity,
    enabled,
  });
  const hasData = completed.length > 0 || failed.length > 0;

  return (
    <VolumeChart
      queueName={queueName}
      rows={hasData ? fillBuckets(toHistoryRows(completed, failed), from, spec) : null}
      loading={loading}
      granularity={spec.granularity}
      formatTooltipLabel={(row) =>
        spec.granularity === 'hour'
          ? new Date(row.x).toLocaleString(undefined, {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
            })
          : new Date(row.x).toLocaleDateString()
      }
    />
  );
};

interface VolumeChartProps extends Pick<
  ThroughputAreaChartProps,
  'formatTooltipLabel' | 'granularity' | 'valueUnit'
> {
  queueName: string;
  /** Null when nothing was ever recorded, which is different from a quiet period of zeros. */
  rows: ThroughputAreaChartProps['data'] | null;
  loading: boolean;
}

const VolumeChart = ({ queueName, rows, loading, ...chartProps }: VolumeChartProps) => {
  const { t } = useTranslation();

  if (!rows) {
    return (
      <div className={s.volume}>
        <p className={s.empty}>{loading ? null : t('METRICS.HISTORY_EMPTY')}</p>
      </div>
    );
  }

  return (
    <div className={s.volume}>
      <ThroughputAreaChart
        idPrefix={`volume-${queueName.replace(/[^\w-]/g, '_')}`}
        data={rows}
        height={56}
        showLegend={false}
        {...chartProps}
      />
      <div className={s.totals}>
        <span className={s.total}>
          <span className={s.dot} style={{ backgroundColor: 'var(--status-failed)' }} />
          {t('METRICS.FAILED')}
          <span className={s.count}>{sum(rows.map((row) => row.failed)).toLocaleString()}</span>
        </span>
        <span className={s.separator} aria-hidden="true" />
        <span className={s.total}>
          <span className={s.dot} style={{ backgroundColor: 'var(--status-completed)' }} />
          {t('METRICS.COMPLETED')}
          <span className={s.count}>{sum(rows.map((row) => row.completed)).toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
};
