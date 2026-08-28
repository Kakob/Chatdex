// Local-first storage barrel.
// Every read/write of user data should go through this module — IndexedDB is
// the source of truth. Cloud sync (Phase 2) will replicate from here.

export { db, type ChatdexDB, type KnowledgeFolderRow } from './schema';
export * from './conversations';
export * from './messages';
export * from './activities';
export * from './anchors';
export * from './tags';
export * from './folders';
export * from './dailyStats';
export * from './metadata';
export * from './findings';
export * from './detectorRuns';
export * from './understanding';
export * from './rawSources';
export * from './investigationAnchors';
export * from './investigationCases';
export * from './preparedChanges';
export * from './intentTraces';

import { db } from './schema';

export async function clearAllData(): Promise<void> {
  await db.transaction(
    'rw',
    [
      db.conversations,
      db.messages,
      db.activities,
      db.anchors,
      db.tags,
      db.entityTags,
      db.knowledgeFolders,
      db.dailyStats,
      db.metadata,
      db.findings,
      db.detectorRuns,
      db.understandingProjects,
      db.projectAssociations,
      db.understandingObjects,
      db.understandingEvents,
      db.rawSources,
      db.investigationAnchors,
      db.investigationCases,
      db.caseExhibits,
      db.reviewScopes,
      db.verdictRevisions,
      db.preparedChanges,
      db.investigationFindings,
      db.intentTraces,
    ],
    async () => {
      await db.conversations.clear();
      await db.messages.clear();
      await db.activities.clear();
      await db.anchors.clear();
      await db.tags.clear();
      await db.entityTags.clear();
      await db.knowledgeFolders.clear();
      await db.dailyStats.clear();
      await db.metadata.clear();
      await db.findings.clear();
      await db.detectorRuns.clear();
      await db.understandingProjects.clear();
      await db.projectAssociations.clear();
      await db.understandingObjects.clear();
      await db.understandingEvents.clear();
      await db.rawSources.clear();
      await db.investigationAnchors.clear();
      await db.investigationCases.clear();
      await db.caseExhibits.clear();
      await db.reviewScopes.clear();
      await db.verdictRevisions.clear();
      await db.preparedChanges.clear();
      await db.investigationFindings.clear();
      await db.intentTraces.clear();
    }
  );
}
