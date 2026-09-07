# Chatdex — Research Contribution Layer PRD

**Status:** Draft v0.1 — future release, not in current scope
**Owner:** Jacob
**Last updated:** April 7, 2026
**Depends on:** Chatdex core PRD (Pattern Mirror, Collections, Tagging, Encryption) shipped and validated.

---

## 1. Overview

The Research Contribution Layer is an opt-in feature that lets Chatdex users contribute specific, self-selected, self-annotated moments from their Claude conversations to a public research dataset. The dataset is intended to support research on how AI assistants behave in real, long-term use — particularly behaviors that are hard to study with synthetic data, such as wellbeing-motivated pushback, refusal patterns, sycophancy, memory-driven interventions, and the calibration of model judgments to actual user benefit.

The feature is designed to sit on top of Chatdex's existing local features (Pattern Mirror, Collections, Tagging) and reuse the annotation work users already do for their own purposes. Contribution is never the primary motivation — it is a side effect of behavior the user would do anyway, surfaced as an explicit, granular, reversible choice.

This PRD is a **forward-looking design document**. It is not in scope for the current Chatdex release. It exists so that the architectural decisions made in the current release do not preclude this future feature, and so that the design can be discussed openly (including with Anthropic) before any of it is built.

---

## 2. Why this exists

### 2.1 The research gap

Researchers studying how AI assistants behave in real use have three current options for data, all of which have serious limitations:

1. **Scraped public data** (Reddit threads, Twitter screenshots, blog posts). Low quality, no ground truth, heavily biased toward dramatic or shareable interactions, no context about the user or the conversation arc.
2. **Paid contractor annotation.** Expensive, generic, made by people with no context on the user, no investment in the outcome, and no retrospective view of whether model behavior aged well.
3. **Synthetic data.** Cheap and controllable, but artificial. Cannot capture the texture of real long-term use, real user goals, or real emotional context.

What no current dataset has is **user-curated, user-annotated, retrospectively-judged data from real long-term use**, where the annotator is the same person who had the conversation and can speak to whether the model's behavior was actually well-calibrated to their situation.

This is the gap the Research Contribution Layer is designed to fill.

### 2.2 Why Chatdex is uniquely positioned

Chatdex already has:

- A user base of power users who take their Claude conversations seriously.
- Local annotation infrastructure (tags, collections, Pattern Mirror corrections) that produces exactly the kind of structured judgments researchers need.
- Client-side encryption that makes it credible for users to trust the system with sensitive data.
- A relationship of self-interest with users — they are using Chatdex for their own benefit, and contribution is a low-friction additional choice rather than the reason they showed up.

No other tool combines these properties. Building this layer in Chatdex is significantly easier than building it as a standalone product, because the hard parts (collection infrastructure, annotation surfaces, user trust) already exist.

---

## 3. Goals and non-goals

### Goals

- Enable users to contribute **specific, self-selected** moments from their Claude history to a public research dataset.
- Make contribution **fully opt-in, per item**, with no blanket consent.
- Ensure users see **exactly what gets shared** before anything leaves their device.
- Support **retraction** — users can delete contributed items at any time, and deletions propagate to dataset releases.
- Produce a dataset that is **genuinely useful to researchers** studying model behavior, especially behaviors that are hard to study otherwise (pushback calibration, refusal patterns, sycophancy, memory effects).
- Build the system in a way that **Anthropic and the broader AI research community would view as legitimate** — careful, transparent, well-consented, honestly framed.
- Treat the dataset as a **research contribution in its own right**, not as a marketing feature or growth hack.

### Non-goals

- Not a marketplace. Users are not paid for contributions and the dataset is not sold.
- Not a public sharing or social feature. Contributions are anonymized and pooled into a dataset, not displayed under usernames.
- Not a way to make Chatdex's primary features depend on contribution. Chatdex must be fully usable without ever contributing anything.
- Not a way to collect data Chatdex couldn't otherwise see. Encryption guarantees still apply — contribution requires explicit user-side decryption and approval.
- Not a "report bad Claude responses" feature. The dataset is for research on model behavior in general, not for grievance documentation or PR cycles.

---

