// Understanding Landscape organization (docs/changes/understanding-landscape).
//
// A region is a user-editable *navigational container* inside one project:
// a place on the landscape that holds references to understanding objects.
// It is deliberately NOT an UnderstandingObject — regions assert nothing, so
// they never count as claims, never appear in proposals, and never enter
// agent context. Moving a finding between regions, renaming a region, or
// pinning a representative statement changes organization only; the
// object's text, review state, lifecycle status, and evidence are untouched.
//
// Stored plaintext in IndexedDB; syncs as ciphertext (kind 'landscape_region')
// like every other user record. Two-device edits to the same region resolve
// last-writer-wins on the whole row, the engine's existing record semantics.

export interface LandscapeRegion {
  id: string;
  /** Owning UnderstandingProject. Regions never span projects. */
  projectId: string;
  /** Optional parent region in the same project; null for a top-level region. */
  parentRegionId: string | null;
  title: string;
  /** Optional user-written one-line description shown on the terrain. */
  summary?: string;
  /** Sort key among siblings; lower first. */
  order: number;
  /**
   * UnderstandingObject ids placed in this region. An object may belong to
   * several regions without being copied. Ids that are no longer eligible
   * (deleted, rejected, moved to another project) are ignored by the
   * projection but kept, so a record that syncs back in reappears in place.
   */
  memberObjectIds: string[];
  /** Members the user pinned as the region's representative statements (≤ 2 shown). */
  pinnedObjectIds: string[];
  createdAt: Date;
  updatedAt: Date;
}
