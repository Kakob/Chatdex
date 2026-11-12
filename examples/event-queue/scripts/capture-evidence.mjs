#!/usr/bin/env node
// Capture a chatdex.engineering.evidence/v1 manifest for examples/event-queue.
//
// Usage (from the repository root):
//   npm run queue:evidence -- [--base <sha>] [--out <path>] [--note "<text>"]...
//
// Runs the example's vitest suite with the JSON reporter, pins the result to
// the current git commit, and records a SHA-256 of every top-level symbol,
// class member, and criterion test so a reader can tell exactly which code
// produced which result. Failing tests are expected and recorded; the script
// fails only when it cannot produce a manifest.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCHEMA = 'chatdex.engineering.evidence/v1';
const CRITERION_ID = /^\[(EQ-[A-Z0-9-]+)\]/;
const FAILURE_MESSAGE_MAX = 500;

const exampleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  console.error(`capture-evidence: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { base: undefined, out: undefined, notes: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const takeValue = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) fail(`${flag} needs a value`);
      i += 1;
      return value;
    };
    if (flag === '--base') args.base = takeValue();
    else if (flag === '--out') args.out = takeValue();
    else if (flag === '--note') args.notes.push(takeValue());
    else if (flag === '--help' || flag === '-h') {
      console.log('usage: npm run queue:evidence -- [--base <sha>] [--out <path>] [--note "<text>"]...');
      process.exit(0);
    } else fail(`unknown argument: ${flag}`);
  }
  return args;
}

function git(repoRoot, args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    if (allowFailure) return null;
    fail(`git ${args.join(' ')} failed: ${(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

function toPosix(path) {
  return path.split(sep).join('/');
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeRemote(raw) {
  if (!raw) return '';
  let url = raw.trim();
  const scp = /^git@github\.com:(.+)$/.exec(url);
  if (scp) url = `https://github.com/${scp[1]}`;
  url = url.replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/');
  url = url.replace(/^git:\/\/github\.com\//, 'https://github.com/');
  url = url.replace(/^https?:\/\/[^@/]+@github\.com\//, 'https://github.com/');
  url = url.replace(/\/+$/, '').replace(/\.git$/, '');
  return url;
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function summarizeFailure(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return undefined;
  const lines = stripAnsi(String(messages[0])).split('\n');
  const kept = [];
  for (const line of lines) {
    if (/^\s+at /.test(line)) break;
    kept.push(line.trimEnd());
  }
  let text = kept.join('\n').trim();
  if (text.length > FAILURE_MESSAGE_MAX) text = `${text.slice(0, FAILURE_MESSAGE_MAX - 1)}…`;
  return text || undefined;
}

function normalizeStatus(status) {
  if (status === 'passed' || status === 'failed' || status === 'todo') return status;
  return 'skipped'; // vitest reports skipped tests as "pending" or "skipped"
}

function listTsFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

function memberName(member, sourceFile) {
  if (ts.isConstructorDeclaration(member)) return 'constructor';
  if (!member.name) return null;
  if (ts.isIdentifier(member.name) || ts.isPrivateIdentifier(member.name)) return member.name.text;
  if (ts.isStringLiteral(member.name) || ts.isNumericLiteral(member.name)) return member.name.text;
  return member.name.getText(sourceFile);
}

function isTestCall(node) {
  if (!ts.isCallExpression(node)) return false;
  let callee = node.expression;
  // it.only(...), test.skip(...), it.fails(...)
  if (ts.isPropertyAccessExpression(callee)) callee = callee.expression;
  return ts.isIdentifier(callee) && (callee.text === 'it' || callee.text === 'test');
}

function collectSymbols(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const path = toPosix(relative(exampleRoot, filePath));
  const symbols = [];

  const record = (symbol, node) => {
    const start = node.getStart(sourceFile);
    const end = node.end;
    symbols.push({
      path,
      symbol,
      startLine: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
      endLine: sourceFile.getLineAndCharacterOfPosition(end).line + 1,
      sha256: createHash('sha256').update(text.slice(start, end), 'utf8').digest('hex'),
    });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      record(statement.name.text, statement);
    } else if (ts.isClassDeclaration(statement) && statement.name) {
      const className = statement.name.text;
      record(className, statement);
      for (const member of statement.members) {
        const name = memberName(member, sourceFile);
        if (name) record(`${className}.${name}`, member);
      }
    } else if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
      record(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      const declarations = statement.declarationList.declarations;
      for (const declaration of declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        // A single declarator owns its whole statement (including `export const`).
        record(declaration.name.text, declarations.length === 1 ? statement : declaration);
      }
    }
  }

  if (path.startsWith('test/')) {
    const visit = (node) => {
      if (isTestCall(node)) {
        const [title] = node.arguments;
        if (title && (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))) {
          const match = CRITERION_ID.exec(title.text);
          if (match) record(`test:${match[1]}`, node);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return symbols;
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = (git(exampleRoot, ['rev-parse', '--show-toplevel']) ?? '').trim();
  if (!repoRoot) fail('not inside a git repository');
  const exampleRel = toPosix(relative(repoRoot, exampleRoot));

  // --- revision ------------------------------------------------------------
  const sha = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  const branchRaw = (git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'], { allowFailure: true }) ?? '').trim();
  const branch = branchRaw && branchRaw !== 'HEAD' ? branchRaw : undefined;
  const statusLines = git(repoRoot, ['status', '--porcelain', '--untracked-files=all', '--', exampleRel])
    .split('\n')
    .filter((line) => line.trim() !== '');
  const dirty = statusLines.length > 0;
  const uncommittedPaths = [
    ...new Set(
      statusLines.map((line) => {
        const path = line.slice(3);
        const arrow = path.indexOf(' -> ');
        return (arrow >= 0 ? path.slice(arrow + 4) : path).replace(/^"|"$/g, '');
      }),
    ),
  ].sort(compare);

  let baseSha;
  let changedPaths = [];
  if (args.base !== undefined) {
    const resolved = git(repoRoot, ['rev-parse', '--verify', '--quiet', `${args.base}^{commit}`], {
      allowFailure: true,
    });
    if (!resolved || !/^[0-9a-f]{40}$/.test(resolved.trim())) fail(`--base ${args.base} does not resolve to a commit`);
    baseSha = resolved.trim();
    changedPaths = git(repoRoot, ['diff', '--name-only', baseSha, 'HEAD', '--', exampleRel])
      .split('\n')
      .filter((line) => line.trim() !== '')
      .sort(compare);
  }

  const remoteRaw = git(repoRoot, ['remote', 'get-url', 'origin'], { allowFailure: true });

  // --- tests ---------------------------------------------------------------
  const configPath = `${exampleRel}/vitest.config.ts`;
  const command = `npx vitest run --config ${configPath} --reporter=json`;
  const tempDir = mkdtempSync(join(tmpdir(), 'chatdex-queue-evidence-'));
  const reportPath = join(tempDir, 'vitest.json');
  let report;
  try {
    const run = spawnSync(
      'npx',
      ['vitest', 'run', '--config', configPath, '--reporter=json', `--outputFile=${reportPath}`],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    if (!existsSync(reportPath)) {
      if (run.stdout) process.stderr.write(run.stdout);
      if (run.stderr) process.stderr.write(run.stderr);
      fail(`vitest produced no JSON report (exit ${run.status ?? run.signal})`);
    }
    report = JSON.parse(readFileSync(reportPath, 'utf8'));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const tests = [];
  for (const fileResult of report.testResults ?? []) {
    const file = toPosix(relative(exampleRoot, fileResult.name));
    for (const assertion of fileResult.assertionResults ?? []) {
      const name = assertion.title;
      const match = CRITERION_ID.exec(name);
      const test = {
        id: match ? match[1] : null,
        name,
        file,
        status: normalizeStatus(assertion.status),
        durationMs: Math.round((assertion.duration ?? 0) * 1000) / 1000,
      };
      const failureMessage = test.status === 'failed' ? summarizeFailure(assertion.failureMessages) : undefined;
      if (failureMessage) test.failureMessage = failureMessage;
      tests.push(test);
    }
  }
  tests.sort((a, b) => compare(a.file, b.file) || compare(a.name, b.name));
  if (tests.length === 0) fail('vitest JSON report contained no tests');

  // --- symbols -------------------------------------------------------------
  const symbols = [...listTsFiles(join(exampleRoot, 'src')), ...listTsFiles(join(exampleRoot, 'test'))]
    .flatMap(collectSymbols)
    .sort((a, b) => compare(a.path, b.path) || compare(a.symbol, b.symbol) || a.startLine - b.startLine);

  // --- environment ---------------------------------------------------------
  const requireFromRoot = createRequire(join(repoRoot, 'package.json'));
  let vitestVersion = 'unknown';
  try {
    vitestVersion = requireFromRoot('vitest/package.json').version;
  } catch {
    // leave as unknown
  }

  const revision = { sha, dirty, dirtyScope: exampleRel };
  if (branch) revision.branch = branch;
  if (baseSha) revision.baseSha = baseSha;

  const manifest = {
    schema: SCHEMA,
    repository: { remote: normalizeRemote(remoteRaw), root: exampleRel },
    revision,
    changedPaths,
    uncommittedPaths,
    command,
    environment: { node: process.version, platform: process.platform, vitest: vitestVersion },
    capturedAt: new Date().toISOString(),
    tests,
    symbols,
    notes: args.notes.map((text) => ({ text, source: 'agent-reported' })),
  };

  const outPath = args.out
    ? resolve(process.env.INIT_CWD ?? process.cwd(), args.out)
    : join(exampleRoot, 'evidence', `${sha.slice(0, 12)}${dirty ? '-dirty' : ''}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const count = (status) => tests.filter((t) => t.status === status).length;
  const failedIds = tests.filter((t) => t.status === 'failed').map((t) => t.id ?? t.name);
  console.log(`wrote ${toPosix(relative(process.cwd(), outPath)) || outPath}`);
  console.log(
    `${sha.slice(0, 12)}${dirty ? ' (dirty, unpinned)' : ''}: ${count('passed')} passed, ${count('failed')} failed, ` +
      `${count('skipped') + count('todo')} skipped/todo` +
      (failedIds.length ? ` — failing: ${failedIds.join(', ')}` : ''),
  );
}

main();
