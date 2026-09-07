# Chatdex Flow Map — Specification

**Status:** Draft — 2026-09-07; not yet approved
**Source PRD:** `docs/tracks/change-workspace/PRD.md` (ownership as evidence of understanding). Also motivated by the hand-built Application Atlas in `docs/territories/` and the ownership program in `docs/ownership/` — this feature is the generated, evidence-backed, always-current form of what those documents do by hand.
**Area:** Project workspace (new tab) / Change Workspace / Current Understanding
**Companions (to be created at the Spec milestone):** `docs/tracks/flow-map/BUILD-LOG.md`, `docs/tracks/flow-map/TODOS.md`

---

## 0. Instructions to Claude Code

Same discipline as `docs/tracks/change-workspace/SPEC.md` §0:

- One milestone (§17) per session. Typecheck + lint + `npm run test:all` green before a row lands in the build log; the build log row and the todos checklist are updated in the same session as the code.
- If a request conflicts with §2, say so and ask rather than silently diverging.
- Do not touch `src/lib/crypto/`, `src/lib/detection/`, or `src/lib/investigation/` (boundary law §2.6). The new module `src/lib/flowmap/` may import `src/lib/repo/**` (cache + search), `src/lib/github/**` (blob links), and the **types and pure functions** of `src/lib/prepare/trace.ts`; nothing imports the other direction.
- Generation makes **no network calls at all** (§2.5, §13). Assisted naming (FM-5) is opt-in and disclosed (§2.7).
- Recognizers are heuristics. Every heuristic rule is a named, versioned, configurable unit with a golden-fixture test (§16). Never "broaden a rule to find more" without adding the false-positive fixture that the broader rule must still reject — the same discipline CLAUDE.md applies to detectors.

---

## 1. Product thesis

A developer cannot own code they cannot locate. The Application Atlas (`docs/territories/`) showed that the useful map of Chatdex is **behavior-first**: what a user can do, where each behavior enters the code, and what it touches on the way down. That map was built once, by hand, at one commit (`63d7012`), and is already stale.

The Flow Map generates that map from the repository itself, pinned to a sha, with a file + line behind every node, and keeps it current by regeneration. It answers three questions from PRD §2 mechanically:

1. **What can a user do here?** — every route, page, and interactive element (a *surface*).
2. **What code does that run?** — the chain from the surface through handlers, stores, hooks, API calls, backend endpoints, and tables (a *flow*).
3. **Where has this been discussed?** — the conversations, intents, findings, and workspaces that reference the files and symbols in that flow.

The map is a **starting point for understanding, never a substitute for it**. It is deliberately honest about its own limits: every link says whether it was *declared* in the code or *matched* by a heuristic, and every unresolved reference is listed as fog rather than dropped (PRD §19, §27).

---

## 2. Non-negotiable product laws

These outrank convenience and speed. §2.1–2.8 are inherited from `docs/tracks/change-workspace/SPEC.md` §2 and restated only where this feature adds a rule.

### 2.1 Provenance law
Every surface and every link carries `repoKey`, `sha`, `path`, and a 1-based line (§8). A surface without a line is a bug in the recognizer, not a data-model option.

### 2.2 Verification vocabulary law
A link is `declared` only when the relation is syntactically explicit on its evidence line (an import naming the file, a `<Route element={<X/>}>`, an `app.post('/push')`). Name-matching across files (a request URL matched to an endpoint pattern, a JSX tag matched to an import, a `db.table.put` classified as a write) is `heuristic`. When a flow is exported to a Change Workspace trace (§12), **only declared links attach edge evidence**; heuristic links export with the rule named in the edge `claim` and no evidence, so `deriveEdgeVerification` yields `unknown` until a human attaches evidence. `trace.ts` is not modified to accommodate this.

AI output (FM-5) is naming and grouping only. It lands as `suggestedName` / `suggestedGroup` and as `ai_inference` provenance on the flow — never as a surface, a link, or a confidence upgrade.

### 2.3 Human-authorship law
Flow names, notes, pins, and "kept" status are human-authored. AI drafts go into a visibly separate suggested slot; accepting copies the text and records `origin: 'ai'` on the name's history.

### 2.4 Determinism law
Generation is a pure function of `(cached file rows, recognizer profile + versions, config)`. Running it twice over the same cache yields a deep-equal map, including surface and link ids (ids are content hashes of `path:line:ruleId:label`, not random). This is the same contract as `livingDocument.ts`.

### 2.5 Read-only repository, local-only derivation law
Identical to Change Workspace §2.5 for the repository. In addition: the **derived map (surfaces + links + derived flows) is LOCAL-ONLY** — a new Dexie table never hooked into sync, recomputable from the cache, cleared with it. What syncs is only what a human kept: a *kept flow* (§7.3) carrying paths, shas, lines, and capped quotes. A private repository's structure never reaches the server unless the user keeps a flow, and then only that flow.

