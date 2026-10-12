/**
 * Throwaway credentials for the test server that Playwright starts (see playwright.config.ts).
 * They exist only for the duration of a test run and guard nothing real.
 */
export const TEST_ADMIN_PASSWORD = 'e2e-admin'; // ggignore
export const TEST_SESSION_SECRET = 'e2e-secret'; // ggignore
export const TEST_BACKROOM_WORD = 'speakeasy'; // ggignore
export const TEST_STATS_IGNORE_TOKEN = 'e2e-live-check'; // ggignore

let nextClient = 0;

/**
 * Gives a page its own admin-login rate-limit bucket (5 sign-ins a minute per client). The test
 * server is reached over loopback, so it keys the limit on `cf-connecting-ip`, as it does behind
 * the tunnel; each call picks a fresh documentation address (TEST-NET-3) per worker.
 */
export async function ownLoginLimit(page: {
  setExtraHTTPHeaders(h: Record<string, string>): Promise<void>;
}) {
  nextClient += 1;
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0);
  await page.setExtraHTTPHeaders({
    'cf-connecting-ip': `203.0.113.${((worker * 64 + nextClient) % 254) + 1}`,
  });
}
