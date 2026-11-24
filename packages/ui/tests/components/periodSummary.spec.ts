import {
  percentChange,
  sumRows,
  summarizePeriod,
} from '../../src/components/OverviewSummary/periodSummary';

describe('summarizePeriod', () => {
  it('totals the period and picks the peak bucket, busiest queue and most failures', () => {
    const summary = summarizePeriod({
      rows: [
        { x: 1, completed: 10, failed: 0 },
        { x: 2, completed: 30, failed: 2 },
        { x: 3, completed: 8, failed: 0 },
      ],
      queueTotals: [
        { queueName: 'emails', completed: 40, failed: 0 },
        { queueName: 'webhooks', completed: 8, failed: 2 },
      ],
    });

    expect(summary).toEqual({
      completed: 48,
      failed: 2,
      processed: 50,
      successRate: 96,
      peak: { x: 2, completed: 30, failed: 2 },
      busiest: { queueName: 'emails', completed: 40, failed: 0 },
      mostFailed: { queueName: 'webhooks', completed: 8, failed: 2 },
    });
  });

  it('reports no rate, peak or queues for an idle period', () => {
    const summary = summarizePeriod({
      rows: [{ x: 1, completed: 0, failed: 0 }],
      queueTotals: [{ queueName: 'emails', completed: 0, failed: 0 }],
    });

    expect(summary).toMatchObject({
      processed: 0,
      successRate: null,
      peak: null,
      busiest: null,
      mostFailed: null,
    });
  });
});

describe('percentChange', () => {
  it('rounds to whole percent and skips an empty previous period', () => {
    expect(percentChange(104, 100)).toBe(4);
    expect(percentChange(96, 100)).toBe(-4);
    expect(percentChange(10, 0)).toBeNull();
  });
});

describe('sumRows', () => {
  it('adds each bucket across series', () => {
    expect(
      sumRows([
        [
          { x: 0, completed: 1, failed: 0 },
          { x: 1, completed: 2, failed: 1 },
        ],
        [
          { x: 0, completed: 3, failed: 1 },
          { x: 1, completed: 0, failed: 0 },
        ],
      ])
    ).toEqual([
      { x: 0, completed: 4, failed: 1 },
      { x: 1, completed: 2, failed: 1 },
    ]);
  });
});
