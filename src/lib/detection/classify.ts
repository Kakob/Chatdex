// Curated tool-call classification (SPEC §2.2 step 1).
// Versioned: any change to the mapping is a behavior change for the
// verification-absence detector and requires a version bump here plus a
// detector version bump (findings are immutable per detector version).

export const CLASSIFIER_VERSION = '1.0.0';

export type ToolCallClass = 'state_changing' | 'verification_shaped' | 'neutral';

/** Non-Bash tools classified by name. Unknown tools default to neutral. */
const TOOL_NAME_CLASSES: Record<string, ToolCallClass> = {
  Edit: 'state_changing',
  Write: 'state_changing',
  MultiEdit: 'state_changing',
  NotebookEdit: 'state_changing',
  Read: 'neutral',
  Grep: 'neutral',
  Glob: 'neutral',
  LS: 'neutral',
  WebFetch: 'neutral',
  WebSearch: 'neutral',
  TodoWrite: 'neutral',
  Task: 'neutral',
  Agent: 'neutral',
};

interface BashRule {
  pattern: RegExp;
  class: ToolCallClass;
}

// Evaluated in order; first match wins. Mutating-curl outranks the generic
// curl health-check rule; verification patterns outrank generic state rules
// so `npm test > out.log` classifies as a test run, not a file write.
//
// Local compile/build commands are classified verification_shaped: for
// verification-absence purposes a build after an edit is a success check,
// and build artifacts are not the kind of state change that should suppress
// loop findings. Deploy/publish commands remain state_changing (SPEC §2.2).
const BASH_RULES: BashRule[] = [
  // 1. Mutating HTTP calls.
  { pattern: /\bcurl\b[^|;&]*-X\s*(POST|PUT|PATCH|DELETE)/i, class: 'state_changing' },

  // 2. Verification-shaped: test runners.
  { pattern: /\b(npm|yarn|pnpm|bun)(\s+run)?\s+test(\b|:)/, class: 'verification_shaped' },
  { pattern: /\b(vitest|jest|pytest|mocha|playwright\s+test)\b/, class: 'verification_shaped' },
  { pattern: /\bgo\s+test\b/, class: 'verification_shaped' },
  { pattern: /\bcargo\s+(test|check)\b/, class: 'verification_shaped' },
  // Verification-shaped: type checkers and linters.
  { pattern: /\btsc\b/, class: 'verification_shaped' },
  { pattern: /\b(npm|yarn|pnpm|bun)\s+run\s+(typecheck|lint)(\b|:)/, class: 'verification_shaped' },
  { pattern: /\b(eslint|ruff|flake8|pylint|mypy|golangci-lint)\b/, class: 'verification_shaped' },
  // Verification-shaped: local builds (see rationale above).
  { pattern: /\b(npm|yarn|pnpm|bun)\s+run\s+build(\b|:)/, class: 'verification_shaped' },
  { pattern: /\b(cargo|go)\s+build\b/, class: 'verification_shaped' },
  // Verification-shaped: health checks and CI status.
  { pattern: /\bcurl\b/, class: 'verification_shaped' },
  { pattern: /\bgh\s+(run\s+(view|watch)|pr\s+checks)\b/, class: 'verification_shaped' },
  { pattern: /\bgit\s+(status|diff|log)\b/, class: 'neutral' },

  // 3. State-changing: version control mutations.
  { pattern: /\bgit\s+(commit|push|merge|rebase|reset|checkout|cherry-pick|revert|apply|stash|rm|mv|add)\b/, class: 'state_changing' },
  // State-changing: package management.
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(install|i|ci|add|remove|uninstall|update|link)\b/, class: 'state_changing' },
  { pattern: /\bpip3?\s+install\b/, class: 'state_changing' },
  { pattern: /\bcargo\s+(add|install)\b/, class: 'state_changing' },
  { pattern: /\bgo\s+get\b/, class: 'state_changing' },
  { pattern: /\bbrew\s+(install|uninstall|upgrade)\b/, class: 'state_changing' },
  // State-changing: filesystem mutations.
  { pattern: /\b(rm|mv|cp|mkdir|touch|ln|chmod|chown)\b/, class: 'state_changing' },
  { pattern: /\bsed\b[^|;&]*\s-i\b/, class: 'state_changing' },
  // Output redirection writes a file (2>&1 fd duplication excluded).
  { pattern: /(?<![\d>])>{1,2}(?!&)/, class: 'state_changing' },
  // State-changing: containers, migrations, deploys.
  { pattern: /\bdocker(\s+compose)?\s+(run|up|down|build|rm|exec)\b/, class: 'state_changing' },
  { pattern: /\b(drizzle-kit\s+push|prisma\s+(migrate|db\s+push)|alembic\s+upgrade)\b/, class: 'state_changing' },
  { pattern: /\b(vercel|netlify|flyctl|terraform\s+apply|kubectl\s+apply)\b/, class: 'state_changing' },
  { pattern: /\b(npm|yarn|pnpm|bun)\s+(run\s+)?(deploy|publish)(\b|:)/, class: 'state_changing' },
];

export function classifyBashCommand(command: string): ToolCallClass {
  for (const rule of BASH_RULES) {
    if (rule.pattern.test(command)) return rule.class;
  }
  return 'neutral';
}

export function classifyToolCall(
  toolName: string,
  input: Record<string, unknown>
): ToolCallClass {
  if (toolName === 'Bash') {
    const command = input.command;
    return typeof command === 'string' ? classifyBashCommand(command) : 'neutral';
  }
  return TOOL_NAME_CLASSES[toolName] ?? 'neutral';
}

/** True when the tool name is in the curated mapping (Phase 8 uses this to surface mapping gaps). */
export function isKnownTool(toolName: string): boolean {
  return toolName === 'Bash' || toolName in TOOL_NAME_CLASSES;
}
