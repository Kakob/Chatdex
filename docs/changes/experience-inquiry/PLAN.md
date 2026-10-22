# Experience inquiry

Status: In progress
Primary capability: [Decision Investigation](../../capabilities/decision-investigation/SPEC.md) (§2, §7–8, §12, §20–21).
Related: [Understanding Workspace](../../capabilities/understanding-workspace/PRD.md) (§8–11).

## Problem and authorized scope
Question investigations currently require a single accepted conversation. The user authorized a local, human-led cross-source research slice, with immutable documentary snapshots, reference-only inventory, human findings, question lineage and private exports. The working tree was clean on `feature/project-workspace-golden-path`. No branches, commits, accounts or original documents will be changed.

## Design and contract amendments
Add local-only research source/snapshot/exhibit and relation-history tables. Reuse investigation cases and findings; opt-in `research` cases carry an empty legacy conversation locator and explicit source IDs, leaving existing anchored and single-conversation cases unchanged. Reuse question UnderstandingObjects and introduced events; explicit fork/merge relations require a small append-only relation table. No AI invocation. Existing derived records retain encrypted sync; new source material and relation history remain device-local. Research source IDs are scoped to a project and attachment is explicit acceptance. DA&E remains a separate proposed AI/code workflow; this slice does not implement or widen it.

## Steps and acceptance
1. Baseline typecheck, frontend tests, build all; inspect sync and migration boundaries.
2. Add additive Dexie v14, source shelf, text preview/import and private registry registration.
3. Question-only cases, multiple sources, exact selection, bounded search, evidence board and finding revisions.
4. Human question nodes, branching relations with reversible history, compare originals.
5. Private JSON/Markdown export, synthetic walkthrough, adversarial tests and full checks.

Preserve old data and flows; verify version/idempotence, missing/corrupt evidence, project boundaries, attribution, separate dates, history and default export omissions. PDF/EML conversion is manual. No private fixtures. Export is a portable inspection/backup packet; restoration is not implied.

## Outcome
Local research slice implemented; final acceptance remains in progress. See the delivery record below.

## Delivery record — 2026-10-18

The original [handoff](CODEX_HANDOFF_CHATDEX_INQUIRY.md) is now preserved verbatim in
this change package. [WALKTHROUGH.md](WALKTHROUGH.md) explains source preparation,
registry registration, the actual research UI, and private storage. The original
private JSON is copied to ignored `research-data/mit/mit_research_sources.private.json`;
it is not tracked documentation and has not become imported evidence.

Implemented locally: source shelf, text versions, registry preview, accepted-conversation
snapshots, additive research cases/exhibits, human finding revisions, canonical question
nodes, relation history, private export preview, and isolated synthetic sample. Added
a direct research-shelf link to every project header after feedback that the workflow
was difficult to find. Existing anchored cases and single-conversation pages remain.

Verified before interruption: baseline 978 frontend tests; initial implementation 986
frontend tests and 53 backend tests; frontend/backend builds, lint and typechecks passed.
Live synthetic browser exercise covered original inspection, CRLF selection/pinning,
two-question comparison and retained finding revision. Follow-up selection/sync tests
and final documentation checks are recorded below when rerun.

Remaining acceptance: complete browser checks for changed-file reimport, relation
correction and downloaded packet inspection; full owning-contract reconciliation and
cross-case export review. Three authorized Google Doc exports are now imported locally (see follow-up below). Status
remains In progress; these limitations must not be mistaken for imported evidence or
completed acceptance.

### Bundle documentation follow-up verification

`npm run typecheck`, `npm test` (119 files, 988 tests), `npm run lint`, and
`git diff --check` passed. This includes the added CRLF selection and synced finding
revision timestamp tests. The two copied bundle files match their originals
byte-for-byte; `git check-ignore` confirms the private inventory is excluded, and
`git ls-files` contains no private inventory. New documentation links resolve locally.
No commit, push, account fetch, or source-document import was performed.

### Import and direct reading follow-up

The user authorized read-only export of the three inventory Google Docs. All three
are now imported into their existing registry entries in the user's localhost Chrome
workspace; the other eight leads remain reference-only. Exports stay gitignored.
No original document was modified. The third export used the new paste fallback;
its displayed text matches the full export after CRLF-to-LF normalization.

Added a preview/confirm paste importer alongside the native file picker (whose Open
button was disabled on macOS), and full snapshot readers directly on source cards.
The Read sources link jumps to the shelf; version selection preserves access to older
text. The header now labels conversation counts explicitly. No storage migration,
new account integration, or sync changes.

Verification: typecheck and 989 frontend tests passed, including an integration test
covering preview without persistence, confirmed import into an existing lead, literal
text rendering and switching to an earlier version without creating a case. Live
browser verification confirmed all three imported versions and the third full text.
The earlier broad-slice acceptance items remain open.
