import { X, Check, ThumbsDown, Crosshair, ChevronLeft, ChevronRight } from 'lucide-react';
import { useFindingsStore } from '../../stores/findingsStore';
import { scrollToFinding } from '../../lib/detection/findingAnchors';
import type { NormalizedSession, Step } from '../../lib/detection/normalize';
import type { StoredFinding, UserLabel } from '../../types/detection';
import { SEVERITY_BADGE, SEVERITY_LABEL, detectorLabel } from './severity';

interface EvidencePanelProps {
  conversationId: string;
  finding: StoredFinding;
  session: NormalizedSession;
  /** All findings for the conversation, in step order — enables prev/next. */
  findings?: StoredFinding[];
}

// Explainability is a product feature: everything below renders from the
// stored finding alone (summary, evidence, suppressions) plus the step
// stream for context — no detector re-run, no detector-specific code.
export function EvidencePanel({ conversationId, finding, session, findings = [] }: EvidencePanelProps) {
  const selectFinding = useFindingsStore((s) => s.selectFinding);
  const labelFinding = useFindingsStore((s) => s.labelFinding);

  const steps = session.steps.slice(
    finding.stepRange.start,
    finding.stepRange.end + 1
  );

  const currentIndex = findings.findIndex((f) => f.id === finding.id);
  const canNavigate = findings.length > 1 && currentIndex >= 0;

  const navigate = (offset: number) => {
    const next =
      findings[(currentIndex + offset + findings.length) % findings.length];
    selectFinding(next.id);
    scrollToFinding(session, next);
  };

  const setLabel = (label: UserLabel) => {
    void labelFinding(
      conversationId,
      finding.id,
      finding.userLabel === label ? 'unset' : label
    );
  };

  return (
    <aside
      data-testid="evidence-panel"
      className="w-96 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 overflow-y-auto p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {detectorLabel(finding.detector)}
          </span>
          <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${SEVERITY_BADGE[finding.severity]}`}>
            {SEVERITY_LABEL[finding.severity]}
          </span>
          <span className="text-[10px] text-gray-400">v{finding.detectorVersion}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {canNavigate && (
            <>
              <button
                onClick={() => navigate(-1)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Previous finding"
                data-testid="finding-prev"
              >
                <ChevronLeft size={16} className="text-gray-500" />
              </button>
              <span className="text-[10px] text-gray-400 tabular-nums">
                {currentIndex + 1}/{findings.length}
              </span>
              <button
                onClick={() => navigate(1)}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
                title="Next finding"
                data-testid="finding-next"
              >
                <ChevronRight size={16} className="text-gray-500" />
              </button>
            </>
          )}
          <button
            onClick={() => selectFinding(null)}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
            title="Close"
          >
            <X size={16} className="text-gray-500" />
          </button>
        </div>
      </div>

      <p className="text-sm text-gray-800 dark:text-gray-200">{finding.summary}</p>

      <button
        onClick={() => scrollToFinding(session, finding)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-medium border border-violet-200 dark:border-violet-800 text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors"
      >
        <Crosshair size={12} />
        Steps {finding.stepRange.start}–{finding.stepRange.end} · jump to location
      </button>

      <Section title="Why this fired">
        <EvidenceValue value={finding.evidence} />
      </Section>

      <Section title="Suppression checks">
        <ul className="space-y-1.5">
          {finding.suppressionsEvaluated.map((s) => (
            <li key={s.rule} className="text-xs">
              <span
                className={`inline-block px-1.5 py-0.5 rounded-full mr-1.5 text-[10px] font-medium ${
                  s.fired
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
              >
                {s.fired ? 'fired' : 'not fired'}
              </span>
              <span className="font-medium text-gray-700 dark:text-gray-300">{s.rule}</span>
              {s.detail && (
                <div className="text-gray-500 dark:text-gray-400 mt-0.5">{s.detail}</div>
              )}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Steps involved">
        <ul className="space-y-1">
          {steps.map((step) => (
            <li key={step.index} className="text-xs text-gray-600 dark:text-gray-400">
              <span className="font-mono text-gray-400">#{step.index}</span>{' '}
              <span className="font-medium">{step.kind}</span> {stepExcerpt(step)}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Is this finding correct?">
        <div className="flex gap-2">
          <LabelButton
            active={finding.userLabel === 'confirmed'}
            onClick={() => setLabel('confirmed')}
            activeClass="bg-emerald-600 text-white"
            idleClass="border-emerald-300 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
          >
            <Check size={12} /> Confirm
          </LabelButton>
          <LabelButton
            active={finding.userLabel === 'false_positive'}
            onClick={() => setLabel('false_positive')}
            activeClass="bg-rose-600 text-white"
            idleClass="border-rose-300 text-rose-700 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/20"
          >
            <ThumbsDown size={12} /> False positive
          </LabelButton>
        </div>
        <p className="text-[10px] text-gray-400 mt-1.5">
          Labels stay encrypted and train future detection tiers.
        </p>
      </Section>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
        {title}
      </h3>
      {children}
    </section>
  );
}

function LabelButton({
  active,
  onClick,
  activeClass,
  idleClass,
  children,
}: {
  active: boolean;
  onClick: () => void;
  activeClass: string;
  idleClass: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
        active ? `${activeClass} border-transparent` : `bg-transparent ${idleClass}`
      }`}
    >
      {children}
    </button>
  );
}

/** Generic, detector-agnostic evidence rendering. */
function EvidenceValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') {
    return <span className="text-xs text-gray-700 dark:text-gray-300">{String(value)}</span>;
  }
  return (
    <dl className="space-y-1">
      {Object.entries(value as Record<string, unknown>).map(([key, val]) => (
        <div key={key} className="text-xs">
          <dt className="inline font-medium text-gray-700 dark:text-gray-300">{key}: </dt>
          <dd className="inline text-gray-600 dark:text-gray-400">
            {typeof val === 'object' && val !== null ? (
              <pre className="mt-0.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-1.5 overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(val, null, 2)}
              </pre>
            ) : (
              String(val)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function stepExcerpt(step: Step): string {
  if (step.kind === 'tool_call') {
    const command = step.toolInput?.command;
    const path = step.toolInput?.file_path;
    const detail =
      typeof command === 'string' ? command : typeof path === 'string' ? path : '';
    return `${step.toolName ?? ''} ${detail}`.trim().slice(0, 90);
  }
  if (step.kind === 'tool_result') {
    return (step.toolResult ?? '').slice(0, 90);
  }
  return (step.text ?? '').slice(0, 90);
}
