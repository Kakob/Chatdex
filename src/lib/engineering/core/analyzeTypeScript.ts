/**
 * Deterministic, filesystem-free TypeScript source analyzer.
 *
 * Consumes complete in-memory files and returns a rebuildable source graph.
 * No browser, React, Dexie, GitHub, Node fs, sample app, or LLM dependency.
 *
 * Intended only as a structural analyzer, not behavior verification or a
 * persistent identity solver. Cross-file links are established by the TS
 * language service's checker against exactly the files in the snapshot.
 */
import * as ts from 'typescript';
import {
  ANALYZER_VERSION, fingerprintText, normalizeSnapshot, snapshotFingerprint,
  type AnalyzerDiagnostic, type DerivedGraph, type SourceEntity, type SourceEntityKind,
  type SourceFile, type SourceLocation, type SourceRelation, type SourceRelationKind,
  type SourceSnapshot,
} from './contracts';

const MAX_ENTITIES = 40_000;
const MAX_RELATIONS = 100_000;

const order = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const isTypeScriptFile = (path: string) => /\.(?:ts|tsx|mts|cts)$/.test(path);

function absolutePath(path: string): string {
  return '/' + path;
}

/**
 * Explicitly local resolution, not a web or on-disk module loader. Handle
 * TypeScript imports written with .js / .mjs / .cjs output extensions.
 * Bare package imports are external; don't invent graph entities for them.
 */
function resolveLocalImport(containingPath: string, specifier: string, paths: ReadonlySet<string>): string | undefined {
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return undefined;
  const dir = containingPath.split('/').slice(0, -1);
  for (const part of specifier.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (!dir.length) return undefined;
      dir.pop();
    } else {
      dir.push(part);
    }
  }
  const joined = dir.join('/');
  const options = [
    joined,
    joined + '.ts', joined + '.tsx', joined + '.mts', joined + '.cts',
    joined + '/index.ts', joined + '/index.tsx', joined + '/index.mts',
  ];
  if (/\.(?:js|jsx|mjs|cjs)$/.test(joined)) {
    const prefix = joined.replace(/\.(?:js|jsx|mjs|cjs)$/, '');
    options.push(prefix + '.ts', prefix + '.tsx', prefix + '.mts', prefix + '.cts');
  }
  return options.find((path) => paths.has(path));
}

function makeHost(files: readonly SourceFile[], compilerOptions: ts.CompilerOptions): ts.CompilerHost {
  const texts = new Map(files.map((file) => [absolutePath(file.path), file.text]));
  const sourceFiles = new Map<string, ts.SourceFile>();
  for (const file of files) {
    const fileName = absolutePath(file.path);
    const scriptKind = /\.tsx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    sourceFiles.set(fileName, ts.createSourceFile(fileName, file.text, ts.ScriptTarget.Latest, true, scriptKind));
  }
  const relativePaths = new Set(files.map((file) => file.path));
  const host: ts.CompilerHost = {
    getSourceFile: (fileName) => sourceFiles.get(fileName),
    getDefaultLibFileName: () => '/__no_default_lib__.d.ts',
    writeFile: () => { throw new Error('The analyzer never writes source files'); },
    getCurrentDirectory: () => '/',
    getDirectories: () => [],
    getCanonicalFileName: (name) => name,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (name) => texts.has(name),
    readFile: (name) => texts.get(name),
    directoryExists: (name) =>
      name === '/' || [...texts.keys()].some((path) => path.startsWith(name.replace(/\/$/, '') + '/')),
    realpath: (name) => name,
    resolveModuleNames: (names, containingFile) => {
      const containingPath = containingFile.startsWith('/') ? containingFile.slice(1) : containingFile;
      return names.map((specifier) => {
        const resolved = resolveLocalImport(containingPath, specifier, relativePaths);
        if (!resolved) return undefined;
        return {
          resolvedFileName: absolutePath(resolved),
          extension: resolved.endsWith('.tsx') ? ts.Extension.Tsx : resolved.endsWith('.mts')
            ? ts.Extension.Mts : resolved.endsWith('.cts') ? ts.Extension.Cts : ts.Extension.Ts,
          isExternalLibraryImport: false,
        };
      });
    },
  };
  // Compiler options remain in the caller's realm; this host cannot escape
  // its in-memory map regardless of noLib or module resolution settings.
  void compilerOptions;
  return host;
}

