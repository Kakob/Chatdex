import { describe, it, expect } from 'vitest';
import { buildCsv } from './csv';

describe('buildCsv', () => {
  it('produces header row followed by data rows', () => {
    const result = buildCsv(['A', 'B'], [['1', '2'], ['3', '4']]);
    const lines = result.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('quotes all cells', () => {
    const result = buildCsv(['Name'], [['Alice']]);
    expect(result).toContain('"Name"');
    expect(result).toContain('"Alice"');
  });

  it('escapes embedded double quotes', () => {
    const result = buildCsv(['Val'], [['He said "hello"']]);
    expect(result).toContain('"He said ""hello"""');
  });

  it('handles null and undefined cells as empty strings', () => {
    const result = buildCsv(['A', 'B'], [[null, undefined]]);
    const lines = result.split('\n');
    expect(lines[1]).toBe('"",""');
  });

  it('handles commas within cell content', () => {
    const result = buildCsv(['Val'], [['a,b,c']]);
    const lines = result.split('\n');
    expect(lines[1]).toBe('"a,b,c"');
  });

  it('handles empty rows array with only headers', () => {
    const result = buildCsv(['A', 'B'], []);
    expect(result.split('\n')).toHaveLength(1);
  });

  it('renders numeric values as strings', () => {
    const result = buildCsv(['N'], [[42]]);
    expect(result).toContain('"42"');
  });

  it('renders boolean values as strings', () => {
    const result = buildCsv(['B'], [[true]]);
    expect(result).toContain('"true"');
  });
});
