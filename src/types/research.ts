/** Research bytes and registry live only in IndexedDB; never in sync. */
export interface ResearchTime {
  value: string;
  precision: 'unknown' | 'exact' | 'day' | 'month' | 'year' | 'approximate' | 'range';
}
export interface ResearchSource {
  id: string;
  projectId: string;
  title: string;
  kind: string;
  attribution: string;
  uri: string;
  authored: ResearchTime;
  eventTime: ResearchTime;
  notes: string;
  locator: string;
  access: 'reference-only' | 'imported';
  privacy: 'private-local';
  registeredAt: Date;
  conversationId?: string;
  registryId?: string;
}
export interface ResearchSnapshot {
  id: string;
  sourceId: string;
  contentHash: string;
  text: string;
  filename: string;
  importedAt: Date;
  /** Document text is exact; conversation text uses existing normalized events. */
  format: 'text' | 'conversation';
  segments?: { start: number; end: number; role: string; messageId: string; expressedAt: string }[];
}
export interface ResearchExhibit {
  id: string;
  caseId: string;
  sourceId: string;
  snapshotId?: string;
  sourceHash?: string;
  start?: number;
  end?: number;
  quote: string;
  quoteHash?: string;
  role: string;
  expressedAt: ResearchTime;
  note: string;
  locator?: string;
  createdAt: Date;
}
export const RELATIONS = ['refined', 'narrowed', 'branched', 'challenged', 'combined', 'superseded'] as const;
export interface QuestionRelation {
  id: string;
  projectId: string;
  from: string;
  to: string;
  kind: typeof RELATIONS[number];
  explanation: string;
  tentative: boolean;
  action: 'add' | 'remove';
  replacesId?: string;
  createdAt: Date;
}
