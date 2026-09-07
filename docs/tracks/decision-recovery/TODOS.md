# Decision Recovery — TODOs

Companion to `docs/tracks/decision-recovery/SPEC.md` and `docs/tracks/decision-recovery/BUILD-LOG.md`. Two lists: things **Jacob** has to do (Claude Code can't), and the engineering checklist per milestone. Check items off in place.

---

## 🧑 User todos (Jacob)

> ⚠️ **Deploy the backend before the frontend for DR-1.** DR-1 adds `decision_trace` to the backend sync `KindSchema`. If the frontend ships first, every sync push containing a trace is rejected with **400**.

- [ ] **DR-1 — deploy backend first**, then frontend. Run `npm run db:push` against Neon for the new enum value if the kind column is an enum there.
- [x] **DR-6 — dogfood session produced** as a subagent run on `demo/project-deletion` (commit `9987455`, not pushed, not merged). To recover against the code it produced in the browser, `git push -u origin demo/project-deletion` and bind `Kakob/Chatdex` at `9987455` — or bind the local directory with that branch checked out.
- [ ] **DR-6 — walk the manual acceptance scenario** (spec §16, 9 steps): import `~/.claude/projects/-Users-jacie-dev-apps-chatdex/a5f18574-47b5-4d93-9059-985596769160/subagents/agent-a91bb13ba13341110.jsonl` (or the whole session folder) via the Import page, associate it with the Chatdex project, bind the repo, Recover, and compare the live split with the fixture's 2/1/3/1.
- [ ] **DR-6 — decide the fate of the demo branch**: keep unmerged (recommended) or land project deletion deliberately through the replacement-change flow. Recon P5 (three divergent delete cascades) applies.
- [ ] **Known gap — branch binding.** `resolveSnapshot` ignores the bound ref and uses the most recently indexed snapshot (`latestCachedSnapshot` is branch-blind), so DR-6 recovery can silently run against the wrong branch. Planned fix: `docs/tracks/branch-binding/PLAN.md` (not yet implemented).
- [x] **DR-7 — subagent transcript layout confirmed from a real session:** sibling files under `~/.claude/projects/<dir>/<sessionId>/subagents/agent-<id>.jsonl`, every entry `isSidechain: true` with `agentId`, carrying the PARENT's `sessionId` and `cwd`. Parser 1.2.0 handles them (own conversation id, `providerMeta.parentSessionId`).
- [ ] **Any run — pick the provider deliberately.** OpenAI/Codex subscription adds ~14k tokens per call; prefer Anthropic.
- [ ] **Later — approve Flow Map §21** so reverse-traversal blast radius can replace the text-level v1.

---

## 🛠 Engineering checklist (Claude Code)

### DR-0 — spec + docs
- [x] `docs/tracks/decision-recovery/SPEC.md`
- [x] Build log, this file, `docs/README.md` row, `CLAUDE.md` "Next up"
- [x] Flow Map draft → Dexie v14

### DR-1 — types, storage, sync, deterministic capture
- [x] `src/types/decision.ts`
- [x] Dexie v13: `decisionTraces` (synced), `agentInspections`, `decisionDiffs` (local); `clearAllData`; conversation cascade
- [x] `src/lib/db/{decisionTraces,agentInspections,decisionDiffs}.ts`
- [x] Sync kind `decision_trace`: `syncApi.ts`, `serializer.ts`, `engine.ts` (remove / apply / read / full-push / hooks / parent cascade), backend `KindSchema` + Drizzle enum
- [x] `src/lib/investigation/agentInspections.ts` deriver + backfill + import hook
- [x] `src/lib/understanding/decisions/sessionCommits.ts`
- [x] Tests: local-only guard (verno 13), serializer round trip, engine coverage, deriver, commits
- [x] Build-log row

### DR-2 — recovery pipeline
- [x] `candidates.ts`, `prompt.ts`, `firewall.ts`, `runRecovery.ts`, `symbols.ts`, `decisionMatrix.ts`, `fromInvestigation.ts`
- [x] Tests: firewall downgrades, madeBy, offsets, re-recognition, `assertNoSecrets`, plan-before-call

### DR-3 — Decisions tab + detail
- [x] Routes, tab, `DecisionsPage`, `BasisBadge`, `DecisionDetail`, `AssumptionList`, run + disclosure
- [x] Page test

### DR-4 — code links, blast radius, replacement change, challenge
- [x] `blastRadius.ts` + `BlastRadiusPanel`
- [x] `WorkspaceOriginKind 'decision'`, `?decision=` seeding, `FromWorkspaceLine` label
- [x] `challenge.ts`
- [x] Tests: blast radius fixture, zero fetch, challenge pending-only

### DR-5 — semantic decision diff
- [x] `diff.ts`, `decisionDiffs` helpers, `DecisionDiffView`, run picker, record-as-contradicted
- [x] Tests: five ops, idempotent id, determinism, local-only

### DR-6 — dogfood demo + fixture
- [x] Session produced (or handed to Jacob), sanitized into `tests/decision-fixtures/`
- [x] Fixture tests; spec §16 confirmed; CLAUDE.md invariant-6 sentence; status → built

### DR-7 — parser v1.2.0 + delegation
- [x] `src/types/claude-code.ts` metadata, `StoredMessage.sourceMeta`, parser bump, sidechain linking, "delegated" labels
- [x] Golden traces unchanged; sidechain fixture
