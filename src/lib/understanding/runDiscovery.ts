// Batch orchestration + disclosure summary for project discovery (U1.3).
//
// Disclosure (CLAUDE.md invariant 6): before any conversation content is sent,
// the UI must state which provider will receive which sources. Sending one
// provider's history to a *different* provider is called out explicitly.

import { discoverProjects } from './discovery';
import type { DiscoveryConfig, DiscoveryResult } from './discovery';
import { getProviderInfo } from '../providers';
import type { LLMProviderId } from '../providers';
import type { StoredConversation, DataSource } from '../../types';

/** Which LLM provider each conversation source natively belongs to. */
const NATIVE_PROVIDER: Record<DataSource, LLMProviderId> = {
  'claude.ai': 'anthropic',
  'claude-code': 'anthropic',
  chatgpt: 'openai',
  codex: 'openai',
};

export interface DisclosureSummary {
  provider: LLMProviderId;
  providerLabel: string;
  totalConversations: number;
  bySource: Array<{ source: DataSource; count: number }>;
  /** Sources whose history originates from a different provider than the target. */
  crossProviderSources: DataSource[];
}

export function buildDisclosure(
  conversations: StoredConversation[],
  provider: LLMProviderId
): DisclosureSummary {
  const counts = new Map<DataSource, number>();
  for (const c of conversations) {
    counts.set(c.source, (counts.get(c.source) ?? 0) + 1);
  }
  const bySource = [...counts.entries()]
    .map(([source, count]) => ({ source, count }))
    .sort((a, b) => b.count - a.count);
  return {
    provider,
    providerLabel: getProviderInfo(provider).label,
    totalConversations: conversations.length,
    bySource,
    crossProviderSources: bySource
      .filter(({ source }) => NATIVE_PROVIDER[source] !== provider)
      .map(({ source }) => source),
  };
}

export interface RunDiscoveryOptions {
  /** Conversations per LLM call. */
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
}

const DEFAULT_BATCH_SIZE = 25;

export interface RunDiscoveryOutcome extends DiscoveryResult {
  batchesRun: number;
  batchesTotal: number;
}

/**
 * Run discovery over conversations in sequential batches, aggregating results.
 * Stops at the first failing batch (an auth or provider outage would fail every
 * subsequent call too) but keeps everything persisted by earlier batches; the
 * failure is reported as a warning on the aggregate outcome.
 */
export async function runDiscoveryInBatches(
  conversations: StoredConversation[],
  config: DiscoveryConfig,
  options: RunDiscoveryOptions = {}
): Promise<RunDiscoveryOutcome> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const batches: StoredConversation[][] = [];
  for (let i = 0; i < conversations.length; i += batchSize) {
    batches.push(conversations.slice(i, i + batchSize));
  }

  const outcome: RunDiscoveryOutcome = {
    projectsCreated: 0,
    projectsMatched: 0,
    associationsCreated: 0,
    associationsSkipped: 0,
    objectsCreated: 0,
    warnings: [],
    batchesRun: 0,
    batchesTotal: batches.length,
  };

  for (const batch of batches) {
    try {
      const result = await discoverProjects(batch, config);
      outcome.projectsCreated += result.projectsCreated;
      outcome.projectsMatched += result.projectsMatched;
      outcome.associationsCreated += result.associationsCreated;
      outcome.associationsSkipped += result.associationsSkipped;
      outcome.objectsCreated += result.objectsCreated;
      outcome.warnings.push(...result.warnings);
      outcome.batchesRun++;
      options.onProgress?.(outcome.batchesRun, batches.length);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome.warnings.push(
        `Stopped after batch ${outcome.batchesRun} of ${batches.length}: ${message}`
      );
      break;
    }
  }

  return outcome;
}
