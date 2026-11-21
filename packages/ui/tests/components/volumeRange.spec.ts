import {
  fillBuckets,
  HISTORY_RANGES,
  historyWindow,
} from '../../src/components/QueueCard/QueueVolume/volumeRange';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe('historyWindow', () => {
  it('ends with the current UTC hour for hourly ranges', () => {
    const now = Date.UTC(2026, 10, 21, 10, 42);

    expect(historyWindow(HISTORY_RANGES['24h'], now)).toEqual({
      from: Date.UTC(2026, 10, 20, 11),
      to: Date.UTC(2026, 10, 21, 11) - 1,
    });
  });

  it('ends with the current UTC day for daily ranges', () => {
    const now = Date.UTC(2026, 10, 21, 10, 42);

    expect(historyWindow(HISTORY_RANGES['30d'], now)).toEqual({
      from: Date.UTC(2026, 10, 21) - 29 * DAY,
      to: Date.UTC(2026, 10, 22) - 1,
    });
  });

  it('stays stable within one bucket', () => {
    const spec = HISTORY_RANGES['7d'];

    expect(historyWindow(spec, Date.UTC(2026, 10, 21, 10, 1))).toEqual(
      historyWindow(spec, Date.UTC(2026, 10, 21, 10, 59))
    );
  });
});

describe('fillBuckets', () => {
  it('zero-fills idle buckets and keeps recorded ones', () => {
    const spec = HISTORY_RANGES['24h'];
    const from = Date.UTC(2026, 10, 20, 11);
    const spike = { x: from + 3 * HOUR, completed: 40, failed: 2 };

    const rows = fillBuckets([spike], from, spec);

    expect(rows).toHaveLength(24);
    expect(rows[0]).toEqual({ x: from, completed: 0, failed: 0 });
    expect(rows[3]).toBe(spike);
    expect(rows[23].x).toBe(from + 23 * HOUR);
  });
});
