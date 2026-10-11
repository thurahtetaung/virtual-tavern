import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'nightfall', environment: 'node' },
});
