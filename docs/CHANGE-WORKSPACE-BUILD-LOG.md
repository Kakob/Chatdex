# Change Workspace — Build Log

Companion to `SPEC-change-workspace.md` (the authoritative spec) and
`CHANGE-WORKSPACE-TODOS.md` (user-side actions + engineering checklist). Records
what was actually built per milestone, plus operational notes that affect
deployment. One milestone per session; each row lands with typecheck + lint +
tests green.

| Milestone | Date | Commit | Summary |
|---|---|---|---|
| Spec | 2026-08-28 | `4425b0b` | `docs/SPEC-change-workspace.md` (laws §2, data model §7–§12, audit §15 S1–S12, milestones CW-0…CW-8, decisions D1–D11); `docs/PRD-code-ownership-loop.md` (Jacob's draft, verbatim); README + CLAUDE.md pointers; this log + todos |
| CW-0 | 2026-08-28 | `a704ee0` | Workspace schema: `EvidenceItem` union (`src/types/evidence.ts`), `PreparedChange` sections + widened `state` (draft→ready→implementing→verified→closed), `UnderstandingEvent.codeEvidence?`, per-section editability table, lifecycle (`attachImplementation` freezes the open hypothesis, `markVerified` gate, `closeWorkspace`), relaxed creation (intent OR accepted understanding, D7), criteria↔acceptanceCriteria mirror, Dexie v12 LOCAL-ONLY `repoFiles` + `inspections` with helpers, serializer revives lifecycle Dates (nested ISO, D11), S10 guard extended, S1 sync-absence test |
| CW-1 | 2026-08-28 | `d6cd057` | Repository search: `src/lib/repo/` — `RepoSource` interface, GitHub source over the hardened client, resumable indexer into LOCAL-ONLY `repoFiles` (fetch-gate denylist + excluded dirs before caching, 200 KB / 2000 files / 50 MB caps, rate-limit stop with retry time, `shouldStop`), pure `grep` / `findSymbol` / `findReferences` with context lines, path globs, hit cap, regex safety pre-check + per-file time budget (S8), `buildCodeEvidence` (scrubbed, capped, hashed quote — S4); Evidence section on the Prepare Change page (index banner with on-device disclosure, search modes, add-as-evidence, manual line range, evidence list with validated blob links); Settings → GitHub "Clear repository cache" |
| CW-2 | 2026-08-28 | `3e1d106` | Trace: `src/lib/prepare/trace.ts` — `deriveEdgeVerification` (contradicted override > mechanical ⇒ verified > hypothesis > AI ⇒ ai_inference > unknown; D4), `deriveNodeSupport`, `traceSummary`, pure structure ops (main sequence + branches + `???` unknown nodes, `reconcileEdges` keeps one edge per adjacency and preserves claims/evidence, add/insert-after/move/remove-subtree/update, contradiction requires a note, `pruneEvidenceRefs`); `TraceSection` list editor on Prepare Change (kind/label rows, evidence pickers on nodes and edges, derived chips, branch/unknown insertion, explicit Save through `updateTrace`, read-only when frozen); `evidenceLabel` helper; RTL tests incl. `<script>` label (S6) |
| CW-3 | 2026-08-28 | `1ae29c2` | Hypothesis + Implementation: `HypothesisSection` (PRD §12 template, open hypothesis editable, frozen ones shown with timestamps); GitHub client `compareCommits` / `getPullFiles` / `compareUrl` / `pullUrl` / `assertRef` (validated refs, host-constant, S2/S6 tests); `src/lib/prepare/implementation.ts` — attach from compare, PR, ingested Claude Code session (per-file stats from `investigationAnchors`, provenance defaults `ai`), or pasted unified diff (git + plain `diff -u` parser); `capPatches` scrubs secrets and enforces 20 KB/file + 200 KB/workspace (S4/S7); `ImplementationSection` with source tabs, provenance + note, patch-text opt-out, attached summary with validated links; attach freezes the open hypothesis and auto-readies a draft (AI-led path) |
| CW-4 | 2026-08-28 | `8cdfc86` | Verification: `src/lib/prepare/verification.ts` — rows per criterion, `deriveVerificationHint` (suggests only; AI-only ⇒ unverified, failing run ⇒ contradicted, pass+fail ⇒ partial, code/history only ⇒ partial), `verificationSummary` with blocking list, test-run discovery in ingested Claude Code sessions (`findTestRunSteps` over normalized steps: test/typecheck/lint/build commands paired with results, outcome classified), transcript + manual `test_runtime` evidence builders (scrubbed, capped, hashed); `VerificationSection` matrix (human status select, hint, attach existing / record observation / attach a session run to a criterion, notes, Mark verified gated on unverified-without-note); RTL test |
| CW-5 | 2026-08-28 | _pending_ | Learned / Promote / Questions / Close: `src/lib/prepare/promote.ts` — `promotionCandidates` (mechanical evidence + verified edges only), `promoteFromWorkspace` (user-origin accepted object of type belief/decision/constraint; `introduced` event carries conversation `EvidenceRef`s + `codeEvidence`; edge claims appended to the body; `promotions[]` recorded), `createWorkspaceQuestion` (type `question`, linked both ways), loaders; `CreateUnderstandingObjectInput.codeEvidence`; `LearnedSection` (human text, AI suggestion in a separate slot, Close workspace gated on saved text), `PromoteSection` (pick evidence/edges, write the belief, promote; promoted list links to Current Understanding), `QuestionsSection` (add/list, "start a workspace from this" → `/prepare?question=<id>` seeds title + `originRef` + link); tests |

---

## Operational notes

### No backend change for CW-0

The workspace extends the existing `prepared_change` sync kind; no new
`KindSchema` entry, so there is **no deploy-order constraint** (unlike IT-0).
Older frontends that receive a grown payload keep the unknown fields through
the serializer spread and simply don't render them.

### Local-only tables (Dexie v12)

`repoFiles` (whole-file cache for search) and `inspections` (view log) are
LOCAL-ONLY by law §2.5 / decision D3 / D9. They must never be added to the
sync engine's table list; a test asserts this (audit S1).
