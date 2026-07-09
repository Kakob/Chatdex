// Main-thread client for the detection worker. Sends analyze requests,
// relays progress, and persists results on the main thread so the sync
// engine's Dexie hooks observe the batched writes.

import { generateId } from '../utils/ids';
import {
  persistDetectorRun,
  type ConfigOverrides,
  type PipelineProgress,
  type PipelineResult,
} from './pipeline';
import type { AnalyzeRequest, WorkerResponse } from './workerHandler';

interface PendingRequest {
  resolve: (result: PipelineResult) => void;
  reject: (err: Error) => void;
  onProgress?: (progress: PipelineProgress) => void;
}

export class DetectionWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      void this.handleResponse(event.data);
    };
    return this.worker;
  }

  private async handleResponse(response: WorkerResponse): Promise<void> {
    const entry = this.pending.get(response.requestId);
    if (!entry) return;

    if (response.type === 'progress') {
      entry.onProgress?.({ stage: response.stage, detectorId: response.detectorId });
      return;
    }

    this.pending.delete(response.requestId);
    if (response.type === 'error') {
      entry.reject(new Error(response.message));
      return;
    }

    try {
      // Persist on the main thread — batched transaction at run completion.
      entry.resolve(await persistDetectorRun(response.result));
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }
  }

  analyze(
    sessionId: string,
    options?: {
      configOverrides?: ConfigOverrides;
      onProgress?: (progress: PipelineProgress) => void;
    }
  ): Promise<PipelineResult> {
    const worker = this.ensureWorker();
    const requestId = generateId();
    return new Promise<PipelineResult>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve,
        reject,
        onProgress: options?.onProgress,
      });
      const request: AnalyzeRequest = {
        type: 'analyze',
        requestId,
        sessionId,
        configOverrides: options?.configOverrides,
      };
      worker.postMessage(request);
    });
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const [, entry] of this.pending) {
      entry.reject(new Error('Detection worker terminated'));
    }
    this.pending.clear();
  }
}

export const detectionWorkerClient = new DetectionWorkerClient();