function sourceLocation(path: string, file: ts.SourceFile, node: ts.Node): SourceLocation {
  const startOffset = node.getStart(file);
  const endOffset = node.end;
  const start = file.getLineAndCharacterOfPosition(startOffset);
  const end = file.getLineAndCharacterOfPosition(endOffset);
  return {
    path, startOffset, endOffset,
    startLine: start.line + 1, startColumn: start.character + 1,
    endLine: end.line + 1, endColumn: end.character + 1,
  };
}

function nameOf(node: ts.Node): string | null {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && !node.name) return 'default';
  if (!('name' in node)) return null;
  const name = (node as ts.NamedDeclaration).name;
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function sourceKind(node: ts.Node): SourceEntityKind | null {
  if (ts.isFunctionDeclaration(node)) return 'function';
  if (ts.isClassDeclaration(node)) return 'class';
  if (ts.isInterfaceDeclaration(node)) return 'interface';
  if (ts.isTypeAliasDeclaration(node)) return 'type';
  if (ts.isEnumDeclaration(node)) return 'enum';
  if (ts.isModuleDeclaration(node)) return 'namespace';
  if (ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) return 'method';
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node) || ts.isEnumMember(node)) return 'property';
  if (ts.isVariableDeclaration(node)) {
    const statement = node.parent?.parent;
    if (statement && ts.isVariableStatement(statement) &&
        (ts.isSourceFile(statement.parent) || ts.isModuleBlock(statement.parent))) return 'variable';
  }
  return null;
}

function hasExportModifier(node: ts.Node): boolean {
  const declaration = ts.isVariableDeclaration(node) ? node.parent?.parent : node;
  if (!declaration || !ts.canHaveModifiers(declaration)) return false;
  return (ts.getModifiers(declaration) ?? []).some((modifier) =>
    modifier.kind === ts.SyntaxKind.ExportKeyword || modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function headerAndBody(node: ts.Node, file: ts.SourceFile): { signature: string; body: string } {
  const start = node.getStart(file);
  if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)) {
    const body = node.body;
    return {
      signature: file.text.slice(start, body ? body.getStart(file) : node.end).trim(),
      body: body?.getText(file) ?? '',
    };
  }
  if (ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node)) {
    // SyntaxList starts immediately after the opening brace.
    return {
      signature: file.text.slice(start, node.members.pos).trim(),
      body: node.members.map((member) => member.getText(file)).join('\n'),
    };
  }
  if (ts.isEnumDeclaration(node)) {
    return {
      signature: file.text.slice(start, node.members.pos).trim(),
      body: node.members.map((member) => member.getText(file)).join('\n'),
    };
  }
  if (ts.isModuleDeclaration(node)) {
    return {
      signature: file.text.slice(start, node.body ? node.body.getStart(file) : node.end).trim(),
      body: node.body?.getText(file) ?? '',
    };
  }
  if (ts.isVariableDeclaration(node)) {
    const nameEnd = node.initializer?.getStart(file) ?? node.end;
    return {
      signature: file.text.slice(start, nameEnd).replace(/=\s*$/, '').trim(),
      body: node.initializer?.getText(file) ?? '',
    };
  }
  if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
    return {
      signature: file.text.slice(start, node.initializer?.getStart(file) ?? node.end).replace(/=\s*$/, '').trim(),
      body: node.initializer?.getText(file) ?? '',
    };
  }
  return { signature: node.getText(file), body: '' };
}

function moduleSpecifier(node: ts.Node): string | null {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
    return node.moduleSpecifier.text;
  }
  return null;
}

interface DeclarationRecord {
  id: string;
  node: ts.Node;
  file: ts.SourceFile;
  path: string;
}

