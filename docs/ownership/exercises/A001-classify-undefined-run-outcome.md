# A001 — Undefined run outcome

**Date:** 2026-09-07
**Area:** Verification
**Type:** Predict
**Status:** Resolved — prediction correct; test-suite run outstanding

## Question

> What does `classifyRunOutcome(undefined)` return, and why does the `undefined` case exist at all?

## Scenario

A direct call to the pure function `classifyRunOutcome` with `undefined` as its only argument.

`src/lib/prepare/verification.ts:99`

```ts
export function classifyRunOutcome(result: string | undefined): TestRuntimeEvidence['outcome']
```

## Prediction

**Expected behavior:**

Returns `'observed'`.

**Why (my reasoning, verbatim):**

> It seems like it should return observed. So like `testruntimeevidence['outcome']` seems to be able to be `'pass'` `'fail'` and `'observed'` based on the interface in `evidence.ts`. In the `classifyrunoutcome` function it takes in a result which could presumably be `'pass'` `'fail'` `'observed'` and returns a `testruntimeevidence['outcome']` value which could again be `'pass'` `'fail'` or `'observed'`.

**Caveat I noted at prediction time:**

> I'm not sure how this fits into the larger spec requirements for the change workspace and because of that im not sure when the result would be undefined and need to return observed. It seems weird already.

**Confidence:** _/5  ← fill in (reads like a 3 from the above)

**Verdict:** Correct - `classifyRunOutcome(undefined)` returns `'observed'` via line 100.

## Tutor Dialogue

This section is the working log: the questions I was asked, and my answers, in order.
It exists so I can see how my understanding moved, not just where it ended up.

### Round 1 — before opening the function body

**Q1. From the return type `TestRuntimeEvidence['outcome']`, what values can this return, and where would you find that union without reading `classifyRunOutcome`?**

> `testruntimeevidence['outcome']` seems to be able to be `'pass'` `'fail'` and `'observed'` based on the interface in `evidence.ts`.

✅ Correct, and found by the right route — reading the type, not the implementation.

**Q2. What does `undefined` mean in this domain — what situation produces a run with no result text?**

> I'm not sure when the result would be undefined.

Left open. Became the core of Round 2.

**Q3. Which outcome value would you expect, and why that one?**

> `observed`.

### Round 2 — checking one inference and finding the real caller

**Flagged inference:** I had assumed the *parameter* `result` was the same union as the return
type (`'pass' | 'fail' | 'observed'`). The existing tests contradict this:

```ts
expect(classifyRunOutcome('error TS2322: nope')).toBe('fail');
expect(classifyRunOutcome('✓ built in 3.2s')).toBe('pass');
```

Those are raw command-output strings, not union members.

**Q4. Where does the value passed as `result` come from at the production call site?**

> When I look at the `verification.test` that calls `classifyrunoutcome` it says it looks for
> test-like commands, pairs results by tool use id or proximity and classifies outcome.... but in
> `verification.ts` I see the `findtestrunsteps` function which seems to look through chat histories.
> line 114 lets result be `Step` or undefined. not sure what `Step` is exactly. Then in line 115 if
> the step has a `tooluseid` it updates result to something about `steps.find`. not totally sure what
> transformation takes place there. in line 116 if result is undefined (which i still dont
> understand when it would be undefined) it assigns result to something I'm not clear on. Then line
> 117 text wants to be assigned to results's tool result or an empty string if its undefined??? not
> sure. Then events which is a `TestRunEvent` array i think adds all this stuff including the outcome
> which is defined by `classifyrunoutcome` evaluating text.

**Q5. Given `const text = result?.toolResult ?? '';` — can `text` ever be `undefined` when it reaches `classifyRunOutcome`?**

> I dont think text can be undefined when it reaches `classifyrunoutcome` but maybe it can be an
> empty string? so im not sure who actually exercises the undefined case.

✅ This is the key move of the exercise. Carried forward to Round 3.

### Round 3 — reading the body

