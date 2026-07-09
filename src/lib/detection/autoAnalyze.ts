// Shared analysis entry point for the UI and the import flow. Uses the Web
// Worker when available; falls back to main-thread analysis in environments
// without Worker support (tests, older webviews). Both paths persist through
// persistDetectorRun on the main thread, so sync hooks always observe writes.

import { registerAllDetectors } from './registerAll';
import {
  analyzeSession,
  type ConfigOverrides,
  type PipelineProgress,
  type PipelineResult,
} from './pipeline';
import { detectionWorkerClient } from './workerClient';
import { getMetadata, setMetadata } from '../db/metadata';

// Settings-page detector config (IMPLEMENTATION_PLAN decisions log #2).
// Stored in metadata so it syncs like other preferences; every analysis path
// picks it up unless explicit overrides are passed.
const CONFIG_OVERRIDES_KEY = 'detection.configOverrides';

export async function getStoredConfigOverrides(): Promise<ConfigOverrides | undefined> {
  return getMetadata<ConfigOverrides>(CONFIG_OVERRIDES_KEY);
}

export async function setStoredConfigOverrides(
  overrides: ConfigOverrides
): Promise<void> {
  await setMetadata(CONFIG_OVERRIDES_KEY, overrides);
}

export async function analyzeConversation(
  conversationId: string,
  onProgress?: (progress: PipelineProgress) => void,
  overrides?: ConfigOverrides
): Promise<PipelineResult> {
  registerAllDetectors();
  const config = overrides ?? (await getStoredConfigOverrides());
  if (typeof Worker !== 'undefined') {
    return detectionWorkerClient.analyze(conversationId, {
      onProgress,
      configOverrides: config,
    });
  }
  return analyzeSession(conversationId, config, onProgress);
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
