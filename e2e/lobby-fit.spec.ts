import { randomBytes } from 'node:crypto';
import { type Browser, type Page, expect } from '@playwright/test';
import { GAME_IDS } from '../playwright.config.ts';
import { TEST_BACKROOM_WORD } from './credentials.ts';
import { test } from './fixtures.ts';
import { openBackroom } from './tavern-brawl-play.ts';

// Every game's lobby as a first-time host sees it on a phone: the "New here?" intro not yet put
// away (the rest of the suite marks it seen), one guest in. It fits one screen with Start on it.
// The back room's games need its password, so this runs in the `back-room` project.

const PHONE = { width: 390, height: 844 };
const pageErrors: string[] = [];
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  pageErrors.length = 0;
});

test.beforeAll(async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await openBackroom(admin);
  await admin.context().close();
});

let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const token = randomBytes(16).toString('hex');
  const context = await browser.newContext({
    // Not the suite's storage, which marks every intro seen: every game is new to this browser.
    storageState: { cookies: [], origins: [] },
    viewport: PHONE,
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.53.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.addInitScript(
    ([n, t]) => {
      localStorage.setItem('vt.playerName', n!);
      localStorage.setItem('vt.playerToken', t!);
    },
    [name, token],
  );
  await page.goto('/backroom');
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
  await expect(page.getByLabel('The word')).toHaveCount(0);
  return { page, token };
}

const size = (page: Page) =>
  page.evaluate(() => ({
    h: document.scrollingElement!.scrollHeight,
    w: document.scrollingElement!.scrollWidth,
  }));

for (const id of GAME_IDS)
  test(`${id}: a first-time host's lobby fits a phone`, async ({ browser }) => {
    const { page: host, token } = await visitor(browser, 'Hana');
    const res = await host.context().request.post('/api/rooms', { data: { gameId: id, token } });
    expect(res.status()).toBe(200);
    const { roomId } = (await res.json()) as { roomId: string };
    await host.goto(`/r/${roomId}`);
    const { page: guest } = await visitor(browser, 'Gil');
    await guest.goto(`/r/${roomId}`);
    await expect(guest.getByRole('button', { name: /^Players/ })).toBeVisible();

    // The intro sits in the header, in the Rules button's place.
    const intro = host.getByRole('button', { name: 'New here? The game in 30 seconds' });
    await expect(intro).toBeVisible();
    await expect(host.getByRole('button', { name: 'Rules', exact: true })).toHaveCount(0);
    await expect(host.getByRole('button', { name: /^Players \(2 online\)/ })).toBeVisible();
    await expect.poll(async () => (await size(host)).h).toBeLessThanOrEqual(PHONE.height);
    const { h, w } = await size(host);
    expect(w).toBeLessThanOrEqual(PHONE.width);
    test.info().annotations.push({ type: 'height', description: `${id} ${h}x${w}` });
    const start = host
      .getByRole('button', { name: /start|deal|begin|need \d/i })
      .filter({ visible: true })
      .first();
    const box = await start.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(PHONE.height);
    if (process.env.SCREENSHOTS)
      await host.screenshot({ path: test.info().outputPath('lobby.png') });

    // Put away, it is the plain Rules button again, and stays so.
    await intro.click();
    const sheet = host.getByRole('dialog');
    await expect(sheet.getByTestId('guide-stepper')).toBeVisible();
    if (process.env.SCREENSHOTS)
      await host.screenshot({ path: test.info().outputPath('sheet.png') });
    await sheet.getByRole('button', { name: 'Skip' }).click();
    await expect(host.getByRole('button', { name: 'Rules', exact: true })).toBeVisible();
    await expect(intro).toHaveCount(0);
    await host.context().close();
    await guest.context().close();
  });
