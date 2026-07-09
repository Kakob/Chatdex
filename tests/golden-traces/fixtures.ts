// Golden-trace fixture definitions. Each fixture is minimal and surgical:
// one scenario per trace. The .jsonl files on disk are generated from these
// definitions (UPDATE_FIXTURES=1 npm test) and the *.expected.json siblings
// are the hand-authored contract. See IMPLEMENTATION_PLAN Phase 0 and the
// step-indexing convention in the decisions log.

import {
  agentText,
  buildTrace,
  toolCall,
  toolResult,
  userMsg,
  type EntrySpec,
} from './fixture-builder';

export interface GoldenFixture {
  name: string;
  entries: EntrySpec[];
}

const npmTest = () => toolCall('Bash', { command: 'npm test' });

// ── Loop detector ────────────────────────────────────────────────────────────

// Same command fails 4x identically, no intervening state change → loop.
const loopExactRepeat: EntrySpec[] = [
  /* 0 */ userMsg('Run the test suite and fix any failures'),
  /* 1 */ npmTest(),
  /* 2 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 2 to be 3'),
  /* 3 */ agentText('That failed. Let me run it again.'),
  /* 4 */ npmTest(),
  /* 5 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 2 to be 3'),
  /* 6 */ agentText('Hmm, same failure. Running once more.'),
  /* 7 */ npmTest(),
  /* 8 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 2 to be 3'),
  /* 9 */ agentText('Trying again.'),
  /* 10 */ npmTest(),
  /* 11 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 2 to be 3'),
];

// A 3-step sequence (Read → build → Grep) repeats twice consecutively → loop.
const loopSequenceRepeat: EntrySpec[] = [
  /* 0 */ userMsg('Debug why the build fails'),
  /* 1 */ toolCall('Read', { file_path: '/home/user/project/src/config.ts' }),
  /* 2 */ toolResult('Read', 'export const config = { retries: 3 }'),
  /* 3 */ toolCall('Bash', { command: 'npm run build' }),
  /* 4 */ toolResult('Bash', "error TS2345 in src/config.ts: argument of type 'string'"),
  /* 5 */ toolCall('Grep', { pattern: 'config', path: '/home/user/project/src' }),
  /* 6 */ toolResult('Grep', '3 matches in 2 files'),
  /* 7 */ toolCall('Read', { file_path: '/home/user/project/src/config.ts' }),
  /* 8 */ toolResult('Read', 'export const config = { retries: 3 }'),
  /* 9 */ toolCall('Bash', { command: 'npm run build' }),
  /* 10 */ toolResult('Bash', "error TS2345 in src/config.ts: argument of type 'string'"),
  /* 11 */ toolCall('Grep', { pattern: 'config', path: '/home/user/project/src' }),
  /* 12 */ toolResult('Grep', '3 matches in 2 files'),
];

// Polling a CI run to completion — retry-shaped, must NOT fire.
const loopLegitPolling: EntrySpec[] = [
  /* 0 */ userMsg('Kick off the CI run and wait for it to finish'),
  /* 1 */ toolCall('Bash', { command: 'gh run view 12345 --json status' }),
  /* 2 */ toolResult('Bash', '{"status":"in_progress"}'),
  /* 3 */ agentText('Still running, checking again shortly.'),
  /* 4 */ toolCall('Bash', { command: 'gh run view 12345 --json status' }),
  /* 5 */ toolResult('Bash', '{"status":"in_progress"}'),
  /* 6 */ agentText('Not done yet.'),
  /* 7 */ toolCall('Bash', { command: 'gh run view 12345 --json status' }),
  /* 8 */ toolResult('Bash', '{"status":"completed","conclusion":"success"}'),
  /* 9 */ agentText('CI run completed successfully.'),
];

