// Shared analysis entry point for the UI and the import flow. Uses the Web
// Worker when available; falls back to main-thread analysis in environments
// without Worker support (tests, older webviews). Both paths persist through
// persistDetectorRun on the main thread, so sync hooks always observe writes.

import { registerAllDetectors } from './registerAll';
import { analyzeSession, type PipelineProgress, type PipelineResult } from './pipeline';
import { detectionWorkerClient } from './workerClient';

export async function analyzeConversation(
  conversationId: string,
  onProgress?: (progress: PipelineProgress) => void
): Promise<PipelineResult> {
  registerAllDetectors();
  if (typeof Worker !== 'undefined') {
    return detectionWorkerClient.analyze(conversationId, { onProgress });
  }
  return analyzeSession(conversationId, undefined, onProgress);
}

/** Analyze freshly imported sessions; failures are logged, never thrown. */
export async function autoAnalyzeConversations(ids: string[]): Promise<void> {
  for (const id of ids) {
    try {
      await analyzeConversation(id);
    } catch (err) {
      console.error('[detection] auto-analyze failed for', id, err);
    }
  }
}
