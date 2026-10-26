import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'mission-control', environment: 'node' },
});