## 4. Users

### 4.1 Contributors

The target contributor is a Chatdex power user who:

- Has been using Chatdex for at least a few weeks and has a meaningful corpus of conversations.
- Has used Pattern Mirror, Collections, or Tagging enough to have formed judgments about specific moments in their history.
- Is intrinsically interested in AI research, model behavior, or AI safety, and sees contribution as a way to support work they care about.
- Trusts Chatdex enough (because of the encryption story and the existing local features) to consider sharing curated moments.

Contributors are **not** assumed to be representative of all Claude users. They are a self-selected, technically engaged, research-curious subset. This is acknowledged in the dataset documentation as a known and important bias.

### 4.2 Researchers

The intended consumers of the dataset are:

- Independent researchers studying LLM behavior, alignment, or human-AI interaction.
- Academic groups working on AI safety, HCI, and applied ML.
- Industry research teams (including at Anthropic, OpenAI, DeepMind, and others) looking for high-quality user-annotated data.
- Journalists, policy researchers, and civil society groups studying how AI assistants behave in practice — provided they engage with the dataset's limitations honestly.

The dataset is published under a research-friendly license with clear documentation of methodology, biases, and intended use.

---

## 5. The contribution flow

### 5.1 Entry points

Users can mark a moment for contribution from any of these surfaces:

1. **From a tagged message:** When a user tags a message (in the existing tagging feature), a "Contribute to research" option appears as a secondary action.
2. **From a collection:** When a user adds a message to a collection, they can optionally mark it for contribution.
3. **From Pattern Mirror:** When a user corrects a pattern (e.g., "this wasn't really pushback" or "this pushback was well-calibrated"), the correction itself can be contributed.
4. **From the contribution dashboard:** A dedicated view where users can review their existing tags and collections and decide which to contribute in batch.

In all cases, marking for contribution is a **second, deliberate action** distinct from tagging or collecting. A user never accidentally contributes anything by tagging.

### 5.2 The consent moment

When a user marks an item for contribution, they see an inline panel (not a modal — modals get dismissed without reading) that shows:

- **What gets shared:** the specific message(s) being contributed, the surrounding context (configurable, default 2 messages of context), the user's annotation, and the structured summary fields relevant to the contribution.
- **What gets removed:** automated PII redaction is run and the redacted spans are highlighted. The user can review, accept, or edit the redactions.
- **Where it goes:** a public dataset on HuggingFace (or equivalent host), under license [X], used by researchers studying model behavior.
- **Reversibility:** an explicit note that contributions can be deleted at any time from the contribution dashboard, and that deletions propagate to dataset releases.
- **Two buttons:** "Contribute" and "Not this one." There is no third option that is more obscure or smaller.

The user can preview the exact JSON payload that will be uploaded before approving. This is the trust unlock — users who can see the bytes trust the system; users who can't, don't.

### 5.3 Per-contribution review

Before any data leaves the user's device:

1. The contribution payload is constructed in the browser.
2. PII redaction is applied (see Section 6).
3. The user is shown the final payload with all redactions visible.
4. The user can edit the payload (further redact, add or remove context messages, modify the annotation).
5. Only after the user clicks an explicit "Confirm and upload" does the payload leave the device.

There is no background upload, no batch consent, no "you already agreed when you signed up." Every contribution is a deliberate, individually-consented action.

### 5.4 The contribution dashboard

A settings page lists every contribution the user has ever made. Each entry shows:

- The original message and context.
- The annotation contributed.
- The redactions that were applied.
- The date contributed.
- The dataset release(s) it appears in.
- A "Delete this contribution" button.

Deletion is real: when a user deletes a contribution, the entry is marked for retraction in the next dataset release, and the previous release is updated with a retraction note. (See Section 8 for the retraction model.)

---

## 6. PII redaction

Redaction is the highest-risk technical area in this feature. It must be conservative by default, transparent to the user, and never fully automated.

### 6.1 Redaction pipeline