### 2.6 Boundary law
No module under `src/lib/detection/**` or `src/lib/investigation/**` imports `src/lib/flowmap/**` (extend the S10 guard test). `src/lib/flowmap/**` does not import `src/lib/providers/**`; the Assisted naming action (FM-5) lives in `src/lib/prepare/assisted.ts`'s pattern and calls into flowmap pure functions, not the reverse.

### 2.7 Disclosure law
Assisted naming reuses `DisclosureModal` + `fetchPolicy`; the prompt names the provider, the repository, the number of flows and excerpt bytes being sent, and states that no conversation content is included (naming sends code locators and short quotes only — §13).

### 2.8 Honest-coverage law
Every generated map reports what it did **not** understand: files with zero surfaces, JSX tags with no resolved import, request URLs with no matched endpoint, dynamic imports, `React.lazy`, and routes whose element could not be resolved. This list ("fog", §11.4) is a first-class part of the UI, never a debug view.

---

## 3. Known baseline (what this spec builds on)

- `src/lib/repo/` (CW-1, CW-8): `RepoSource`, `ensureIndexed`, LOCAL-ONLY `repoFiles` rows `{ repoKey, sha, path, size, content }`, `grep` / `findSymbol` / `findReferences`, `fetchPolicy` denylist + excluded dirs, `scrubSecrets`, caps 200 KB / file, 50 MB, 2000 files (GitHub) / 5000 (local). `listRepoFiles(repoKey, sha)` already loads the cache in `EvidenceSection.tsx`.
- `src/lib/prepare/trace.ts`: `TraceNode` kinds `behavior | component | function | route | endpoint | service | db | event | state | external | test | unknown | other`; `addNode`, `updateEdge`, `deriveEdgeVerification`, `emptyTrace`. `src/types/evidence.ts`: `CodeEvidence` with `quote` ≤ 500 chars + `quoteHash`.
- `src/types/understanding.ts`: `UnderstandingObject` with open `type: string` and `meta`; `UnderstandingEvent.codeEvidence?: EvidenceItem[]` (CW-5). Questions already use `type: 'question'` (CW D8) — kept flows use the same mechanism.
- `src/lib/understanding/trace/` (Intent Trace): intents anchored to file paths and symbols; `DisclosureModal`; `blobUrl` builder in `src/lib/github/client.ts`.
- `src/lib/search.ts` + `useConversations`: full-text search over messages, used for the "Discussed in" cross-reference (§11.3).
- `src/lib/detection/registry.ts`: the pluggable-registry pattern (interface + register + versions) that §9 copies for recognizers.
- Route `/projects/:id/*` under `ProjectWorkspaceLayout` with tabs Overview · Investigate · Understanding · Intents · Prepare. Dexie at **v12**. Sync kinds unchanged since CW; backend untouched.
- `docs/territories/*.md`: seven hand-written territory documents with `[CODE]/[TEST]/[DOC]/[INFERRED]/[UNKNOWN]` evidence tags and "Entry point" / "Control-flow path" / "Fog" sections. They are the ground truth for the §18 acceptance comparison.

---

## 4. Outcome

A developer opens Projects → Chatdex → **Flows**, clicks "Generate", and within seconds sees every route in the app, every interactive element under each route, and for each one a chain of code locations down to the backend endpoint or IndexedDB table it touches — each step a click away from the source line, each link labelled declared or heuristic, and each unresolved reference listed as fog. They can keep a flow into Current Understanding, open it as a trace in a Change Workspace with code evidence pre-attached, and see which conversations discussed its files. Regenerating at a new sha produces a new map; kept flows show "Source changed" where their lines moved.

The §18 test: for the "Unlock the vault" territory, the generated map must find the same entry point (`CloudSyncSection.tsx` → `session.ts`) that the hand-written document found, and list as fog the things that document marks `[UNKNOWN]`.

---

## 5. Scope

### 5.1 In scope (v1)
One recognizer profile, `react-vite-fastify` (§9), covering: React Router routes; React components; ES imports; JSX render relations; event-handler attributes; custom hooks; Zustand stores and their exported actions; `fetch` / API-client calls with literal URLs; Fastify route registrations with prefixes; Dexie table declarations and table reads/writes; Web Worker construction. Deterministic flow derivation from routes (§10). Fog reporting (§11.4). The Flows tab (§14). Local-only storage of generated maps (§7.2). Kept flows as understanding objects (§7.3). Open-as-trace bridge to Change Workspace (§12). "Discussed in" cross-reference to conversations, intents, findings, and workspaces (§11.3). Assisted naming and grouping (FM-5). Regeneration at a new sha with kept-flow drift badges.

### 5.2 Out of scope (v1)
Parser-based analysis (tree-sitter, TypeScript compiler API) — see §20; other framework profiles (Next.js, Express, Vue, Svelte, mobile); a graph canvas (v1 is lists and an ordered step view, same as the trace editor); flow diff between two shas (§20 — the most valuable follow-on); running or instrumenting the app; runtime tracing; test-coverage overlay; per-flow "ownership score"; autonomous regeneration or watching a branch; anything that writes to a repository.

---

## 6. Vocabulary

