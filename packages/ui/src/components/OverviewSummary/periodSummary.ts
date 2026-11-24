import type { ThroughputRow } from '../ThroughputAreaChart/throughputSeries';

export interface QueueTotal {
  queueName: string;
  completed: number;
  failed: number;
}

export interface PeriodSummary {
  completed: number;
  failed: number;
  processed: number;
  /** Null when nothing finished, so the card shows n/a instead of 0% or 100%. */
  successRate: number | null;
  /** The bucket with the most finished jobs, or null for an idle period. */
  peak: ThroughputRow | null;
  /** Queue with the most finished jobs; null when every queue was idle. */
  busiest: QueueTotal | null;
  /** Queue with the most failed jobs; null when nothing failed. */
  mostFailed: QueueTotal | null;
}

export interface SummarizePeriodInput {
  rows: ThroughputRow[];
  queueTotals: QueueTotal[];
}

const processedOf = (total: { completed: number; failed: number }) =>
  total.completed + total.failed;

export function summarizePeriod({ rows, queueTotals }: SummarizePeriodInput): PeriodSummary {
  let completed = 0;
  let failed = 0;
  let peak: ThroughputRow | null = null;
  for (const row of rows) {
    completed += row.completed;
    failed += row.failed;
    if (processedOf(row) > 0 && (!peak || processedOf(row) > processedOf(peak))) {
      peak = row;
    }
  }

  let busiest: QueueTotal | null = null;
  let mostFailed: QueueTotal | null = null;
  for (const total of queueTotals) {
    if (processedOf(total) > 0 && (!busiest || processedOf(total) > processedOf(busiest))) {
      busiest = total;
    }
    if (total.failed > 0 && (!mostFailed || total.failed > mostFailed.failed)) {
      mostFailed = total;
    }
  }

  const processed = completed + failed;
  return {
    completed,
    failed,
    processed,
    successRate: processed > 0 ? (completed / processed) * 100 : null,
    peak,
    busiest,
    mostFailed,
  };
}

/** Whole-percent change, or null when the previous period had nothing to compare against. */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) {
    return null;
  }
  return Math.round(((current - previous) / previous) * 100);
}

/** Adds same-length rows bucket by bucket, e.g. every queue's native 60-minute series. */
export function sumRows(rowSets: ThroughputRow[][]): ThroughputRow[] {
  const [first = []] = rowSets;
  return first.map((row, index) => ({
    x: row.x,
    completed: rowSets.reduce((acc, rows) => acc + (rows[index]?.completed ?? 0), 0),
    failed: rowSets.reduce((acc, rows) => acc + (rows[index]?.failed ?? 0), 0),
  }));
}
