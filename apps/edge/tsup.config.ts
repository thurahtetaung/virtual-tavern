import { defineConfig } from 'tsup';

// One self-contained ES module, ready to upload as a Worker script.
export default defineConfig({
  entry: ['src/worker.ts'],
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  clean: true,
  noExternal: [/.*/],
});