```ts
export function classifyRunOutcome(result: string | undefined): TestRuntimeEvidence['outcome'] {
  if (!result) return 'observed';
  if (FAIL_RE.test(result)) return 'fail';
  if (PASS_RE.test(result)) return 'pass';
  return 'observed';
}
```

**Q6. Was your prediction correct?**

> i guess im not sure if the prediction was correct or what exactly my prediction was.

Yes. The prediction on record was `'observed'`, and line 100 returns exactly that.

**Q7. Does `''` take the same branch as `undefined`?**

> line 100 would say `!result` is true and return observed for `''`.

Correct. `!` is a falsy test, not a null test, so `undefined` and `''` are indistinguishable here.

**Q8. Who exercises the `undefined` case?**

> so for question 3 is it line 100 exercising the undefined case?

Two different questions got merged here:

* *Which line **handles** `undefined`?* -> line 100. Correct.
* *Which caller **supplies** `undefined`?* -> still open. Line 100 cannot be the answer; a line
  inside the function cannot pass an argument to it.

Carried to Round 4.

**My open questions at this point:**

> why do you think undefined goes to "observed"? Like in service of the change workspace spec.

> i feel like im not sure what input would catch line 103.

### Round 4 - findTestRunSteps, lines 109-126

**My question:**

> are we talking about how findtestrunsteps pushes a testrunevent into the events array while
> supplying classifyrunoutcome with text which i guess feels like it should be a string that
> represents the command from the tool call and its result maybe, but i feel like i need help
> understanding lines 109-126, but more specifically lines 114-116.

> I dont see where the command output is matched to fail_re and pass_re. I see line 113 but that
> feels like if there's no matching command continue.

**Misconception flagged:** there are two regex checks on two different strings.

* line 113 - `TEST_COMMAND_RE` tests `command` (the thing that was run)
* lines 101-102 - `FAIL_RE` / `PASS_RE` test `result` (the output it produced)

`text` at line 117 is `result?.toolResult` only - the command is *not* in it.

**On why `observed` exists:**

> I guess if it doesnt match we cant say it passes or fails so we just could say its observed.

Right shape of answer. To be confirmed against `docs/tracks/change-workspace/SPEC.md:39`.

**Hand-execution fixtures (assigned, not yet worked):**

Fixture A - `tool_call` with `toolUseId: 'tu_7'`, matching `tool_result` two steps later.
Fixture B - same, but `toolUseId` removed from both: forces the line 116 proximity fallback.
Fixture C - the `tool_result` step deleted entirely: the agent ran `npm test` and the session
ended before a result arrived.

Fixture C is the answer to the Round 1 question "when would result be undefined."

### Rounds 5-7 - closing the trace

**My answers (verbatim):**

> only index one should reach line 114 i think. but once it's there it finds a tool_result that
> matches the tooluseid? which should be index 3.

> does the tool call and tool result have corresponding tooluseids? that's what is being compared
> besides the tool_result kind in line 115. 116 only runs if no step was found or if result is just
> undefined for some reason i guess. But for fixture c i think this is where you would get an empty
> text. result after lines 114-116 would be undefined because it cant find a tool_result?

> The only place undefined is supplied to classifyrunoutcome i think is verification.test.ts:68.
> The loop visits only tool_calls; tool_results are reached by steps.find rather than by the
> conditional. The undefined branch on line 100 is reachable from the tests but not from the
> normalized steps. well that feels incorrect to me still.

All correct. The unease in the last line is the finding, not a mistake.

**Mechanics I had to learn along the way:**

* `RegExp.prototype.test(str)` returns a boolean - matched anywhere / not at all. It does not say
  what or where. `PASS_RE` carries the `i` flag; `FAIL_RE` does not.
* `Array.prototype.find(pred)` returns the first matching **element** or `undefined`
  (`findIndex` is the one returning an index). That is why `result` is typed `Step | undefined`
  and why line 117 can reach into `result?.toolResult`.
* `continue` is an early-exit filter: lines 111 and 113 skip the rest of the iteration rather than
  nesting the whole body inside two `if`s.