// Repeated test runs but with a file edit between each — must NOT fire.
const loopWithStateChange: EntrySpec[] = [
  /* 0 */ userMsg('Fix the failing test'),
  /* 1 */ npmTest(),
  /* 2 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 2 to be 3'),
  /* 3 */ toolCall('Edit', {
    file_path: '/home/user/project/src/math.ts',
    old_string: 'return a - b',
    new_string: 'return a + b',
  }),
  /* 4 */ toolResult('Edit', 'Edit applied'),
  /* 5 */ npmTest(),
  /* 6 */ toolResult('Bash', 'FAIL src/math.test.ts — expected 4 to be 5'),
  /* 7 */ toolCall('Edit', {
    file_path: '/home/user/project/src/math.ts',
    old_string: 'const OFFSET = 0',
    new_string: 'const OFFSET = 1',
  }),
  /* 8 */ toolResult('Edit', 'Edit applied'),
  /* 9 */ npmTest(),
  /* 10 */ toolResult('Bash', 'PASS 12 tests'),
  /* 11 */ agentText('All tests pass now.'),
];

// ── Verification-absence detector ────────────────────────────────────────────

// Edit followed by a typecheck — verified, no finding.
const verifyClean: EntrySpec[] = [
  /* 0 */ userMsg('Rename the date helper in utils.ts'),
  /* 1 */ toolCall('Edit', {
    file_path: '/home/user/project/src/utils.ts',
    old_string: 'function fmtDate',
    new_string: 'function formatDate',
  }),
  /* 2 */ toolResult('Edit', 'Edit applied'),
  /* 3 */ toolCall('Bash', { command: 'npm run typecheck' }),
  /* 4 */ toolResult('Bash', 'tsc --noEmit — no errors'),
  /* 5 */ agentText('Renamed and typecheck passes.'),
];

// Edit, then the session moves to a new topic with no verification → finding.
const verifyAbsent: EntrySpec[] = [
  /* 0 */ userMsg('Update the API timeout to 30 seconds'),
  /* 1 */ toolCall('Edit', {
    file_path: '/home/user/project/src/api.ts',
    old_string: 'timeout: 10_000',
    new_string: 'timeout: 30_000',
  }),
  /* 2 */ toolResult('Edit', 'Edit applied'),
  /* 3 */ agentText('Done, I have updated the timeout.'),
  /* 4 */ userMsg('Great, now can you list the routes in the backend?'),
  /* 5 */ toolCall('Grep', { pattern: 'router\\.', path: '/home/user/project/backend' }),
  /* 6 */ toolResult('Grep', '12 matches in 4 files'),
  /* 7 */ agentText('Here are the backend routes: ...'),
];

// Edit, success asserted in text, session ends unverified → HIGH severity.
const verifyAsserted: EntrySpec[] = [
  /* 0 */ userMsg('Fix the off-by-one bug in pagination'),
  /* 1 */ toolCall('Edit', {
    file_path: '/home/user/project/src/pagination.ts',
    old_string: 'const offset = page * size',
    new_string: 'const offset = (page - 1) * size',
  }),
  /* 2 */ toolResult('Edit', 'Edit applied'),
  /* 3 */ agentText('Fixed — the tests should pass now.'),
];

// ── Silent-reversion detector ────────────────────────────────────────────────

const reversionBase = (revertText: string): EntrySpec[] => [
  /* 0 */ userMsg('Raise the query result limit'),
  /* 1 */ toolCall('Edit', {
    file_path: '/home/user/project/src/query.ts',
    old_string: 'const limit = 100',
    new_string: 'const limit = 500',
  }),
  /* 2 */ toolResult('Edit', 'Edit applied'),
  /* 3 */ npmTest(),
  /* 4 */ toolResult('Bash', 'FAIL src/query.test.ts — limit exceeds provider max of 250'),
  /* 5 */ agentText(revertText),
  /* 6 */ toolCall('Edit', {
    file_path: '/home/user/project/src/query.ts',
    old_string: 'const limit = 500',
    new_string: 'const limit = 100',
  }),
  /* 7 */ toolResult('Edit', 'Edit applied'),
  /* 8 */ npmTest(),
  /* 9 */ toolResult('Bash', 'PASS 8 tests'),
  /* 10 */ agentText('The query builder is updated and tests pass.'),
];

