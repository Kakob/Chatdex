# Engineering iteration 4 — one coding workspace for humans and agents

Branch: \`feature/engineering-shared-code-workspace\`  
Base: \`feature/engineering-general-model-3-5\`  
Scope: staged full-file source revisions, agent handoff, explicit local write, linked model history, and a real Event Queue code change.

## Main idea

**The model is the navigation and engineering context; code remains executable source.**

We should not build a separate human editor and an unrelated AI coding workflow. Both produce the same source revision object, linked to the same project, engineering entity, and checked source binding. The actor and provider are metadata, not different code paths.

\`src/lib/engineering/codingProtocol.ts\` defines \`SourceEditProposal\` with:

- Identity: project, target model entity, source-binding ID, repository/path/revision.
- Exact baseline content and SHA-256; proposed full-file content and SHA-256.
- Human or agent actor, provider ID, goal, time.
- The \`EngineeringCodingProvider\` handoff seam: \`manual-editor\` and \`chatgpt-handoff\` are built in. Future autonomous providers can return the same full-file proposal shape; they are not wired to run inside the browser yet.
- A pure, bounded changed-region preview (not a full Myers/multi-hunk diff).

\`src/lib/engineering/codingStore.ts\` validates project/target/binding ownership, refuses missing/changed baselines, requires non-empty bounded source, hashes both versions and appends a revision to the device-local engineering-model DB. Existing native Chatdex project concepts are NOT overwritten by proposed source.

The database adds \`codeRevisions\` and \`codeWrites\` in additive Dexie **version 3**; older models and proposals remain intact. The extra tables are device-local and are **not synced**.

## Actual user experience

On either installed example project:

1. Select an engineering concept (Event Queue → Retry is a useful first example).
2. Open **Code**. On a phone this expands the inspector to avoid squeezing the source view under the diagram.
3. Beneath the actual source excerpt, open **Build through this model → Open editor**.
4. Choose **Hand code** to edit/paste the full file, or **Agent result** to copy a ChatGPT handoff and paste the agent-returned full file.
5. Enter an engineering goal. The same editor displays a bounded changed-region summary.
6. Click **Stage revision**. The source edit is persisted against the selected engineering entity; it is a proposal, not runtime code.
7. Return to **Understand → Shared model → Linked code revisions** to inspect which model entity the source revision belongs to.
8. On desktop Chromium, the explicit **Apply staged file to chosen local folder** button opens an isolated read/write directory picker, checks the selected existing file against the staged full-file baseline, and writes only after a confirmation. It does not create paths, commit Git, run tests, modify unrelated files or silently broaden permissions.
9. iPhone/Safari and unsupported platforms: use **Copy complete code** to apply in an IDE, or copy the agent handoff to ChatGPT, which can make a GitHub feature-branch change separately. Direct local writes are unavailable; do not claim they happened.

\`src/lib/engineering/localWorkspaceWriter.ts\` is separate from the existing read-only GitHub/local repository reader by design. Any write action requires a persisted staged edit, a user-granted folder, an unchanged on-disk baseline and an explicit user confirmation in the UI. A receipt after a successful write records **written-unverified**, not tested.

The source viewer's provenance remains truthful: demo source bundled into Vite has no fake commit SHA. An indexed source can be linked to its exact SHA. If a subsequent real source refresh matches proposed bytes, the workspace can show **observed-source-match**; that is still NOT a semantic correctness proof.

## First actual ChatGPT/agent code implementation

While creating this branch, ChatGPT has modified actual files using the GitHub connector rather than merely producing a mock change:

- \`examples/event-queue/src/queue.ts\`: added \`retryBackoffMs\` option (default zero for compatibility); pending jobs have an earliest eligible claim time. Subsequent expired attempts delay retry exponentially, capped at 24 hours. Existing acknowledgement, delivery-token and dead-letter behavior stays intact.
- \`examples/event-queue/src/harness.ts\`: accepts the same retry configuration for deterministic tests.
- \`src/lib/engineering/liveQueue.ts\`: now uses a 1,000ms initial backoff in the running example, tracks ready versus waiting pending jobs, and advances the controlled clock through scheduled retries.
- \`src/components/engineering/QueueLiveLab.tsx\`: shows ready/waiting counts and next claim eligibility. Claim is disabled until a scheduled retry is eligible.
- \`examples/event-queue/test/queue.test.ts\`, \`src/lib/engineering/liveQueue.test.ts\`, \`src/pages/EngineeringExplorerPage.test.tsx\`: cover the behavior change, including preserved default immediate retries.
- Event Queue README and selected Retry inspector description reflect this feature.

**To see the change in the app**, run this feature branch and create/claim/fail/advance once; the job becomes pending but waiting. Advance again; the job becomes ready. Claim, complete and observe it disappear. The browser is invoking actual modified \`EventQueue\` methods, not playing an invented animation.

This ChatGPT GitHub code change is **not** an autonomous, in-browser agent run and was not produced by editing and staging in the UI. It demonstrates the real code side while the shared UI lays the foundation for future agent connections. Do not conflate these steps.

## Integration points

- \`BoundSourceInspector\` wraps the same mobile source view as before and inserts \`SourceBuildWorkspace\` only for implementation bindings in existing project models.
- \`ModelInspector\` surfaces source revisions on the same selected persistent model entity.
- Queue, Todo and generic Explorers pass their model and refresh functions to the same editor; no app-specific coding interface.
- The underlying \`RepoSource\`, \`ensureIndexed\`, \`repoFiles\` cache and sensitive-path fetch policy remain intact and read-only.
- A third ordinary model project can stage source edits if it has a valid indexed source binding. No separate GitHub repo is required for the examples.

## Important limitations / next iteration

- Staging **does not** execute or hot-recompile pasted source. A real on-disk write and development-server rebuild/reload are needed to affect the running app.
- Human/agent edits currently operate on **complete individual source files**, not line-based merge hunks or multi-file atomic transactions. The copy/handoff path asks the agent to return every changed file; only the selected file can be staged in one editor session.
- New source code is accessible through the bound source view after the application or repository cache refresh. Automatic AST-level structural reconciliation, live file watching, and trustworthy semantic model updating **are not yet implemented**. Source intent versus implemented behavior must remain explicit.
- A locally stored write receipt isn't an assertion about tests, Git commits, review, or correctness.
- No embedded autonomous agent provider, and no general execution sandbox for pasted code.
- The manual model descriptions may still lag the code and are not semantically auto-updated yet. This is the next major engineering challenge: deterministic source facts plus evidence-backed behavioral reconciliation.

## Validation

GitHub Actions: \`.github/workflows/engineering-shared-code-workspace.yml\`

    npm run typecheck
    npm run lint
    npm test -- src/lib/engineering/codingStore.test.ts src/lib/engineering/localWorkspaceWriter.test.ts src/lib/engineering/modelGraph.test.ts src/lib/engineering/modelStore.test.ts src/lib/engineering/liveQueue.test.ts src/components/engineering/SourceBuildWorkspace.test.tsx src/components/engineering/ModelInspector.test.tsx src/pages/EngineeringModelIntegration.test.tsx src/pages/EngineeringExplorerPage.test.tsx src/pages/TodoExplorerPage.test.tsx src/pages/EngineeringProjectPage.test.tsx src/pages/GenericEngineeringExplorerPage.test.tsx
    npm run queue:test
    npm run build

Phone/manual acceptance remains user-observed, not independently verified by CI. The parent repo has an unrelated pre-existing full-test-suite investigation constraint failure; focused checks do not claim to repair it.
