import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearAllData, bulkPutConversations, bulkPutMessages, db } from '../../lib/db';
import { parseClaudeCodeContent } from '../../lib/parsers/claude-code';
import { normalizeSession, type NormalizedSession } from '../../lib/detection/normalize';
import { useFindingsStore } from '../../stores/findingsStore';
import { EvidencePanel } from './EvidencePanel';
import { FindingMarkers } from './FindingMarker';
import type { StoredFinding } from '../../types/detection';

const GOLDEN_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../tests/golden-traces'
);

let sessionId: string;
let session: NormalizedSession;
let findings: StoredFinding[];

beforeEach(async () => {
  await clearAllData();
  useFindingsStore.setState({
    findingsByConversation: {},
    runCountByConversation: {},
    analyzingStage: {},
    selectedFindingId: null,
  });

  const jsonl = readFileSync(join(GOLDEN_DIR, 'verify-asserted.jsonl'), 'utf-8');
  const parsed = parseClaudeCodeContent(jsonl, 'verify-asserted.jsonl');
  sessionId = parsed.conversations[0].id;
  await bulkPutConversations(parsed.conversations);
  await bulkPutMessages(parsed.messages);
  session = normalizeSession(sessionId, parsed.messages);

  await useFindingsStore.getState().analyze(sessionId);
  findings = useFindingsStore.getState().findingsByConversation[sessionId];
});

describe('EvidencePanel — explainability from stored evidence', () => {
  it('renders summary, severity, detector version, suppressions, and raw steps', () => {
    const finding = findings[0];
    render(
      <EvidencePanel conversationId={sessionId} finding={finding} session={session} />
    );

    expect(screen.getByText(finding.summary)).toBeInTheDocument();
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByText(`v${finding.detectorVersion}`)).toBeInTheDocument();
    // Suppression evaluations render even when they did not fire.
    expect(screen.getByText('verification-within-span')).toBeInTheDocument();
    expect(screen.getByText('not fired')).toBeInTheDocument();
    // Evidence: the success assertion excerpt is visible.
    expect(screen.getByText(/successAssertion/)).toBeInTheDocument();
    // Raw steps of the range are listed.
    expect(screen.getByText('#1')).toBeInTheDocument();
    // Appears in both the evidence excerpt and the raw-step listing.
    expect(screen.getAllByText(/tests should pass now/).length).toBeGreaterThanOrEqual(1);
  });

  it('labels a finding via the buttons and persists it', async () => {
    const finding = findings[0];
    render(
      <EvidencePanel conversationId={sessionId} finding={finding} session={session} />
    );

    fireEvent.click(screen.getByText('Confirm'));
    await waitFor(async () => {
      expect((await db.findings.get(finding.id))?.userLabel).toBe('confirmed');
    });
  });
});

describe('EvidencePanel — prev/next navigation across findings', () => {
  it('cycles selection through the ordered findings list', async () => {
    // Re-seed with the three-finding mixed-session trace.
    await clearAllData();
    useFindingsStore.setState({
      findingsByConversation: {},
      runCountByConversation: {},
      analyzingStage: {},
      selectedFindingId: null,
    });
    const jsonl = readFileSync(join(GOLDEN_DIR, 'mixed-session.jsonl'), 'utf-8');
    const parsed = parseClaudeCodeContent(jsonl, 'mixed-session.jsonl');
    await bulkPutConversations(parsed.conversations);
    await bulkPutMessages(parsed.messages);
    const mixedId = parsed.conversations[0].id;
    const mixedSession = normalizeSession(mixedId, parsed.messages);
    await useFindingsStore.getState().analyze(mixedId);
    const mixed = [...useFindingsStore.getState().findingsByConversation[mixedId]].sort(
      (a, b) => a.stepRange.start - b.stepRange.start
    );
    expect(mixed).toHaveLength(3);

    useFindingsStore.getState().selectFinding(mixed[0].id);
    // Mirrors ConversationView: the rendered finding follows the selection.
    function Harness() {
      const selectedId = useFindingsStore((s) => s.selectedFindingId);
      const finding = mixed.find((f) => f.id === selectedId) ?? mixed[0];
      return (
        <EvidencePanel
          conversationId={mixedId}
          finding={finding}
          session={mixedSession}
          findings={mixed}
        />
      );
    }
    render(<Harness />);

    expect(screen.getByText('1/3')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('finding-next'));
    expect(useFindingsStore.getState().selectedFindingId).toBe(mixed[1].id);
    fireEvent.click(screen.getByTestId('finding-prev'));
    expect(useFindingsStore.getState().selectedFindingId).toBe(mixed[0].id);
    // Wrap-around backwards lands on the last finding.
    fireEvent.click(screen.getByTestId('finding-prev'));
    expect(useFindingsStore.getState().selectedFindingId).toBe(mixed[2].id);
  });

  it('hides navigation when there is a single finding', () => {
    render(
      <EvidencePanel
        conversationId={sessionId}
        finding={findings[0]}
        session={session}
        findings={findings}
      />
    );
    expect(screen.queryByTestId('finding-next')).not.toBeInTheDocument();
  });
});

describe('FindingMarkers — severity-coded inline markers', () => {
  it('renders a marker per finding and selects on click', () => {
    render(<FindingMarkers findings={findings} />);
    const marker = screen.getByTestId(`finding-marker-${findings[0].id}`);
    expect(marker).toHaveTextContent('Unverified change');

    fireEvent.click(marker);
    expect(useFindingsStore.getState().selectedFindingId).toBe(findings[0].id);
  });

  it('renders nothing when there are no findings', () => {
    const { container } = render(<FindingMarkers findings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