- **Surface** — a place a user or the system can enter code: a route, page, component, action (interactive element), hook, store, store action, API call, endpoint, table, or worker (§8).
- **Link** — a directed relation between two surfaces with a relation kind and a `declared | heuristic` confidence (§8).
- **Recognizer** — a versioned rule that reads one cached file and emits surfaces and links (§9). Analogous to a detector.
- **Profile** — the ordered set of recognizers for one stack (§9.3).
- **Flow** — an ordered chain of surfaces from an entry surface to its terminals, derived from links (§10). Derived flows are local-only; a **kept flow** is a human-promoted copy stored as an understanding object (§7.3).
- **Fog** — anything the recognizers saw but could not resolve (§11.4). Named after the territory docs' "Fog" sections.
- **Map** — one generation result: `{ surfaces, links, flows, fog, coverage }` for one `(project, repoKey, sha)`.

---

## 7. Conceptual data model

### 7.1 Types (`src/types/flowmap.ts`, new)

```ts
type SurfaceKind = 'route' | 'page' | 'component' | 'action' | 'hook' | 'store' | 'store_action'
                 | 'api_call' | 'endpoint' | 'table' | 'worker';
type LinkRelation = 'renders' | 'imports' | 'handles' | 'calls' | 'uses_hook' | 'reads_store' | 'dispatches'
                  | 'requests' | 'serves' | 'reads_table' | 'writes_table' | 'spawns';
type Confidence = 'declared' | 'heuristic';

interface Locator { repoKey: string; sha: string; path: string; line: number; endLine?: number }

interface Surface extends Locator {
  id: string;                 // sha256(`${path}:${line}:${ruleId}:${label}`) — deterministic (law 2.4)
  kind: SurfaceKind;
  label: string;              // route path, component name, button text / aria-label, URL pattern, table name …
  symbol?: string;            // identifier when one exists (component / handler / hook / store action name)
  ruleId: string;             // recognizer id, e.g. 'react-router.route'
  ruleVersion: string;
  meta?: Record<string, string | number | boolean>;   // e.g. { method: 'POST', urlPattern: '/api/sync/push' }
}

interface Link extends Locator {
  id: string;                 // sha256(`${from}:${relation}:${to}:${ruleId}`)
  from: string; to: string;   // surface ids
  relation: LinkRelation;
  confidence: Confidence;
  ruleId: string;
  ruleVersion: string;
}

interface FlowStep { surfaceId: string; via?: string /* link id that led here */ }

interface DerivedFlow {
  id: string;                 // sha256 of the ordered surface ids
  entrySurfaceId: string;     // always a route in v1
  actionSurfaceId?: string;   // the interactive element this flow starts from; absent for the "page load" flow
  steps: FlowStep[];          // entry first, terminals last; ≤ MAX_FLOW_STEPS
  derivedName: string;        // e.g. "/settings · Unlock with passkey"
  truncated: boolean;         // depth or fan-out cap hit
}

interface FogItem extends Locator {
  kind: 'unresolved_tag' | 'unresolved_import' | 'unmatched_request' | 'dynamic_import' | 'lazy_element'
      | 'unresolved_route_element' | 'no_surfaces' | 'skipped_file';
  detail: string;
}

interface Coverage {
  filesScanned: number; filesWithSurfaces: number; filesSkipped: number;
  surfacesByKind: Record<SurfaceKind, number>; linksByConfidence: Record<Confidence, number>;
  routes: number; flows: number; fog: number;
}

interface FlowMapRow {           // LOCAL-ONLY (§7.2)
  key: string;                   // `${projectId}|${repoKey}|${sha}`
  projectId: string; repoKey: string; sha: string;
  profileId: string; recognizerVersions: Record<string, string>; configDigest: string;
  generatedAt: Date;
  surfaces: Surface[]; links: Link[]; flows: DerivedFlow[]; fog: FogItem[]; coverage: Coverage;
}
```

Caps (configurable in `FlowMapConfig`, §9.4): `MAX_FLOW_STEPS = 30`, `MAX_FLOW_DEPTH = 8`, `MAX_FANOUT_PER_NODE = 12`, `MAX_FLOWS_PER_ROUTE = 200`, `MAX_SURFACES = 20_000`, `MAX_LINKS = 60_000`. Hitting a cap sets `truncated` or adds a fog item; it never silently drops.

### 7.2 New LOCAL-ONLY table (Dexie v14, never synced)

- `flowMaps: '&key, projectId, [repoKey+sha]'` — one row per generation. Evicted with the corresponding `repoFiles` (same Settings "Clear repository cache" control) and by `clearAllData()`. Absent from the sync engine's hook / resync table list (extend test S1).

No change to `repoFiles`, `inspections`, `preparedChanges`, or any synced table's indexes.

### 7.3 Kept flows (synced, no new kind)

A kept flow is an `UnderstandingObject`:

