// Message protocol + handler for the detection Web Worker. Kept separate from
// worker.ts (the entry that binds to the worker global) so the handler is
// unit-testable in jsdom, which has no real Worker.
//
// The worker only READS IndexedDB and computes; results go back to the main
// thread, which persists them so the sync engine's Dexie hooks observe the
// writes (they are per-instance and would not fire for worker-side writes).

import {
  computeDetectorRun,
  type ConfigOverrides,
  type PipelineResult,
  type PipelineStage,
} from './pipeline';

export interface AnalyzeRequest {
  type: 'analyze';
  requestId: string;
  sessionId: string;
  configOverrides?: ConfigOverrides;
}

export type WorkerResponse =
  | {
      type: 'progress';
      requestId: string;
      sessionId: string;
      stage: PipelineStage;
      detectorId?: string;
    }
  | {
      type: 'result';
      requestId: string;
      sessionId: string;
      result: PipelineResult;
    }
  | {
      type: 'error';
      requestId: string;
      sessionId: string;
      message: string;
    };

export async function handleAnalyzeRequest(
  request: AnalyzeRequest,
  post: (response: WorkerResponse) => void
): Promise<void> {
  const { requestId, sessionId } = request;
  try {
    const result = await computeDetectorRun(
      sessionId,
      request.configOverrides,
      ({ stage, detectorId }) =>
        post({ type: 'progress', requestId, sessionId, stage, detectorId })
    );
    post({ type: 'result', requestId, sessionId, result });
  } catch (err) {
    post({
      type: 'error',
      requestId,
      sessionId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}
