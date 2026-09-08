# Share Build Story — proposed implementation contract

Status: Proposed, 2026-09-08. [PLAN.md](PLAN.md) owns delivery; [PRD.md](PRD.md) owns purpose.

## 1. Ownership and architecture

Propose a Private → Shared capability; Share Build Story is its first bounded change.
Private authoring is project-scoped. Proposed routes: `/projects/:id/stories` and
`/projects/:id/stories/:storyId`; public reading at `/s/:opaqueToken`. Source surfaces
expose Add to build story; selection collects privately and never publishes.

The existing backend handles private ciphertext sync and transit-only AI relay. Public
publication requires a distinct authenticated owner API, public-read API and storage
model. Do not place public plaintext in private sync envelopes or persist private
provider requests in the relay. Public readers receive only a self-contained approved
snapshot. They must not call authenticated source APIs or resolve private source IDs.

## 2. Records

| Record | Contract |
| --- | --- |
| StoryDraft | Project/story ID, title, authored blocks/order, evidence selections, selected source revision IDs, contact links, optional reusable material, local revision/time. |
| StoryEvidenceSelection | Private source locator, pinned revision/hash, bounded original excerpt, edited shared excerpt, context note, redaction changes, attribution. Private metadata. |
| StorySuggestion | Scoped instruction/context, provider/model, proposed blocks, request/response references, adoption/edit history. Private and explicitly generated. |
| PublicationSnapshot | Schema version, revision ID, title, narrative blocks, approved excerpts/context, safe attribution labels, approved links and approved downloadable text assets. No private source graph. |
| PublishedStory | Owner ID, opaque token, active revision, publication state/time and owner revision history. |
| StoryMetric | Story/revision ID, day bucket, allowlisted action and public block/asset key, count. No reader identity. |

Snapshot blocks have fresh public IDs unrelated to internal evidence identifiers.
Compiler uses a field allowlist; never serialize the draft and remove a few fields.
Raw original excerpts, redaction maps, internal paths/IDs, project membership, hidden
metadata and source URLs are excluded unless a particular display field is explicitly
selected/reviewed. Hash alone is not sanitization and must not leak private fingerprints.

Narrative annotations are separate from source corrections. Upstream revision changes
mark private collected material out of date and offer comparison; no automatic draft
replacement, and never any automatic published replacement.

## 3. Authoring, AI and review

Provide accessible writing surface and evidence tray, responsive tabs on small screens,
and keyboard controls for attach/reorder/remove. Selected decision revisions preserve
contribution origin without forcing the author to describe every AI correction in prose.
Read-only original excerpts remain distinguishable from edited excerpts. Text insertion
is not a verified claim. Missing/private sources cannot resolve in the public viewer.

AI drafting is explicit and scoped to selected material/instructions with the current
provider and cross-source disclosure. Reuse opt-in credentials and transit-only relay.
Suggestions remain separate until accepted; no request on merely opening a story.
Failures preserve authored text. No invented links, events, motivation or attribution.

Prepare a share candidate locally from a specific draft revision. Show recipient preview
and included-content list covering every narrative block, excerpt, context span, contact
link, asset and filename. Suggest sensitive-content review and mark edits visibly in
review. A change after approval invalidates approval for the changed candidate; publish
only the exact reviewed content hash/version. The server validates the allowlisted
schema but cannot claim it has verified the truth or privacy of the narrative.

No active HTML, scripts, remote embeds or arbitrary binary uploads in v1. Markdown/text
assets and code examples render inertly. Allow http/https links with external-link
handling; no automatic external fetches. Explicitly review public repo links because
filenames, URLs and surrounding context may themselves disclose private information.

## 4. Publish, update, withdraw and export

Authenticated Publish submits only the reviewed snapshot plus an idempotency key and
expected active revision. Create a high-entropy unlisted token with no directory or
sitemap listing, and noindex metadata; explain that these are not access control.
Public reads need no login. Owners alone update/unpublish/view analytics, with server
ownership checks independent of user-supplied project/story IDs.

