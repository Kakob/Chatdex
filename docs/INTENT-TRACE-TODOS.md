# Intent Trace — TODOs

Companion to `docs/SPEC-intent-trace.md` and `docs/INTENT-TRACE-BUILD-LOG.md`. Two lists: things **Jacob** has to do (Claude Code can't), and the running engineering checklist per milestone. Check items off in place.

---

## 🧑 User todos (Jacob)

> ⚠️ **Deploy the backend before the frontend for IT-0.** IT-0 adds `intent_trace` to the backend sync `KindSchema` (`backend/src/routes/sync.ts`). If the frontend ships first, every sync push containing a trace is rejected with **400** — the build log records this exact failure once before (see `docs/INTENT-TRACE-BUILD-LOG.md` operational notes). Order: deploy backend → verify `/api/sync` accepts the new kind → deploy frontend.

- [ ] **IT-0 — deploy backend first** (see warning above), then frontend.
- [ ] **IT-3 — create a GitHub token for Chatdex.** Fine-grained PAT, repository access limited to `Kakob/Chatdex`, permissions **Contents: Read** + **Metadata: Read**, expiry ≤ 90 days. (Quick start: `gh auth token` works but is a classic token and will show the "over-privileged" warning.) Paste it in Settings → GitHub → Test.
- [ ] **IT-3 — bind the repo** on the Chatdex project: Intent Trace tab → `Kakob/Chatdex` → Validate → Save.
- [ ] **IT-5 — run the manual acceptance scenario** (spec §16, 7 steps) on real data and answer the qualitative question: did the matrix surface at least one intent you'd forgotten, and did its evidence confirm it without further searching?
- [ ] **IT-5 — check the second-device behaviour**: intents and traces should sync; the GitHub token must **not** appear on the other device.
- [ ] **Any run — pick the provider deliberately.** The OpenAI/Codex subscription path adds ~14k tokens per call; prefer Anthropic for extraction over a large project.
- [ ] **Later — CSP for the hosted origin** (spec §13 S1). Not part of this track, but it is the real fix for credential-at-rest exposure on Vercel.

---

## 🛠 Engineering checklist (Claude Code)

### IT-0 — schema, types, sync plumbing
- [x] `src/types/intentTrace.ts`
- [x] `UnderstandingObject.meta?`, `UnderstandingProject.repository?` + `lastIntentExtractedAt?`; `CreateUnderstandingObjectInput.meta?` passthrough
- [x] Dexie v11 `intentTraces`; `src/lib/db/intentTraces.ts`; `clearAllData()`
- [x] Sync: `SyncKind` + serializer + engine (apply / delete / cascade / resync) + backend `KindSchema`
- [x] Tests: Dexie round trip, serializer identity, engine cascade, envelope cleartext fields (S9)
- [x] Build-log row

### IT-1 — pairs + heuristic
- [x] `intents/pairs.ts`, `intents/heuristic.ts`, fixtures, recall + timing tests (S8)

### IT-2 — extraction
- [x] `intents/extraction.ts`, `intents/runExtraction.ts`, `getAssociatedConversations` refactor, panel exclusion, tests

### IT-3 — GitHub
- [x] `github/credentials.ts` (device-local: `isDeviceLocalMetadata` matches `github.`), `github/client.ts`, `GitHubSection`, `RepoBindingCard`, tests (S1/S2)

### IT-4 — trace engine
- [x] `trace/specDocs.ts`, `candidateFiles.ts`, `fetchPolicy.ts`, `judge.ts`, `runTrace.ts`, tests (S3/S4/S5/S7)

### IT-5 — UI
- [ ] `IntentTracePage`, table/row, tab + route, `DisclosureModal.title`, RTL tests (S6), guard test (S10)

### IT-6 — polish + docs
- [ ] Commit evidence, re-trace / add-file, warnings panel
- [ ] `CLAUDE.md` invariant-6 wording, `docs/SEPTEMBER-1-SHIP.md` wording, `docs/INTENT-TRACE-BUILD-LOG.md` rows
