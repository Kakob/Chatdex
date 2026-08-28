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
- [ ] **Decision — CW-7 timing.** Assisted mode is gated to after the September 1 ship (D10). Say when to unblock it.
- [ ] **CW-7 — run the AI-led §18 scenario** (after unblocking).
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
- [ ] Build-log row + commit hash

### CW-1 — repository search
- [ ] `src/lib/repo/{sources,githubSource,index,search}.ts` + tests (S8)
- [ ] Evidence section UI, index banner, Settings "Clear repository cache"

### CW-2 — trace
- [ ] `src/lib/prepare/trace.ts` (`deriveEdgeVerification`, `traceSummary`), list editor, RTL tests (S6)

### CW-3 — hypothesis + implementation
- [ ] Hypothesis section with freeze; `compareCommits` / `getPullFiles`; Claude Code session attach; pasted diff; tests (S2)

### CW-4 — verification
- [ ] Matrix UI, `deriveVerificationHint`, `markVerified` gate, tests

### CW-5 — learned, promote, questions
- [ ] Promotion → understanding object + event with `codeEvidence`; questions; `closeWorkspace`; tests

### CW-6 — sections, Guided menu, history, inspections
- [ ] `src/components/prepare/*Section.tsx` split; Guided action menu; Investigate History timeline; inspection log; Guided constraint test

### CW-7 — Assisted mode *(post-Sept-1)*
- [ ] Actions + disclosures; `aiSuggested`; tests (S3, S5)

### CW-8 — local directory
- [ ] `localDirSource.ts`, Settings entry, tests (S11)
