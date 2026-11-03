# Editable Current Understanding Landscape

Status: Implemented — acceptance pending
Primary capability: [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md)
Builds on: [Understanding Landscape](../understanding-landscape/PLAN.md) (branch `feature/understanding-landscape`)
Affected contracts: Understanding Workspace PRD §13 (amended 2026-11-03: concepts, concept-scoped
chat context), PRD §11 review gate (unchanged; AI rewording added as a pending `refined` event),
native chat U5.2 context injection (concept-scoped variant), CLAUDE.md invariant 6 (applies
unchanged: user-initiated, disclosed, transit-only), invariant 1 (no new sync kind; new fields ride
inside existing ciphertext).
Code walkthrough: [territories/explore-the-landscape.md](../../territories/explore-the-landscape.md).

## Problem

The landscape could only show understanding that already existed, mostly synthesized from
imported conversations. Users could not create and develop understanding directly — name the
parts of a project, nest them, describe how something should work — without first having a
conversation to point at.

## Decisions

1. **A concept is the existing `LandscapeRegion`, not a new record or an understanding object.**
   Regions already had containment (`parentRegionId`), the "about" relation (`memberObjectIds`),
   cycle and cross-project refusal, deletion that keeps findings, and encrypted sync. They assert
   nothing, so creating "Box zoom" never claims it is built. The landscape's original Decision 1
   (no pollution of counts, proposals, or agent context) therefore still holds for the concept itself.
   New optional fields: `body` (description), `kind` (free-text category, suggestions offered), and
   `revisions` (append-only history of title/summary/body/kind/parent changes). Unindexed, so **no
   Dexie version bump and no migration**; older rows simply have no `revisions`.
2. **Statements about a concept are ordinary understanding objects.** Four sections write four
   open-ontology types: Intended behavior `behavior`, Current beliefs & observations `belief`,
   Open questions `question`, Decisions `decision`; anything else placed there shows under
   "Other linked understanding". They are `origin: 'user'`, accepted, evidence optional — so they
   appear in Current Understanding, Prepare Change, and project chat context with no duplication.
   Intents stay with Intent Trace (refused here).
3. **Intended vs believed vs verified vs uncertain** is shown per statement (`supportOf()`):
   "Your statement · unverified", "Backed by reviewed sources", "Code or test evidence attached",
   "AI proposal · awaiting your review", or historical. Evidence is never described as proof.
4. **Rewording keeps history.** `UnderstandingEvent.revision` {title, body, previousTitle,
   previousBody} on a `refined` event. User edits (`reviseUnderstandingObject`) apply immediately.
   AI rewordings are pending and apply only on Accept; their baseline is the wording sent
   to the provider, not a fresh read when the response arrives. Accept is refused if the object changed
   after the provider request began (the reviewer must Edit & accept against current wording, or Reject).
   Edit & accept preserves the complete original proposal in `originalRevision`; the finding
   history exposes its original title/details alongside the applied revision. This optional field
   uses the existing encrypted event payload and needs no database migration.
   Editing a pending AI object is only possible through review (Edit & accept → `edited`, with the
   AI's wording kept as a user `refined` event). Region `revisions` coalesce free-text saves within
   2 minutes; renames, kind changes, and moves never coalesce.
5. **AI collaboration reuses native chat.** "Discuss with AI" opens `/chat?project=P&concept=R`.
   The chat stores `conceptId` in `providerMeta` and sends `buildConceptContext()` instead of the
   whole-project document: concept path, its description, its accepted current statements, sub-
   concept names, accepted statements of enclosing concepts (≤ 4 each), and *titles* of linked
   conversations (never their content). Pending, rejected, historical, and other-project records are
   excluded (tested). Budget ~3000 tokens, shrinking in stages. The context panel shows the exact
   prompt; the existing disclosure modal gates the first send.
6. **Proposals land in review.** "Propose concept updates" (concept chats only) sends the chat
   transcript and the concept packet in one disclosed call (`lib/landscape/proposals.ts`). `add`
   proposals become pending AI objects placed in the concept; `revise` proposals become pending
   `refined` events on the concept's accepted statements. Evidence is the chat itself, message-
   anchored where the model cites indexes. Review happens in the concept panel or the finding
   inspector (Accept / Edit & accept / Reject), or in Current Understanding as before. This is a
   concept-scoped sibling of U6.1 reconciliation, not a replacement: reconcile still works on the
   same chat.
7. **Prepare Change from a concept** uses the existing preselect-only `?understanding=` link with
   the concept's (and sub-concepts') accepted, current records.

## What shipped

- Map: "+ Add concept" (project scene) and "+ Add inside X" (concept scene) inline creation;
  "Develop “X” →" opens the concept panel (`panel=concept`, URL-backed, Back/Escape closes it).
  Empty project/concept scenes explain what to do instead of "nothing synthesized".