// Later edit restores the original hunk with no acknowledgment → silent.
const reversionSilent = reversionBase('Let me adjust the implementation.');

// Same shape, but the agent acknowledges the revert → informational only.
const reversionAcknowledged = reversionBase(
  'That broke the limit test — reverting to the original limit.'
);

// ── Mixed session ────────────────────────────────────────────────────────────

// A longer realistic session containing three findings:
// loop (steps 5–10), silent reversion (steps 3 & 14), asserted-unverified edit
// (steps 20–22). The npm test at step 16 shares the loop signature but has an
// intervening edit (step 14), so it must be excluded from the loop finding.
const mixedSession: EntrySpec[] = [
  /* 0 */ userMsg('Migrate the config loader to async and make sure nothing breaks'),
  /* 1 */ toolCall('Read', { file_path: '/home/user/project/src/config.ts' }),
  /* 2 */ toolResult('Read', 'export function loadConfig() { return parse(readFileSync(PATH)) }'),
  /* 3 */ toolCall('Edit', {
    file_path: '/home/user/project/src/config.ts',
    old_string: 'export function loadConfig',
    new_string: 'export async function loadConfig',
  }),
  /* 4 */ toolResult('Edit', 'Edit applied'),
  /* 5 */ npmTest(),
  /* 6 */ toolResult('Bash', 'FAIL src/config.test.ts — loadConfig(...).port is undefined'),
  /* 7 */ npmTest(),
  /* 8 */ toolResult('Bash', 'FAIL src/config.test.ts — loadConfig(...).port is undefined'),
  /* 9 */ npmTest(),
  /* 10 */ toolResult('Bash', 'FAIL src/config.test.ts — loadConfig(...).port is undefined'),
  /* 11 */ agentText('The async change is breaking synchronous callers. Let me look at the file again.'),
  /* 12 */ toolCall('Read', { file_path: '/home/user/project/src/config.ts' }),
  /* 13 */ toolResult('Read', 'export async function loadConfig() { return parse(readFileSync(PATH)) }'),
  /* 14 */ toolCall('Edit', {
    file_path: '/home/user/project/src/config.ts',
    old_string: 'export async function loadConfig',
    new_string: 'export function loadConfig',
  }),
  /* 15 */ toolResult('Edit', 'Edit applied'),
  /* 16 */ npmTest(),
  /* 17 */ toolResult('Bash', 'PASS 8 tests'),
  /* 18 */ agentText('I have cleaned up the config loader and the tests pass.'),
  /* 19 */ userMsg('Ok, also bump the cache TTL to one hour'),
  /* 20 */ toolCall('Edit', {
    file_path: '/home/user/project/src/cache.ts',
    old_string: 'ttl: 60',
    new_string: 'ttl: 3600',
  }),
  /* 21 */ toolResult('Edit', 'Edit applied'),
  /* 22 */ agentText('Done — the cache now holds entries for an hour, everything should work correctly now.'),
];

// ─────────────────────────────────────────────────────────────────────────────

const fixture = (name: string, entries: EntrySpec[]): GoldenFixture => ({
  name,
  entries,
});

export const goldenFixtures: GoldenFixture[] = [
  fixture('loop-exact-repeat', loopExactRepeat),
  fixture('loop-sequence-repeat', loopSequenceRepeat),
  fixture('loop-legit-polling', loopLegitPolling),
  fixture('loop-with-state-change', loopWithStateChange),
  fixture('verify-clean', verifyClean),
  fixture('verify-absent', verifyAbsent),
  fixture('verify-asserted', verifyAsserted),
  fixture('reversion-silent', reversionSilent),
  fixture('reversion-acknowledged', reversionAcknowledged),
  fixture('mixed-session', mixedSession),
];

export function renderFixture(f: GoldenFixture): string {
  return buildTrace({ sessionId: `golden-${f.name}` }, f.entries);
}
