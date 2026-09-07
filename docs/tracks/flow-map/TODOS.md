# Flow Map — TODOs

Companion to `docs/tracks/flow-map/SPEC.md` and `docs/tracks/flow-map/BUILD-LOG.md`. Two lists: things **Jacob** has to do (Claude Code can't), and the running engineering checklist per milestone. Check items off in place; Claude Code updates the engineering list every session.

---

## 🧑 User todos (Jacob)

- [ ] **Spec — read §2 laws and §21 proposed decisions** and confirm or change D1–D10; they become binding once FM-0 lands. The two that most shape the build: D1 (derived map is local-only, only kept flows sync) and D4 (heuristic links export to traces with no evidence, so they show as `unknown`).
- [ ] **Spec — confirm the v1 target is Chatdex itself** (profile `react-vite-fastify`, D3/D7). If another repository matters first, name it now so the fixture tree and self-atlas test are built for that stack.
- [ ] **FM-0 — no deploy action.** No backend change in any milestone.
- [ ] **FM-2 — sanity-check the self-atlas numbers** once they exist (route count should equal the `<Route path` count in `src/App.tsx`; `POST /api/sync/push` must be linked from the sync engine).
- [ ] **FM-3 — first browser look** at the Chatdex map; note which flows look wrong or missing before FM-4 builds bridges on top of them.
- [ ] **FM-4 — run the Guided §18 scenario** and do the territory comparison against `docs/territories/unlock-the-vault.md`; the qualitative question is whether the tab alone gets a newcomer to the seven core territories' entry points.
- [ ] **FM-4 — second-device check:** a kept flow syncs; `flowMaps` must **not** appear on the other device.
- [ ] **FM-5 — run the Assisted §18 scenario.**
- [ ] **Decision (after use) — flow diff between shas** is the first deferred item (§20); decide whether it becomes FM-6.

---

## 🛠 Engineering checklist (Claude Code)

### Spec
- [x] `docs/tracks/flow-map/SPEC.md`
- [x] `docs/README.md` row, `CLAUDE.md` pointer
- [x] Build log + this file
- [ ] Commit after Jacob confirms §21

### FM-0 — types, registry, config, local-only table, fixtures
- [ ] `src/types/flowmap.ts`
- [ ] `src/lib/flowmap/{registry,config,ids}.ts`
- [ ] Dexie v14 `flowMaps` + helpers; `clearAllData`; cache-eviction hook-up
- [ ] Fixture tree `src/test/fixtures/flowmap/react-vite-fastify/`
- [ ] Tests: determinism, S1 sync-absence, S8 pattern safety, S10 guard

### FM-1 — front-end recognizers
- [ ] `react-router.route`, `react.component`, `react.action`, `react.hook`, `zustand.store`, `es.import`
- [ ] Golden + false-positive fixtures per rule

### FM-2 — back-end / data recognizers, linker, derivation
- [ ] `http.request`, `fastify.endpoint`, `dexie.table`, `worker.spawn`
- [ ] `link.ts`, `derive.ts`, fog, coverage, `flowSummary`
- [ ] Self-atlas test over the real repository (< 3 s)

### FM-3 — Flows tab
- [ ] `/projects/:id/flows`, generate / regenerate, route tree, step list, fog panel, Overview card, Settings note

### FM-4 — bridges + Guided constraint
- [ ] Keep flow (`type: 'flow'` object + `codeEvidence`), Open as trace, Discussed in, Guided menu entry
- [ ] Guided constraint test: zero `fetch`

### FM-5 — Assisted naming
- [ ] Suggest names / Suggest groups behind `DisclosureModal`; parse firewall; `nameHistory`
