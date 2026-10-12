import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'hydra', environment: 'node' },
});
