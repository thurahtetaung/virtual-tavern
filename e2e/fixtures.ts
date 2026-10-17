import { createHash } from 'node:crypto';
import { type Browser, type BrowserContextOptions, test as base } from '@playwright/test';

/** Sent with a room's creation: the server (run with `VT_TEST_SEED`) seeds that room with it. */
const TEST_SEED_HEADER = 'x-vt-test-seed';

/** The running test's seed; a worker runs one test at a time. */
let current: string | null = null;
const patched = new WeakSet<Browser>();

const withSeed = (options: BrowserContextOptions = {}): BrowserContextOptions =>
  current
    ? { ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, [TEST_SEED_HEADER]: current } }
    : options;

/**
 * Every spec's `test`. Each test gets a seed from its file and title, and every browser it opens
 * (the default page and `browser.newContext()` alike) sends it, so each room the test creates
 * deals, shuffles and colours the same way on every run, whatever runs beside it.
 */
export const test = base.extend<{ testSeed: string }>({
  testSeed: [
    async ({ browser }, use, info) => {
      current = createHash('sha256').update(info.titlePath.join(' › ')).digest('hex').slice(0, 16);
      if (!patched.has(browser)) {
        patched.add(browser);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = (options) => newContext(withSeed(options));
      }
      await use(current);
      current = null;
    },
    { auto: true },
  ],
  extraHTTPHeaders: async ({ extraHTTPHeaders, testSeed }, use) => {
    await use({ ...extraHTTPHeaders, [TEST_SEED_HEADER]: testSeed });
  },
});