```ts
{ type: 'flow', origin: 'user', reviewState: 'accepted', status: 'current',
  title: string,                        // human name (AI-suggested text accepted per law 2.3)
  body: string,                         // optional note
  meta: { flowId, repoKey, sha, profileId, entryLabel, actionLabel?,
          steps: { kind, label, symbol?, path, line, endLine?, quote (≤ 200 chars, scrubbed), quoteHash, viaRelation?, viaConfidence? }[],
          nameHistory?: { text, origin: 'user' | 'ai', at: ISO }[],
          naming?: { runId, provider, promptDigest } } }
```

plus an `introduced` event whose `codeEvidence` holds one `CodeEvidence` per step (exact lines, `addedVia: 'search'`, `origin: 'user'`). Kept-flow `meta.steps` is capped at `MAX_FLOW_STEPS`; total object size stays under the existing S7 posture. Nested timestamps are ISO strings (CW D11).

Kept flows appear in Current Understanding under a "Flows" group (existing object list, filtered by type) and on the Flows tab with a "kept" badge. Because they are ordinary understanding objects they sync as `understanding_object` / `understanding_event` — **no new sync kind, backend untouched, no deploy-order note.**

### 7.4 Sync

Nothing new. The S9 envelope test is extended with a kept flow: cleartext fields exactly `{ kind, parentId, updatedAt }`.

---

## 8. Surface and link semantics

| Surface kind | Emitted by | Label | Terminal? |
|---|---|---|---|
| `route` | react-router `<Route path=…>` (nested paths joined with the parent) | full path, e.g. `/projects/:id/prepare` | entry |
| `page` | component referenced by a route element, or any export under `src/pages/` | component name | no |
| `component` | exported function / const in a `.tsx` file whose body contains JSX | component name | no |
| `action` | `onClick` / `onSubmit` / `onChange` / `onKeyDown` / `onDrop` attributes and `<form onSubmit>` | nearest button text, `aria-label`, `title`, or the handler name as fallback | no |
| `hook` | `export function useX(` / `export const useX =` | hook name | no |
| `store` | a file calling Zustand `create(` | store variable name | no |
| `store_action` | property of the object returned by `create((set, get) => ({ … }))` whose value is a function | action name | no |
| `api_call` | `fetch(` / `apiFetch(` / `relayClient.*(` / `syncApi.*(` with a string-literal or template URL | method + URL pattern | terminal if unmatched |
| `endpoint` | Fastify `app.<verb>('/path'` inside a plugin registered with `prefix` | `POST /api/sync/push` | no |
| `table` | Dexie `stores({ name: '…' })` declarations | table name | terminal |
| `worker` | `new Worker(new URL('…', import.meta.url))` | worker file path | terminal |

| Relation | From → To | Confidence |
|---|---|---|
| `renders` | route → element component; component → JSX tag resolved to an imported component | declared (route element, same-file component); heuristic (tag ↔ import name match) |
| `imports` | file-level, folded into surface links only when both ends are surfaces | declared |
| `handles` | action → handler symbol declared in the same file, or imported | declared (same file); heuristic (imported) |
| `calls` | handler → function it names (word-boundary, same file or imported) | heuristic |
| `uses_hook` | component → `useX(` call | heuristic |
| `reads_store` | component / hook → `useXStore(` | heuristic |
| `dispatches` | handler → store action (`useXStore.getState().action(` or destructured action name) | heuristic |
| `requests` | handler / hook / store action → api_call in the same function body | declared |
| `serves` | api_call → endpoint whose method + pattern matches (`:id` / `*` wildcards normalised) | heuristic |
| `reads_table` / `writes_table` | any function → `db.<table>.<method>(`; write iff method ∈ `add put update delete bulkAdd bulkPut bulkDelete clear` | heuristic |
| `spawns` | file → worker | declared |

"Declared" is used only where the spec table says so. A recognizer that cannot decide emits `heuristic`.

---

## 9. Recognizers (`src/lib/flowmap/recognizers/`, FM-1, FM-2)

### 9.1 Interface

```ts
interface Recognizer {
  id: string;                   // 'react-router.route', 'zustand.store', 'fastify.endpoint', 'dexie.table' …
  version: string;              // semver; bump on any behaviour change (mirrors detector versioning)
  applies(path: string): boolean;
  run(file: { path: string; content: string; lines: string[] }, ctx: RecognizerContext): RecognizerOutput;
}
interface RecognizerContext { config: FlowMapConfig; resolveImport(fromPath: string, spec: string): string | null; fileIndex: ReadonlySet<string> }
interface RecognizerOutput { surfaces: Surface[]; links: Link[]; fog: FogItem[] }
```

Recognizers are pure. They receive one file and the resolver; cross-file linking happens in the linker (§9.2). Register in `src/lib/flowmap/registry.ts`; the generator, storage, and UI require no per-recognizer changes (same rule as detectors).

### 9.2 Linker (`src/lib/flowmap/link.ts`)

Runs after all recognizers: resolves JSX tags to component surfaces via the file's imports, matches `api_call` to `endpoint` (method + normalised pattern; `/api/sync/push` matches prefix `/api/sync` + `/push`), and folds `imports` into `renders` / `handles` / `calls` where both ends are surfaces. Unresolved references become fog items. Import resolution handles relative paths, `index.ts(x)`, extension inference, and `tsconfig` `paths` aliases read from the cached `tsconfig*.json` when present; anything else is `unresolved_import` fog.

