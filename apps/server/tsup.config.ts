import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24',
  clean: true,
  // Workspace packages ship TypeScript source, so they are bundled in; npm deps stay external.
  noExternal: [/^@vt\//],
});
