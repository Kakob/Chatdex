import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Standalone config: this example's suite is not part of the root `npm test`
// and must not inherit the root config's jsdom environment or setup files.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    globals: false,
    setupFiles: [],
  },
});