1. **Regex pass:** Email addresses, phone numbers, URLs, common ID patterns (SSN-like, credit-card-like), and obvious file paths are flagged.
2. **Model pass:** A separate Claude API call with a focused prompt identifies any text that looks like personally identifying information — names, locations, employer names, project names that could identify a person, family member references, health details, financial details.
3. **User pass (mandatory):** The user reviews all flagged spans and can accept, reject, or add to them. The user can also manually highlight any other text and mark it for redaction.
4. **Redaction application:** Flagged spans are replaced with type-tagged placeholders (e.g., `[NAME]`, `[LOCATION]`, `[PROJECT]`, `[REDACTED]`) before the payload is uploaded.

### 6.2 Conservative defaults

- All proper nouns are flagged by default, even if they look harmless.
- Numbers in contexts that could be identifying (dates near events, ages, dollar amounts in personal contexts) are flagged.
- The default is to over-redact and let the user un-redact, never the other way around.

### 6.3 What is never contributed

Regardless of user choice, certain categories are never included in any contribution payload:

- Authentication tokens, API keys, passwords, or anything matching credential patterns.
- Anything from a conversation the user has marked as "private" in Chatdex.
- The user's Chatdex account identifier or any internal IDs that could link contributions back to a single user across the dataset.

---

## 7. The dataset

### 7.1 Format

The dataset is published as a versioned collection of JSON records. Each record contains:

- A unique contribution ID (random, not linkable to user).
- The contributed message(s) and context, with redactions applied.
- The user's annotation (category, free-text reasoning, retrospective judgment).
- The relevant fields from the structured summary (topics, intent, behaviors).
- A coarse temporal bucket (e.g., "Q1 2026") rather than exact timestamps.
- The model identifier and version, if known.
- A schema version for the contribution format itself.

### 7.2 Hosting

The dataset is published on HuggingFace Datasets (or an equivalent host) under a clear license. The dataset card includes:

- A description of what the dataset contains and what it is intended for.
- A description of the methodology — how data was collected, how it was annotated, how it was redacted, what consent users gave.
- A description of known limitations and biases — small sample size, power-user bias, self-selection effects, single-platform (Claude) bias, the fact that contributors had retrospective knowledge that affected their annotations.
- A statement of what the dataset should **not** be used for — training models to mimic specific user behavior, identifying individuals, building "Claude criticism" archives, sensationalist journalism.
- Contact information for researchers who want to ask questions or report issues.
- A link to the methodology paper or writeup.

### 7.3 License

Initial recommendation: **CC BY 4.0** with a clear "intended for research" framing in the dataset card. This is the most useful license for legitimate researchers and aligns with how most academic datasets are released. If consultation with Anthropic or with privacy-focused advisors suggests a more restrictive license, this can be revisited before launch.

### 7.4 Release cadence

- Releases are versioned (v0.1, v0.2, etc.) and immutable once published, with one exception: retraction notices for deleted contributions.
- Initial cadence: quarterly releases, with the first release happening only when at least 500 contributions have accumulated. Below that threshold, the dataset is not statistically meaningful and shouldn't be published.
- Each release includes a changelog: how many new contributions, how many retractions from previous releases, any methodology changes.

---

## 8. Retraction

Retraction is a real feature, not a marketing claim. It must work end-to-end.

### 8.1 How it works

- When a user deletes a contribution from their dashboard, the entry is marked for retraction in Chatdex's contribution database.
- At the next dataset release, retracted entries are removed from the new release.
- A retraction notice is published alongside the previous release: "Contribution IDs [X, Y, Z] have been retracted by their contributors. Researchers using v0.1 should remove these IDs from their analysis."
- The retraction notice is part of the dataset card and is also distributed via the HuggingFace dataset's update mechanism.

### 8.2 Honest limitations

Retraction propagates to **future** releases and to retraction notices on past releases. It does not retrieve data from researchers who have already downloaded a previous release. Users are told this explicitly in the consent flow:

> "If you delete a contribution, it will be removed from future releases and a retraction notice will be published. We cannot retrieve the data from researchers who already downloaded earlier releases. If this is a concern, do not contribute data you may want to fully delete later."

This is the honest version. Most consent flows lie about this or hand-wave it. Chatdex does not.

---

## 9. Architecture

### 9.1 Backend

