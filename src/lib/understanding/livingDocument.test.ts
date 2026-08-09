import { describe, it, expect } from 'vitest';
import {
  renderLivingDocument,
  livingDocumentFilenamePrefix,
} from './livingDocument';
import { assembleCurrentUnderstanding } from './currentUnderstanding';
import type {
  UnderstandingObject,
  UnderstandingEvent,
  UnderstandingOp,
  UnderstandingProject,
  ReviewState,
} from '../../types/understanding';

let seq = 0;

function obj(overrides: Partial<UnderstandingObject> = {}): UnderstandingObject {
  const now = new Date('2026-08-01T00:00:00Z');
  return {
    id: `obj-${++seq}`,
    projectId: 'p1',
    type: 'idea',
    title: `Object ${seq}`,
    status: 'current',
    origin: 'ai',
    reviewState: 'accepted' as ReviewState,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function evt(
  objectId: string,
  overrides: Partial<UnderstandingEvent> & { op?: UnderstandingOp } = {}
): UnderstandingEvent {
  return {
    id: `evt-${++seq}`,
    objectId,
    op: 'introduced',
    evidence: [{ conversationId: 'c1' }],
    origin: 'ai',
    reviewState: 'accepted',
    occurredAt: new Date('2026-08-01T00:00:00Z'),
    createdAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

const names = new Map([
  ['c1', 'First conversation'],
  ['c2', 'Second conversation'],
]);

const project: UnderstandingProject = {
  id: 'p1',
  name: 'Chatdex',
  description: 'Shared understanding workspace',
  origin: 'ai',
  reviewState: 'accepted',
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

function render(
  objects: UnderstandingObject[],
  events: UnderstandingEvent[],
  options = {}
): string {
  return renderLivingDocument(
    project,
    assembleCurrentUnderstanding(objects, events, names),
    options
  );
}

describe('renderLivingDocument', () => {
  it('renders header, sections in order, and recent changes', () => {
    const objects = [
      obj({ id: 'd', type: 'direction', title: 'Go local-first', body: 'Because sync is hard.' }),
      obj({ id: 'dec', type: 'decision', title: 'Use Dexie' }),
      obj({ id: 'q', type: 'question', title: 'What about Codex?' }),
    ];
    const events = objects.map((o) => evt(o.id));
    const doc = render(objects, events);

    expect(doc).toContain('# Chatdex — Current Understanding');
    expect(doc).toContain('Shared understanding workspace');
    const sections = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toEqual(['Current Direction', 'Decisions', 'Open Questions', 'Recent Changes']);
    expect(doc).toContain('- **Go local-first**[^1]');
    expect(doc).toContain('  Because sync is hard.');
  });

  it('groups the open ontology by type with pluralized headings', () => {
    const objects = [
      obj({ id: 'a', type: 'decision' }),
      obj({ id: 'b', type: 'idea' }),
      obj({ id: 'c', type: 'hypothesis' }),
    ];
    const doc = render(objects, objects.map((o) => evt(o.id)));
    const sections = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(sections).toContain('Decisions');
    expect(sections).toContain('Ideas');
    // Naive pluralizer: unknown types still get a heading ('hypothesis' + es).
    expect(sections).toContain('Hypothesises');
  });

  it('dedupes footnotes by conversation across entries and lists them once', () => {
    const objects = [obj({ id: 'a' }), obj({ id: 'b' })];
    const events = [
      evt('a', { evidence: [{ conversationId: 'c1', note: 'the quote' }] }),
      evt('b', { evidence: [{ conversationId: 'c1' }, { conversationId: 'c2' }] }),
    ];
    const doc = render(objects, events);
    // Both objects cite c1 → same footnote number.
    expect(doc.match(/\[\^1\]:/g)).toHaveLength(1);
    expect(doc).toContain('[^1]: First conversation — “the quote”');
    expect(doc).toContain('[^2]: Second conversation');
  });

  it('marks deleted conversations in footnotes', () => {
    const o = obj({ id: 'a' });
    const doc = render([o], [evt('a', { evidence: [{ conversationId: 'gone' }] })]);
    expect(doc).toContain('[^1]: (deleted conversation)');
  });

  it('annotates pending objects and can exclude them', () => {
    const objects = [
      obj({ id: 'ok', title: 'Accepted idea' }),
      obj({ id: 'p', title: 'Pending idea', reviewState: 'pending' }),
    ];
    const events = objects.map((o) => evt(o.id));

    const withPending = render(objects, events);
    expect(withPending).toContain('- **Pending idea** *(pending review)*');

    const withoutPending = render(objects, events, { includePending: false });
    expect(withoutPending).not.toContain('Pending idea');
    expect(withoutPending).toContain('Accepted idea');
  });

  it('renders recent changes with ISO dates, supersession, and pending markers', () => {
    const objects = [
      obj({ id: 'old', type: 'direction', title: 'Old way', status: 'superseded' }),
      obj({ id: 'new', type: 'direction', title: 'New way' }),
    ];
    const events = [
      evt('old', { occurredAt: new Date('2026-07-01T00:00:00Z') }),
      evt('new', { occurredAt: new Date('2026-08-05T00:00:00Z') }),
      evt('old', {
        op: 'superseded',
        supersededByObjectId: 'new',
        detail: 'Direction changed',
        reviewState: 'pending',
        occurredAt: new Date('2026-08-07T00:00:00Z'),
      }),
    ];
    const doc = render(objects, events);
    expect(doc).toContain(
      '- 2026-08-07 — Superseded: Old way → New way — Direction changed *(pending)*'
    );
    // Superseded object stays out of the sections.
    expect(doc).not.toContain('- **Old way**');
  });

  it('is deterministic and only stamps a date when given one', () => {
    const objects = [obj({ id: 'a' })];
    const events = [evt('a')];
    expect(render(objects, events)).toBe(render(objects, events));
    expect(render(objects, events)).not.toContain('Generated');
    expect(render(objects, events, { generatedAt: new Date('2026-08-09T12:00:00Z') })).toContain(
      '*Generated 2026-08-09. '
    );
  });

  it('renders a placeholder for empty understanding', () => {
    const doc = render([], []);
    expect(doc).toContain('*No understanding synthesized for this project yet.*');
  });

  it('falls back to Unassigned for the null-project bucket', () => {
    const doc = renderLivingDocument(null, assembleCurrentUnderstanding([], [], names));
    expect(doc).toContain('# Unassigned — Current Understanding');
  });
});

describe('livingDocumentFilenamePrefix', () => {
  it('slugifies the project name', () => {
    expect(livingDocumentFilenamePrefix(project)).toBe('understanding-chatdex');
    expect(livingDocumentFilenamePrefix({ ...project, name: 'My Big Plan!' })).toBe(
      'understanding-my-big-plan'
    );
    expect(livingDocumentFilenamePrefix(null)).toBe('understanding-unassigned');
  });
});
