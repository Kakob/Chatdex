# Branch Binding — build log

Append-only. Plan: `PLAN.md`. Status lives in `docs/tracks/README.md`.

---

## 2026-09-07 — steps 1–6, one pass

Plan steps 1–6 all landed together; step 7's split (1–4 shippable alone, 5 separable)
was not needed because the whole change typechecks, lints and tests as one unit.

**Step 1 — `src/lib/github/client.ts`.** `parseRepoInput` now returns
`ParsedRepoInput { owner, repo, ref?, refCandidates? }`. Query/hash are stripped up
front; three anchored patterns capture an optional remainder; `refCandidatesFromRemainder`
reads `tree`, `blob`, `commit`/`commits`, `releases/tag`, `pull/<n>` and the shorthand
`@ref`, decoding `%2F` into segments. Every candidate passes `assertRef` or is dropped,
so a returned ref can never throw downstream. `ref`/`refCandidates` keys are omitted
when absent, and `refCandidates` only appears when the ref is genuinely ambiguous —
existing `toEqual({ owner, repo })` assertions were unaffected. `listCommits` gained
`ref?` (validated with `assertRef`, sent as the `sha` query parameter) while `sha?`
keeps `assertSha` strict. No new endpoint, no `/branches` call (D1).

**Deviation from the plan.** For `blob/…` the plan said both "longest-first" and
that `/blob/main/src/lib/a.ts` must yield `main`; those contradict. Blob candidates
are ordered **shortest-first** (`['main', 'main/src', 'main/src/lib']`) because a blob
URL's file path is almost always longer than its ref, so the first attempt is usually
the right one. `tree/…` stays longest-first as specified.

**Step 2 — `src/lib/prepare/guided.ts`.** The dead `...(pinnedRef ? {} : {})` spread now
passes `{ ref: repository.pinnedRef }`, so history evidence follows the bound branch.

**Step 3 — `src/components/intents/RepoBindingCard.tsx`.** Pasting a URL prefills the
branch (never over typing); Validate walks `[ref, ...refCandidates]` deduped and capped
at three `resolveRef` calls and keeps the first that resolves; a ref that resolves
nowhere leaves the repo half validated, shows why, and **disables Save** — a ref is
never silently dropped. The "default branch" verdict headline became
`tracking <ref> @ <sha7>` with the default branch demoted. New `collapsible` prop
(one-line summary + **Change**) and `suggestedRefs` chips. `pinnedRef` stays the
persisted field name (D2); only local names and labels changed.

**Step 4 — pages.** `IntentTracePage` and `DecisionsPage` render the card
unconditionally with `collapsible`; `ProjectOverviewPage` is untouched. The staleness
hint no longer bails when `pinnedRef` is set — it resolves the ref the binding tracks
now and distinguishes "moved" from "switched refs". `DecisionsPage` feeds session
commits in as chips and the disclosure names the ref alongside the sha.

**Step 5 — `runRecovery.resolveSnapshot`.** For a `gh:` repoKey it resolves
`pinnedRef ?? defaultBranch ?? 'HEAD'` to a sha (D4). An unindexed snapshot returns the
sha anyway with a warning rather than substituting another branch's cache; only a
failed resolve falls back to `latestCachedSnapshot`, and then it says the snapshot may
be from a different branch. `config.sha` still short-circuits with zero network, `fs:`
keys never touch GitHub. `RecoveryConfig.fetchImpl` was added for tests; `RecoveryPlan.ref`
carries the ref to the UI. This is what makes the `inherited` basis label
(SPEC-decision-recovery §2.2) trustworthy.

**Step 6 — tests.** `client.test.ts`: the pinned drop assertion is gone; tree/blob/commit/
pull/tag/@ref/`%2F`/query/hash cases, `assertRef`-rejected refs returning `{owner, repo}`
rather than `null`, and the `listCommits` ref/sha split. New `RepoBindingCard.test.tsx`
(6 cases, incl. candidate fallback in ≤2 resolves, Save disabled on an unresolvable ref,
collapse/expand, chips, and every URL on `api.github.com`). New cases in
`IntentTracePage.test.tsx`, `DecisionsPage.test.tsx`, `runTrace.test.ts`,
`runRecovery.test.ts` (now injecting `fetchImpl`) and `guided.constraint.test.ts`.

**Verification.** `npm run typecheck`, `npm run lint`, `npm run test:all` green —
972 frontend tests across 118 files (three consecutive full runs), 6 backend.
Layering grep over `src/lib/detection|investigation|flowmap` for `github/client` is
empty; `client.ts` still has exactly one call site, inside `request()`.
Plan §5 items 4–7 (the manual browser pass) are outstanding.