The contribution layer requires backend infrastructure that the core Chatdex product does not:

- A **contribution API** that accepts uploads, validates them, stores them in a contribution database, and assigns IDs.
- A **contribution database** (separate from the user storage Postgres) that holds all contributed records, their consent metadata, and their retraction status.
- A **release pipeline** that takes the current state of the contribution database, applies retractions, packages the dataset, and publishes to HuggingFace.
- An **audit log** of all uploads, retractions, and releases, for transparency and debugging.

The contribution database is a **separate service** from the user storage Postgres for two reasons: (1) different security requirements, (2) clean separation between "user's personal data" and "contributions to a public dataset."

### 9.2 Encryption boundary

Contributions are explicitly **outside** the client-side encryption boundary. The user is decrypting their data locally, reviewing it, and choosing to upload a plaintext copy of the specific contribution to the contribution backend. This is the only path by which data leaves the encryption boundary, and it requires deliberate per-item user action.

### 9.3 No linking

The contribution backend stores no user identifiers. Each contribution is associated with a random contribution ID and a Chatdex installation ID that is rotated periodically. There is no way for Chatdex operators to link multiple contributions to the same user, and no way to link contributions back to the user's primary Chatdex account.

This is enforced architecturally, not just by policy.

---

## 10. Anthropic relationship

This feature is the part of Chatdex that touches Anthropic's interests most directly. The plan for engaging with Anthropic is:

1. **Build the core Chatdex features first** (Pattern Mirror, Collections, Tagging, Encryption) and ship them. The contribution layer is not built until the core features have been validated with real users.
2. **Once the core features are shipped and used**, draft an outreach email to Anthropic describing the contribution layer design (this PRD or a summary of it).
3. **The email is informational, not a permission request.** Users own their own data, and Chatdex is providing tooling for users to share their own data deliberately. The email's purpose is transparency, goodwill, and getting feedback that might catch real problems in the design.
4. **Specific questions to ask Anthropic:**
   - Are there terms-of-service considerations for this kind of third-party data sharing?
   - Are there design choices in the consent flow or dataset release that would make Anthropic more comfortable?
   - Is there existing internal work in this space that this should complement or avoid duplicating?
   - Would Anthropic be interested in a preview of the dataset or in discussing schema design?
5. **Genuine willingness to adjust.** If Anthropic raises concerns that have merit, the design changes. If Anthropic raises concerns that don't have merit, the design doesn't change but the conversation is still worth having.
6. **Public posture:** Chatdex's public framing of the feature is careful, research-oriented, and explicitly not adversarial. This is research infrastructure, not "Claude's worst moments archive."

---

## 11. Risks and mitigations

### 11.1 Risk: low contribution rate

Users may engage with Pattern Mirror and Collections for their own benefit but never contribute anything.

**Mitigation:** That is **acceptable**. The contribution layer is a bonus, not the reason Chatdex exists. If only 5% of users ever contribute, that's still a valuable dataset because the 5% are highly engaged. The feature is designed so that low contribution rates do not break anything.

### 11.2 Risk: poor data quality

Contributors may annotate carelessly, contribute trivial moments, or self-select toward dramatic content.

**Mitigation:** The structured summary fields and the requirement of a free-text reason for each contribution raise the floor. The dataset card honestly documents these risks. Researchers using the dataset can filter on metadata (e.g., contributions where the annotator wrote more than 50 words of reasoning).

### 11.3 Risk: PII leakage despite redaction

A user might fail to notice and redact something sensitive.

**Mitigation:** Conservative default redaction, mandatory user review, explicit warning in the consent flow ("Look carefully — once this is published, it cannot be fully recalled"), and a 24-hour delay between user approval and actual upload (giving them time to change their mind and unmark before the upload happens).

### 11.4 Risk: misuse of the dataset

Researchers, journalists, or bad actors could use the dataset in ways the contributors didn't intend.

**Mitigation:** Clear license terms, dataset card stating intended use and prohibited uses, willingness to publicly call out misuse. Acceptance that some misuse is possible and that this is a tradeoff inherent to publishing any dataset. The alternative — never publishing — would prevent legitimate research and is worse.