### 9.3 Profile `react-vite-fastify` v1

Ordered: `react-router.route` → `react.component` → `react.action` → `react.hook` → `zustand.store` → `es.import` → `http.request` → `fastify.endpoint` → `dexie.table` → `worker.spawn`. A profile is a list of recognizer ids plus config defaults; selecting a profile is a per-project setting (new optional, unindexed `flowMapProfile?: string` on `UnderstandingProject`, beside `repository`), defaulting to `react-vite-fastify` when the cache contains `vite.config.*` and `backend/` with `fastify` in `package.json`, otherwise the user picks.

### 9.4 Config (`FlowMapConfig`)

Every threshold and every path convention is a documented config field with a default: caps from §7.1; `pagesDirs: ['src/pages']`; `storesDirs: ['src/stores']`; `backendDirs: ['backend/src']`; `dexieSchemaFiles: ['src/lib/db/schema.ts', 'src/lib/db.ts']`; `handlerAttributes: ['onClick','onSubmit','onChange','onKeyDown','onDrop']`; `writeMethods: [...]`; `requestFunctions: ['fetch','apiFetch','relayClient','syncApi']`. `configDigest` is stored on the map row so a config change invalidates the cached map (law 2.4).

### 9.5 Performance

Regex-only, single pass per file, per-file time budget of 50 ms (reuse the S8 budget), files over 200 KB are already excluded by the cache. Target: Chatdex (~600 cached files) generates in under two seconds on the main thread in chunks of 25 files with a yield between chunks and a progress callback. A Web Worker host is deferred (§20) unless FM-2 measurement shows > 3 s on Chatdex.

---

## 10. Flow derivation (`src/lib/flowmap/derive.ts`, FM-2)

Deterministic, no LLM:

1. For each `route` surface, in path order, compute its **render closure**: follow `renders` links depth-first (declared and heuristic) up to `MAX_FLOW_DEPTH`, visiting each component once per route.
2. Emit one **page-load flow** per route: route → element → components in closure that have `uses_hook` / `reads_store` / `reads_table` / `requests` links, following those links to terminals.
3. For each `action` surface inside the closure, emit one **action flow**: route → … → component owning the action → action → `handles` → handler → (`calls` | `dispatches` | `requests`)* → (`serves` → endpoint → `reads_table`/`writes_table`)* → terminals. Breadth-first, `MAX_FANOUT_PER_NODE`, `MAX_FLOW_STEPS`; cycles are cut at the first revisit and noted with `truncated`.
4. `derivedName` = `${route.label} · ${action.label}` (or `${route.label} · page load`). Sorted by route path then action line so the list is stable across regenerations.
5. Actions that exist in no route's closure (components only rendered via unresolved tags) are emitted as flows under a synthetic entry `(unreached)` and counted in fog as `unresolved_tag` — they are still browsable, never hidden.

`flowSummary(map)` returns counts by kind, confidence, and fog category; feeds the tab header and the per-project Overview card.

---

## 11. Cross-references and honesty

### 11.1 Open source
Every locator renders as `path:line` with "Open" → `blobUrl(owner, repo, sha, path, line)` for GitHub sources, or the local file path with a copy button for `fs:` sources (no `file://` links). Text-node rendering; validated builders only (S6).

### 11.2 Drift
A kept flow stores `quoteHash` per step. On the Flows tab, kept flows re-check their quotes against the current cache and show "Source changed" per step on mismatch (same UX as exhibit / evidence drift). Regeneration never mutates a kept flow.

