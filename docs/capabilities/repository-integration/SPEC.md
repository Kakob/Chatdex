# Repository Integration

Shared owner of repository connection, ref resolution, and local snapshot access.
This document consolidates existing behavior; it does not authorize new runtime
features. Delivery status lives in the [capability index](../README.md).
Future possibilities live in [ROADMAP.md](./ROADMAP.md).

## 1. Boundary and consumers

Repository Integration supplies repository identity, selected refs, resolved snapshots,
credentials, and read-only file access. Decision Recovery owns decision reconstruction;
Intent Trace owns intent-to-code claims; Change Workspace owns evidence use and change
preparation. Those consumers retain their own domain, disclosure, and review contracts.
Decision Investigation's quarantine remains unchanged; this document does not give it
new imports, network access, or dependencies.

## 2. Connection and ref selection

Projects store their repository binding in `ProjectRepository`. GitHub input may identify
a repository plus branch, tag, or commit. The persisted `pinnedRef` field can contain a
moving branch, despite its historical name. Ref validation must not silently discard
an invalid selected branch or substitute the default branch. The shared binding UI
allows viewing and changing a saved binding; consumers may supply suggested refs.

A selected branch identifies what to follow. A resolved commit SHA identifies the exact
revision examined by a trace. These are distinct values. Traces record the immutable
revision used; changing a binding does not retroactively change historical evidence.
Current binding controls do not imply scheduled refresh or a local `git pull`.

## 3. Snapshots and availability

GitHub files are cached by repository key, SHA, and path; snapshots from different
revisions coexist. A local directory source uses an `fs:` identity and `local` revision
marker, which is not an immutable Git commit. Whole-file caches remain LOCAL-ONLY.

Successful ref resolution with no indexed snapshot is a missing-cache condition, not
permission to substitute another branch's cached files. Decision Recovery's existing
resolution-failure fallback may use the latest cache only with an explicit warning
that it may be from another branch. Consumer-specific selection precedence remains in
its own spec and implementation; do not infer identical fallback behavior everywhere.

## 4. Access contract

Current GitHub integration is read-only through the validated GitHub API client.
Tokens are device-local, sent only to `api.github.com`, and excluded from model prompts
and relay bodies. Local directory access is read-only. Whole files never enter sync;
consumer records use locators and capped evidence quotes under their existing specs.
Model calls remain separately disclosed under root CLAUDE.md invariant 6.
No repository writes, automatic pulls, or background model reruns are introduced here.

## 5. Implementation and contract references

- Shared GitHub input/ref/client behavior: `src/lib/github/client.ts`.
- Credentials: `src/lib/github/credentials.ts`.
- Binding UI: `src/components/intents/RepoBindingCard.tsx` (shared despite directory name).
- Binding type: `src/types/understanding.ts`; cache types: `src/types/repo.ts`.
- Cache/source layer: `src/lib/repo/`, `src/lib/db/repoFiles.ts`.
- Consumer contracts: [Intent Trace](../intent-trace/SPEC.md),
  [Decision Recovery](../decision-recovery/SPEC.md), and
  [Change Workspace](../change-workspace/SPEC.md).
- Fix rationale, detailed implementation, and outstanding browser checks:
  [Branch Binding plan](../../changes/branch-binding/PLAN.md).

This spec owns the shared connection contract. Existing consumer security laws continue
to apply; this consolidation does not weaken them or rewrite historical build records.
