import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'echo', environment: 'node' },
});
