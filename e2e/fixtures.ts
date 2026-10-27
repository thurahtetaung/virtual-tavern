import { createHash } from 'node:crypto';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
} from '@playwright/test';

/** Sent with a room's creation: the server (run with `VT_TEST_SEED`) seeds that room with it. */
const TEST_SEED_HEADER = 'x-vt-test-seed';

/** The running test's seed; a worker runs one test at a time. */
let current: string | null = null;
/** The contexts the running test opened with `browser.newContext()`. */
const opened = new Set<BrowserContext>();
const patched = new WeakSet<Browser>();

const withSeed = (options: BrowserContextOptions = {}): BrowserContextOptions =>
  current
    ? { ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, [TEST_SEED_HEADER]: current } }
    : options;

/**
 * Every spec's `test`. Each test gets a seed from its file and title, and every browser it opens
 * (the default page and `browser.newContext()` alike) sends it, so each room the test creates
 * deals, shuffles and colours the same way on every run, whatever runs beside it.
 *
 * Playwright closes a context a test opened itself only when the worker ends, so each test's
 * contexts are closed when it ends: a serial worker running spec after spec otherwise keeps every
 * earlier game's players connected, and each test runs slower than the last.
 */
export const test = base.extend<{ testSeed: string }>({
  testSeed: [
    async ({ browser }, use, info) => {
      current = createHash('sha256').update(info.titlePath.join(' › ')).digest('hex').slice(0, 16);
      if (!patched.has(browser)) {
        patched.add(browser);
        const newContext = browser.newContext.bind(browser);
        browser.newContext = async (options) => {
          const context = await newContext(withSeed(options));
          if (current) opened.add(context);
          return context;
        };
      }
      await use(current);
      current = null;
      const contexts = [...opened];
      opened.clear();
      await Promise.all(contexts.map((context) => context.close()));
    },
    { auto: true },
  ],
  extraHTTPHeaders: async ({ extraHTTPHeaders, testSeed }, use) => {
    await use({ ...extraHTTPHeaders, [TEST_SEED_HEADER]: testSeed });
  },
});
