// Golden-trace harness (IMPLEMENTATION_PLAN Phase 0).
//
// For each fixture this suite verifies:
//   1. the committed .jsonl on disk matches the fixture-builder output
//      (regenerate with: UPDATE_FIXTURES=1 npm test)
//   2. the trace parses through the existing ingestion path unmodified
//   3. detector findings match the *.expected.json contract
//
// Findings come from the real pipeline (normalize + registered detectors).
// Until Phases 3-5 register the detectors, fixtures with expected findings
// stay red and must-NOT-fire fixtures pass — the intended interim state.

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseClaudeCodeContent } from '../../src/lib/parsers/claude-code';
import { normalizeSession } from '../../src/lib/detection/normalize';
import { runDetectors } from '../../src/lib/detection/pipeline';
import { registerAllDetectors } from '../../src/lib/detection/registerAll';
import { goldenFixtures, renderFixture } from './fixtures';

registerAllDetectors();

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const UPDATE_FIXTURES = process.env.UPDATE_FIXTURES === '1';

interface ExpectedFinding {
  detector: 'loop' | 'verification_absence' | 'silent_reversion';
  severity: 'info' | 'low' | 'medium' | 'high';
  stepRange: { start: number; end: number };
  note?: string;
}

interface Expectations {
  description: string;
  findings: ExpectedFinding[];
}

function analyzeFindings(jsonl: string, name: string): ExpectedFinding[] {
  const { conversations, messages } = parseClaudeCodeContent(jsonl, `${name}.jsonl`);
  const session = normalizeSession(conversations[0].id, messages);
  const { findings, errors } = runDetectors(session);
  expect(errors).toEqual({});
  return findings as unknown as ExpectedFinding[];
}

function comparable(findings: ExpectedFinding[]): Omit<ExpectedFinding, 'note'>[] {
  return findings
    .map(({ detector, severity, stepRange }) => ({ detector, severity, stepRange }))
    .sort((a, b) =>
      a.stepRange.start - b.stepRange.start ||
      a.detector.localeCompare(b.detector)
    );
}

for (const fixture of goldenFixtures) {
  const jsonlPath = join(FIXTURE_DIR, `${fixture.name}.jsonl`);
  const expectedPath = join(FIXTURE_DIR, `${fixture.name}.expected.json`);
  const rendered = renderFixture(fixture);

  describe(`golden trace: ${fixture.name}`, () => {
    it('has an up-to-date .jsonl on disk', () => {
      if (UPDATE_FIXTURES) {
        writeFileSync(jsonlPath, rendered);
      }
      expect(
        existsSync(jsonlPath),
        `missing ${fixture.name}.jsonl — run UPDATE_FIXTURES=1 npm test`
      ).toBe(true);
      expect(
        readFileSync(jsonlPath, 'utf-8'),
        `stale ${fixture.name}.jsonl — run UPDATE_FIXTURES=1 npm test`
      ).toBe(rendered);
    });

    it('parses through the existing ingestion path unmodified', () => {
      const jsonl = readFileSync(jsonlPath, 'utf-8');
      const { conversations, messages } = parseClaudeCodeContent(
        jsonl,
        `${fixture.name}.jsonl`
      );

      expect(conversations).toHaveLength(1);
      const conversation = conversations[0];
      expect(conversation.id).toBe(`golden-${fixture.name}`);
      expect(conversation.source).toBe('claude-code');
      expect(conversation.workingDirectory).toBe('/home/user/project');
      // Every fixture entry (user/assistant/tool_use/tool_result) maps 1:1
      // to a stored message — this is the step-indexing convention the
      // expected.json files rely on (decisions log #4).
      expect(messages).toHaveLength(fixture.entries.length);
    });

    it('produces the expected findings', () => {
      const expectations = JSON.parse(
        readFileSync(expectedPath, 'utf-8')
      ) as Expectations;
      const actual = analyzeFindings(readFileSync(jsonlPath, 'utf-8'), fixture.name);
      expect(comparable(actual)).toEqual(comparable(expectations.findings));
    });
  });
}
