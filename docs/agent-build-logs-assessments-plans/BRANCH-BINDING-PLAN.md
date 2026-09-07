# Branch Binding — implementation plan

Status: **planned, no code written.** Drafted 2026-09-07.

Cross-cutting fix touching Intent Trace (`docs/specs/SPEC-intent-trace.md`), Change
Workspace (`docs/specs/SPEC-change-workspace.md`) and Decision Recovery
(`docs/specs/SPEC-decision-recovery.md`). No spec amendment is required — see
[Spec conformance](#spec-conformance).

---

## 1. The bug

Pasting `https://github.com/Kakob/Chatdex/tree/feature/project-workspace-golden-path`
into the **Repository** box on the Intent Trace or Decisions tab silently binds to
`Kakob/Chatdex` on **`main`**. Three separate defects stack up:

1. **The branch is thrown away at parse time.** `parseRepoInput()`
   (`src/lib/github/client.ts:88-107`) returns `{ owner, repo }` only; the URL pattern
   at `:92` ends in `(?:[/#?].*)?$`, which swallows `/tree/<branch>` along with
   `/blob/…`, `/commit/…` and `/pull/…`. A test at `src/lib/github/client.test.ts:57`
   explicitly pins that drop.
2. **The only branch control is unlabelled and unrelated-looking.** A narrow second box,
   `placeholder="pinned ref (optional)"` / `aria-label="Pinned ref"`
   (`src/components/intents/RepoBindingCard.tsx:126-132`), writes
   `ProjectRepository.pinnedRef`. Meanwhile the success line always announces
   `— default branch <defaultBranch>` (`:160-162`), which reads as a verdict rather
   than as a fallback.
3. **The card disappears once a repo is bound.** `src/pages/IntentTracePage.tsx:329`
   and `src/pages/DecisionsPage.tsx:263` both render it under `{!repository && …}`.
   After the first Save there is no way to change the branch from either tab; only
   `src/pages/ProjectOverviewPage.tsx:142-145` renders it unconditionally.

### Two further defects found while tracing this

4. **Decision Recovery ignores the binding entirely.** `resolveSnapshot()`
   (`src/lib/understanding/decisions/runRecovery.ts:110-126`) does
   `config.sha ?? await latestCachedSnapshot(repoKey)`, and `latestCachedSnapshot`
   (`src/lib/db/repoFiles.ts:44-51`) returns the sha of the most recently **fetched**
   row for the repoKey — branch-blind. Recovery therefore runs against whichever branch
   happened to be indexed last, with no warning.
5. **Commit history is always default-branch.** `src/lib/prepare/guided.ts:78` contains
   a dead no-op spread, `...(repository.pinnedRef ? {} : {})`, so `commitsTouchingPath`
   never passes the chosen ref to `listCommits`. (`listCommits` would reject it anyway:
   `assertSha(params.sha)` at `src/lib/github/client.ts:301`, even though GitHub's `sha`
   query parameter accepts a branch name.)

## 2. What already works — do not "fix" it

- `resolveRef(owner, repo, ref)` (`client.ts:184-199`) accepts any branch, tag or sha.
  Slashed branch names were verified against the live API: `encodeURIComponent`
  produces `%2F` and `GET /repos/{o}/{r}/commits/a%2Fb` returns **200**. No change needed.
- `assertRef` / `REF_RE` (`client.ts:23,75`) already permit `feature/foo`.
- `src/lib/understanding/trace/runTrace.ts:148` already resolves
  `config.ref ?? repository.pinnedRef ?? repository.defaultBranch` → sha, and records
  `RepoRef { owner, repo, commitSha, ref }`. `TraceConfig.ref` exists; no UI sets it.
- `src/components/prepare/EvidenceSection.tsx:96` already resolves
  `pinnedRef ?? defaultBranch ?? 'HEAD'` → sha → `ensureIndexed(source, sha)`.
  Everything below that is sha-keyed and branch-agnostic.
- `repoFiles` is keyed `&[repoKey+sha+path]` (`src/lib/db/schema.ts:179`), so snapshots
  from different branches already coexist as separate sha partitions.
- **No Dexie migration.** `ProjectRepository` lives unindexed inside
  `understandingProjects` (`schema.ts:96`).

In short: the plumbing is branch-ready end to end. Only the intake and two consumers
are wrong.

## 3. Scope decisions (confirmed with Jacob, 2026-09-07)

| # | Decision | Rationale |
|---|---|---|
| D1 | **No branch-picker dropdown, no new GitHub endpoint.** A labelled text field only. | Keeps the client's GET-only surface unchanged; avoids burning rate limit on a `/branches` call. Revisit only if typing branch names proves painful. |
| D2 | **Keep the persisted field name `pinnedRef`.** Rename local UI variables and labels only. | It is persisted user data read at five sites (`runTrace.ts:148`, `EvidenceSection.tsx:96`, `IntentTracePage.tsx:101`, `guided.ts:78`, `RepoBindingCard.tsx:28`). A rename buys a permanent `ref ?? pinnedRef` fallback in every reader for no gain. |
| D3 | **Resolve `/tree/a/b/c` ambiguity over the network, not by heuristic.** `parseRepoInput` returns the longest candidate as `ref` plus a longest-first `refCandidates[]`; Validate walks the list and keeps the first that resolves. | Branch `a/b/c` and branch `a` + path `b/c` are indistinguishable from the string alone. The reported bug wins on the first try; `/tree/main/src` on the second; ≤3 requests worst case. |
| D4 | **Fix Decision Recovery inside `resolveSnapshot`**, not by threading a sha down from the page. | Otherwise `planRecovery` stays wrong for every other caller and for tests — the bug class stays reachable. Costs one `GET /commits/{ref}` per plan. |
| D5 | **All three secondary fixes are in scope**: `guided.ts` dead spread, the staleness hint, session-commit chips. | They are the same bug seen from three angles; fixing the binding alone leaves each of them still reading the wrong branch. |

## 4. Implementation

### Step 1 — `src/lib/github/client.ts`

**1a. Widen the parse result.**

```ts
export interface ParsedRepoInput {
  owner: string;
  repo: string;
  /** Best-guess ref from a /tree, /blob, /commit, /pull or @ref input. */
  ref?: string;
  /** Longest-first alternatives when a slashed ref is ambiguous; omitted when unambiguous. */
  refCandidates?: string[];
}
export function parseRepoInput(input: string): ParsedRepoInput | null;
```

Regex strategy — stop trying to do it in one pattern:

1. Trim, then strip `?query` and `#hash` from the whole string **up front**. That is
   what the old trailing group was doing; removing it frees the remainder grammar.
2. Three anchored patterns, each capturing owner, repo, and an optional **remainder**:
   - `/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:@(.+))?\/?$/` — shorthand, with optional `@ref`
   - `/^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:\/(.*))?$/`
   - `/^git@github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/`
3. `assertRepoName(owner, repo)` inside the existing try — unchanged, still `null` on failure.
4. A private `refFromRemainder(rest)`: split on `/`, `decodeURIComponent` each segment
   (handles `%2F`-encoded branch names), drop empties, then:
   - `tree/<a…z>` → `ref` = the full join; `refCandidates` = every prefix, longest-first, when ≥2 segments
   - `blob/<a…z>` → same, but every candidate must leave ≥1 trailing path segment; if the last segment matches `/\.[A-Za-z0-9]+$/`, prefer all-but-last as `ref`
   - `commit/<sha>` or `commits/<sha>` → the sha when `SHA_RE` matches, else nothing
   - `releases/tag/<t>` → `t`
   - `pull/<digits>` → `refs/pull/<n>/head`, single candidate
   - anything else (`issues`, `actions`, `wiki`, empty) → no ref
   - every candidate passes `assertRef` in a try; failures are dropped, so a ref that
     would throw downstream is never returned
5. Omit the `ref` / `refCandidates` keys entirely when absent — matching the
   `...(x ? { x } : {})` style used throughout this file — so existing
   `toEqual({ owner, repo })` assertions for plain inputs keep passing.

**1b. `listCommits` (`:294-320`) — accept a ref without weakening the sha check.**
Params become `{ path?, since?, sha?, ref?, perPage? }`. Keep
`if (params.sha) assertSha(params.sha)` — `runTrace.ts:357` passes a real immutable sha
and should stay strict. Add `if (params.ref) assertRef(params.ref)`; send
`sha: params.sha ?? params.ref`.

**1c.** Update the file-header comment (`:1-12`); it enumerates "owner / repo / sha /
path are validated before they touch a URL". Add refs.

**Explicitly out of scope:** a `listBranches` helper or any call to
`/repos/{owner}/{repo}/branches` (D1).

### Step 2 — `src/lib/prepare/guided.ts:78`

```ts
return listCommits(
  repository.owner, repository.repo,
  { path, perPage, ...(repository.pinnedRef ? { ref: repository.pinnedRef } : {}) },
  opts
);
```

`GuidedActionMenu.tsx:65` already forwards the whole `repository` — no change there.

### Step 3 — `src/components/intents/RepoBindingCard.tsx` (bulk of the work)

Props gain:

```ts
  /** Render as a one-line summary with a Change button when already bound. */
  collapsible?: boolean;
  /** One-click chips, e.g. shas/branches from session commits. */
  suggestedRefs?: Array<{ ref: string; label?: string }>;
```

Rename the local `pinnedRef` state to `ref` (the persisted field name stays, per D2).
Add `refTouched` and `expanded`. The `'ok'` validation variant gains
`ref?`, `refSha?`, `refError?`.

1. **Prefill from a pasted URL.** In the main input's `onChange` (not during render):
   `const p = parseRepoInput(value); if (p?.ref && !refTouched) setRef(p.ref)`. Stash
   `p.refCandidates` in a `useRef` for the validate step. Typing in the ref field sets
   `refTouched = true`; a successful Save resets it.
2. **`handleValidate`.** `getRepo(...)` as today, then when `ref.trim()` is set: walk
   `[ref, ...(candidates ?? [])]`, deduped and capped at 3, calling `resolveRef`. The
   first success becomes the ref and records `refSha`. All 404 →
   `refError: 'Ref not found in this repository.'` while keeping `kind: 'ok'` (the repo
   half stays validated), and **Save stays disabled** until the ref resolves or is
   cleared. A ref is never silently dropped.
3. **`suggestedRefs` chips** under the ref input — `Use abc1234 · feature/x` buttons
   that `setRef(...)` + `setRefTouched(true)`. Cap 5, dedupe.
4. **Retire the "default branch" headline** (replaces `:157-164`):
   - ref chosen → `✓ owner/repo — tracking <ref> @ <sha7>`, with `· default branch <d>`
     demoted to a trailing muted span
   - no ref → `✓ owner/repo — tracking default branch <d>`
   - header subtitle → ``Bound to owner/repo · tracking `<pinnedRef ?? defaultBranch>` ``
     (this also fixes `:97`, which today gates the whole parenthetical on
     `defaultBranch` being present)
   - ref input → `placeholder="branch, tag, or sha (defaults to <d>)"`,
     `aria-label="Branch or ref"`, widened from `w-44` — it has to hold
     `feature/project-workspace-golden-path`
5. **Collapsed mode.** When `collapsible && bound && !expanded`, render one row:
   `<GitBranch/> owner/repo · <pinnedRef ?? defaultBranch>` plus a **Change** button
   (`aria-label="Change repository binding"`). Save and Unbind collapse it again.
   Without the prop the component renders exactly as today, so
   `ProjectOverviewPage.tsx:142` is untouched.

### Step 4 — pages

- `src/pages/IntentTracePage.tsx:330-332` — drop the `{!repository && …}` guard →
  `<RepoBindingCard project={project} collapsible onSaved={() => void load()} />`.
  `handleTraceClick` needs no change; `planTrace` already honours `pinnedRef`.
- `src/pages/DecisionsPage.tsx:263` — same, plus
  `suggestedRefs={commits.slice(0, 5).map(c => ({ ref: c.branch ?? c.sha, label: … }))}`.
  `extractSessionCommits` already parses the branch from `git branch --show-current`
  (`src/lib/understanding/decisions/sessionCommits.ts`); it is displayed at `:264-275`
  with the hint "Pin one as the repository ref…" and no way to act on it. Reword `:275`
  to "Use one as the tracked ref above to recover against the code the session produced."
- **Staleness hint** (`IntentTracePage.tsx:99-112`, wording at `:276`). Today it bails
  whenever `pinnedRef` is set, so on a non-default branch there is no staleness signal
  at all. Delete the `|| repo.pinnedRef` bail and compare against the ref the last trace
  actually used: `ref.ref ?? repo.pinnedRef ?? repo.defaultBranch ?? 'HEAD'`. Widen the
  state to `{ sha7, ref, switched }`. Wording: same ref → `· <ref> has moved to <sha7>`;
  switched → `· now tracking <boundRef> — re-trace to compare`. Keep
  `.catch(() => undefined)`; still one request per load. A sha-valued `pinnedRef`
  resolves to itself and is never reported stale — no special case needed.

### Step 5 — `src/lib/understanding/decisions/runRecovery.ts`

Add `fetchImpl?: typeof fetch` to `RecoveryConfig` (mirrors `TraceConfig` at
`runTrace.ts:63`; needed so tests can inject) and `ref?` to both the `resolveSnapshot`
return and `RecoveryPlan`. `src/lib/understanding/**` already imports
`src/lib/github/**` (`runTrace.ts:21`), so no layering rule is broken.

Ladder:

1. repoKey resolution unchanged.
2. `config.sha` still wins, still zero network.
3. `parseRepoKey(repoKey)` (`../../repo/sources`); a non-`gh` kind falls through to
   `latestCachedSnapshot` as today — branches do not apply to `fs:`.
4. GitHub: `ref = pinnedRef ?? defaultBranch ?? 'HEAD'` → `resolveRef(...)` with
   `{ token: config.token ?? await getGitHubToken(), fetchImpl: config.fetchImpl }`.
   - **success** → if `countRepoFiles(repoKey, sha) === 0`, return the sha **anyway**
     with `warning: "<ref> resolves to <sha7> but no snapshot is indexed; index it in
     Prepare → Evidence to add code links"`. Never substitute another branch's cache.
   - **throw** (offline, no token, no access) → fall back to `latestCachedSnapshot` with
     `warning: "Could not resolve <ref>; using the most recently indexed snapshot
     <sha7>, which may be from a different branch"`.
5. Propagate `ref` onto `RecoveryPlan` so `DecisionsPage` can state which ref a run used.

New imports: `resolveRef`, `countRepoFiles`, `parseRepoKey`.

### Step 6 — tests

**`src/lib/github/client.test.ts`** — rewrite the `parseRepoInput` block (`:52-67`;
**line 57 is the pinned-drop assertion that must change**): the reported branch URL →
full ref + candidates; `/tree/main` (no `refCandidates` key); `/tree/main/src`;
`/blob/main/src/lib/a.ts` → `main`; `/commit/<40 hex>`; `/pull/12` →
`refs/pull/12/head`; `/issues/3` → no ref; `?tab=…`; `#readme`;
`owner/repo@feature/x`; a `%2F`-encoded tree URL; `/tree/a..b` and `/tree/../etc` →
`{ owner, repo }` with **no** ref (the `assertRef` guard), not `null`.
`listCommits`: `{ ref: 'feature/x' }` sends `sha=feature%2Fx` and does not throw;
`{ ref: 'a..b' }` throws; the existing `{ sha }` case at `:188` is unchanged.

**NEW `src/components/intents/RepoBindingCard.test.tsx`** — none exists today; model it
on `src/components/prepare/TraceSection.test.tsx`. Cases: pasting the tree URL prefills
the "Branch or ref" field; Validate shows `tracking feature/… @ sha7` and *not* a
"default branch" headline; Save persists `pinnedRef`; re-rendering with the saved
project round-trips it into the field; candidate fallback (`/tree/main/src` — first
`resolveRef` 404s, second 200s, ≤2 calls, field settles on `main`); an unresolvable ref
disables Save and persists nothing; `collapsible` + bound renders the summary row and
**Change** expands it; a `suggestedRefs` chip click fills the field; every captured URL
starts with `https://api.github.com/` (mirrors `src/lib/repo/index.test.ts:143`).

**`src/pages/IntentTracePage.test.tsx`** — the card is still rendered when `repository`
is set (regression guard for the removed condition); the stale hint now fires with
`pinnedRef` set and reads `feature/x has moved to …`; switched-ref wording.

**`src/pages/DecisionsPage.test.tsx`** — card visible when bound; a session-commit chip
sets the ref.

**`src/lib/understanding/trace/runTrace.test.ts`** — `pinnedRef: 'feature/x'` hits
`/commits/feature%2Fx` and records `repoRef.ref === 'feature/x'`; `config.ref` still
overrides.

**`src/lib/understanding/decisions/runRecovery.test.ts`** — the existing cases at
`:84`, `:144`, `:203` now take the resolve path, so **inject `fetchImpl`**. New: the
bound ref resolves to sha B while sha A is the most recently cached → the plan uses
**B** and warns "no snapshot is indexed" (this is the actual bug); `resolveRef` rejects
→ falls back to A **with** the different-branch warning; `config.sha` set → zero
fetches; an `fs:` repoKey → zero GitHub calls.

**`src/lib/prepare/guided.constraint.test.ts:100`** — add a `pinnedRef: 'feature/x'`
case asserting `sha=feature%2Fx` in the query string.

## 5. Verification

1. `npm run typecheck && npm test && npm run lint`.
2. Layering unchanged (SPEC-change-workspace §2.6 / audit S10, SPEC-flow-map §21 D5):
   `grep -rn "github/client" src/lib/detection src/lib/investigation src/lib/flowmap`
   must stay empty.
3. Audit S2 — every request still goes through the one helper:
   `grep -n "fetch(" src/lib/github/client.ts` shows only the call inside `request()`.
4. Manual, `npm run dev` (port 4000) with the network panel open: paste
   `https://github.com/Kakob/Chatdex/tree/feature/project-workspace-golden-path` on the
   Intent Trace tab → the ref field shows the full branch; Validate issues exactly
   `GET /repos/Kakob/Chatdex` and
   `GET /repos/Kakob/Chatdex/commits/feature%2Fproject-workspace-golden-path`; the card
   reads "tracking feature/… @ sha7"; Save; reload → the collapsed summary shows the
   branch; **Change** reopens with it prefilled.
5. "Trace against repo" → the stored `repoRef.commitSha` is the branch head and
   `repoRef.ref` is the branch (check the trace row in IndexedDB).
6. Decisions tab → click a session-commit chip → Save → "Recover decisions" reports the
   chosen ref and warns, rather than silently reusing the last-indexed branch.
7. DevTools → Offline: the ref field is still editable, the stale hint stays silent, and
   recovery warns "may be from a different branch" instead of failing.

## 6. Spec conformance

- **SPEC-intent-trace §6** — "traces bind to an immutable sha, never a branch" governs
  what is *recorded*, not what the user may *choose*. `RepoRef.ref?` is already a
  first-class optional field (`src/types/intentTrace.ts:28-35`) and §8.3 defines
  `pinnedRef` as an optional free "ref/sha". Branch selection is not a non-goal,
  deferred item, or known gap in any spec.
- **SPEC-change-workspace §15.1 audit S2** — "new functions use the existing `request()`
  helper only". Satisfied trivially: no new endpoint is added (D1). The one behaviour
  change to `listCommits` keeps `assertSha` strict and adds `assertRef` alongside it.
- **Token scope** — unchanged. A fine-grained PAT with Contents: Read + Metadata: Read
  already covers everything here; the over-privilege warning logic is untouched.
- **Rate limit** — no new surface beyond the one `resolveRef` per Validate (plus up to
  two more only when a slashed `/tree/` URL is ambiguous), and one per recovery plan.
- **SPEC-flow-map §21 D5** — generation must make zero network calls. Nothing here is
  reachable from `src/lib/flowmap/**`; the change is confined to `src/lib/github/`,
  the binding UI, and two consumers.
- **SPEC-decision-recovery §2.2** — basis labels (`inherited` in particular) are computed
  against the bound snapshot, so binding the wrong branch silently changes them. Step 5
  is what makes that label trustworthy.

## 7. Sequencing

Steps 1–4 alone fix the reported bug and are independently shippable. Step 5 is the
Decisions-side correctness fix and can land separately. Step 2 is a two-line change that
can ride with either.

## 8. Related

- `docs/TODOS/DECISION-RECOVERY-TODOS.md` DR-6 — the demo branch `demo/project-deletion`
  is exactly the case this fix serves; today's workaround is to push the branch and
  hand-type a 7-char sha, or bind a local directory with the branch checked out.
- `docs/agent-build-logs-assessments-plans/INTENT-TRACE-BUILD-LOG.md` — as-built client
  surface and ref-resolution order.
