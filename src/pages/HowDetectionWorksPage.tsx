import { Radar, ShieldCheck, Repeat, FileWarning, Undo2 } from 'lucide-react';

// "How detection works" (SPEC §6). Honesty about heuristic ceilings is part
// of the positioning: the known-limits table ships in the product, not just
// in the spec.
export function HowDetectionWorksPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <Radar size={24} className="text-violet-500" />
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            How detection works
          </h1>
        </div>
        <p className="text-gray-600 dark:text-gray-400">
          Chatdex analyzes your Claude Code sessions for agent failure patterns —
          places where the trajectory went wrong, independent of whether the final
          output looked fine. All v1 detectors are deterministic and rule-based:
          rules are explainable ("here is exactly why this fired") and build the
          labeled ground truth for future detection tiers.
        </p>
      </div>

      <section className="flex items-start gap-3 p-4 rounded-lg bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800">
        <ShieldCheck size={20} className="text-violet-600 dark:text-violet-400 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-violet-900 dark:text-violet-200">
          <strong>Everything runs on your machine.</strong> Detection executes in
          your browser (in a background worker), against locally stored sessions.
          Findings and your labels are stored locally and sync — if you enable
          sync — as encrypted ciphertext only. No session content, findings, or
          labels ever reach a server in plaintext.
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          The three detectors
        </h2>

        <DetectorCard
          icon={<Repeat size={16} className="text-violet-500" />}
          title="Loop"
          body="Flags when the same action (or a short action sequence) repeats without intervening progress. Tool calls are normalized into signatures — tool name plus canonicalized arguments — and a sliding window looks for repeats. Legitimate repetition is suppressed: retry-shaped patterns like build polling are whitelisted, and repeats separated by a real state change (a file edit, an install) don't count as looping."
        />
        <DetectorCard
          icon={<FileWarning size={16} className="text-orange-500" />}
          title="Unverified change"
          body="Flags when the agent makes a state-changing action — an edit, a migration, an install — and moves on without verifying the result. Verification means a test run, typecheck, lint, health check, build, or reading back the edited file, before the conversation moves to a new task. If the agent claims success (&quot;the tests should pass now&quot;) with no verification, the finding escalates to high severity: asserted-but-unverified is the most dangerous variant."
        />
        <DetectorCard
          icon={<Undo2 size={16} className="text-emerald-600" />}
          title="Silent reversion"
          body="Flags when a later edit restores a file region to an earlier state without the agent acknowledging the reversal. Each file's edit history is tracked; an edit that exactly undoes an earlier one is a reversion. If the agent says it's reverting, the finding is informational — unacknowledged reversions are the ones that hide failed approaches."
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
          Known limits
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
          Rule-based detection has blind spots. These are the ones we know about,
          and what the roadmap does about them:
        </p>
        <table className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-gray-500 dark:text-gray-400">
              <th className="p-3 font-medium">Detector</th>
              <th className="p-3 font-medium">Blind spot</th>
              <th className="p-3 font-medium">Roadmap answer</th>
            </tr>
          </thead>
          <tbody className="text-gray-700 dark:text-gray-300">
            <LimitRow
              detector="Loop"
              blindSpot="Semantic loops — the same failing strategy, rephrased differently each time"
              roadmap="Client-side embedding similarity over a sliding window"
            />
            <LimitRow
              detector="Unverified change"
              blindSpot="The curated tool mapping has gaps for uncommon toolchains"
              roadmap="Lightweight classifier trained on your labeled segments"
            />
            <LimitRow
              detector="Silent reversion"
              blindSpot="Semantically equivalent but textually different reversions (a function rewritten back to its original behavior with different code)"
              roadmap="AST-level or embedding-based comparison"
            />
          </tbody>
        </table>
      </section>

      <section className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
          Your labels matter
        </h2>
        <p>
          Every finding has <strong>Confirm</strong> and <strong>False positive</strong>{' '}
          buttons. Labeling costs seconds and does two things: the detector-health
          view on the Analytics page reports each detector's real false-positive
          rate from your labels, and the accumulated labels become the ground-truth
          dataset that future, smarter detection tiers are trained against —
          still under the same encryption.
        </p>
        <p>
          Detector thresholds and whitelists are editable in Settings. Findings are
          never rewritten in place: re-analyzing with new settings or a new detector
          version records a fresh run, so your history stays auditable.
        </p>
      </section>
    </div>
  );
}

function DetectorCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <p className="text-sm text-gray-600 dark:text-gray-400">{body}</p>
    </div>
  );
}

function LimitRow({
  detector,
  blindSpot,
  roadmap,
}: {
  detector: string;
  blindSpot: string;
  roadmap: string;
}) {
  return (
    <tr className="border-t border-gray-100 dark:border-gray-800 align-top">
      <td className="p-3 font-medium whitespace-nowrap">{detector}</td>
      <td className="p-3">{blindSpot}</td>
      <td className="p-3">{roadmap}</td>
    </tr>
  );
}