- Concept panel (`components/landscape/ConceptPanel.tsx`): rename, kind, summary, description
  (⌘/Ctrl+Enter saves, Esc discards), four statement sections with inline add, pending proposals
  with review controls, sub-concepts with inline add, link existing records (search + Place here),
  move into any valid parent / reorder, concept history, two-step delete, Discuss with AI, Prepare
  Change.
- Finding inspector: Edit wording (user-origin rewording), review controls for pending objects and
  pending events, rewording shown in the history ("old" → "new").
- Chat: concept chip linking back to the concept, concept-scoped context panel and disclosure copy,
  "Propose concept updates" button with its own disclosure.
- Wording across the landscape: regions are called concepts.

## Verification (2026-11-03)

Automated: `npm run typecheck`, `npm run lint`, `npm test` (137 files / 1109 tests; baseline was
134 / 1089), `npm run build`. New tests:
- `src/lib/db/concepts.test.ts` — hierarchy with no conversation; revision history per field;
  coalescing rules; cycle / self / cross-project refusal; delete keeps statements and lifts
  sub-concepts; user statements have no evidence and are accepted; linking an existing AI record
  (tile licensing decision) leaves the object and its events byte-identical with no duplicate; user
  rewording; AI rewording pending → accepted / stale refusal / edited; pending objects cannot be
  edited by a side door; serializer round-trip of revisions.
- `src/lib/landscape/concept.test.ts` — context packet contents and exclusions (pending, rejected,
  other project, conversation body, foreign conversation ids), budget, null for virtual/foreign
  concepts, support labels, grouping; proposal parsing; proposal pass writes pending chat-cited
  rows into the concept and changes accepted wording only on review.
- `src/lib/landscape/route.test.ts` — `panel=concept` only on real concepts, Back closes it first.
- `src/pages/LandscapePage.test.tsx` — the Atlas Maps hierarchy built through the UI (keyboard
  entry, three levels, breadcrumbs, description, intended behavior, link an existing AI-origin
  record, reparent and move back), remount from storage, stored tree equals the target,
  existing record untouched, statement visible to Current Understanding, zero conversations;
  Escape cancels an inline add and returns focus.

Browser (Chrome, dev server on an **isolated origin** `localhost:4001` — separate empty IndexedDB,
no sync key, nothing written to real data): created a test project, built a three-level concept
tree (four top-level concepts, three per level below) with Enter, wrote a description and an intended behavior, opened Discuss
with AI (context panel showed the concept packet, ~274 tokens; no provider configured so nothing
was sent), hard-reloaded the concept URL and confirmed tree, description, history, and statement
from IndexedDB. Found and fixed one bug the jsdom test could not: the inline field was disabled
while saving, which drops focus in a real browser, so the next keystrokes were lost and Escape
stepped the landscape out a level.

## Open acceptance checks

- [ ] A real concept discussion with a provider: send with concept context, Propose concept
      updates, Accept / Edit & accept / Reject in the concept panel (covered by unit tests with a
      mocked provider only — no provider on the test origin).
- [ ] The Atlas Maps walkthrough on real data, including linking the real Tile licensing decision
      record (not done: it would write synced records without your go-ahead).
- [ ] Phone-width layout of the map toolbar and concept panel.
- [ ] Screen-reader pass of inline add and the concept panel.
- [ ] Two-device concept edits (last-writer-wins per region row also applies to `revisions`).

## Limitations

- Concept `revisions` live inside the region row, so two devices editing one concept concurrently
  can drop one side's revision entries along with its edit (existing LWW semantics).
- No drag-to-reparent; moving uses the "Move into" menu. Reordering is ↑/↓.
- AI proposals cannot edit a concept's own description or structure — only statements in it.
- Concept chats keep the conceptId even if the concept is later deleted; they fall back to the
  project context then.
- Prepare Change receives the concept's records as a preselect only; the concept itself is not
  recorded on the prepared change.
- No code/test linking per concept beyond what Change Workspace already promotes as code
  evidence (Priority 3 left mostly for later).

## Review correctness follow-up (2026-11-03)

- Fixed stale acceptance when a user edits a statement while a concept proposal request is in
  flight: proposals retain the request-time title/body baseline, and ordinary Accept refuses a
  mismatch. Edit & accept remains an explicit reconciliation against current wording.
- Fixed loss of original AI revision wording during Edit & accept: the original revision is
  preserved separately, including its baseline and proposed details, and is visible in the
  finding history. Existing event evidence and the applied before/after revision are retained.
- Regression coverage: both title and body edits during provider completion; rejected stale
  accepts leave wording/review state intact; explicit edited acceptance; original proposal
  preservation through sync serialization; UI edit/review/history after remount.
- Live provider and real-browser acceptance remain pending; this follow-up uses isolated tests.
- Validation: typecheck, lint, and build passed; 22 focused concept/storage/UI tests and all
  10 external Precedent acceptance probes passed. The full suite passed 1,111/1,112 tests;
  the same pre-existing `investigation/constraints.test.ts` invalid-span failure observed on
  main recurred. Browser/provider acceptance is not claimed by these results.
