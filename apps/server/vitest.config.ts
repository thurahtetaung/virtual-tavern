import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // Real servers, sockets and scrypt logins: most tests take a few hundred ms alone, and a busy
    // machine (the whole suite in parallel) pushed some past the default 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
