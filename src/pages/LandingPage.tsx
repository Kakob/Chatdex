import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  FlaskConical,
  History,
  Inbox,
  Loader2,
  Radar,
  Search,
  ShieldCheck,
  Fingerprint,
  Lock,
  HardDrive,
  Github,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import {
  SAMPLE_PROJECT_ID,
  isSampleWorkspaceLoaded,
  seedSampleWorkspace,
} from '../lib/demo/seedWorkspace';

const EVIDENCE_CHAIN = [
  'immutable source',
  'exact evidence',
  'human finding',
  'accepted understanding',
  'deterministic handoff',
];

const WORKFLOW_STEPS = [
  {
    title: 'Investigate history',
    body: 'Ask a project question, read the complete primary source, run literal search, pin exact evidence, and write findings.',
  },
  {
    title: 'Current understanding',
    body: 'Explicitly accept source-linked beliefs, decisions, constraints, consequences, and open questions.',
  },
  {
    title: 'Prepare change',
    body: 'Compile selected understanding into a bounded Markdown or JSON implementation handoff. Chatdex stops before execution.',
  },
];

const FEATURES = [
  {
    icon: Inbox,
    title: 'Multi-provider import',
    body: 'Bring in Claude.ai exports, ChatGPT exports, and Claude Code JSONL sessions — full-source browsing across all of them.',
  },
  {
    icon: Search,
    title: 'Literal search',
    body: 'Global and in-investigation search over everything you imported. Literal matching, not fuzzy guesses.',
  },
  {
    icon: Fingerprint,
    title: 'Evidence integrity',
    body: 'Immutable raw-source retention with SHA-256 hashes, so every exhibit points at exactly what was said.',
  },
  {
    icon: BarChart3,
    title: 'Analytics & timeline',
    body: 'See how your conversations and projects evolve over time across providers.',
  },
  {
    icon: Radar,
    title: 'Agent failure detection',
    body: 'Detects loops, missing verification, and silent reversions in agent sessions — every finding is explainable from its stored evidence.',
  },
  {
    icon: History,
    title: 'Append-only history',
    body: 'Source locators, review ranges, and history are machine-managed; conclusions are human-authored or visibly review-gated.',
  },
];

const TRUST_POINTS = [
  {
    icon: HardDrive,
    title: 'Local-first',
    body: 'Your conversations live in your browser (IndexedDB). No account required to use everything.',
  },
  {
    icon: ShieldCheck,
    title: 'Client-side detection',
    body: 'Failure detection runs entirely in your browser and never depends on the network.',
  },
  {
    icon: Lock,
    title: 'Ciphertext-only sync',
    body: 'Sync is optional and end-to-end encrypted — the server only ever sees ciphertext.',
  },
];

