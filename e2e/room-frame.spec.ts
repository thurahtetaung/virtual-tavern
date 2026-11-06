import { type Browser, type Locator, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { playEscape } from './recap-play.ts';

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

test('a Spymaster on a 1440 × 900 desktop sees the clue form and its refusal without scrolling', async ({
  browser,
}) => {
  const desk = async (name: string, url: string) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
    });
    const p = await context.newPage();
    p.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
    await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await p.goto(url);
    return p;
  };
  const host = await desk('Hana', '/');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const [ana, ben, cy] = await Promise.all(['Ana', 'Ben', 'Cy'].map((n) => desk(n, url)));
  const seat = async (p: Page, team: 'Red' | 'Blue', spymaster: boolean) =>
    p
      .getByRole('region', { name: `${team} team` })
      .getByRole('button', {
        name: spymaster ? 'Be the Spymaster' : `Join ${team} as Operative`,
      })
      .click();
  await seat(host, 'Red', true);
  await seat(ana!, 'Red', false);
  await seat(ben!, 'Blue', true);
  await seat(cy!, 'Blue', false);
  await host.getByRole('button', { name: 'Start game' }).click();
  const clueBox = (p: Page) => p.getByPlaceholder('e.g. Ocean');
  await expect
    .poll(async () => (await clueBox(host).count()) + (await clueBox(ben!).count()))
    .toBe(1);
  const spy = (await clueBox(host).count()) > 0 ? host : ben!;
  const first = (await spy
    .getByRole('region', { name: 'Word cards' })
    .getByRole('button')
    .first()
    .getAttribute('aria-label'))!.split(',')[0]!;
  await clueBox(spy).fill(first);
  await spy.getByRole('button', { name: '1', exact: true }).click();
  await spy.getByRole('button', { name: 'Give clue' }).click();
  const refusal = spy.getByRole('alert').filter({ hasText: 'word on the board' });
  await expect(refusal).toBeVisible();
  await expect(refusal).toBeInViewport({ ratio: 1 });
  await expect(clueBox(spy)).toBeInViewport({ ratio: 1 });
  const { scroll, client } = await page(spy);
  test
    .info()
    .annotations.push({ type: 'fit', description: `Codenames desktop: page ${scroll}/${client}` });
  expect(scroll).toBe(client);
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
  // Echo has no tab bar: the players and the cards played lie below, so the page may scroll, but
  // the clues, the guess box and the bar holding Guess and Pass all fit the first screen.
  const bar = await box(host.locator('[data-ui="sticky-bar"]'));
  const field = await box(guess);
  const clues = await box(host.getByRole('list', { name: 'Your clues' }));
  test.info().annotations.push({
    type: 'fit',
    description: `Echo: clues top ${Math.round(clues.y)}, field bottom ${Math.round(field.y + field.height)}, bar ${Math.round(bar.y)}–${Math.round(bar.y + bar.height)}`,
  });
  expect(field.y + field.height).toBeLessThanOrEqual(bar.y);
  expect(clues.y).toBeGreaterThanOrEqual(0);
  expect(bar.y + bar.height).toBeLessThanOrEqual(PHONE.height + 1);
  expect((await page(host)).width).toBeLessThanOrEqual(PHONE.width);
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

// A long back-room title with all four header buttons (Night shows after a finished game) on a
// phone: the name never breaks inside a word, and the header stays one row.
test('a long game name never breaks inside a word in a full phone header', async ({ browser }) => {
  test.setTimeout(120_000);
  const TITLE = 'Phantasmagorical Midsummer Masquerade Extravaganza';
  const visitor = async (name: string) => {
    const context = await browser.newContext();
    const p = await context.newPage();
    p.on('pageerror', (e) => pageErrors.push(`${name}: ${e.message}`));
    p.on('dialog', (d) => void d.accept());
    await ownLoginLimit(p);
    await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    return p;
  };
  const unlock = async (p: Page, url = '/backroom') => {
    await p.goto(url);
    await p.getByLabel('The word').fill(TEST_BACKROOM_WORD);
    await p.getByRole('button', { name: 'Knock' }).click();
  };
  const admin = await visitor('Admin');
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
  const setTitle = (title: string | null) =>
    admin.request.put('/api/admin/games/masquerade-originals', { data: { title } });
  expect((await setTitle(TITLE)).ok()).toBe(true);
  try {
    const host = await visitor('Hana');
    await unlock(host);
    await host.getByRole('button', { name: `Create a ${TITLE} room` }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(
      ['Ana', 'Ben'].map(async (n) => {
        const p = await visitor(n);
        await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
        await expect(p).toHaveURL(url);
        return p;
      }),
    );
    const players = [host, ...others];
    const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
    await host.getByLabel('Rounds').selectOption('1');
    await host.getByRole('button', { name: 'Start game' }).click();
    await playEscape(players, names);

    await host.setViewportSize(PHONE);
    const header = host.locator('[data-ui="room-header"]');
    await expect(header.getByRole('button', { name: /^Night recap/ })).toBeVisible();
    await expect(header.getByRole('button')).toHaveCount(4);
    await expect(header.getByRole('heading', { level: 1 })).toHaveAccessibleName(TITLE);

    // Each line of the name starts after a space, or the name is cut with an ellipsis on one line.
    const fit = () =>
      header.locator('h1 > span:not([aria-hidden])').evaluate((el) => {
        const text = el.firstChild!;
        const range = document.createRange();
        const breaks: number[] = [];
        let top: number | null = null;
        for (let i = 0; i < text.textContent!.length; i++) {
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const rect = [...range.getClientRects()].find((r) => r.width > 0);
          if (!rect) continue;
          if (top !== null && rect.top > top + 2) breaks.push(i);
          top = rect.top;
        }
        const style = getComputedStyle(el);
        return {
          midWord: breaks.filter((i) => text.textContent![i - 1] !== ' '),
          cut: style.whiteSpace === 'nowrap' && style.textOverflow === 'ellipsis',
          title: el.getAttribute('title'),
          size: style.fontSize,
          overflow: el.scrollWidth > el.clientWidth,
        };
      });
    await expect.poll(async () => (await fit()).midWord).toEqual([]);
    const name = await fit();
    test.info().annotations.push({ type: 'fit', description: JSON.stringify(name) });
    if (name.cut) expect(name.title).toBe(TITLE);
    else expect(name.overflow).toBe(false);

    // One row: every part of the header shares its middle, and nothing spills out of it.
    const row = await header.evaluate((el) => ({
      spill: el.scrollWidth > el.clientWidth || document.scrollingElement!.scrollWidth > 390,
      middles: [...el.children].map((c) => {
        const r = c.getBoundingClientRect();
        return Math.round(r.top + r.height / 2);
      }),
    }));
    expect(row.spill).toBe(false);
    expect(Math.max(...row.middles) - Math.min(...row.middles)).toBeLessThanOrEqual(1);
  } finally {
    await setTitle(null);
  }
});
