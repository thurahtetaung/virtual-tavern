import { type APIRequestContext, expect, request, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_STATS_IGNORE_TOKEN } from './credentials.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** A request context with no test header, signed in as admin under its own login limit. */
async function admin(baseURL: string, client: string): Promise<APIRequestContext> {
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { 'cf-connecting-ip': client },
  });
  const login = await api.post('/api/admin/login', { data: { password: TEST_ADMIN_PASSWORD } });
  expect(login.ok()).toBe(true);
  return api;
}

/** How many raw stats events the room has, from a dry run of the admin delete. */
async function roomEvents(api: APIRequestContext, roomId: string): Promise<number> {
  const res = await api.delete(`/api/admin/stats/rooms/${roomId}?dryRun=1`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { deleted: { stats_events: number } }).deleted.stats_events;
}

// A plain request opens the room (recorded); a browser then joins it over Socket.IO. Only a
// browser sending `x-vt-test` (Playwright's extraHTTPHeaders) turns the room into a test room,
// which proves the header reaches the socket handshake.
for (const [title, headers, client] of [
  ['a browser sending the test header joins without being recorded', true, '198.51.100.11'],
  ['a browser without the test header is recorded as usual', false, '198.51.100.12'],
] as const) {
  test(title, async ({ browser, baseURL }) => {
    const api = await admin(baseURL!, client);
    const created = await api.post('/api/rooms', {
      data: {
        gameId: 'codenames',
        token: `e2e-creator-${client.replaceAll('.', '-')}-${'0'.repeat(24)}`,
      },
    });
    expect(created.ok()).toBe(true);
    const { roomId } = (await created.json()) as { roomId: string };
    expect(await roomEvents(api, roomId)).toBe(1);

    const context = await browser.newContext(
      headers ? { extraHTTPHeaders: { 'x-vt-test': TEST_STATS_IGNORE_TOKEN } } : {},
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript(() => localStorage.setItem('vt.playerName', 'Probe'));
    await page.goto(`/r/${roomId}`);
    await expect(page.getByText('Probe').first()).toBeVisible();

    if (headers) {
      // The join is committed before it is broadcast, so nothing more can arrive later.
      expect(await roomEvents(api, roomId)).toBe(1);
    } else {
      await expect.poll(() => roomEvents(api, roomId)).toBeGreaterThan(1);
    }
    await context.close();
    await api.dispose();
  });
}