export function LandingPage() {
  const navigate = useNavigate();
  const theme = useAppStore((s) => s.theme);
  const [loadingSample, setLoadingSample] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  // The theme toggle lives in the app Header, which doesn't render here.
  useEffect(() => {
    const dark =
      theme === 'dark' ||
      (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
  }, [theme]);

  const handleSampleWorkspace = async () => {
    setLoadingSample(true);
    setSampleError(null);
    try {
      if (await isSampleWorkspaceLoaded()) {
        navigate(`/projects/${SAMPLE_PROJECT_ID}`);
        return;
      }
      const result = await seedSampleWorkspace();
      navigate(`/projects/${result.projectId}`);
    } catch (error) {
      setSampleError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoadingSample(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-white">
      {/* Top bar */}
      <header className="max-w-5xl mx-auto flex items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <img src="/chatdex.svg" alt="" className="h-7 w-7" />
          <span className="text-lg font-semibold">Chatdex</span>
        </div>
        <Link
          to="/projects"
          className="text-sm text-gray-600 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
        >
          Open Chatdex
        </Link>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-16 pb-14 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Your best thinking is buried in old AI conversations.
        </h1>
        <p className="mt-5 text-lg text-gray-600 dark:text-gray-400">
          Chatdex turns your Claude, ChatGPT, and Claude Code history into an evidence-backed
          picture of where each project actually stands — and a ready-to-implement handoff for
          what comes next.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => void handleSampleWorkspace()}
            disabled={loadingSample}
            className="flex items-center gap-2 px-5 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {loadingSample ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <FlaskConical size={16} />
            )}
            Try the sample workspace
          </button>
          <Link
            to="/projects"
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
          >
            Open Chatdex
            <ArrowRight size={16} />
          </Link>
        </div>
        {sampleError && (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400">{sampleError}</p>
        )}
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-500">
          The sample is synthetic and privacy-safe — it never touches your conversations.
        </p>
      </section>

      {/* Problem */}
      <section className="max-w-3xl mx-auto px-6 pb-14">
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6 sm:p-8">
          <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
            Real projects don't live in one chat. The reasoning behind them is scattered across
            Claude.ai threads, ChatGPT exports, and Claude Code sessions. Decisions get remade
            because nobody can find where they were made the first time. Context evaporates
            between sessions, and agents repeat mistakes no one caught. Chatdex is where that
            history becomes something you can actually stand on.
          </p>
        </div>
      </section>

      {/* How it works */}
      <section className="max-w-5xl mx-auto px-6 pb-14">
        <h2 className="text-2xl font-semibold text-center mb-8">One workflow, three steps</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {WORKFLOW_STEPS.map((step, i) => (
            <div
              key={step.title}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
            >
              <div className="text-xs font-semibold text-violet-600 dark:text-violet-400 mb-2">
                Step {i + 1}
              </div>
              <h3 className="font-semibold mb-2">{step.title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Evidence chain */}
      <section className="max-w-5xl mx-auto px-6 pb-14">
        <h2 className="text-2xl font-semibold text-center mb-2">Every conclusion has a chain</h2>
        <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
          Nothing in Chatdex is a vibe. Everything traces back to the primary source.
        </p>
        <div className="overflow-x-auto">
          <div className="flex items-center gap-2 min-w-max justify-center pb-2">
            {EVIDENCE_CHAIN.map((node, i) => (
              <div key={node} className="flex items-center gap-2">
                <div className="px-4 py-2.5 rounded-lg border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/30 text-sm text-violet-800 dark:text-violet-300 whitespace-nowrap">
                  {node}
                </div>
                {i < EVIDENCE_CHAIN.length - 1 && (
                  <ArrowRight size={16} className="text-gray-400 dark:text-gray-600 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-14">
        <h2 className="text-2xl font-semibold text-center mb-8">What's in the box</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:border-violet-300 dark:hover:border-violet-800 transition-colors"
            >
              <Icon size={20} className="text-violet-600 dark:text-violet-400 mb-3" />
              <h3 className="font-semibold mb-1.5">{title}</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Privacy */}
      <section className="max-w-5xl mx-auto px-6 pb-14">
        <div className="rounded-xl border border-violet-200 dark:border-violet-900/60 bg-violet-50 dark:bg-violet-950/20 p-6 sm:p-8">
          <h2 className="text-2xl font-semibold text-center mb-2">
            Built for people who'd rather not upload their entire inner monologue
          </h2>
          <p className="text-center text-gray-600 dark:text-gray-400 mb-8">
            Years of private conversations deserve better than someone else's database.
          </p>
          <div className="grid sm:grid-cols-3 gap-6">
            {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="text-center">
                <Icon size={22} className="text-violet-600 dark:text-violet-400 mx-auto mb-3" />
                <h3 className="font-semibold mb-1.5">{title}</h3>
                <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-200 dark:border-gray-800">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            No generated verdicts, no autonomous implementation — Chatdex stops before execution.
          </p>
          <a
            href="https://github.com/Kakob/Chatdex"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-violet-700 dark:hover:text-violet-300 transition-colors"
          >
            <Github size={16} />
            GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}
