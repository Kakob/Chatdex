/** Project-level shared model loader used by both executable examples. */
import { useCallback, useEffect, useState } from 'react';
import { loadEngineeringModel, type ProjectEngineeringModel } from './modelStore';

export function useExampleEngineeringModel(projectId: string | undefined) {
  const [model, setModel] = useState<ProjectEngineeringModel | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    const next = await loadEngineeringModel(projectId);
    setModel(next);
    setError(null);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    void loadEngineeringModel(projectId).then((next) => {
      if (!cancelled) setModel(next);
    }).catch((failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure));
    });
    return () => { cancelled = true; };
  }, [projectId]);

  return { model: model?.projectId === projectId ? model : null, refresh, error };
}

