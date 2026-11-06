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

/**
 * The phone frame's checks for one screen: the page doesn't scroll or run sideways, the sticky bar
 * (when there is one) sits on the tab bar, clear of `field`, and the tab bar ends on the screen.
 * Notes the measures on the test, for the fit report.
 */
async function fitsOneScreen(p: Page, game: string, field?: Locator) {
  await expect.poll(async () => (await page(p)).scroll).toBe(PHONE.height);
  const { scroll, client, width } = await page(p);
  expect(scroll).toBe(client);
  expect(width).toBeLessThanOrEqual(PHONE.width);
  const tabs = await box(p.getByRole('tablist', { name: game }));
  expect(tabs.y + tabs.height).toBeLessThanOrEqual(PHONE.height + 1);
  const bars = p.locator('[data-ui="sticky-bar"]');
  let note = `page ${scroll}/${client}, tab bar top ${Math.round(tabs.y)}`;
  if ((await bars.count()) > 0) {
    const sticky = await box(bars.first());
    expect(sticky.y + sticky.height).toBeLessThanOrEqual(tabs.y + 1);
    note += `, bar ${Math.round(sticky.y)}–${Math.round(sticky.y + sticky.height)}`;
    if (field) {
      const input = await box(field);
      expect(overlaps(input, sticky)).toBe(false);
      note += `, field bottom ${Math.round(input.y + input.height)}`;
    }
  }
  test.info().annotations.push({ type: 'fit', description: `${game}: ${note}` });
}

/** A phone room with these players, the first one its host; returns their pages. */
async function phoneRoom(browser: Browser, game: string, names: string[]) {
  const host = await player(browser, names[0]!, '/', true);
  await host.getByRole('button', { name: `Create ${game} room` }).click();
  await expect(host).toHaveURL(/\/r\//);
  const others: Page[] = [];
  // One at a time, so seat order follows the names.
  for (const n of names.slice(1)) {
    others.push(await player(browser, n, host.url(), true));
    await expect(host.getByText(n, { exact: true }).first()).toBeVisible();
  }
  return [host, ...others];
}

/** Of `pages`, the one for which `has` turns true first. */
async function whichOf(pages: Page[], has: (p: Page) => Promise<boolean>) {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of pages) if (await has(p)) found = p;
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

test('an Enigma Encryptor writes three clues on one phone screen', async ({ browser }) => {
  const pages = await phoneRoom(browser, 'an Enigma', ['Hana', 'Ana', 'Ben', 'Cy']);
  const [host] = pages as [Page];
  await host
    .getByRole('region', { name: 'Red team' })
    .getByRole('button', { name: 'Join Red' })
    .click();
  for (const [p, team] of [
    [pages[1]!, 'Red'],
    [pages[2]!, 'Blue'],
    [pages[3]!, 'Blue'],
  ] as const)
    await p
      .getByRole('region', { name: `${team} team` })
      .getByRole('button', { name: `Join ${team}` })
      .click();
  await host.getByRole('button', { name: 'Start game' }).click();
  const encryptor = await whichOf(pages, (p) =>
    p.getByPlaceholder('A hint only your team will get').first().isVisible(),
  );
  // One clue the game turns down (a keyword itself), so the field shows its problem.
  await encryptor.getByRole('button', { name: '👁️ Show your code' }).click();
  const inputs = encryptor.getByPlaceholder('A hint only your team will get');
  const keyword = (
    await encryptor.locator('label b.uppercase, label span.uppercase').first().innerText()
  ).trim();
  await inputs.nth(0).fill(keyword);
  await inputs.nth(1).fill('blorft');
  await inputs.nth(2).fill('quimble');
  await expect(encryptor.getByRole('alert').first()).toBeVisible();
  await fitsOneScreen(encryptor, 'Enigma', inputs.nth(2));
});

test('an Echo guesser guesses on one phone screen', async ({ browser }) => {
  const pages = await phoneRoom(browser, 'an Echo', ['Hana', 'Ana', 'Ben', 'Cy']);
  const [host, ...writers] = pages as [Page, ...Page[]];
  await host.getByRole('button', { name: 'Start game' }).click();
  await host.getByRole('button', { name: 'Pick word 1' }).click();
  for (const [i, w] of writers.entries()) {
    await w.getByLabel('Your clue').fill(['Zzyzx', 'Qwvx', 'Pjmq'][i]!);
    await w.getByRole('button', { name: 'Send clue' }).click();
  }
  const guess = host.getByLabel('Your guess');
  await expect(guess).toBeVisible();
  await guess.fill('a guess');
  await fitsOneScreen(host, 'Echo', guess);
});

test('a Masquerade player reads their card on one phone screen', async ({ browser }) => {
  const pages = await phoneRoom(browser, 'a Masquerade', ['Hana', 'Ana', 'Ben', 'Cy']);
  await pages[0]!.getByRole('button', { name: 'Start game' }).click();
  const p = pages[1]!;
  await p.getByRole('button', { name: 'Show your card' }).click();
  await expect(p.getByTestId('card-title')).toBeVisible();
  await fitsOneScreen(p, 'Masquerade');
});

test('a Round Table leader picks a team at a full table on one phone screen', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const names = ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Ivy', 'Jo'];
  const host = await player(browser, names[0]!, '/', true);
  await host.getByRole('button', { name: 'Create a Round Table room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const others = await Promise.all(names.slice(1).map((n) => player(browser, n, host.url(), true)));
  const pages = [host, ...others];
  await expect(host.getByText('Players (10/10)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const p of pages) await p.getByRole('button', { name: 'I’ve seen my role' }).click();
  const lead = await whichOf(pages, (p) => p.getByText(/^You lead!/).isVisible());
  // One seat picked, so the team line and Announce are both in the bar.
  await lead
    .getByRole('button', { name: /^Pick .* for the team$/ })
    .first()
    .click();
  await expect(lead.getByRole('button', { name: /^Tap \d more$/ })).toBeVisible();
  await fitsOneScreen(lead, 'Round Table');
});
