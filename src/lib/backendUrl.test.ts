import { describe, expect, it } from 'vitest';
import { resolveBackendUrl } from './backendUrl';

describe('backend routing across devices', () => {
  it.each([undefined, '/api', 'http://localhost:3003/api', 'https://api.example.com/api'])(
    'uses the same-origin dev proxy even with %s configured', (configured) => {
      expect(resolveBackendUrl(configured, true)).toBe('');
    },
  );

  it.each([
    [undefined, ''], ['/api', ''], ['/api/', ''],
    ['https://api.example.com/api/', 'https://api.example.com'],
    ['https://api.example.com/', 'https://api.example.com'],
    ['/service/api/', '/service'],
  ])('normalizes production API base %s', (configured, expected) => {
    expect(resolveBackendUrl(configured, false)).toBe(expected);
  });
});