/** Build an exhaustive structural graph for the supported in-memory files. */
export function analyzeTypeScript(snapshot: SourceSnapshot): DerivedGraph {
  const files = normalizeSnapshot(snapshot);
  const supported = files.filter((file) => isTypeScriptFile(file.path));
  const skippedPaths = files.filter((file) => !isTypeScriptFile(file.path)).map((file) => file.path);
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noLib: true, noEmit: true, allowImportingTsExtensions: true,
    jsx: ts.JsxEmit.Preserve,
  };
  const program = ts.createProgram({
    rootNames: supported.map((file) => absolutePath(file.path)),
    options,
    host: makeHost(supported, options),
  });
  const checker = program.getTypeChecker();
  const diagnostics: AnalyzerDiagnostic[] = [];
  const entities: SourceEntity[] = [];
  const relations = new Map<string, SourceRelation>();
  const declarations: DeclarationRecord[] = [];
  const declarationIds = new Map<ts.Node, string>();
  const relativePaths = new Set(supported.map((f) => f.path));
  const moduleIds = new Map<string, string>();

  function addRelation(kind: SourceRelationKind, fromId: string, toId: string) {
    if (fromId === toId) return;
    const id = kind + ':' + fromId + '->' + toId;
    if (!relations.has(id)) {
      if (relations.size >= MAX_RELATIONS) throw new Error('Source graph exceeds supported relation limit');
      relations.set(id, { id, kind, fromId, toId });
    }
  }

  for (const file of supported) {
    const sf = program.getSourceFile(absolutePath(file.path));
    if (!sf) throw new Error('The in-memory compiler could not read ' + file.path);
    const moduleId = 'module:' + file.path;
    moduleIds.set(file.path, moduleId);
    entities.push({
      id: moduleId, kind: 'module', name: file.path.split('/').at(-1) ?? file.path,
      path: file.path, parentId: null, exported: false,
      location: sourceLocation(file.path, sf, sf),
      signature: 'module ' + file.path,
      signatureFingerprint: fingerprintText('module ' + file.path),
      bodyFingerprint: fingerprintText(file.text),
    });
    for (const problem of program.getSyntacticDiagnostics(sf)) {
      const pos = sf.getLineAndCharacterOfPosition(problem.start ?? 0);
      diagnostics.push({
        path: file.path, kind: 'syntax',
        message: ts.flattenDiagnosticMessageText(problem.messageText, '\n'),
        line: pos.line + 1, column: pos.character + 1,
      });
    }
  }

  for (const file of supported) {
    const sf = program.getSourceFile(absolutePath(file.path))!;
    const occurrences = new Map<string, number>();

    function walk(node: ts.Node, parentId: string, enclosingNames: string[]) {
      const kind = sourceKind(node);
      const name = kind ? nameOf(node) : null;
      let nextParent = parentId;
      let nextNames = enclosingNames;
      if (kind && name !== null) {
        const namePart = kind + ':' + name;
        const scope = [...enclosingNames, namePart].join('/');
        const current = occurrences.get(scope) ?? 0;
        occurrences.set(scope, current + 1);
        const id = file.path + '::' + scope + (current ? '#' + current : '');
        const { signature, body } = headerAndBody(node, sf);
        entities.push({
          id, kind, name, path: file.path, parentId, exported: hasExportModifier(node),
          location: sourceLocation(file.path, sf, node),
          signature: signature.slice(0, 2000),
          signatureFingerprint: fingerprintText(signature),
          bodyFingerprint: fingerprintText(body),
        });
        if (entities.length > MAX_ENTITIES) throw new Error('Source graph exceeds supported entity limit');
        declarations.push({ id, node, file: sf, path: file.path });
        declarationIds.set(node, id);
        addRelation('contains', parentId, id);
        if (parentId === moduleIds.get(file.path) && hasExportModifier(node)) {
          addRelation('exports', parentId, id);
        }
        nextParent = id;
        nextNames = [...enclosingNames, namePart];
      }
      ts.forEachChild(node, (child) => walk(child, nextParent, nextNames));
    }
    walk(sf, moduleIds.get(file.path)!, []);
  }

  function entityOfSymbol(symbol: ts.Symbol | undefined): string | null {
    if (!symbol) return null;
    let actual = symbol;
    if (actual.flags & ts.SymbolFlags.Alias) {
      try { actual = checker.getAliasedSymbol(actual); } catch { return null; }
    }
    for (const declaration of actual.declarations ?? []) {
      const found = declarationIds.get(declaration);
      if (found) return found;
      // A symbol may resolve to a variable statement rather than declaration.
      if (ts.isVariableStatement(declaration)) {
        for (const d of declaration.declarationList.declarations) {
          const candidate = declarationIds.get(d);
          if (candidate) return candidate;
        }
      }
    }
    return null;
  }

  for (const file of supported) {
    const sf = program.getSourceFile(absolutePath(file.path))!;
    const moduleId = moduleIds.get(file.path)!;

    function references(node: ts.Node, ownerId: string) {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        const specifier = moduleSpecifier(node);
        if (specifier && (specifier.startsWith('./') || specifier.startsWith('../'))) {
          const resolved = resolveLocalImport(file.path, specifier, relativePaths);
          if (resolved) {
            const targetModule = moduleIds.get(resolved);
            if (targetModule) addRelation(ts.isImportDeclaration(node) ? 'imports' : 'exports', moduleId, targetModule);
          } else {
            const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
            diagnostics.push({
              path: file.path, kind: 'unresolved-import',
              message: 'Relative module not found in supplied snapshot: ' + specifier,
              line: pos.line + 1, column: pos.character + 1,
            });
          }
        }
        if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) {
          for (const specifierNode of node.exportClause.elements) {
            const target = entityOfSymbol(checker.getSymbolAtLocation(specifierNode.propertyName ?? specifierNode.name));
            if (target) addRelation('exports', moduleId, target);
          }
        }
        return;
      }

      // The function/method/class which contains this reference owns it.
      const nextOwner = declarationIds.get(node) ?? ownerId;
      if (ts.isIdentifier(node)) {
        const target = entityOfSymbol(checker.getSymbolAtLocation(node));
        if (target && target !== nextOwner) {
          const parent = node.parent;
          const isCalled = (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
            parent.expression === node;
          const isPropertyCalled = ts.isPropertyAccessExpression(parent) && parent.name === node &&
            (ts.isCallExpression(parent.parent) || ts.isNewExpression(parent.parent)) &&
            parent.parent.expression === parent;
          addRelation(isCalled || isPropertyCalled ? 'calls' : 'references', nextOwner, target);
        }
      }
      ts.forEachChild(node, (child) => references(child, nextOwner));
    }

    references(sf, moduleId);
  }

  // Omit unsupported input from structural entities, but never hide its presence.
  for (const path of skippedPaths) {
    diagnostics.push({ path, kind: 'unsupported', message: 'Not a supported TypeScript source file' });
  }

  // Ensure output is independent of caller file ordering and object identity.
  entities.sort((a, b) => order(a.id, b.id));
  diagnostics.sort((a, b) => order(a.path, b.path) ||
    (a.line ?? 0) - (b.line ?? 0) || (a.column ?? 0) - (b.column ?? 0) ||
    order(a.kind, b.kind) || order(a.message, b.message));
  const result: DerivedGraph = {
    schemaVersion: 'chatdex.derived-source-graph/v1',
    analyzerVersion: ANALYZER_VERSION,
    snapshotFingerprint: snapshotFingerprint(files),
    ...(snapshot.revision ? { revision: snapshot.revision } : {}),
    files: supported.map((file) => ({
      path: file.path, fingerprint: fingerprintText(file.text), length: file.text.length,
    })),
    entities,
    relations: [...relations.values()].sort((a, b) => order(a.id, b.id)),
    diagnostics,
    skippedPaths,
  };
  void declarations;
  return result;
}
