/**
 * A deliberately conservative operation lens on source facts. It reports
 * direct calls, relevant data types and literal decisions in source code,
 * not inferred purpose, runtime execution order or verified behavior.
 */
import * as ts from 'typescript';
import type { DerivedGraph, SourceEntity, SourceFile } from './contracts';

const OP_KINDS = new Set<SourceEntity['kind']>(['function', 'method', 'constructor']);
const DATA_KINDS = new Set<SourceEntity['kind']>(['interface', 'type', 'class', 'enum']);
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

export const isTestFile = (path: string): boolean =>
  /(?:\.test\.|\.spec\.|\/__tests__\/|\/tests?\/)/i.test(path);

export const humanizeSymbol = (name: string): string => name
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();

export interface OperationOverview {
  entity: SourceEntity;
  label: string;
  callCount: number;
  callerCount: number;
}

export function sourceOperations(graph: DerivedGraph): OperationOverview[] {
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  function withinInterface(e: SourceEntity): boolean {
    let parent = e.parentId ? byId.get(e.parentId) : undefined;
    while (parent) {
      if (parent.kind === 'interface' || parent.kind === 'type') return true;
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    return false;
  }
  const summaries = graph.entities
    .filter((e) => OP_KINDS.has(e.kind) && !isTestFile(e.path) && !withinInterface(e))
    .map((entity) => ({
      entity,
      label: humanizeSymbol(entity.name),
      callCount: graph.relations.filter((r) => r.kind === 'calls' && r.fromId === entity.id).length,
      callerCount: graph.relations.filter((r) => r.kind === 'calls' && r.toId === entity.id).length,
    }));
  const score = (x: OperationOverview) =>
    (x.entity.exported ? 5 : 0) + x.callCount * 4 + x.callerCount * 2;
  return summaries.sort((a, b) => score(b) - score(a) ||
    cmp(a.entity.path, b.entity.path) || a.entity.location.startOffset - b.entity.location.startOffset);
}

export interface SourceDecision {
  kind: 'switch' | 'case' | 'if' | 'loop';
  expression: string;
  line: number;
}

export interface OperationDetail {
  entity: SourceEntity;
  inputs: string[];
  returnType: string | null;
  decisions: SourceDecision[];
  calls: SourceEntity[];
  calledBy: SourceEntity[];
  dataTypes: SourceEntity[];
  mentionedInTests: string[];
}

function inspectSyntax(entity: SourceEntity, source: string) {
  const file = ts.createSourceFile(entity.path, source, ts.ScriptTarget.Latest, true,
    entity.path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  let owner: ts.Node | undefined;
  function locate(node: ts.Node) {
    if (node.getStart(file) === entity.location.startOffset &&
        node.getEnd() === entity.location.endOffset &&
        (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
         ts.isConstructorDeclaration(node))) {
      owner = node;
      return;
    }
    if (node.getStart(file) <= entity.location.startOffset &&
        node.end >= entity.location.endOffset) {
      ts.forEachChild(node, locate);
    }
  }
  locate(file);
  const fallback = { inputs: [] as string[], returnType: null as string | null, decisions: [] as SourceDecision[] };
  if (!owner) return fallback;
  const declaration = owner as ts.FunctionDeclaration | ts.MethodDeclaration | ts.ConstructorDeclaration;
  const inputs = declaration.parameters.map((p) => p.getText(file).slice(0, 160));
  const returnType = 'type' in declaration && declaration.type
    ? declaration.type.getText(file).slice(0, 160) : null;
  const decisions: SourceDecision[] = [];
  function walk(node: ts.Node) {
    if (decisions.length >= 16) return;
    if (node !== owner && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    const line = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
    const add = (kind: SourceDecision['kind'], text: string) => {
      if (decisions.length < 16) decisions.push({ kind, expression: text.slice(0, 145), line });
    };
    if (ts.isSwitchStatement(node)) add('switch', node.expression.getText(file));
    else if (ts.isCaseClause(node)) add('case', node.expression.getText(file));
    else if (ts.isDefaultClause(node)) add('case', 'default');
    else if (ts.isIfStatement(node)) add('if', node.expression.getText(file));
    else if (ts.isForStatement(node) || ts.isForInStatement(node) ||
      ts.isForOfStatement(node) || ts.isWhileStatement(node) || ts.isDoStatement(node)) {
      add('loop', node.getText(file).split('{')[0].slice(0, 145));
    }
    ts.forEachChild(node, walk);
  }
  ts.forEachChild(owner, walk);
  return { inputs, returnType, decisions };
}

export function inspectOperation(
  graph: DerivedGraph, sourceFiles: readonly SourceFile[], entityId: string,
): OperationDetail | null {
  const entity = graph.entities.find((e) => e.id === entityId);
  if (!entity || !OP_KINDS.has(entity.kind)) return null;
  const byId = new Map(graph.entities.map((e) => [e.id, e]));
  const unique = (entities: Array<SourceEntity | undefined>) =>
    [...new Map(entities.filter((e): e is SourceEntity => Boolean(e))
      .map((e) => [e.id, e])).values()]
      .sort((a, b) => cmp(a.path, b.path) || a.location.startOffset - b.location.startOffset);
  const calls = unique(graph.relations.filter((r) => r.kind === 'calls' && r.fromId === entityId)
    .map((r) => byId.get(r.toId))).filter((e) => OP_KINDS.has(e.kind));
  const calledBy = unique(graph.relations.filter((r) => r.kind === 'calls' && r.toId === entityId)
    .map((r) => byId.get(r.fromId))).filter((e) => OP_KINDS.has(e.kind));
  const dataTypes = unique(graph.relations.filter((r) => r.kind === 'references' && r.fromId === entityId)
    .map((r) => byId.get(r.toId))).filter((e) => DATA_KINDS.has(e.kind));
  const text = sourceFiles.find((f) => f.path === entity.path)?.text ?? '';
  const escaped = entity.name.replace(/[^A-Za-z0-9_$]/g, '\\$&');
  const mentionedInTests = sourceFiles.filter((f) => isTestFile(f.path))
    .filter((f) => new RegExp('(?:^|[^A-Za-z0-9_$])' + escaped + '(?:$|[^A-Za-z0-9_$])').test(f.text))
    .map((f) => f.path);
  return {
    entity, ...inspectSyntax(entity, text),
    calls, calledBy, dataTypes, mentionedInTests,
  };
}
