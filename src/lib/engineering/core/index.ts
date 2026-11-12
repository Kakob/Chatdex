/** Public, UI-agnostic engineering source-analysis API. */
export { analyzeTypeScript } from './analyzeTypeScript';
export {
  ANALYZER_VERSION, fingerprintText, normalizeSnapshot, snapshotFingerprint, validateSourcePath,
} from './contracts';
export type {
  SourceFile, SourceSnapshot, SourceEntity, SourceEntityKind,
  SourceRelation, SourceRelationKind, SourceLocation,
  AnalyzerDiagnostic, AnalyzedSourceFile, DerivedGraph,
} from './contracts';
