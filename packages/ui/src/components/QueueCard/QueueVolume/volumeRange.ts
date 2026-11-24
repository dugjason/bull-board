import type { MetricsHistoryGranularity } from '@bull-board/api/typings/app';
import type { ThroughputRow } from '../../ThroughputAreaChart/throughputSeries';

export type VolumeRange = '60m' | '24h' | '7d' | '30d';

export type HistoryVolumeRange = Exclude<VolumeRange, '60m'>;

export const VOLUME_RANGES: VolumeRange[] = ['60m', '24h', '7d', '30d'];

export const VOLUME_RANGE_LABEL_KEYS: Record<
  VolumeRange,
  'METRICS.RANGE_60M' | 'METRICS.RANGE_24H' | 'METRICS.RANGE_7D' | 'METRICS.RANGE_30D'
> = {
  '60m': 'METRICS.RANGE_60M',
  '24h': 'METRICS.RANGE_24H',
  '7d': 'METRICS.RANGE_7D',
  '30d': 'METRICS.RANGE_30D',
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

interface HistoryRangeSpec {
  granularity: MetricsHistoryGranularity;
  stepMs: number;
  buckets: number;
}

export const HISTORY_RANGES: Record<HistoryVolumeRange, HistoryRangeSpec> = {
  '24h': { granularity: 'hour', stepMs: HOUR_MS, buckets: 24 },
  '7d': { granularity: 'hour', stepMs: HOUR_MS, buckets: 7 * 24 },
  '30d': { granularity: 'day', stepMs: DAY_MS, buckets: 30 },
};

/**
 * UTC-aligned window that ends with the current (partial) bucket. It only moves when a new
 * bucket starts, so the history query key stays stable between polls.
 */
export function historyWindow(spec: HistoryRangeSpec, nowMs: number) {
  const currentStart = Math.floor(nowMs / spec.stepMs) * spec.stepMs;
  return {
    from: currentStart - (spec.buckets - 1) * spec.stepMs,
    to: currentStart + spec.stepMs - 1,
  };
}

/** The history provider omits buckets with no activity. Zero-fill them so idle time reads flat. */
export function fillBuckets(
  rows: ThroughputRow[],
  from: number,
  spec: HistoryRangeSpec
): ThroughputRow[] {
  const byTs = new Map(rows.map((row) => [row.x, row]));
  return Array.from({ length: spec.buckets }, (_, index) => {
    const x = from + index * spec.stepMs;
    return byTs.get(x) ?? { x, completed: 0, failed: 0 };
  });
}

/** Tooltip and peak label for a history bucket: hour buckets show the hour, day buckets the date. */
export function formatHistoryBucket(ts: number, granularity: MetricsHistoryGranularity): string {
  return granularity === 'hour'
    ? new Date(ts).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
      })
    : new Date(ts).toLocaleDateString();
}
