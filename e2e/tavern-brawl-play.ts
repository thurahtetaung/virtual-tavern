import { type Browser, type Page, expect } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';

// Shared steps for Tavern Brawl's specs: browsers with their own addresses, the back room, a
// room, and a "play whatever is asked" loop that finishes a game from the players' screens.

export const pageErrors: string[] = [];

export interface Look {
  viewport?: { width: number; height: number };
  colorScheme?: 'light' | 'dark';
  /** Runs on each new page before it loads anything (routes for local art). */
  setup?: (page: Page) => Promise<void>;
}

let nextIp = 1;
export async function visitor(browser: Browser, name: string, look: Look = {}) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.31.${worker}.${(nextIp++ % 250) + 1}` },
    ...(look.viewport && {
      viewport: look.viewport,
      isMobile: look.viewport.width < 500,
      hasTouch: look.viewport.width < 500,
    }),
    ...(look.colorScheme && { colorScheme: look.colorScheme }),
  });
  const page = await context.newPage();
  await look.setup?.(page);
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

/** The admin signs in and sets the back-room password. */
export async function openBackroom(page: Page) {
  await ownLoginLimit(page);
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
}

export async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

/** The host opens a room; everyone else follows the link in. */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Tavern Brawl room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(
    rest.map(async (n) => {
      const p = await visitor(browser, n, look);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  await expect(host.getByText(`Players (${names.length}/6)`)).toBeVisible();
  return [host, ...others];
}

export const heroTile = (p: Page, hero: string) =>
  p.getByRole('list', { name: 'Heroes' }).getByRole('button', { name: new RegExp(`^(?:${hero})`) });

/** Picks a hero by its placeholder name or, with `byId`, its id (the tile toggles, so only when it isn't already ours). */
export async function pickHero(p: Page, hero: string, byId = false) {
  const tile = byId ? p.locator(`[data-hero="${hero}"]`) : heroTile(p, hero);
  if ((await tile.getAttribute('aria-pressed')) !== 'true') await tile.click();
  await expect(tile).toHaveAttribute('aria-pressed', 'true');
}

/** The Play button under the hand. */
export const dock = (p: Page) => p.getByRole('group', { name: 'Play a card' }).getByRole('button');

const seq = async (p: Page) => (await p.locator('[data-seq]').getAttribute('data-seq')) ?? '';

/** Waits until the table on `p` has moved on from `before`. */
async function movedOn(p: Page, before: string) {
  await expect.poll(() => seq(p), { timeout: 10_000 }).not.toBe(before);
}

export const isOver = async (p: Page) =>
  (await p.getByRole('button', { name: 'Play again' }).count()) > 0 ||
  (await p
    .getByText(/wins the brawl!|win the brawl!|it’s a tie!|Waiting for .* to start the next brawl/)
    .count()) > 0;

/** Makes the one move `p` is asked for, if any: a choice, the howl, or a card. */
export async function move(p: Page): Promise<boolean> {
  const before = await seq(p).catch(() => '');
  const social = p.getByRole('region', { name: 'Honour prompt' });
  if (await social.count()) {
    await social.getByRole('button').first().click();
    await movedOn(p, before);
    return true;
  }
  const choice = p.getByRole('region', { name: 'Your choice' });
  if (await choice.count()) {
    const take = choice.getByRole('button', { name: /^Take / });
    const chips = choice.getByRole('button').filter({ hasNotText: 'Skip' });
    if (await take.count()) await take.first().click();
    else if (await chips.count()) await chips.first().click();
    else await choice.getByRole('button', { name: 'Skip' }).click();
    await movedOn(p, before);
    return true;
  }
  if (await p.getByRole('button', { name: 'Pick a card to play' }).count()) {
    // Cards fan over each other: tap the strip of the first card that always shows.
    await p
      .getByRole('region', { name: 'Your hand' })
      .locator('[data-hand]')
      .first()
      .click({ position: { x: 14, y: 90 } });
    await dock(p).click();
    await movedOn(p, before);
    return true;
  }
  return false;
}

/** Plays from every screen until the brawl is over. */
export async function playToEnd(pages: Page[], maxMoves = 600) {
  for (let i = 0; i < maxMoves; i++) {
    if (await isOver(pages[0]!)) return;
    let acted = false;
    for (const p of pages) {
      if (await move(p)) {
        acted = true;
        break;
      }
    }
    if (!acted) await pages[0]!.waitForTimeout(150);
  }
  throw new Error('the brawl never ended');
}
