/**
 * Only the two intentionally authored demo scopes ship with source bytes.
 * Every other project must resolve bindings from the existing repoFiles
 * cache (populated by RepoSource / ensureIndexed), never from this map.
 *
 * Keys are exact repository-relative paths; no Git revision is implied.
 */
import queueSource from '../../../examples/event-queue/src/queue.ts?raw';
import workerSource from '../../../examples/event-queue/src/worker.ts?raw';
import deliveryTests from '../../../examples/event-queue/test/delivery.test.ts?raw';
import todoSource from './todoModel.ts?raw';
import todoTests from './todoModel.test.ts?raw';

export const bundledEngineeringSources: Readonly<Record<string, string>> = {
  'examples/event-queue/src/queue.ts': queueSource,
  'examples/event-queue/src/worker.ts': workerSource,
  'examples/event-queue/test/delivery.test.ts': deliveryTests,
  'src/lib/engineering/todoModel.ts': todoSource,
  'src/lib/engineering/todoModel.test.ts': todoTests,
};