Updates use compare-and-swap on active revision and immutable snapshot IDs. Retries
return the same result; stale updates require refresh/review. Keep the stable story URL
pointing at the active revision. Prior versions are owner-visible only, not publicly
addressable through guessed revision IDs. No published content changes on draft save.

Unpublish disables all public page/snapshot/export endpoints for that story. Return a
neutral unavailable response. Serve public API/page/export with no-store in v1 and
avoid persistent service-worker/CDN copies; handle stale in-flight publication updates
with server revision checks. Browser copies/screenshots/previous downloads cannot be
revoked. Republishing is an explicit reviewed action. Permanent account/publication
deletion must remove served content and aggregates, not merely delete a local draft.

Export compiles the same reviewed snapshot, even for a story never hosted. Initial
formats: standalone static HTML and Markdown, with approved text assets where provided.
Exports omit analytics code, private locators, redaction originals and hidden metadata.
Owner export of unpublished drafts still requires shared-content review. Public downloads
resolve only the active publication. Format-specific rendering must not expose extra
source content. Opening a code example/export must not execute source artifacts.

## 5. Aggregate analytics

Allow page-open, evidence-expand, asset/export-download and contact-click counters,
keyed by story revision/day and public block/asset ID. Do not record reader/user/session
IDs, IP addresses, user-agent strings, referrers, free text or arbitrary destinations in
analytics records. No cookies, fingerprinting or cross-request journey reconstruction.
Label totals as events, not unique visitors or reading time. Empty data means no recorded
activity, not proof of no readers. Preview/owner mode does not emit public reader events.

Validate events against the currently served revision and allowed blocks; bound payloads
and event volume. Exclude content bodies and tokens from application analytics logs.
Infrastructure access-log retention and rate limiting must be audited before rollout;
transient abuse controls must not become reader profiling or populate StoryMetric.
Provide a clear page notice describing aggregate activity collection. Failed/blocked
analytics never blocks reading. No third-party analytics SDK in v1.

Proposed retention: delete daily aggregates older than 90 days and all aggregates on
permanent publication deletion; unpublishing retains owner-visible aggregates until
expiry. This duration is an implementation default to review, not a user-stated limit.
Counts may include bots/repeated opens and must not be presented as precise human reach.

## 6. Persistence, security and operation

Private draft storage is local-first. Proposed first slice uses Dexie with explicit
Saved on this device labeling and private-draft backup separate from reader exports.
Only approved snapshots reach public server storage. Publication management remains
accessible to the owner from another authenticated device even if its draft is absent;
editing may begin from the approved snapshot without reconstructing private evidence.
Encrypted draft sync is deferred to a dedicated schema/conflict/deletion extension.

Implement public snapshots in separate backend tables/routes with size limits, authenticated
mutations, owner authorization, input validation, existing auth protection appropriate to
its transport, and safe server rendering/response headers. Public readers cannot enumerate
private projects, resolve raw source locators, retrieve old revisions or view analytics.
No provider credentials or private conversation plaintext enter publication payloads unless
that exact excerpt is expressly reviewed for public disclosure; credentials must be removed.

Network errors leave draft and reviewed candidate intact, with publication state unknown
until reconciled by idempotency/status lookup. Offline authoring/review/export works;
publish/unpublish requires connectivity and must not claim withdrawal before server success.
Local project removal must explain separately whether a hosted story remains; account
and publication deletion flows must explicitly cover both server and local records.

## 7. Verification

Test allowlist compilation with adversarial private markers in source IDs, annotations,
redaction maps, filenames, source links and hidden fields. Inspect every public HTML/JSON/
export response for leaks. Test raw HTML/script sanitization, URL handling, asset access,
ownership/unauthenticated mutations, token routes, stale update conflicts, retry idempotency,
old-revision inaccessibility and complete unpublish behavior. Test aggregates contain no
reader identifiers and analytics outages do not break the page. Verify local-only labels,
draft edits not changing publication, upstream revisions not changing excerpts, and export
parity. Manual review uses a logged-out browser with only the shared link.
