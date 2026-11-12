/**
 * Experimental, read-only exploration surface for the engineering prototype.
 *
 * This is an AUTHORED guided tour of the checked-in example queue, not a
 * generated program model, debugger, code editor, or live execution engine.
 * Bundled ?raw source comes from the current app build and is not evidence
 * pinned to one of the imported test manifests.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Code2, GitBranch, RotateCcw, StepForward } from 'lucide-react';
import { Badge, button, muted, panel, primaryButton } from '../components/engineering/ui';
import queueSource from '../../examples/event-queue/src/queue.ts?raw';
import workerSource from '../../examples/event-queue/src/worker.ts?raw';
import deliveryTests from '../../examples/event-queue/test/delivery.test.ts?raw';

type ConceptId = 'overview' | 'producer' | 'storage' | 'lifecycle' | 'worker' | 'recovery' | 'verification';
type SourceId = 'queue' | 'worker' | 'delivery-tests';
type ScenarioId = 'success' | 'failure';

interface TourConcept {
  id: ConceptId;
  title: string;
  short: string;
  description: string;
  question: string;
  source: SourceId;
  needle: string;
}

const concepts: TourConcept[] = [
  {
    id: 'overview', title: 'Event Queue', short: 'The system',
    description: 'A producer adds jobs; the queue holds them until workers process them. If a worker fails, unfinished work can be offered again.',
    question: 'How can work finish without being silently lost?',
    source: 'queue', needle: 'export class EventQueue',
  },
  {
    id: 'producer', title: 'Producer', short: 'Creates work',
    description: 'A producer asks the queue to accept a job. enqueue() gives the job an ID and marks it pending in memory.',
    question: 'What happens between submitting a job and receiving its ID?',
    source: 'queue', needle: 'async enqueue(payload',
  },
  {
    id: 'storage', title: 'Queue & storage', short: 'Remembers work',
    description: 'The queue stores jobs in an in-memory Map. This is enough to outlive a worker failure while the queue process stays alive, but not a process restart.',
    question: 'Where does a job live while nobody is processing it?',
    source: 'queue', needle: 'private readonly jobs = new Map',
  },
  {
    id: 'lifecycle', title: 'Job lifecycle', short: 'Tracks states',
    description: 'A job is pending, becomes leased when claimed, and is removed only after a successful acknowledgment. Failed attempts can return it to pending or leave it dead-lettered.',
    question: 'Why is receiving a job different from finishing it?',
    source: 'queue', needle: "export type JobState",
  },
  {
    id: 'worker', title: 'Worker', short: 'Does the work',
    description: 'The worker claims a job for a limited time, runs the handler, and acknowledges only if processing succeeds. A thrown error leaves the job unacknowledged.',
    question: 'What happens if the worker crashes between receiving and finishing a job?',
    source: 'worker', needle: 'export async function workOnce',
  },
  {
    id: 'recovery', title: 'Failure recovery', short: 'Retries unfinished work',
    description: 'When a lease expires, the queue returns the unacknowledged job to pending. After too many attempts, the job becomes dead-lettered instead of disappearing silently.',
    question: 'How can the queue recover work when its worker never responds?',
    source: 'queue', needle: 'async reapExpired',
  },
  {
    id: 'verification', title: 'Tests', short: 'Checks behavior',
    description: 'Tests exercise the queue through its public API. The worker-failure test proves a specific scenario at the revision where it was run; it does not prove durable restart recovery.',
    question: 'Which observed results support these explanations?',
    source: 'delivery-tests', needle: "it('[EQ-C5]",
  },
];

const sourceFiles: Record<SourceId, { path: string; content: string; label: string }> = {
  queue: { path: 'src/queue.ts', content: queueSource, label: 'Queue implementation' },
  worker: { path: 'src/worker.ts', content: workerSource, label: 'Worker implementation' },
  'delivery-tests': { path: 'test/delivery.test.ts', content: deliveryTests, label: 'Delivery tests' },
};

interface TourStep {
  text: string;
  explanation: string;
  concept: ConceptId;
}

const scenarios: Record<ScenarioId, TourStep[]> = {
  success: [
    { text: 'Job submitted', explanation: 'A producer calls enqueue(). The new job has an ID.', concept: 'producer' },
    { text: 'Job pending', explanation: 'The queue still owns the job while no worker has claimed it.', concept: 'storage' },
    { text: 'Worker claims', explanation: 'The queue gives the worker a temporary lease; the job stays tracked.', concept: 'worker' },
    { text: 'Handler succeeds', explanation: 'The worker finishes the task and can now acknowledge the job.', concept: 'worker' },
    { text: 'Job acknowledged', explanation: 'ack() removes the completed job. It will not be dispatched again.', concept: 'lifecycle' },
  ],
  failure: [
    { text: 'Job submitted', explanation: 'The producer adds a job. It is waiting in queue memory.', concept: 'producer' },
    { text: 'Worker claims', explanation: 'A worker receives the job, but the queue keeps it in the leased state.', concept: 'worker' },
    { text: 'Worker fails', explanation: 'The worker fails before acknowledging. The queue has NOT forgotten the job.', concept: 'worker' },
    { text: 'Lease expires', explanation: 'A time limit prevents the failed worker from owning the job forever.', concept: 'recovery' },
    { text: 'Job becomes pending', explanation: 'reapExpired() makes unfinished work claimable again.', concept: 'recovery' },
    { text: 'Another attempt', explanation: 'Another worker claims and finishes the work. Processing can occur more than once.', concept: 'worker' },
    { text: 'Acknowledged', explanation: 'A successful acknowledgment finally removes the job.', concept: 'lifecycle' },
  ],
};

function SourcePreview({ concept }: { concept: TourConcept }) {
  const [full, setFull] = useState(false);
  const file = sourceFiles[concept.source];
  const lines = file.content.split('\n');
  const located = lines.findIndex((line) => line.includes(concept.needle));
  const start = full ? 0 : Math.max(0, located - 4);
  const end = full ? lines.length : Math.min(lines.length, (located >= 0 ? located : 0) + 17);
  const excerpt = lines.slice(start, end);
  const github = 'https://github.com/Kakob/Chatdex/blob/feature/engineering-explorer-iteration-1/examples/event-queue/' + file.path;

  return (
    <section className={panel + ' min-w-0'} aria-label="Source code">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2"><Code2 size={16} /> <h2 className="font-semibold">Actual source code</h2></div>
          <p className={'mt-1 text-xs ' + muted}>{file.label}</p>
        </div>
        <a href={github} target="_blank" rel="noreferrer" className="text-xs text-violet-700 underline dark:text-violet-300">
          Open on GitHub
        </a>
      </div>
      <p className={'mt-2 text-xs ' + muted}>
        Source bundled with this app build, not a live editor or revision-pinned evidence. The highlighted line is an authored entry point.
      </p>
      <div className="mt-3 overflow-auto rounded-lg border border-gray-200 bg-gray-950 text-gray-100 dark:border-gray-700">
        <div className="sticky left-0 border-b border-gray-700 px-3 py-2 font-mono text-xs text-gray-400">{file.path}</div>
        <pre className="p-3 text-xs leading-5">
          <code>
            {excerpt.map((line, i) => {
              const number = start + i + 1;
              return (
                <span key={number} className={'block whitespace-pre ' + (number === located + 1 ? 'bg-violet-900/60 text-white' : '')}>
                  <span className="mr-4 inline-block w-7 select-none text-right text-gray-500">{number}</span>{line || ' '}
                  {'\n'}
                </span>
              );
            })}
          </code>
        </pre>
      </div>
      {located < 0 && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">The expected entry point was not found in this build.</p>}
      <button type="button" className={button + ' mt-3'} onClick={() => setFull((previous) => !previous)}>
        {full ? 'Show relevant excerpt' : 'View full file'}
      </button>
    </section>
  );
}

export function EngineeringExplorerPage() {
  const [selected, setSelected] = useState<ConceptId>('overview');
  const [scenario, setScenario] = useState<ScenarioId>('failure');
  const [step, setStep] = useState(0);
  const concept = concepts.find((entry) => entry.id === selected) ?? concepts[0];
  const journey = scenarios[scenario];
  const current = journey[step];

  const chooseScenario = (choice: ScenarioId) => {
    setScenario(choice);
    setStep(0);
    setSelected(scenarios[choice][0].concept);
  };

  const nextStep = () => {
    const index = Math.min(step + 1, journey.length - 1);
    setStep(index);
    setSelected(journey[index].concept);
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-4 text-gray-900 dark:text-gray-100 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <BookOpen size={19} className="text-violet-600 dark:text-violet-300" />
            <h1 className="text-xl font-semibold">Explore: Event Queue</h1>
            <Badge tone="violet">Iteration 1</Badge>
          </div>
          <p className={'mt-1 max-w-2xl text-sm ' + muted}>
            Discover how this program works. Select a subsystem, follow a job, and inspect the source behind each explanation.
          </p>
        </div>
        <Link to="/engineering" className={button}><GitBranch size={15} /> Original change workbench</Link>
      </header>

      <section className={panel} aria-label="System flow">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">How a job moves through the system</h2>
          <span className={'text-xs ' + muted}>Authored model of the checked-in example</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['producer', 'storage', 'worker'] as const).map((id, index) => {
            const entry = concepts.find((item) => item.id === id)!;
            return (
              <div key={id} className="flex items-center gap-2">
                {index > 0 && <ArrowRight size={16} className="text-gray-400" />}
                <button type="button"
                  className={'rounded-lg border px-4 py-3 text-left transition ' + (selected === id ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/40' : 'border-gray-200 hover:border-violet-300 dark:border-gray-700')}
                  onClick={() => setSelected(id)}>
                  <span className="block text-sm font-semibold">{entry.title}</span>
                  <span className={'block text-xs ' + muted}>{entry.short}</span>
                </button>
              </div>
            );
          })}
          <button type="button" className={button} onClick={() => setSelected('recovery')}>If worker fails → Recovery</button>
        </div>
      </section>

      <section className={panel} aria-label="Guided behavior">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Observe a scenario</h2>
            <p className={'text-xs ' + muted}>Illustrated walkthrough, not code execution or measured runtime evidence.</p>
          </div>
          <div className="flex gap-2">
            <button type="button" aria-pressed={scenario === 'success'} className={scenario === 'success' ? primaryButton : button} onClick={() => chooseScenario('success')}>Successful job</button>
            <button type="button" aria-pressed={scenario === 'failure'} className={scenario === 'failure' ? primaryButton : button} onClick={() => chooseScenario('failure')}>Worker crashes</button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {journey.map((stage, index) => (
            <button type="button" key={index} aria-current={index === step ? 'step' : undefined}
              className={'rounded-full border px-3 py-1.5 text-xs ' + (index === step ? 'border-violet-500 bg-violet-100 font-medium text-violet-900 dark:bg-violet-950 dark:text-violet-100' : 'border-gray-300 dark:border-gray-700')}
              onClick={() => { setStep(index); setSelected(stage.concept); }}>
              {(index + 1) + '. ' + stage.text}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
          <div>
            <p className="text-sm font-semibold">{current.text}</p>
            <p className="mt-1 text-sm">{current.explanation}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" className={button} onClick={() => { setStep(0); setSelected(journey[0].concept); }}><RotateCcw size={14} /> Reset</button>
            <button type="button" className={primaryButton} disabled={step === journey.length - 1} onClick={nextStep}><StepForward size={14} /> Next step</button>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav className={panel + ' self-start'} aria-label="System components">
          <h2 className="mb-2 text-sm font-semibold">Explore components</h2>
          <div className="space-y-1">
            {concepts.map((entry) => (
              <button type="button" key={entry.id} aria-current={selected === entry.id ? 'page' : undefined}
                onClick={() => setSelected(entry.id)}
                className={'w-full rounded-md px-3 py-2 text-left text-sm ' + (selected === entry.id ? 'bg-violet-100 font-semibold text-violet-900 dark:bg-violet-900/40 dark:text-violet-100' : 'hover:bg-gray-100 dark:hover:bg-gray-800')}>
                <span className="block">{entry.title}</span>
                <span className={'block text-xs font-normal ' + (selected === entry.id ? 'text-violet-700 dark:text-violet-200' : muted)}>{entry.short}</span>
              </button>
            ))}
          </div>
        </nav>
        <main className="grid min-w-0 items-start gap-4 xl:grid-cols-2">
          <section className={panel} aria-label="Component understanding">
            <Badge tone="violet">System model · authored</Badge>
            <h2 className="mt-3 text-lg font-semibold">{concept.title}</h2>
            <p className="mt-3 text-sm leading-6">{concept.description}</p>
            <div className="mt-4 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
              <p className="mb-1 font-medium">Question to investigate</p>
              <p>{concept.question}</p>
            </div>
            <p className={'mt-3 text-xs ' + muted}>This concept and the entry point on the right are manually linked for the first iteration. They are not inferred from source.</p>
            <button type="button" className={button + ' mt-4'} onClick={() => setSelected('verification')}>
              See supporting tests <ArrowRight size={14} />
            </button>
          </section>
          <SourcePreview key={concept.id} concept={concept} />
        </main>
      </div>
      <p className={'text-xs ' + muted}>
        This exploratory route is intentionally separate from the existing local-only engineering workbench. It does not modify project data, run code, or edit files.
      </p>
    </div>
  );
}
