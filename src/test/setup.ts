import '@testing-library/jest-dom/vitest';

// Mock DOM APIs used by exporters
global.URL.createObjectURL = vi.fn(() => 'blob:mock');
global.URL.revokeObjectURL = vi.fn();
