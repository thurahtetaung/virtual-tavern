import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'stampede', environment: 'node' },
});
