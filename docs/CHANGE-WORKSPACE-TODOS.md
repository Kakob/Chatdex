# Change Workspace — TODOs

Companion to `docs/SPEC-change-workspace.md` and `docs/CHANGE-WORKSPACE-BUILD-LOG.md`. Two lists: things **Jacob** has to do (Claude Code can't), and the running engineering checklist per milestone. Check items off in place; Claude Code updates the engineering list every session.

---

## 🧑 User todos (Jacob)

- [ ] **Spec — read §2 laws and §21 decisions** and object now if any of D1–D11 is wrong; they become binding once CW-0 lands.
- [ ] **CW-0 — no deploy action.** No backend change; frontend can ship on its own. (Contrast with IT-0.)
- [ ] **CW-1 — first index of `Kakob/Chatdex`.** Needs the GitHub token + repo binding from IT-3. Confirm the first-index disclosure ("Chatdex stores a read-only copy of these files on this device") reads correctly, and check Settings → "Clear repository cache" actually empties `repoFiles` (DevTools → Application → IndexedDB → `chatdex` → `repoFiles`).
- [ ] **CW-3 — pick a real change to run the loop on.** The spec's §18 scenario uses "search result should scroll to the matching message"; substitute any real Chatdex bug you're about to fix in Claude Code, then import that session's JSONL so it can be attached as the implementation.
- [ ] **CW-6 — run the human-led §18 scenario** end-to-end on real data and answer the qualitative question: a week later, can you answer PRD §2's ten questions from the workspace alone?
- [ ] **CW-6 — second-device check**: the workspace syncs; `repoFiles` and `inspections` must **not** appear on the other device.
- [ ] **Decision — sync the inspection log?** v1 is local-only (D9). After using it, decide whether PRD §17 counts should follow you across devices (that's a new disclosure — behavioral data in ciphertext).
- [x] **Decision — CW-7 timing.** The Sept-1 ship doc was retired 2026-08-28; CW-7 is no longer gated (D10 superseded).
- [ ] **CW-7 — run the AI-led §18 scenario.**
- [ ] **CW-8 — local directory (Chrome only).** Pick a local clone via Settings; confirm "Forget directory" works and that the picker refuses oversized roots (don't pick `~`).
- [ ] **Later — CSP for the hosted origin** (audit S1; shared with Intent Trace S1). Still the real fix for credentials-at-rest and cached-files-at-rest on Vercel.

---

## 🛠 Engineering checklist (Claude Code)

### Spec
- [x] `docs/SPEC-change-workspace.md`, `docs/PRD-code-ownership-loop.md`
- [x] `docs/README.md` row, `CLAUDE.md` "Next up" pointer
- [x] Build log + this file

### CW-0 — types, lifecycle, local-only tables
- [x] `src/types/evidence.ts` (`EvidenceKind`, `EvidenceItem` union, caps)
- [x] `src/types/preparedChange.ts` — widened `state`, optional sections, `Criterion` / `TraceNode` / `TraceEdge` / `Hypothesis` / `Implementation` / `VerificationRow`, top-level lifecycle Dates
- [x] `src/types/understanding.ts` — `UnderstandingEvent.codeEvidence?`
- [x] `src/types/repo.ts` — `RepoFileRow`, `InspectionRow`
- [x] `src/lib/prepare/editability.ts`, `src/lib/prepare/lifecycle.ts`
- [x] `src/lib/prepare/changes.ts` — relaxed creation, either/or validation, draft patch for `intent` / `criteria`
- [x] Dexie v12 `repoFiles` + `inspections`; `src/lib/db/repoFiles.ts`, `src/lib/db/inspections.ts`; `clearAllData()`
- [x] `src/lib/sync/serializer.ts` — revive `implementingAt` / `verifiedAt` / `closedAt`
- [x] Boundary guard extended (S10)
- [x] Tests: lifecycle, editability, changes, serializer identity + S9, Dexie v12 + S1
- [x] Build-log row + commit hash (`a704ee0`)

### CW-1 — repository search
- [x] `src/lib/repo/{sources,githubSource,index,search}.ts` + tests (S8, S4, S1 gate)
- [x] Evidence section UI (`src/components/prepare/EvidenceSection.tsx`), index banner + on-device disclosure, Settings "Clear repository cache"
- [x] Build-log row + commit hash (`d6cd057`)

### CW-2 — trace
- [x] `src/lib/prepare/trace.ts` (`deriveEdgeVerification`, `traceSummary`, structure ops), `TraceSection` list editor, RTL tests (S6)
- [x] Build-log row + commit hash (`3e1d106`)

### CW-3 — hypothesis + implementation
- [x] `HypothesisSection` with freeze display; `compareCommits` / `getPullFiles` / `compareUrl` / `pullUrl`; `implementation.ts` (session / PR / compare / pasted diff, `capPatches`); `ImplementationSection`; tests (S2, S4, S6, S7, freeze law)
- [x] Build-log row + commit hash (`1ae29c2`)

### CW-4 — verification
- [x] `verification.ts` (`deriveVerificationHint`, summary, session test-run discovery, manual/transcript `test_runtime` evidence), `VerificationSection` matrix, `markVerified` gate, tests
- [x] Build-log row + commit hash (`8cdfc86`)

### CW-5 — learned, promote, questions
- [x] `promote.ts` (promotion → accepted user object + `introduced` event with `codeEvidence`; questions), `LearnedSection` + Close, `PromoteSection`, `QuestionsSection`, `?question=` seeding, tests
- [x] Build-log row + commit hash (`48c989e`)

### CW-6 — sections, Guided menu, history, inspections
- [x] Page split into sections + `WorkspaceRail`; `IntentSection`; `GuidedActionMenu` + `guided.ts` + `prepareWorkspaceStore`; `WorkspaceTimeline` + Investigate History tab; `FromWorkspaceLine`; inspection writes; Guided constraint test; RTL page test
- [ ] Build-log row + commit hash

### CW-7 — Assisted mode
- [ ] Actions + disclosures; `aiSuggested`; tests (S3, S5)

### CW-8 — local directory
- [ ] `localDirSource.ts`, Settings entry, tests (S11)
