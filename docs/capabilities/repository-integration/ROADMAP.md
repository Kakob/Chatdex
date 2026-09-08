# Repository Integration — future possibilities

These are product directions, not implemented behavior or approved implementation plans.
Current behavior is documented in [SPEC.md](./SPEC.md).

- Easier connection: repository and branch selection without requiring users to assemble URLs.
- Follow a branch with explicit freshness status and manual refresh first; consider periodic
  background checks with user controls, credentials, rate limits, and failure handling.
- Keep repository refresh separate from model analysis: fetching a new snapshot must not
  silently rerun discovery, trace, or recovery or incur model usage.
- Preserve old analysis at its recorded SHA and show when newer repository data exists.
- Eventually support deliberate repository writes with explicit scope and review. Define
  authentication, write permissions, branch/PR workflow, and changes to existing read-only
  contracts in a dedicated change plan before implementation.

Create bounded packages under `docs/changes/` when pursuing these directions. Repository
Integration owns connection and access mechanics; consumer capabilities own what they do
with refreshed evidence or prepared changes.