### 11.3 "Discussed in"
For a selected flow, deterministically collect: intent traces whose file anchors are in the flow's paths (`src/lib/understanding/trace/`); Change Workspaces whose `evidence[]` code items or `implementation.files[]` touch those paths; investigation findings / exhibits anchored to those paths; and conversations whose messages contain any of the flow's paths or unique symbols (existing full-text search, limited to the project's associated conversations, capped at 50). Rendered as tabs with counts and deep links. Each hit can be added to a workspace as `intent_history` evidence via the existing picker — the Flow Map never creates evidence on its own.

### 11.4 Fog
A dedicated panel on the tab, grouped by category with counts, each item a locator + detail. Coverage line in the header: "Generated from 612 files at `bdeb097` · profile react-vite-fastify v1 · 29 routes · 143 actions · 88 % of `.tsx` files have a surface · 17 fog". The territories' `[UNKNOWN]` items for §18 must appear here.

---

## 12. Bridges (FM-4)

- **Keep flow** → creates the understanding object of §7.3 with a name dialog (derived name pre-filled; suggested name shown separately after FM-5). Records `meta.flowId` so re-keeping the same flow updates rather than duplicates (`[projectId + meta.flowId]` lookup, not an index).
- **Open as trace** → creates a new Change Workspace (`createPreparedChange` with `originRef: { kind: 'manual', id: flowId }` and `intent.currentBehavior` = derived name) or appends to a chosen draft/ready workspace; each step becomes a `TraceNode` (kind mapped: route→`route`, page/component/action→`component`, hook/store/store_action→`state`, api_call→`external`, endpoint→`endpoint`, table→`db`, worker→`service`) with one `CodeEvidence` for its line; edges follow law 2.2 — declared links attach the link's own line as evidence, heuristic links attach nothing and set `claim: "heuristic: <ruleId>"`. The resulting trace therefore renders with a mix of `verified` and `unknown` edges, which is the truthful state.
- **From a workspace**: the Evidence section's Guided menu gains "Show flows through this file" (deterministic lookup in the current map).

---

## 13. Guided vs Assisted

- **Guided (default, FM-0…FM-4).** Generate · Regenerate · Keep · Open as trace · Open source · Discussed in · Fog. **Zero network calls**, including to GitHub: generation reads only the cache. The Guided constraint test (§16, FM-4) asserts no `fetch` at all during a full generate → keep → open-as-trace walkthrough.
- **Assisted (FM-5).** Two actions, each one `complete()` call preceded by `DisclosureModal`: **Suggest names** (up to 50 flows per call: derived names + step labels + one ≤ 120-char scrubbed quote per step; response: `{ flowId, name ≤ 80 chars }[]`) and **Suggest groups** (same input; response: `{ groupName, flowIds[] }[]`). Outputs land in `suggestedName` / `suggestedGroup` on the LOCAL map row and in `nameHistory` with `origin: 'ai'` when accepted. The model never receives conversation content in these prompts, and the prompt says so. Reuse `judge.ts` conventions: content-is-data framing, delimiters, `assertNoSecrets`, `parse` firewall that drops any `flowId` not in the request and any name containing markup.

---

## 14. User experience (FM-3, FM-4)

- New project tab **Flows** at `/projects/:id/flows` (after Intents, before Prepare in `ProjectWorkspaceLayout`).
- **Empty state:** no repo binding → link to `RepoBindingCard`; bound but not indexed → the existing index banner and "Index & generate"; indexed → "Generate flow map (reads the local cache only; nothing is sent anywhere)".
- **Layout:** header (coverage line + Regenerate + profile picker); left column: routes as a tree (nested paths under parents), each expandable to its flows with kind chips and a `declared / heuristic` ratio glyph; right column: the selected flow as an ordered step list (kind chip · label · `path:line` · Open · confidence badge on the incoming link) with actions **Keep**, **Open as trace**, **Discussed in**; a **Fog** panel below the routes; kept flows pinned at the top of their route with the "kept" badge and drift indicators.
- **Project Overview card:** "Flow map: 29 routes · 143 flows · 6 kept · 17 fog · at `bdeb097` (2 days old)".
- **Settings:** "Clear repository cache" also clears `flowMaps`; a line under it says so.
- Reduced motion, keyboard navigation of the tree, and `aria-label`s on chips follow the trace editor's conventions.

---

## 15. Privacy, security, and offline behavior

### 15.1 Audit (2026-09-07)

| # | Risk | Severity | Disposition |
|---|---|---|---|
| S1 | The derived map exposes a private repository's structure (routes, endpoints, tables) — a new derived data class. | Medium | LOCAL-ONLY table, never synced (test: absent from the engine's table list); cleared with the cache; only human-kept flows sync, and only with capped quotes (≤ 200 chars / step, ≤ 30 steps). |
| S2 | New network paths. | — | None. Generation and all Guided actions are offline. GitHub is touched only by the pre-existing indexer; the token surface is unchanged. Constraint test asserts zero `fetch` calls during the Guided walkthrough. |
| S3 | Prompt injection through code content in Assisted naming (a comment in a source file instructing the model). | Medium | Names are the only output; parsed by a firewall that enforces length ≤ 80, strips markup, and drops unknown `flowId`s; names render as text nodes; nothing the model returns can create a surface, link, or evidence item (law 2.2). |
| S4 | Secrets in step quotes reaching the server (kept flows) or the provider (naming). | High | `scrubSecrets` on every quote at keep-time and prompt-time; redaction counts shown; `fetchPolicy` already keeps denylisted files out of the cache so they cannot become surfaces. |
| S5 | Spend. | Low | ≤ 50 flows / call, ≤ 24 KB excerpt bytes; count and bytes in the disclosure; no automatic naming on regenerate. |
| S6 | Link integrity: blob URLs from recognizer-derived paths and lines. | Low | `blobUrl` builder with `assertRepoName` / `assertSha` and an integer line check; local paths are never rendered as links; `<script>` fixture for labels (button text is user-influenced content). |
| S7 | Synced growth via kept flows. | Low | Caps above; a kept flow is one understanding object of bounded size; re-keeping updates in place. |
| S8 | Pathological regex behaviour on adversarial files. | Low | Recognizer patterns are fixed and reviewed for nested quantifiers (extend `isSafePattern` as a unit test over every recognizer pattern); per-file 50 ms budget ⇒ `skipped_file` fog. |
| S9 | Sync envelope cleartext. | Low | Extend the envelope test with a kept flow. |
| S10 | Boundary. | — | Extend the import-guard test with `src/lib/flowmap/**`. |
| S11 | Misleading confidence: a heuristic match displayed as fact. | Product-critical | Confidence is stored per link and rendered per step; heuristic edges export without evidence (law 2.2); the fog panel is always visible; the coverage line is always shown. |
| S12 | Local-directory sources (`fs:`) — file paths of an arbitrary folder in the map. | Low | Same as CW S11; the map is local-only; kept flows carry relative paths only, never the handle name's absolute location. |