* `!` tests falsiness, not null-ness.

## Resolution

**1. `classifyRunOutcome(undefined)` returns `'observed'`** via line 100. Prediction correct.

**2. `''` and `undefined` are indistinguishable to line 100** - both falsy. But `' '` (a single
space) is **truthy**: it passes line 100, matches neither regex, and exits at line 103. Same return
value, completely different route. I found this by typo.

**3. What reaches line 103:** any non-empty string matching neither `FAIL_RE` nor `PASS_RE` -
whitespace-only output, `"No test files found"`, a process killed before printing a summary, a
watcher that started and never reported, a usage error from a mistyped flag. Line 113 already
established the *command* looked like a test run, so line 103 means "a test command ran and its
output told us nothing conclusive."

**4. The two sentences:**

> The loop visits only tool_calls; tool_results are reached by `steps.find` rather than by
> **iteration**. The loop's job is to find test *invocations*; each invocation then searches the
> array for its own result - first by exact `toolUseId` match, and if the parser did not preserve
> one, by proximity (the next three steps).

> The `undefined` branch on line 100 is reachable from **the test suite** but not from **any
> production path**, because line 117's `?? ''` collapses a missing result to an empty string
> before the call. Both halves of the guard return the same value, so nothing is broken - but only
> the `''` half is load-bearing.

**5. Why `'observed'` is the right default.** `docs/tracks/change-workspace/SPEC.md:39` defines `verified` as
*mechanically established* - observed in code at a pinned sha, recorded test/runtime evidence,
commit history - and forbids AI output from ever setting `verified`. `pass` and `fail` are both
claims about what happened; `'observed'` claims only that a test-shaped command ran and was
recorded. When evidence is absent or unreadable, the system records the event without asserting an
outcome. Guessing `'pass'` on empty output would let unverified work present as verified - the
exact failure the spec exists to prevent, and the same failure mode as the verification-absence
detector.

**The real-world case (Fixture C):** an agent runs `npm test`, the session ends before the result
comes back, and Chatdex records "a test was run here, outcome unknown" rather than silently
claiming success.

## Investigation / Trace

**Important code:**

* `src/lib/prepare/verification.ts:99` — `classifyRunOutcome` (the function under test)
* `src/lib/prepare/verification.ts:107` — `findTestRunSteps` (the only production caller)
* `src/lib/prepare/verification.ts:117` — `const text = result?.toolResult ?? '';`
* `src/lib/prepare/verification.test.ts:66-68` — the three assertions
* `src/lib/detection/normalize.ts:24` — `interface Step`
* `evidence.ts` — `TestRuntimeEvidence['outcome']` union

**Actual path (production):**

```text
conversation steps[]
→ findTestRunSteps()            filters tool_call steps whose command matches TEST_COMMAND_RE
→ pair each call with its result   by toolUseId, else by proximity (next 3 steps)
→ text = result?.toolResult ?? ''  ← undefined is collapsed to '' HERE
→ classifyRunOutcome(text)
→ TestRunEvent.outcome
```

**Two ways to reach `'observed'`:**

* line 100 - falsy input (`undefined` or `''`): nothing to classify
* line 103 - non-empty input that matches neither `FAIL_RE` (line 78) nor `PASS_RE` (line 79)

**Open sub-questions inside this path (not yet answered):**

* What input reaches line 103? (read `FAIL_RE` / `PASS_RE` at lines 78-79 and construct one)
* Why is `'observed'` the right default in Change Workspace terms?
  (`docs/tracks/change-workspace/SPEC.md:39` and `:171`)

* What is `Step` exactly? (`src/lib/detection/normalize.ts:24`)
* Line 115 — what does `steps.find((s) => s.kind === 'tool_result' && s.toolUseId === step.toolUseId)` actually do?
* Line 116 — what is the `steps.slice(i + 1, i + 4)` fallback for, and when is it needed?
* When *is* `result` (the `Step`) undefined at line 114-116?

