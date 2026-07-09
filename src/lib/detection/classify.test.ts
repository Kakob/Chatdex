import { describe, expect, it } from 'vitest';
import {
  classifyToolCall,
  isKnownTool,
  type ToolCallClass,
} from './classify';

// Acceptance (c): ~30 representative tool calls mapped correctly.
const CASES: [string, Record<string, unknown>, ToolCallClass][] = [
  // File tools
  ['Edit', { file_path: '/a.ts', old_string: 'x', new_string: 'y' }, 'state_changing'],
  ['Write', { file_path: '/a.ts', content: 'x' }, 'state_changing'],
  ['MultiEdit', { file_path: '/a.ts', edits: [] }, 'state_changing'],
  ['NotebookEdit', { notebook_path: '/n.ipynb', new_source: 'x' }, 'state_changing'],
  ['Read', { file_path: '/a.ts' }, 'neutral'],
  ['Grep', { pattern: 'foo' }, 'neutral'],
  ['Glob', { pattern: '**/*.ts' }, 'neutral'],
  ['WebSearch', { query: 'docs' }, 'neutral'],
  // Bash: test runners
  ['Bash', { command: 'npm test' }, 'verification_shaped'],
  ['Bash', { command: 'npm run test:watch' }, 'verification_shaped'],
  ['Bash', { command: 'npx vitest run src/lib' }, 'verification_shaped'],
  ['Bash', { command: 'pytest tests/ -k parser' }, 'verification_shaped'],
  ['Bash', { command: 'go test ./...' }, 'verification_shaped'],
  ['Bash', { command: 'cargo check' }, 'verification_shaped'],
  // Bash: type checkers and linters
  ['Bash', { command: 'tsc --noEmit' }, 'verification_shaped'],
  ['Bash', { command: 'npm run typecheck' }, 'verification_shaped'],
  ['Bash', { command: 'eslint . --max-warnings 0' }, 'verification_shaped'],
  ['Bash', { command: 'ruff check src/' }, 'verification_shaped'],
  // Bash: builds and health checks
  ['Bash', { command: 'npm run build' }, 'verification_shaped'],
  ['Bash', { command: 'curl http://localhost:3003/health' }, 'verification_shaped'],
  ['Bash', { command: 'gh run view 12345 --json status' }, 'verification_shaped'],
  // Bash: version control
  ['Bash', { command: 'git commit -m "fix"' }, 'state_changing'],
  ['Bash', { command: 'git push origin main' }, 'state_changing'],
  ['Bash', { command: 'git status' }, 'neutral'],
  ['Bash', { command: 'git diff HEAD~1' }, 'neutral'],
  // Bash: package management
  ['Bash', { command: 'npm install lodash' }, 'state_changing'],
  ['Bash', { command: 'pip install requests' }, 'state_changing'],
  // Bash: filesystem and mutations
  ['Bash', { command: 'rm -rf dist' }, 'state_changing'],
  ['Bash', { command: 'mkdir -p src/lib/detection' }, 'state_changing'],
  ['Bash', { command: "sed -i 's/a/b/' file.txt" }, 'state_changing'],
  ['Bash', { command: 'echo done > out.log' }, 'state_changing'],
  ['Bash', { command: 'curl -X POST http://api/items' }, 'state_changing'],
  // Bash: migrations, deploys, containers
  ['Bash', { command: 'npx drizzle-kit push' }, 'state_changing'],
  ['Bash', { command: 'docker compose up -d' }, 'state_changing'],
  ['Bash', { command: 'npm run deploy' }, 'state_changing'],
  // Bash: reads and unknowns
  ['Bash', { command: 'ls -la src' }, 'neutral'],
  ['Bash', { command: 'grep -rn "config" src/' }, 'neutral'],
  ['Bash', { command: 'npm test 2>&1' }, 'verification_shaped'],
  ['SomeFutureTool', { arg: 1 }, 'neutral'],
];

describe('classifyToolCall (acceptance c)', () => {
  for (const [toolName, input, expected] of CASES) {
    const label = toolName === 'Bash' ? `Bash: ${input.command as string}` : toolName;
    it(`${label} → ${expected}`, () => {
      expect(classifyToolCall(toolName, input)).toBe(expected);
    });
  }

  it('Bash with a non-string command is neutral', () => {
    expect(classifyToolCall('Bash', {})).toBe('neutral');
  });
});

describe('isKnownTool', () => {
  it('recognizes curated tools and flags unknown ones', () => {
    expect(isKnownTool('Bash')).toBe(true);
    expect(isKnownTool('Edit')).toBe(true);
    expect(isKnownTool('SomeFutureTool')).toBe(false);
  });
});
