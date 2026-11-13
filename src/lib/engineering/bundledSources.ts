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


/**
 * Bundled source selection is a demo-adapter concern, NOT a code-to-model
 * mapping. The portable analyzer derives every entity and relation directly
 * from the selected source text; no authored demo concepts feed it.
 *
 * Restrict this catalog to source files already packaged with the application.
 * These are not the laptop working tree and are not pinned to a Git commit.
 */
import type { EngineeringExampleKind } from './demoProjects';

export const bundledExampleSourcePaths: Readonly<Record<EngineeringExampleKind, readonly string[]>> = {
  'event-queue': [
    'examples/event-queue/src/queue.ts',
    'examples/event-queue/src/worker.ts',
    'examples/event-queue/test/delivery.test.ts',
  ],
  'todo-list': [
    'src/lib/engineering/todoModel.ts',
    'src/lib/engineering/todoModel.test.ts',
  ],
};