**Relevant rule/invariant (draft):**

> The production caller never passes `undefined` — it normalizes a missing tool result to `''`
> before the call. So the `undefined` branch of the signature is defensive, not load-bearing.
> (To be confirmed in Round 3.)

## Verification

Answers reasoned out and confirmed against the code; the test-suite run below is still to be done
as the mechanical check.

Planned command:

```
npx vitest run src/lib/prepare/verification.test.ts
```

**Cases to check:**

* `classifyRunOutcome(undefined)` → ?
* `classifyRunOutcome('')` → ?
* `classifyRunOutcome('error TS2322: nope')` → ?

## Prediction vs. Reality

**Right:**

* The return value: `'observed'`.
* The outcome union and where to find it (`evidence.ts`), read from the type rather than the body.
* That `text` cannot be `undefined` at the call site because of `?? ''` - the key move.
* That `''` and `undefined` take the same branch.
* That line 116 is a fallback, gated on line 115 having found nothing.
* That `toolUseId` is what pairs a call to its result.

**Wrong / missing:**

* Initially assumed the *parameter* `result` was the same union as the return type
  (`'pass' | 'fail' | 'observed'`). It is raw command output text. The existing tests
  (`'error TS2322: nope'`) contradicted this and I had already read them.
* Thought `text` might contain the command as well as its output. It is `toolResult` only.
* Did not initially see that two different regexes run against two different strings:
  `TEST_COMMAND_RE` against the command, `FAIL_RE`/`PASS_RE` against the output.
* Conflated "which line handles `undefined`" with "which caller supplies `undefined`".
* Assumed a `tool_result` step being skipped by `continue` meant it was unreachable. It is skipped
  as a *loop subject* but found by search.
* Wrote `' '` for `''` - and that typo turned out to be a genuine second code path.

**Why:**

My mental model was reading types and control flow one line at a time without asking *who calls
this and with what*. Once I traced the single production call site, most of the confusion resolved.

## What I Learned



 `classifyRunOutcome` turns raw test-command output into one of three outcomes. 
 It is deliberately conservative: anything it cannot read as a clear pass or fail becomes `'observed'`, reachabletwo ways - falsy input at line 100, or unmatched non-empty input at line 103. 
 `findTestRunSteps` iterates a conversation's normalized steps, stops only on tool_calls whose command looks like a test run, then searches the array for that call's result by `toolUseId` (exact) or proximity (fallback). 
 A missing result becomes `''`, which classifies as `'observed'`. 
 The design refuses to assert an outcome it did not actually observe, which is what the Change Workspace spec's definition of `verified` requires.

**If I needed to change this again, I'd start at:**

`src/lib/prepare/verification.ts` -> `classifyRunOutcome` (lines 78-79 for the regexes,
99-104 for the branching, 107-126 for how evidence is gathered)

## Remaining Questions

* **Follow-up exercise idea (mine):** how wide are `FAIL_RE` and `PASS_RE` really? What is the best
  way to check them against the actual tool output produced by my agents across my repos, rather
  than against invented strings? I have real ingested JSONL sessions to sample from.

* How does any of this fit the Change Workspace spec requirements? Where does a `TestRunEvent`
  actually get used downstream, and does `'observed'` mean something specific to the user there?
* "It seems weird already" — is a signature that accepts `undefined` when no production caller can
  pass `undefined` a design smell, or deliberate defensiveness? Does the same pattern show up
  elsewhere in `verification.ts`?
* Does `''` and `undefined` producing the same outcome hide a real distinction (no test was run vs.
  a test ran and printed nothing)?

## Ownership

**Before:** Unknown
**After:** Predictable (Modifiable pending an actual change - A003 is the candidate)
**Confidence:** 3/5

**Promote anything to module documentation?** Yes, candidate: a short note on
`src/lib/prepare/verification.ts` covering the conservative-default rule and its link to
`docs/tracks/change-workspace/SPEC.md:39`.

**Commit:** _n/a (no code change in this exercise)_
