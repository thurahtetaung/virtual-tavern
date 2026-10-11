import { defineProject } from 'vitest/config';

export default defineProject({
  test: { name: 'masquerade-originals', environment: 'node' },
});
