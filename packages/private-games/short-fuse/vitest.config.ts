import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'short-fuse', environment: 'node' },
});
