// Workspace management utilities
import type { Workspace, AnchoredItem } from './types';

export const DEFAULT_WORKSPACE_ID = '__default__';

export function createWorkspace(name: string, description?: string): Workspace {
  return {
    id: crypto.randomUUID(),
    name,
    description: description || null,
    isArchived: false,
    createdAt: new Date(),
  };
}

export function archiveWorkspace(workspace: Workspace): Workspace {
  return { ...workspace, isArchived: true };
}

export function getActiveWorkspaces(workspaces: Workspace[]): Workspace[] {
  return workspaces.filter((w) => !w.isArchived);
}

export function assignItemToWorkspace(item: AnchoredItem, workspaceId: string): AnchoredItem {
  return { ...item, workspaceId, updatedAt: new Date() };
}

export function getWorkspaceItems(items: AnchoredItem[], workspaceId: string): AnchoredItem[] {
  return items.filter((i) => i.workspaceId === workspaceId);
}
