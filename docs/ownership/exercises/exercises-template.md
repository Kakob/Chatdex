# A___ — [Short exercise title]

**Date:** YYYY-MM-DD
**Area:** [Verification / Investigations / UI / Persistence / etc.]
**Type:** [Predict / Trace / Modify / Boundary / Failure / Characterize / Specify]

## Question

What exact behavior am I investigating?

> [One narrow question.]

## Scenario

[The concrete input, user action, state, or situation.]

## Prediction

**Expected behavior:**

[What I think will happen.]

**Expected code path:**

```text
[input/event]
→ [function/component]
→ [state/function]
→ [result/effect]
```

**Why:**

[Why I expect this.]

**Confidence:** _/5

## Investigation / Trace

**Important code:**

* `path/to/file.ts` — `functionName`
* `path/to/other.ts` — `functionName`

**Actual path:**

```text
[input/event]
→ [actual step]
→ [actual step]
→ [result/effect]
```

**Relevant rule/invariant:**

> [What rule appears to govern this behavior?]

## Modification

**Goal:**

[What behavior am I changing?]

**Before coding, I think the smallest change is:**

[Your proposed change.]

**Actual change:**

[What I changed.]

## Verification

**Expected:**

[What should happen after my modification?]

**Actual:**

[What actually happened.]

**Cases checked:**

* [case] → [result]
* [case] → [result]
* [case] → [result]

## Test-Writing Exercises Only

_Fill this in for **Characterize** and **Specify** exercises. Delete it otherwise._

**Will this test pass on the first run?**

[If I am certain it passes, I am characterizing, not specifying.]

**Test file:**

`path/to/file.test.ts`

**Red-first check:**

Break the code deliberately, confirm the test catches it, restore.

* Mutation applied: [what I changed]
* Test failed for the right reason: [yes / no — what the failure message said]
* Restored: [yes]

**What did I pin?**

* Intended behavior (spec law / invariant): [which one, verbatim]
* Accidental behavior I now cannot change without a failing test: [what, and is that acceptable?]

**If this is a Specify test that fails:** that is a finding, not a mistake. Record it here and open
a follow-up exercise rather than weakening the assertion.

## Prediction vs. Reality

**Right:**

[What I understood correctly.]

**Wrong / missing:**

[What I misunderstood or failed to anticipate.]

**Why:**

[What was missing from my mental model?]

## What I Learned

In my own words:

> [2–5 sentence explanation of how this behavior works.]

**If I needed to change this again, I'd start at:**

`path/to/file.ts` → `functionName`

## Remaining Questions

* [Anything I still don't understand.]
* [Potential follow-up exercise.]

## Ownership

**Before:** [Unknown / Recognized / Predictable / Modifiable / Owned]
**After:** [Unknown / Recognized / Predictable / Modifiable / Owned]
**Confidence:** _/5

**Promote anything to module documentation?** [No / Yes: ______]

**Commit:** `[optional]`
