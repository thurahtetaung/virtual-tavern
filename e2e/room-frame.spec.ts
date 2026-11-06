import { type Browser, type Locator, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';

// The room frame on a phone: a Spymaster giving a clue sees the header, the status line, the board
// and the clue form in the sticky bar above the tab bar, all on one 390 × 844 screen with no
// scroll, and a refusal grows the bar rather than covering the clue box.

const PHONE = { width: 390, height: 844 };
const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url: string, phone = false) {
  const context = await browser.newContext(
    phone ? { viewport: PHONE, isMobile: true, hasTouch: true } : {},
  );
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const box = async (l: Locator) => {
  const b = await l.boundingBox();
  expect(b, 'on screen').not.toBeNull();
  return b!;
};
type Box = Awaited<ReturnType<typeof box>>;
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

const page = (p: Page) =>
  p.evaluate(() => {
    const el = document.scrollingElement!;
    return { scroll: el.scrollHeight, client: el.clientHeight, width: el.scrollWidth };
  });

test('a Spymaster on a phone gives a clue on one screen, and a refusal covers nothing', async ({
  browser,
}) => {
  const host = await player(browser, 'Hana', '/', true);
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  // Both Spymasters are on phones, so whichever team starts, its Spymaster is one.
  const ben = await player(browser, 'Ben', url, true);
  const [ana, cy] = await Promise.all(['Ana', 'Cy'].map((n) => player(browser, n, url)));

  const seat = async (p: Page, team: 'Red' | 'Blue', role: 'Spymaster' | 'Operative') => {
    const panel = p.getByRole('region', { name: `${team} team` });
    await panel
      .getByRole('button', {
        name: role === 'Spymaster' ? 'Be the Spymaster' : `Join ${team} as Operative`,
      })
      .click();
  };
  await seat(host, 'Red', 'Spymaster');
  await seat(ana!, 'Red', 'Operative');
  await seat(ben, 'Blue', 'Spymaster');
  await seat(cy!, 'Blue', 'Operative');
  await host.getByRole('button', { name: 'Start game' }).click();

  const clueBox = (p: Page) => p.getByPlaceholder('e.g. Ocean');
  await expect
    .poll(async () => (await clueBox(host).count()) + (await clueBox(ben).count()))
    .toBe(1);
  const spy = (await clueBox(host).count()) > 0 ? host : ben;

  // The room's frame: its own header (the site's is hidden), the status line for your move.
  await expect(spy.getByRole('link', { name: 'Virtual Tavern' })).toBeHidden();
  await expect(spy.locator('[data-ui="status"][data-me]')).toBeVisible();
  const tabBar = spy.getByRole('tablist', { name: 'Codenames' });
  await expect(tabBar).toBeVisible();
  const bar = spy.locator('[data-ui="sticky-bar"]');
  await expect(bar).toBeVisible();

  // A clue the game refuses: a word on the board.
  const first = (await spy
    .getByRole('region', { name: 'Word cards' })
    .getByRole('button')
    .first()
    .getAttribute('aria-label'))!.split(',')[0]!;
  await clueBox(spy).fill(first);
  await spy.getByRole('button', { name: '1', exact: true }).click();
  await spy.getByRole('button', { name: 'Give clue' }).click();
  const refusal = bar.getByRole('alert');
  await expect(refusal).toBeVisible();

  // The whole screen fits, with the refusal showing, and nothing covers anything.
  await expect.poll(async () => (await page(spy)).scroll).toBe(PHONE.height);
  const { scroll, client, width } = await page(spy);
  expect(scroll).toBe(client);
  expect(width).toBeLessThanOrEqual(PHONE.width);
  const [input, refused, sticky, tabs, board] = await Promise.all([
    box(clueBox(spy)),
    box(refusal),
    box(bar),
    box(tabBar),
    box(spy.getByRole('region', { name: 'Word cards' })),
  ]);
  test.info().annotations.push({
    type: 'fit',
    description: `page ${scroll}/${client}; board bottom ${Math.round(board.y + board.height)}, bar ${Math.round(sticky.y)}–${Math.round(sticky.y + sticky.height)}, tab bar top ${Math.round(tabs.y)}`,
  });
  expect(overlaps(input, refused)).toBe(false);
  expect(input.y + input.height).toBeLessThanOrEqual(sticky.y + sticky.height);
  expect(input.y).toBeGreaterThanOrEqual(sticky.y);
  // The bar sits on the tab bar and under the board, never over it.
  expect(sticky.y + sticky.height).toBeLessThanOrEqual(tabs.y + 1);
  expect(board.y + board.height).toBeLessThanOrEqual(sticky.y);
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(PHONE.height + 1);

  // The refusal is the game's own wording, and the clue box still takes a new word.
  await expect(refusal).toContainText('word on the board');
  await clueBox(spy).fill('Tavern');
  await expect(clueBox(spy)).toHaveValue('Tavern');
});
