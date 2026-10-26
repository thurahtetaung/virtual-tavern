import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'encore', environment: 'node' },
});
