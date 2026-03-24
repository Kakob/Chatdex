import { describe, it, expect } from 'vitest';
import {
  createWorkspace,
  archiveWorkspace,
  getActiveWorkspaces,
  assignItemToWorkspace,
  getWorkspaceItems,
  DEFAULT_WORKSPACE_ID,
} from './workspaces';
import { createAnchor } from './anchors';

describe('createWorkspace', () => {
  it('generates UUID and timestamps', () => {
    const ws = createWorkspace('Project X');
    expect(ws.id).toBeDefined();
    expect(ws.name).toBe('Project X');
    expect(ws.createdAt).toBeInstanceOf(Date);
  });

  it('sets isArchived to false by default', () => {
    expect(createWorkspace('Test').isArchived).toBe(false);
  });
});

describe('archiveWorkspace', () => {
  it('sets isArchived to true', () => {
    const ws = createWorkspace('Test');
    const archived = archiveWorkspace(ws);
    expect(archived.isArchived).toBe(true);
  });
});

describe('getActiveWorkspaces', () => {
  it('excludes archived workspaces', () => {
    const workspaces = [
      createWorkspace('Active'),
      archiveWorkspace(createWorkspace('Archived')),
      createWorkspace('Also Active'),
    ];
    expect(getActiveWorkspaces(workspaces)).toHaveLength(2);
  });
});

describe('assignItemToWorkspace', () => {
  it('sets workspace_id on an anchored item', () => {
    const item = createAnchor({
      contentType: 'full_response',
      claudeResponse: 'Hello',
      conversationId: 'c1',
      messageIndex: 0,
    });
    const assigned = assignItemToWorkspace(item, 'ws-1');
    expect(assigned.workspaceId).toBe('ws-1');
  });
});

describe('getWorkspaceItems', () => {
  it('returns items for a workspace', () => {
    const items = [
      { ...createAnchor({ contentType: 'full_response', claudeResponse: 'a', conversationId: 'c1', messageIndex: 0 }), workspaceId: 'ws-1' },
      { ...createAnchor({ contentType: 'full_response', claudeResponse: 'b', conversationId: 'c1', messageIndex: 1 }), workspaceId: 'ws-2' },
      { ...createAnchor({ contentType: 'full_response', claudeResponse: 'c', conversationId: 'c1', messageIndex: 2 }), workspaceId: 'ws-1' },
    ];
    expect(getWorkspaceItems(items, 'ws-1')).toHaveLength(2);
  });
});

describe('DEFAULT_WORKSPACE_ID', () => {
  it('exists for unassigned items', () => {
    expect(DEFAULT_WORKSPACE_ID).toBeDefined();
    expect(typeof DEFAULT_WORKSPACE_ID).toBe('string');
  });
});