### 11.5 Risk: Anthropic objects after launch

Even with careful outreach, Anthropic may take a position that the feature should not exist.

**Mitigation:** The outreach happens **before** launch, not after. If Anthropic raises serious objections that cannot be resolved, the feature is delayed or redesigned. Shipping over Anthropic's clear objection is not the plan.

### 11.6 Risk: legal exposure

Privacy law (GDPR, CCPA, etc.) imposes obligations on data controllers and processors. The contribution layer makes Chatdex a data controller for the contribution dataset.

**Mitigation:** Before launch, consult with a lawyer who specializes in privacy law and data protection. Build the deletion flow, the audit log, and the consent flow to legal standards, not just to good-faith standards. Budget for this work explicitly.

---

## 12. Open questions

- **How are contributors recognized, if at all?** Some users may want credit for their contributions; others want full anonymity. Is there an opt-in attribution layer (e.g., a username appears in the dataset card but not on individual records)? Or is it strictly anonymous?
- **What's the minimum viable annotation schema?** The core PRD's structured summary schema is a good starting point, but the contribution annotation may need additional fields (retrospective judgment, why the contributor thinks this matters, how it aged).
- **How do we handle disagreement between contributors and the model's structured summary?** If a user marks something as pushback that the model didn't flag, or vice versa, which version goes into the dataset? Probably both, with an explicit "model classification" and "user classification" field.
- **What's the right release cadence?** Quarterly is a guess. Could be slower (annual) for more careful curation, or faster (monthly) once volume picks up.
- **Should there be a private beta release first?** Possibly: invite a small set of researchers to use the first release under a confidentiality agreement, gather feedback, then publish publicly. This adds friction but reduces the risk of the first public release being embarrassingly flawed.
- **How does this interact with Chatdex's business model?** If Chatdex eventually charges for features, does contribution unlock anything? Probably not — coupling contribution to product features is the kind of thing that erodes consent. But it's worth thinking about explicitly.

---

## 13. Definition of done

This feature is done when:

1. Users can mark specific tagged messages, collection items, or Pattern Mirror corrections for contribution.
2. The consent flow shows the exact payload, including all redactions, before any upload.
3. PII redaction runs end-to-end with regex, model, and user review passes.
4. The contribution backend accepts uploads, stores them with retraction support, and exposes no user-linking metadata.
5. The contribution dashboard lets users view and delete their contributions.
6. A first dataset release of at least 500 contributions has been published on HuggingFace with a complete dataset card, methodology documentation, and clear license.
7. Anthropic has been informed of the feature, given the opportunity to provide input, and any serious concerns have been addressed.
8. A privacy lawyer has reviewed the consent flow and the data handling practices.
9. The retraction pipeline has been tested end-to-end at least once with real (test) data.
10. A short writeup of the feature, the dataset, and the methodology has been published — either as a blog post or as a brief paper on arXiv or LessWrong.

Anything beyond this list — paid contributions, social features, multi-model support, real-time releases — is explicitly **out of scope** for v1 of this feature.

---

## 14. Why this is deferred

This feature is **not** in the current Chatdex release for several reasons, all of which are deliberate:

1. **The core features need to ship and be validated first.** If users don't engage with Pattern Mirror, Collections, and Tagging, then the contribution layer has no foundation. Building contribution before validating engagement is building on sand.
2. **The encryption work needs to be done first.** Contribution is a meaningful exception to the encryption guarantees, and that exception only makes sense if the encryption story is solid in the first place.
3. **The Anthropic conversation needs to happen at the right time.** Reaching out to Anthropic with "I built this and shipped it" is much stronger than "I'm planning this." Shipping the core first puts the contribution outreach in a much better position.
4. **The feature is significant work in its own right.** Backend, consent flow, redaction pipeline, dataset release infrastructure, legal review, methodology writeup — this is months of work that should not be rushed alongside the core features.
5. **The personal pattern of taking on too much at once.** Adding this to the current release would balloon the scope, push out the launch, and increase the risk that nothing ships. Holding it as a future release is the disciplined choice.

This PRD exists so that the design is **ready** when the core features have shipped and the time is right — not so that it gets built today.