Not addressed here (pre-existing): CSP for the hosted origin.

### 15.2 Offline
Everything in Guided mode works offline once the repository is cached. Assisted naming needs network. Regeneration at a *new* sha needs the indexer, which needs GitHub (or the local directory handle).

---

## 16. Required tests

- **FM-0:** types; deterministic ids (same input twice ⇒ deep-equal map — law 2.4); registry registers / lists / versions; `FlowMapConfig` defaults + `configDigest`; Dexie v14 `flowMaps` exists, cleared by `clearAllData`, absent from the sync engine's table list (S1); boundary guard extended (S10); `isSafePattern` over every recognizer pattern (S8); fixture tree `src/test/fixtures/flowmap/react-vite-fastify/` (a ~25-file miniature with routes, nested routes, a lazy route, a store, a hook, an unresolved tag, a `fetch` with and without a matching endpoint, Dexie schema + reads/writes, a worker, a `<script>` button label, and a file with a fake secret).
- **FM-1:** each front-end recognizer over the fixture — exact surfaces and lines; each false-positive fixture rejected (a non-component `.tsx` export, an `onClick` inside a comment, a `useX` that is not a hook call); nested route path joining; `React.lazy` ⇒ `lazy_element` fog.
- **FM-2:** request ↔ endpoint matching table (prefix, wildcards, method mismatch ⇒ `unmatched_request`); Dexie read vs write classification; linker import resolution (relative, index, alias, unresolved); derivation: page-load flow, action flow, fan-out cap, depth cap, cycle cut, `(unreached)` entry; `flowSummary`. **Self-atlas test:** run the generator over the real repository from `vitest` (Node `fs`, `src/` + `backend/src/`) and assert: every `<Route path` in `src/App.tsx` is a route surface; `POST /api/sync/push` and `GET /api/sync/pull` are endpoints; the sync engine's push request links to the push endpoint; `preparedChanges` is a table with ≥ 1 write link; generation completes within 3 s. This test is the regression guard that the recognizers still understand Chatdex.
- **FM-3:** RTL for the Flows tab — empty states, generate progress, route tree, step list with confidence badges, fog panel, `<script>` label renders escaped (S6), kept-flow drift badge on hash mismatch.
- **FM-4:** Keep flow creates an accepted user object with `codeEvidence`; re-keep updates in place; Open as trace produces nodes with mapped kinds and edges whose derived state is `verified` for declared links and `unknown` for heuristic ones (law 2.2); "Discussed in" over fixtures for each source type; Guided constraint test — full walkthrough with `fetch` stubbed to throw, asserted never called (S2).
- **FM-5:** Assisted naming with mocked `complete` — disclosure precedes the call; excerpts capped; response firewall drops unknown ids and markup; an injected instruction inside a fixture file changes no surface, link, or confidence (S3); accepting a suggestion records `origin: 'ai'` in `nameHistory`.

---

## 17. Milestones

| Milestone | Deliverable | Acceptance |
|---|---|---|
| **Spec** | This document; `docs/README.md` row; `CLAUDE.md` pointer; build log + todos created. | Committed on its own after Jacob's review of §21. |
| **FM-0** | `src/types/flowmap.ts`; `src/lib/flowmap/{registry,config,ids}.ts`; Dexie v14 local-only table + helpers; fixture tree; guard + determinism + pattern-safety tests. | `npm run typecheck && npm run lint && npm run test:all` green; `db.verno === 14`; no backend change. |
| **FM-1** | Front-end recognizers: route, component, action, hook, store, import. | Fixture golden tests pass; every `App.tsx` route recognised. |
| **FM-2** | Back-end / data recognizers: request, endpoint, table, worker; linker; derivation; fog; coverage; self-atlas test. | Self-atlas test green in < 3 s; `/settings · Unlock with passkey` derives to `session.ts` and `POST /api/auth/...` endpoints. |
| **FM-3** | Flows tab UI, generate / regenerate, Settings hook-up, Overview card. | Chatdex map browsable end to end in the browser. |
| **FM-4** | Keep flow; Open as trace; Discussed in; Guided menu entry; Guided constraint test. | §18 Guided scenario passes. |
| **FM-5** | Assisted naming + grouping with disclosure; `nameHistory`. | §18 Assisted scenario passes; every AI output is a suggestion slot. |

---

## 18. Manual acceptance scenario (real Chatdex)

