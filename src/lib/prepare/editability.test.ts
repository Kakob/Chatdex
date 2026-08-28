// SPEC-change-workspace §7.1 editability table.
import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SECTIONS,
  assertEditability,
  canAppend,
  canEdit,
  editabilityOf,
  sectionEditability,
} from './editability';
import type { PreparedChangeState } from '../../types/preparedChange';

const STATES: PreparedChangeState[] = [
  'draft',
  'ready',
  'implementing',
  'verified',
  'closed',
  'superseded',
];

describe('section editability', () => {
  it('covers every state × section with a defined value', () => {
    for (const state of STATES) {
      const table = sectionEditability({ state });
      for (const section of WORKSPACE_SECTIONS) {
        expect(table[section]).toBeDefined();
      }
    }
  });

  it('freezes intent and criteria at ready and never reopens them', () => {
    expect(canEdit({ state: 'draft' }, 'intent')).toBe(true);
    expect(canEdit({ state: 'draft' }, 'criteria')).toBe(true);
    for (const state of STATES.filter((s) => s !== 'draft')) {
      expect(editabilityOf({ state }, 'intent')).toBe('frozen');
      expect(editabilityOf({ state }, 'criteria')).toBe('frozen');
    }
  });

  it('keeps evidence, trace, questions, and hypotheses appendable until closed', () => {
    for (const state of ['draft', 'ready', 'implementing', 'verified'] as const) {
      for (const section of ['evidence', 'trace', 'questions', 'hypotheses'] as const) {
        expect(canAppend({ state }, section)).toBe(true);
      }
    }
    for (const section of ['evidence', 'trace', 'questions', 'hypotheses'] as const) {
      expect(editabilityOf({ state: 'closed' }, section)).toBe('frozen');
      expect(editabilityOf({ state: 'superseded' }, section)).toBe('frozen');
    }
  });

  it('opens verification and learned only from implementing, promotions only from verified', () => {
    expect(editabilityOf({ state: 'ready' }, 'verification')).toBe('unavailable');
    expect(editabilityOf({ state: 'ready' }, 'learned')).toBe('unavailable');
    expect(editabilityOf({ state: 'implementing' }, 'verification')).toBe('editable');
    expect(editabilityOf({ state: 'implementing' }, 'learned')).toBe('editable');
    expect(editabilityOf({ state: 'implementing' }, 'promotions')).toBe('unavailable');
    expect(editabilityOf({ state: 'verified' }, 'promotions')).toBe('appendable');
    expect(editabilityOf({ state: 'closed' }, 'promotions')).toBe('appendable');
  });

  it('lets an implementation be attached from draft/ready and replaced while implementing', () => {
    expect(editabilityOf({ state: 'draft' }, 'implementation')).toBe('attachable');
    expect(editabilityOf({ state: 'ready' }, 'implementation')).toBe('attachable');
    expect(editabilityOf({ state: 'implementing' }, 'implementation')).toBe('replaceable');
    expect(editabilityOf({ state: 'verified' }, 'implementation')).toBe('frozen');
  });

  it('assertEditability names the section and state in its error', () => {
    expect(() => assertEditability({ state: 'ready' }, 'intent', ['editable'])).toThrow(
      /"intent" is frozen while the workspace is ready/
    );
    expect(() => assertEditability({ state: 'draft' }, 'intent', ['editable'])).not.toThrow();
  });
});
