## A___ — [Short exercise title]

**Date:** YYYY-MM-DD
**Area:** [Verification / Investigations / Understanding / Prepare Change / Persistence / Sync / Import / Crypto / UI / Backend / etc.]
**Files initially involved:**

* `path/to/file.ts`
* `path/to/test.ts`

**Exercise type:** [Predict / Modify / Trace / Boundary / Failure mode / Refactor / Bug fix]

**Starting ownership level:** [Unknown / Recognized / Predictable / Modifiable / Owned]

---

### 1. Behavior / Question

What exact behavior am I investigating?

> [State one narrow question. Example: "How does Chatdex classify captured test output when the output contains both 'passed' and '0 failed'?"]

Why does this behavior matter?

[1–3 sentences. What user-visible behavior, invariant, or system responsibility does this support?]

---

### 2. Inputs / Scenario

Concrete scenario I will reason about:

```text
[Input, user action, state, request, stored data, etc.]
```

Relevant starting state:

* [State assumption]
* [State assumption]
* [State assumption]

---

### 3. Prediction — Before Reading Further

**My predicted result:**

```text
[What I think will happen]
```

**My predicted code path:**

```text
[event/input]
→ [component/function]
→ [function/state/store]
→ [result/render/write]
```

**Why I predict this:**

[Explain your reasoning before checking the implementation.]

**Confidence before investigation:** _/5

Things I am specifically unsure about:

* [Question]
* [Question]

---

### 4. Locate the Responsible Code

**Entry point I found:**

`path/to/file.ts` → `functionOrComponentName`

**Code that actually controls the behavior:**

* `file.ts` — `functionName`
* `other-file.ts` — `functionName`

**Actual path through the system:**

```text
[input/event]
→ [step]
→ [step]
→ [step]
→ [observable result]
```

For each important step:

| Step | Responsibility | Input | Output / Effect |
| ---- | -------------- | ----- | --------------- |
| 1    |                |       |                 |
| 2    |                |       |                 |
| 3    |                |       |                 |

---

### 5. State / Data Flow

Delete this section if the exercise has no meaningful state.

**Where the relevant state lives:**

[React state / URL / Dexie / Postgres / local variable / domain object / backend DB / etc.]

**What changes it:**

[Event/function/write]

**What derives from it:**

[Selectors, computed values, rendered components, downstream records]

**Persistence behavior:**

[Not persisted / IndexedDB / backend / both / unknown]

**Important identifiers involved:**

* `projectId`:
* `conversationId`:
* `[other ID]`:

---

### 6. Current Contract / Invariants

Based on the code and tests, the current behavior appears to be:

* [Invariant or rule]
* [Invariant or rule]
* [Invariant or rule]

Example format:

> If `result` is missing, the outcome is `observed`.

Things that are **implementation details rather than intended rules**:

* [Detail]
* [Detail]

Things whose intent is still unclear:

* [Question]
* [Question]

---

### 7. Edge Cases

Before modifying anything, predict these:

| Case                  | Prediction |
| --------------------- | ---------- |
| Normal case           |            |
| Empty / missing input |            |
| Boundary value        |            |
| Duplicate input       |            |
| Invalid input         |            |
| Conflicting input     |            |
| Stale state           |            |
| Repeated action       |            |

Only keep rows relevant to this exercise.

---

### 8. Experiment / Modification

**Goal of the change:**

[One narrow behavior change.]

**Constraint:**

* Production code change target: ≤50 lines
* Preserve: [existing invariant]
* Must not change: [unrelated behavior]

**My planned change before coding:**

[Describe the smallest change you think will work.]

**Files changed:**

* `path/to/file.ts`
* `path/to/test.ts`

**Actual modification:**

[Briefly describe what you changed. Do not paste the entire diff unless it is genuinely useful.]

---

### 9. Verification

**Test or observation used:**

```text
[command, test name, manual interaction, etc.]
```

**Expected result:**

[Prediction made before running it.]

**Actual result:**

[What happened.]

**Additional regression cases checked:**

* [Case] → [result]
* [Case] → [result]
* [Case] → [result]

**Did anything unexpected change?**

[No / explain.]

---

### 10. Prediction vs. Reality

**What I got right:**

* [Prediction]
* [Prediction]

**What I got wrong:**

* [Incorrect prediction]

**Why my mental model was wrong:**

[Explain the missing relationship, hidden state, unexpected condition, library behavior, etc.]

**Surprise worth remembering:**

[The most important thing you would not have known from casually reading the code.]

---

### 11. Failure Modes / Pressure Test

How could this mechanism fail?

* [Failure mode]
* [Failure mode]
* [Failure mode]

What happens if the operation fails halfway through?

[Answer or "not investigated yet."]

What happens with stale, missing, malformed, or conflicting data?

[Answer or "not investigated yet."]

Could this behavior affect another project/user/conversation unintentionally?

[Answer.]

---

### 12. Architectural Understanding

**What responsibility does this code own?**

[Short answer.]

**What responsibility should it *not* own?**

[Short answer.]

**Upstream dependencies:**

* [Dependency]

**Downstream consumers:**

* [Consumer]

**Boundary crossed, if any:**

[UI → domain / domain → persistence / client → server / plaintext → ciphertext / etc.]

---

### 13. Tests and Evidence

Existing tests that document this behavior:

* `path/to/test.ts` — `[test name]`

Tests I added or changed:

* `path/to/test.ts` — `[test name]`

Important code locations:

* `path/to/file.ts` — `functionName`
* `path/to/file.ts` — `functionName`

---

### 14. What I Now Believe

My current compressed model of this behavior:

> [Explain the mechanism in your own words in 2–5 sentences.]

If someone asked me **"Why does Chatdex behave this way?"**, I would answer:

> [Answer.]

If someone asked me **"Where would you change this behavior?"**, I would answer:

> [Answer.]

---

### 15. Remaining Questions

* [Question]
* [Question]
* [Question]

Follow-up exercise candidates:

* A___ — [Next small exercise]
* A___ — [Next small exercise]

---

### 16. Ownership Update

**Ending ownership level:** [Unknown / Recognized / Predictable / Modifiable / Owned]

I can now:

* [ ] Explain what this behavior does
* [ ] Predict representative inputs
* [ ] Locate the responsible implementation
* [ ] Trace important upstream/downstream effects
* [ ] Modify the behavior safely
* [ ] Verify the modification
* [ ] Explain important failure modes
* [ ] Defend why the current behavior should exist

**Confidence after exercise:** _/5

**Worth promoting to a module doc?** [Yes / No]

If yes, distilled knowledge to promote:

> [Invariant, architecture fact, data flow, or warning that will still matter months from now.]

---

**Commit / branch:** `[optional commit hash or branch]`
**Exercise complete:** [ ]
