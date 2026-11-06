import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
} from '@playwright/test';
import { SERVER_ENV, introsSeen } from '../playwright.config.ts';

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
 * Every spec's `test`. Each worker starts its own server (the production build, with
 * `SERVER_ENV` and an in-memory database) on a free port, and its tests' browsers and requests
 * use it as `baseURL`: no two workers share server state, so specs that change it (the back-room
 * password, question decks, content packs) run in parallel like the rest. A worker's specs still
 * share its server one after another, so a spec deletes what it creates.
 *
 * Each test gets a seed from its file and title, and every browser it opens
 * (the default page and `browser.newContext()` alike) sends it, so each room the test creates
 * deals, shuffles and colours the same way on every run, whatever runs beside it.
 *
 * Playwright closes a context a test opened itself only when the worker ends, so each test's
 * contexts are closed when it ends: a serial worker running spec after spec otherwise keeps every
 * earlier game's players connected, and each test runs slower than the last.
 */
export const test = base.extend<{ testSeed: string }, { serverURL: string }>({
  serverURL: [
    // Playwright reads a fixture's dependencies from its first parameter, so it must be a pattern.
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const port = await freePort();
      const server = spawn('node', ['apps/server/dist/index.js'], {
        stdio: ['ignore', 'ignore', 'inherit'],
        env: { ...process.env, ...SERVER_ENV, PORT: String(port) },
      });
      const stop = () => server.kill('SIGKILL');
      process.once('exit', stop);
      const url = `http://127.0.0.1:${port}`;
      await healthy(server, url);
      await use(url);
      process.off('exit', stop);
      await stopServer(server);
    },
    { scope: 'worker', timeout: 60_000 },
  ],
  baseURL: async ({ serverURL }, use) => {
    await use(serverURL);
  },
  storageState: async ({ serverURL }, use) => {
    await use(introsSeen(serverURL));
  },
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

/** A port nothing listens on, for this worker's server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === 'object') resolve(address.port);
        else reject(new Error('no port'));
      });
    });
  });
}

async function healthy(server: ChildProcess, url: string): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`the test server exited (${server.exitCode})`);
    const ok = await fetch(`${url}/healthz`).then(
      (r) => r.ok,
      () => false,
    );
    if (ok) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`the test server at ${url} never became healthy`);
}

async function stopServer(server: ChildProcess): Promise<void> {
  if (server.exitCode !== null || server.signalCode !== null) return;
  const exited = new Promise((resolve) => server.once('exit', resolve));
  server.kill('SIGTERM');
  await exited;
}