**Guided.** Projects → Chatdex → Flows → repository already indexed at `main` → Generate. Header shows the coverage line. Expand `/settings`: flows include "page load", "Create account", "Unlock with passkey", "Recover with code", "Clear repository cache". Select "Unlock with passkey": steps go `SettingsPage` → `CloudSyncSection` → action → `handleUnlock` → `session.login` → `POST /api/auth/passkey/login-init` … → `metadata` table write; compare against `docs/territories/unlock-the-vault.md` "Entry point" and "Control-flow path": entry point and the endpoint sequence must agree; items the territory doc marks `[UNKNOWN]` or `[INFERRED]` must be heuristic links or fog here. Open source on three steps (blob links land on the right lines). Keep the flow as "Unlock the vault". Open as trace → a new workspace opens with the trace pre-filled; at least one edge is `verified` and at least one is `unknown`. Discussed in → shows the Intent Trace intents and the Change Workspaces that touched `session.ts`. The `/timeline` page-load flow ends at an `activities` read that no flow anywhere in the map writes — the Atlas's dead-timeline finding, now visible mechanically. Fog panel lists every unresolved tag and unmatched request, and every `React.lazy` route if any. Switch to airplane mode: Regenerate at the same sha works; Keep works; sync of the kept flow resumes when back online, and `flowMaps` does not sync (second device shows the kept flow but must generate its own map).

**Assisted (after FM-5).** Suggest names for `/settings` → disclosure names the provider, "Kakob/Chatdex", 5 flows, N KB, and "no conversation content" → suggestions appear beside derived names → accept one → the kept flow's `nameHistory` shows `origin: 'ai'`.

The qualitative question: could a new contributor, given only this tab, reach the same entry points the Application Atlas hand-picked for all seven core territories?

---

## 19. Definition of done

- All milestones committed; typecheck, lint, `test:all`, `build` green; self-atlas test green on `main`.
- §18 passed in a browser on the real repository.
- Every link carries a confidence; heuristic links never export as `verified`; the fog panel is populated on the Chatdex map.
- `flowMaps` never appears in a sync envelope; generation performs no network calls.
- Build log has Spec + FM-0 … FM-5 rows; `CLAUDE.md` lists the Flow Map as a track with the §2.5 local-only-derivation sentence.

---

## 20. Later work explicitly deferred

- **Flow diff between two shas** ("what can a user do now that they couldn't at the last release; which flows changed") — the highest-value follow-on; the deterministic ids in §7.1 are designed so this is a set difference.
- Parser-based recognizers (tree-sitter wasm or the TypeScript compiler API in a worker) replacing the regex heuristics one rule at a time, each replacement bumping the recognizer version and keeping the fixture.
- Additional profiles: Next.js app router, Express, Vue, Svelte.
- Worker-hosted generation; incremental regeneration by changed files.
- Graph canvas; runtime tracing / test-coverage overlay; per-flow ownership metrics (PRD §17 rollups).
- Feeding flows into Intent Trace as candidate anchors; generating territory-style Markdown from a kept flow.

None of these may weaken the laws in §2.

---

## 21. Decisions proposed (2026-09-07 — for Jacob to confirm or change before the Spec milestone commits)

| # | Decision | Why |
|---|---|---|
| D1 | The derived map is LOCAL-ONLY and recomputable; only human-kept flows sync. | Keeps private-repo structure off the server by default; mirrors the `repoFiles` posture (CW D3); no new sync kind. |
| D2 | Kept flows are `UnderstandingObject { type: 'flow' }`, not a new record. | Same move as questions (CW D8): reuses sync, review state, Current Understanding UI, and `codeEvidence`; backend untouched. |
| D3 | Regex recognizers first, one profile (`react-vite-fastify`), tree-sitter deferred. | Ships something verifiable against Chatdex in a few sessions; the recognizer interface and versioning make parser replacement incremental (§20). |
| D4 | Every link stores `declared | heuristic`; heuristic links export to traces without evidence. | The only way to keep law 2.2 truthful without changing `trace.ts`; makes the map's uncertainty visible instead of laundering it into `verified`. |
| D5 | Generation makes zero network calls, including to GitHub. | Stronger than Change Workspace Guided (which allows api.github.com); the cache already has everything generation needs. |
| D6 | Surface and link ids are content hashes, never random. | Determinism (law 2.4), stable kept-flow references across regenerations, and the sha-diff follow-on in §20. |
| D7 | Entry surfaces are routes only in v1. | Chatdex's user-reachable behaviour all starts at a route; CLI / worker / cron entries are a profile concern for later. |
| D8 | Fog is a first-class panel, not a debug log. | The territory docs' most useful sections were "Fog" and the doc-vs-code disagreements; hiding unresolved references would make the map lie by omission (law 2.8). |
| D9 | Assisted actions are naming and grouping only; no "explain this flow" in v1. | Keeps the AI surface tiny and non-load-bearing; explanation already exists per file in Change Workspace Assisted mode. |
| D10 | Flows tab lives in the project workspace, not a global page. | Repository binding, kept flows, and "Discussed in" are all project-scoped. |
