# Verification

## Purpose

Verification connects acceptance criteria to evidence while
leaving final verification status under human control.

## Important invariants

- Every criterion gets a verification row.
- Missing rows default to `unverified`.
- AI inference alone cannot support a criterion.
- Passing runtime evidence can suggest `supported`.
- Mixed passing/failing evidence suggests `partial`.

## Flow

PreparedChange
→ criteria
→ verificationRows()
→ attached evidence
→ deriveVerificationHint()
→ human-set VerificationStatus

## Important implementation

- `src/lib/prepare/verification.ts`
- ...

## Audited by

A001, A002, A007, A013, A029