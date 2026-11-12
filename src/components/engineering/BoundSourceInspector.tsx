/**
 * Reusable code/test inspection for any engineering entity.
 * Resolves known bundled examples or indexed source through the existing
 * read-only repo cache. No project-specific source mapping belongs in pages.
 */
import { useEffect, useMemo, useState } from 'react';
import type { EngineeringExampleKind } from '../../lib/engineering/demoProjects';
import type { ProjectEngineeringModel } from '../../lib/engineering/modelStore';
import { bundledEngineeringSources } from '../../lib/engineering/bundledSources';
import {
  bindingGitHubUrl,
  fixtureSourceBindings,
  resolveSourceBinding,
  type EngineeringSourceBinding,
  type SourceResolution,
} from '../../lib/engineering/sourceCatalog';
import { SourceExcerpt } from './SourceExcerpt';
import { muted } from './ui';

type Role = 'implementation' | 'test';

interface Props {
  model: ProjectEngineeringModel | null;
  targetId: string;
  role: Role;
  title: string;
  /** Explicit-only fallback for the legacy standalone queue Explorer. */
  exampleFallback?: { kind: EngineeringExampleKind; projectId: string };
}

export function BoundSourceInspector({ model, targetId, role, title, exampleFallback }: Props) {
  const sources = useMemo(() => {
    if (model?.sourceBindings.some((source) => source.targetId === targetId && source.role === role)) {
      return model.sourceBindings;
    }
    // Until an existing Iteration-2 example is explicitly upgraded, its
    // fixed demo code remains inspectable through the same binding catalog.
    if (exampleFallback) return fixtureSourceBindings(exampleFallback.kind, exampleFallback.projectId);
    return model?.sourceBindings ?? [];
  }, [model, targetId, role, exampleFallback?.kind, exampleFallback?.projectId]);
  const binding = sources.find((source) => source.targetId === targetId && source.role === role);
  const bindingKey = binding ? [binding.id, binding.path, binding.sha ?? '', binding.needle].join(':') : '';
  const [result, setResult] = useState<{ key: string; value: SourceResolution } | null>(null);

  useEffect(() => {
    if (!binding) return;
    let cancelled = false;
    void resolveSourceBinding(binding, bundledEngineeringSources).then((value) => {
      if (!cancelled) setResult({ key: bindingKey, value });
    });
    return () => { cancelled = true; };
    // Bind to the immutable identifying fields. Otherwise the explicit demo
    // fallback creates a fresh object on each render and loops this effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingKey]);

  if (!binding) return (
    <p className={'text-xs leading-5 ' + muted}>
      No {role} source binding for this model element. The Explorer will not invent a source location.
      Add a code/test binding after indexing a repository scope.
    </p>
  );
  if (!result || result.key !== bindingKey) {
    return <p className={'text-xs ' + muted}>Resolving source from the local repository reader…</p>;
  }

  return <BoundSourceResult binding={binding} resolved={result.value} title={title} />;
}

function BoundSourceResult({
  binding, resolved, title,
}: {
  binding: EngineeringSourceBinding;
  resolved: SourceResolution;
  title: string;
}) {
  if (resolved.status === 'not-indexed') return (
    <p className="text-xs text-amber-700 dark:text-amber-300">
      {binding.path} is not indexed at revision {binding.sha ?? '(missing revision)'}.
      Use the existing read-only repository indexer to cache that source first.
      No source or verification claim was fabricated.
    </p>
  );
  if (resolved.status === 'unavailable') return (
    <p className="text-xs text-amber-700 dark:text-amber-300">
      The authored source {binding.path} is not available in this build.
    </p>
  );
  const text = resolved.text;
  if (text === undefined) return <p className={'text-xs ' + muted}>Source unavailable.</p>;
  const trustedUrl = bindingGitHubUrl(binding);
  const provenance = binding.sourceKind === 'bundled'
    ? 'Bundled with this build · unpinned; source is NOT verification evidence.'
    : 'Indexed at ' + binding.sha + ' · a source snapshot, NOT proof of runtime behavior.';
  return (
    <div className="min-w-0 space-y-2">
      <p className={'text-xs leading-5 ' + muted} aria-label="Source provenance">{provenance}</p>
      {resolved.status === 'anchor-missing' && (
        <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">
          The authored symbol anchor is missing at this source revision; inspect the file before trusting the binding.
        </p>
      )}
      <SourceExcerpt
        key={binding.id + ':' + (binding.sha ?? 'bundled')}
        source={{ text, path: binding.path, href: trustedUrl ?? undefined }}
        needle={binding.needle}
        title={title}
      />
    </div>
  );
}
