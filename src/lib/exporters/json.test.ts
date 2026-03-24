import { describe, it, expect } from 'vitest';
import { buildJson } from './json';

describe('buildJson', () => {
  it('without meta, returns raw JSON that round-trips', () => {
    const data = { foo: 'bar', n: 42 };
    const result = buildJson(data);
    expect(JSON.parse(result)).toEqual(data);
  });

  it('with meta, wraps in { meta, data } envelope', () => {
    const data = [1, 2, 3];
    const result = JSON.parse(buildJson(data, { source: 'test' }));
    expect(result).toHaveProperty('meta');
    expect(result).toHaveProperty('data');
    expect(result.data).toEqual([1, 2, 3]);
  });

  it('meta includes exportedAt field', () => {
    const result = JSON.parse(buildJson({}, { source: 'test' }));
    expect(result.meta.exportedAt).toBeDefined();
  });

  it('meta uses provided exportedAt', () => {
    const result = JSON.parse(
      buildJson({}, { exportedAt: '2026-01-01', source: 'test' })
    );
    expect(result.meta.exportedAt).toBe('2026-01-01');
  });

  it('output is pretty-printed with 2-space indent', () => {
    const result = buildJson({ a: 1 });
    expect(result).toContain('  "a"');
  });

  it('handles nested objects', () => {
    const data = { a: { b: { c: [1, 2] } } };
    const result = JSON.parse(buildJson(data));
    expect(result.a.b.c).toEqual([1, 2]);
  });

  it('handles null as data', () => {
    const result = JSON.parse(buildJson(null));
    expect(result).toBeNull();
  });
});
