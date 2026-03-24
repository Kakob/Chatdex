import { describe, it, expect } from 'vitest';
import {
  createThread,
  createLivingThread,
  addItemToThread,
  removeItemFromThread,
  reorderThreadItems,
} from './threads';

describe('createThread', () => {
  it('generates UUID and sets isLiving to false', () => {
    const thread = createThread('My Thread');
    expect(thread.id).toBeDefined();
    expect(thread.name).toBe('My Thread');
    expect(thread.isLiving).toBe(false);
    expect(thread.itemIds).toEqual([]);
  });
});

describe('createLivingThread', () => {
  it('sets isLiving to true and stores criteria', () => {
    const criteria = { tags: ['react'] };
    const thread = createLivingThread('React Notes', criteria);
    expect(thread.isLiving).toBe(true);
    expect(thread.livingCriteria).toEqual(criteria);
  });
});

describe('addItemToThread', () => {
  it('appends item_id to ordered list', () => {
    const thread = createThread('Test');
    const updated = addItemToThread(thread, 'item-1');
    expect(updated.itemIds).toEqual(['item-1']);
  });

  it('does not duplicate existing item', () => {
    let thread = createThread('Test');
    thread = addItemToThread(thread, 'item-1');
    thread = addItemToThread(thread, 'item-1');
    expect(thread.itemIds).toEqual(['item-1']);
  });
});

describe('removeItemFromThread', () => {
  it('removes item_id and preserves order', () => {
    let thread = createThread('Test');
    thread = addItemToThread(thread, 'a');
    thread = addItemToThread(thread, 'b');
    thread = addItemToThread(thread, 'c');
    thread = removeItemFromThread(thread, 'b');
    expect(thread.itemIds).toEqual(['a', 'c']);
  });
});

describe('reorderThreadItems', () => {
  it('accepts valid new order', () => {
    let thread = createThread('Test');
    thread = addItemToThread(thread, 'a');
    thread = addItemToThread(thread, 'b');
    thread = addItemToThread(thread, 'c');
    const reordered = reorderThreadItems(thread, ['c', 'a', 'b']);
    expect(reordered.itemIds).toEqual(['c', 'a', 'b']);
  });

  it('rejects order with missing items', () => {
    let thread = createThread('Test');
    thread = addItemToThread(thread, 'a');
    thread = addItemToThread(thread, 'b');
    expect(() => reorderThreadItems(thread, ['a'])).toThrow();
  });

  it('rejects order with extra items', () => {
    let thread = createThread('Test');
    thread = addItemToThread(thread, 'a');
    expect(() => reorderThreadItems(thread, ['a', 'b'])).toThrow();
  });
});
