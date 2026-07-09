// Detection Web Worker entry. Registers detectors, then serves analyze
// requests. Bundled by Vite via `new Worker(new URL('./worker.ts', ...))`
// in workerClient.ts.

import { handleAnalyzeRequest, type AnalyzeRequest } from './workerHandler';
import { registerAllDetectors } from './registerAll';

registerAllDetectors();

interface DetectionWorkerScope {
  onmessage: ((event: MessageEvent<AnalyzeRequest>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = self as unknown as DetectionWorkerScope;

scope.onmessage = (event) => {
  void handleAnalyzeRequest(event.data, (response) => scope.postMessage(response));
};
