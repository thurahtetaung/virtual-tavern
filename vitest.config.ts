import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: ['e2e/**', '**/node_modules/**'],
    projects: ['apps/*', 'packages/*/vitest.config.ts', 'packages/games/*/vitest.config.ts'],
  },
});
