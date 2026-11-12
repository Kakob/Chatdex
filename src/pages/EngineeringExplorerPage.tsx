/**
 * Engineering Explorer, iteration 1.5: one compact diagram and one inspector.
 *
 * The system/step descriptions and source entry points are authored. Scenario
 * highlighting is illustrative, not a recording of program execution. Source
 * is bundled from this build, not loaded at the SHA of an evidence manifest.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, Code2, ExternalLink } from 'lucide-react';
import { Badge, button, muted } from '../components/engineering/ui';
import {
  SystemDiagram,
  type DiagramEdgeId,
  type DiagramNodeId,
} from '../components/engineering/SystemDiagram';
import queueSource from '../../examples/event-queue/src/queue.ts?raw';
import workerSource from '../../examples/event-queue/src/worker.ts?raw';
import deliveryTests from '../../examples/event-queue/test/delivery.test.ts?raw';

type SourceId = 'queue' | 'worker' | 'tests';
type InspectorTab = 'understand' | 'code' | 'tests';
type ScenarioId = 'success' | 'failure';

interface Part {
  title: string;
  role: string;
  summary: string;
  detail: string;
  source: SourceId;
  needle: string;
  criterion: string;
  testDescription: string;
}

const PARTS: Record<DiagramNodeId, Part> = {
  producer: {
    title: 'Producer',
    role: 'Entry point',
    summary: 'A producer adds work and receives a job ID.',
    detail: 'enqueue() stores a new job as pending in process memory before returning the ID. It does not wait for a worker to finish.',
    source: 'queue', needle: 'async enqueue(payload', criterion: 'EQ-C0',
    testDescription: 'Jobs first reach workers in the order they were enqueued.',
  },
  queue: {
    title: 'Queue',
    role: 'System core',
    summary: 'The queue keeps track of jobs between submission and completion.',
    detail: 'EventQueue stores jobs in an insertion-ordered Map. Because that Map lives only in this process, a queue process restart loses the jobs.',
    source: 'queue', needle: 'export class EventQueue', criterion: 'EQ-C5',
    testDescription: 'A job survives a worker failure as long as the queue process stays alive.',
  },
  worker: {
    title: 'Worker',
    role: 'Execution',
    summary: 'A worker claims one job, runs a handler, then acknowledges success.',
    detail: 'workOnce() does not acknowledge a job when its handler throws. An unacknowledged job stays leased until expiry, when it can be retried.',
    source: 'worker', needle: 'export async function workOnce', criterion: 'EQ-C5',
    testDescription: 'A failed worker must not cause its job to disappear.',
  },
  pending: {
    title: 'Pending',
    role: 'Job state',
    summary: 'The job is stored, waiting for a worker to claim it.',
    detail: 'Pending is a real JobState. enqueue() creates it; lease expiry can return an unfinished job here. This is a state of the job, not a separate service.',
    source: 'queue', needle: 'export type JobState', criterion: 'EQ-C2',
    testDescription: 'An unacknowledged leased job becomes claimable again after expiry.',
  },
  leased: {
    title: 'Leased',
    role: 'Job state',
    summary: 'A worker is processing the job, but the queue still owns it.',
    detail: 'claim() gives a worker a temporary lease token without removing the job. A stale token cannot acknowledge a later claim.',
    source: 'queue', needle: 'async claim(workerId', criterion: 'EQ-C3',
    testDescription: 'A worker cannot acknowledge another worker’s newer claim.',
  },
  acked: {
    title: 'Completed',
    role: 'Terminal transition',
    summary: 'Successful acknowledgment removes the finished job.',
    detail: 'Completed is drawn as an outcome, not a stored JobState. ack() validates the current lease token and deletes the job. It cannot be claimed again.',
    source: 'queue', needle: 'async ack(jobId', criterion: 'EQ-C1',
    testDescription: 'An acknowledged job is not dispatched again.',
  },
  tests: {
    title: 'Tests',
    role: 'Evidence',
    summary: 'Tests exercise observable queue behavior through its public interface.',
    detail: 'The worker-failure test enqueues a job, fails a worker, advances the manual clock, and checks that another worker can process the same job. Tests here are source, not browser-run results.',
    source: 'tests', needle: "it('[EQ-C5]", criterion: 'EQ-C5',
    testDescription: 'Worker failure does not silently lose accepted work.',
  },
  retry: {
    title: 'Retry',
    role: 'Recovery mechanism',
    summary: 'When a lease expires, unfinished work can become pending again.',
    detail: 'reapExpired() examines leased jobs and either releases them for another attempt or dead-letters them if the configured attempt limit is exhausted.',
    source: 'queue', needle: 'async reapExpired', criterion: 'EQ-C2',
    testDescription: 'A job can be reclaimed after its lease expires.',
  },
  'dead-letter': {
    title: 'Dead letter',
    role: 'Job state',
    summary: 'A job that exhausted its allowed attempts remains inspectable.',
    detail: 'Instead of silently dropping a repeatedly failing job, the queue marks it dead_lettered. It no longer counts as active work and deadLetters() can list it.',
    source: 'queue', needle: 'deadLetters():', criterion: 'EQ-C7',
    testDescription: 'Exhausted jobs become dead letters rather than disappearing.',
  },
};

const SOURCES: Record<SourceId, { path: string; text: string }> = {
  queue: { path: 'src/queue.ts', text: queueSource },
  worker: { path: 'src/worker.ts', text: workerSource },
  tests: { path: 'test/delivery.test.ts', text: deliveryTests },
};

interface ScenarioStep {
  label: string;
  explanation: string;
  focus: DiagramNodeId;
  highlights: DiagramNodeId[];
  edge?: DiagramEdgeId;
}

const SCENARIOS: Record<ScenarioId, ScenarioStep[]> = {
  success: [
    { label: 'Job submitted', explanation: 'The producer calls enqueue(). A job ID is returned.', focus: 'producer', highlights: ['producer', 'queue'], edge: 'enqueue' },
    { label: 'Waiting in queue', explanation: 'The real queue records the new job as pending.', focus: 'pending', highlights: ['queue', 'pending'], edge: 'store' },
    { label: 'Claimed', explanation: 'A worker temporarily leases the job; the queue still tracks it.', focus: 'leased', highlights: ['worker', 'leased'], edge: 'claim' },
    { label: 'Processing succeeds', explanation: 'The worker finishes the handler and can acknowledge the job.', focus: 'worker', highlights: ['worker', 'leased'], edge: 'dispatch' },
    { label: 'Acknowledged', explanation: 'ack() removes the completed job. It cannot be claimed again.', focus: 'acked', highlights: ['leased', 'acked'], edge: 'ack' },
  ],
  failure: [
    { label: 'Job submitted', explanation: 'A new job enters the queue and gets an ID.', focus: 'producer', highlights: ['producer', 'queue'], edge: 'enqueue' },
    { label: 'Claimed', explanation: 'The worker receives a lease; the queue still holds the job.', focus: 'leased', highlights: ['worker', 'leased'], edge: 'claim' },
    { label: 'Worker fails', explanation: 'The handler fails before acknowledgment. The job is still leased, not lost.', focus: 'worker', highlights: ['worker', 'leased'] },
    { label: 'Lease expires', explanation: 'The lease time runs out, so the queue can recover unfinished work.', focus: 'retry', highlights: ['leased', 'retry'], edge: 'expire' },
    { label: 'Pending again', explanation: 'The expired job returns to pending; it can now be claimed again.', focus: 'pending', highlights: ['retry', 'pending'], edge: 'requeue' },
    { label: 'Another attempt', explanation: 'A worker reclaims the job. Duplicate processing is possible.', focus: 'leased', highlights: ['pending', 'leased'], edge: 'to-lease' },
    { label: 'Acknowledged', explanation: 'A successful second attempt ends with an acknowledgment.', focus: 'acked', highlights: ['leased', 'acked'], edge: 'ack' },
  ],
};

function SourceExcerpt({ fileId, needle, title }: { fileId: SourceId; needle: string; title: string }) {
  const [full, setFull] = useState(false);
  const file = SOURCES[fileId];
  const lines = file.text.split('\n');
  const match = lines.findIndex((line) => line.includes(needle));
  const from = full ? 0 : Math.max(0, match - 4);
  const to = full ? lines.length : Math.min(lines.length, Math.max(0, match) + 22);
  const githubUrl = 'https://github.com/Kakob/Chatdex/blob/feature/engineering-explorer-iteration-1/examples/event-queue/' + file.path +
    (match >= 0 ? '#L' + (match + 1) : '');

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={'min-w-0 break-all text-xs ' + muted}>{title} · {file.path}</p>
        <a className="inline-flex items-center gap-1 text-xs font-medium text-violet-700 underline dark:text-violet-300" href={githubUrl} target="_blank" rel="noreferrer">
          GitHub <ExternalLink size={12} />
        </a>
      </div>
      <div className="max-w-full overflow-auto rounded-lg border border-gray-700 bg-gray-950 text-gray-100" aria-label={title + ' excerpt'}>
        <pre className="w-max min-w-full p-3 font-mono text-[11px] leading-5">
          <code>
            {lines.slice(from, to).map((line, i) => {
              const n = from + i + 1;
              return (
                <span key={n} className={'block whitespace-pre pr-2 ' + (n === match + 1 ? 'bg-violet-900/70' : '')}>
                  <span className="mr-3 inline-block w-7 select-none text-right text-gray-500">{n}</span>{line || ' '}{'\n'}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {match < 0 && <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">This authored entry point was not found in the bundled source.</p>}
      <button type="button" className={button} onClick={() => setFull(!full)}>
        {full ? 'Show relevant excerpt' : 'View full file'}
      </button>
    </div>
  );
}

export function EngineeringExplorerPage() {
  const [selected, setSelected] = useState<DiagramNodeId>('queue');
  const [tab, setTab] = useState<InspectorTab>('understand');
  const [scenario, setScenario] = useState<ScenarioId>('failure');
  const [stepIndex, setStepIndex] = useState(0);
  const part = PARTS[selected];
  const currentSteps = SCENARIOS[scenario];
  const currentStep = currentSteps[stepIndex];

  const goToStep = (next: number) => {
    const index = Math.max(0, Math.min(currentSteps.length - 1, next));
    setStepIndex(index);
    setSelected(currentSteps[index].focus);
  };
  const changeScenario = (next: ScenarioId) => {
    setScenario(next);
    setStepIndex(0);
    setSelected(SCENARIOS[next][0].focus);
  };
  const tabs: { id: InspectorTab; label: string }[] = [
    { id: 'understand', label: 'Understand' },
    { id: 'code', label: 'Code' },
    { id: 'tests', label: 'Tests' },
  ];

  return (
    <div
      className="mx-auto flex min-h-[470px] max-w-7xl flex-col gap-3 overflow-hidden text-gray-900 dark:text-gray-100"
      style={{ height: 'calc(100dvh - 7.5rem)' }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen size={18} className="shrink-0 text-violet-600 dark:text-violet-300" />
            <h1 className="truncate text-base font-semibold sm:text-xl">Event Queue Explorer</h1>
            <Badge tone="violet">1.5</Badge>
          </div>
          <p className={'truncate text-[11px] ' + muted}>Tap the system · inspect its behavior and code</p>
        </div>
        <Link to="/engineering" className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-2 text-xs dark:border-gray-700" aria-label="Original engineering workbench">
          <ArrowLeft size={14} /> Workbench
        </Link>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(370px,.95fr)]">
        <div className="flex min-h-0 shrink-0 flex-col gap-2 lg:min-h-0 lg:shrink">
          <div className="flex shrink-0 items-center justify-between gap-2" role="group" aria-label="Scenario choice">
            <span className={'text-xs font-medium ' + muted}>Illustrated path</span>
            <div className="flex items-center gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
              <button type="button" aria-pressed={scenario === 'success'} className={'rounded-md px-3 py-1.5 text-xs font-medium ' + (scenario === 'success' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-200' : muted)} onClick={() => changeScenario('success')}>
                Successful job
              </button>
              <button type="button" aria-pressed={scenario === 'failure'} className={'rounded-md px-3 py-1.5 text-xs font-medium ' + (scenario === 'failure' ? 'bg-white text-violet-700 shadow-sm dark:bg-gray-700 dark:text-violet-200' : muted)} onClick={() => changeScenario('failure')}>
                Worker crashes
              </button>
            </div>
          </div>

          <div className="min-h-[210px] shrink-0 lg:min-h-0" style={{ height: 'clamp(210px, 36dvh, 360px)' }}>
            <SystemDiagram selected={selected} highlighted={currentStep.highlights} highlightedEdge={currentStep.edge} onSelect={setSelected} />
          </div>

          <section className="shrink-0 rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900" aria-label="Scenario walkthrough">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-semibold">{currentStep.label}</span>
                  <span className={muted}>Step {stepIndex + 1} / {currentSteps.length}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-4 text-gray-600 dark:text-gray-300">{currentStep.explanation}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg border border-gray-300 disabled:opacity-30 dark:border-gray-600" aria-label="Previous step" disabled={stepIndex === 0} onClick={() => goToStep(stepIndex - 1)}><ChevronLeft size={17} /></button>
                <button type="button" className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-600 text-white disabled:opacity-30" aria-label="Next step" disabled={stepIndex === currentSteps.length - 1} onClick={() => goToStep(stepIndex + 1)}><ChevronRight size={17} /></button>
              </div>
            </div>
          </section>
        </div>

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900 lg:rounded-xl" aria-label="Inspector">
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600 lg:hidden" aria-hidden="true" />
          <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-2">
            <div className="min-w-0">
              <p className={'text-[10px] font-semibold uppercase tracking-wide ' + muted}>Selected system part · {part.role}</p>
              <h2 className="truncate text-base font-semibold">{part.title}</h2>
            </div>
            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-200">Authored model</span>
          </div>

          <div role="tablist" aria-label="Inspect selected system part" className="flex shrink-0 gap-1 border-b border-gray-200 px-3 dark:border-gray-700">
            {tabs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={'explorer-tab-' + item.id}
                aria-selected={tab === item.id}
                aria-controls="explorer-inspector-content"
                className={'min-h-11 flex-1 border-b-2 px-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-violet-600 ' + (tab === item.id ? 'border-violet-600 text-violet-700 dark:text-violet-300' : 'border-transparent text-gray-500 hover:text-gray-800 dark:text-gray-400')}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div
            id="explorer-inspector-content"
            role="tabpanel"
            aria-labelledby={'explorer-tab-' + tab}
            className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-3"
            key={selected + ':' + tab}
          >
            {tab === 'understand' && (
              <div className="space-y-3 text-sm leading-6">
                <p className="font-medium">{part.summary}</p>
                <p className="text-gray-600 dark:text-gray-300">{part.detail}</p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={button} onClick={() => setTab('code')}><Code2 size={14} /> Inspect implementation <ArrowRight size={13} /></button>
                  <button type="button" className={button} onClick={() => setTab('tests')}>See test {part.criterion} <ArrowRight size={13} /></button>
                </div>
                <p className={'text-xs leading-5 ' + muted}>The diagram and connections are manually authored. The colored route is a walkthrough, not observed execution.</p>
              </div>
            )}
            {tab === 'code' && (
              <div className="space-y-2">
                <p className={'text-xs ' + muted}>Real checked-in TypeScript, bundled with this app build. Read-only; not revision-pinned evidence.</p>
                <SourceExcerpt key={selected + ':code'} fileId={part.source} needle={part.needle} title={part.title} />
              </div>
            )}
            {tab === 'tests' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="violet">{part.criterion}</Badge>
                  <p className="text-sm">{part.testDescription}</p>
                </div>
                <p className={'text-xs ' + muted}>This is a real test definition; no tests are executed by this explorer. Verification manifests live in the original workbench.</p>
                <SourceExcerpt key={selected + ':tests'} fileId="tests" needle={"it('[" + part.criterion + "]"} title="Relevant test" />
              </div>
            )}
          </div>
        </section>
      </div>
      <span className="sr-only">Select a diagram node to change the inspector; scenario controls illustrate the flow without executing the queue.</span>
    </div>
  );
}
