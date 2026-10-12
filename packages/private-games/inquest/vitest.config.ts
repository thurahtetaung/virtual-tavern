import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'inquest', environment: 'node' },
});
