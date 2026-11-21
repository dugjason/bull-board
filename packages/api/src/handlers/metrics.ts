import { queueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';
import { GetQueueMetricsResponse } from '../schemas/responses';
import { BullBoardRequest, ControllerHandlerReturnType } from '../types';

// The UI only plots the newest 60 minutes. Workers with `maxDataPoints: ONE_WEEK` keep 10,080
// points per metric, which is too much to send on every poll from each overview card.
const NATIVE_WINDOW_END = 59;

async function getMetrics(
  _req: BullBoardRequest,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType<GetQueueMetricsResponse>> {
  const [completed, failed] = await Promise.all([
    queue.getMetrics('completed', 0, NATIVE_WINDOW_END).catch(() => null),
    queue.getMetrics('failed', 0, NATIVE_WINDOW_END).catch(() => null),
  ]);

  return {
    status: 200,
    body: { completed, failed },
  };
}

export const metricsHandler = queueProvider(getMetrics, {
  skipReadOnlyModeCheck: true,
});
