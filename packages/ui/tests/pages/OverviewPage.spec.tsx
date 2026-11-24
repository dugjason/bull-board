import type { GetQueuesResponse } from '@bull-board/api/typings/responses';
import { act, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { queryKeys } from '../../src/hooks/queryKeys';
import { useSettingsStore } from '../../src/hooks/useSettings';
import { OverviewPage } from '../../src/pages/OverviewPage/OverviewPage';
import { createWrapper, makeQueue, render } from '../testUtils';

beforeEach(() => {
  useSettingsStore.setState({ pollingInterval: 0, jobsPerPage: 10, overview: {} });
});

async function renderOverview(count: number) {
  const queues = Array.from({ length: count }, (_, index) => makeQueue(`queue-${index}`));
  const getQueues = jest.fn(() => Promise.resolve<GetQueuesResponse>({ queues }));
  const { Wrapper, queryClient } = createWrapper({
    api: { getQueues },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  const { container } = render(<OverviewPage />, { wrapper: Wrapper });

  await waitFor(() => expect(container.querySelectorAll('.queueCard').length).toBe(count));

  return queryClient
    .getQueryCache()
    .find({ queryKey: queryKeys.queues.all, exact: false })
    ?.getObserversCount();
}

it('queue cards do not observe the queues query', async () => {
  const observersFor5 = await renderOverview(5);
  const observersFor50 = await renderOverview(50);

  expect(observersFor5).toBeGreaterThan(0);
  expect(observersFor50).toBe(observersFor5);
});

it('asks about workers only for the queue cards in view', async () => {
  const observed: { target: Element; callback: IntersectionObserverCallback }[] = [];
  global.IntersectionObserver = class {
    constructor(private callback: IntersectionObserverCallback) {}
    observe(target: Element) {
      observed.push({ target, callback: this.callback });
    }
    disconnect() {}
  } as unknown as typeof IntersectionObserver;

  try {
    const queues = ['seen', 'unseen'].map((name) => makeQueue(name));
    const getQueuesHasWorkers = jest.fn(() => Promise.resolve({ hasWorkers: { seen: false } }));
    const { Wrapper } = createWrapper({
      api: { getQueues: () => Promise.resolve({ queues }), getQueuesHasWorkers },
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });

    render(<OverviewPage />, { wrapper: Wrapper });

    await waitFor(() => expect(observed).toHaveLength(2));
    act(() => {
      for (const { target, callback } of observed) {
        const isIntersecting = target.textContent?.includes('unseen') === false;
        callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver);
      }
    });

    await waitFor(() => expect(getQueuesHasWorkers).toHaveBeenCalled());
    expect(getQueuesHasWorkers).toHaveBeenCalledTimes(1);
    expect(getQueuesHasWorkers).toHaveBeenCalledWith(['seen']);
  } finally {
    delete (global as { IntersectionObserver?: unknown }).IntersectionObserver;
  }
});

it('summarizes the last 60 minutes across every queue', async () => {
  const now = Date.now();
  const series = (data: number[]) => ({ meta: { count: 0, prevTS: now, prevCount: 0 }, data });
  const metrics: Record<string, unknown> = {
    alpha: { completed: series([5]), failed: series([1]) },
    beta: { completed: series([2]), failed: series([]) },
  };
  const { Wrapper } = createWrapper({
    api: {
      getQueues: () => Promise.resolve({ queues: [makeQueue('alpha'), makeQueue('beta')] }),
      getMetrics: (queueName: string) => Promise.resolve(metrics[queueName]),
    },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });

  const { container } = render(<OverviewPage />, { wrapper: Wrapper });

  await waitFor(() => expect(container.querySelector('.summary .total')?.textContent).toBe('8'));
  const queueLinks = [...container.querySelectorAll('.summary .queue a')];
  // Busiest queue, then the queue with the most failures.
  expect(queueLinks.map((link) => link.textContent)).toEqual(['alpha', 'alpha']);
});

it('waits for every queue history before ranking queues', async () => {
  useSettingsStore.setState({ overview: { volumeRange: '24h' } });
  const hour = Math.floor(Date.now() / 3600000) * 3600000;
  const point = (value: number) => [{ ts: hour, value }];
  const getHistoryMetrics = ({ queue }: { queue?: string }) => {
    if (queue === 'beta') {
      return new Promise(() => {});
    }
    return Promise.resolve(
      queue === 'alpha'
        ? { completed: point(10), failed: [] }
        : { completed: point(100), failed: point(20) }
    );
  };
  const { Wrapper } = createWrapper({
    api: {
      getQueues: () => Promise.resolve({ queues: [makeQueue('alpha'), makeQueue('beta')] }),
      getHistoryMetrics,
    },
    history: createMemoryHistory({ initialEntries: ['/'] }),
    uiConfig: { hasHistoryProvider: true },
  });

  const { container } = render(<OverviewPage />, { wrapper: Wrapper });

  await waitFor(() => expect(container.querySelector('.summary .total')?.textContent).toBe('120'));
  expect(container.querySelectorAll('.summary .queue a')).toHaveLength(0);
  expect(container.querySelector('.summary')?.textContent).not.toContain(
    'OVERVIEW_SUMMARY.NO_FAILURES'
  );
});
