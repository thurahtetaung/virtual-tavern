import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect, test } from '@playwright/test';
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
  await expect(page.getByLabel('The word')).toHaveCount(0);
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
  await expect.poll(() => seq(p), { timeout: 10_000, intervals: [50] }).not.toBe(before);
}

export const isOver = async (p: Page) => {
  const counts = await Promise.all([
    p.getByRole('button', { name: 'Play again' }).count(),
    p
      .getByText(
        /wins the brawl!|win the brawl!|it’s a tie!|Waiting for .* to start the next brawl/,
      )
      .count(),
  ]);
  return counts.some((n) => n > 0);
};

type Ask = 'social' | 'choice' | 'card' | null;

/** What `p` is asked for, if anything: the howl, a choice, or a card. */
async function asked(p: Page): Promise<Ask> {
  const [social, choice, card] = await Promise.all([
    p.getByRole('region', { name: 'Honour prompt' }).count(),
    p.getByRole('region', { name: 'Your choice' }).count(),
    p.getByRole('button', { name: 'Pick a card to play' }).count(),
  ]);
  return social ? 'social' : choice ? 'choice' : card ? 'card' : null;
}

/** Makes the one move `p` is asked for, if any: a choice, the howl, or a card. */
export async function move(p: Page, ask?: Ask): Promise<boolean> {
  const before = await seq(p).catch(() => '');
  ask ??= await asked(p);
  if (ask === 'social') {
    await p.getByRole('region', { name: 'Honour prompt' }).getByRole('button').first().click();
  } else if (ask === 'choice') {
    const choice = p.getByRole('region', { name: 'Your choice' });
    const take = choice.getByRole('button', { name: /^Take / });
    const chips = choice.getByRole('button').filter({ hasNotText: 'Skip' });
    if (await take.count()) await take.first().click();
    else if (await chips.count()) await chips.first().click();
    else await choice.getByRole('button', { name: 'Skip' }).click();
  } else if (ask === 'card') {
    // Attacks first, so a full game ends in a few rounds; cards fan over each other, so tap the
    // strip of the card that always shows.
    const cards = p.getByRole('region', { name: 'Your hand' }).locator('[data-hand]');
    const attacks = cards.and(p.locator('[aria-label*="Attack"]'));
    await ((await attacks.count()) ? attacks : cards).first().click({ position: { x: 14, y: 90 } });
    await dock(p).click();
  } else {
    return false;
  }
  await movedOn(p, before);
  return true;
}

/** Plays from every screen until the brawl is over (every screen is asked at once). */
export async function playToEnd(pages: Page[], maxMoves = 600) {
  for (let i = 0; i < maxMoves; i++) {
    const [over, ...asks] = await Promise.all([isOver(pages[0]!), ...pages.map(asked)]);
    if (over) return;
    const who = asks.findIndex(Boolean);
    if (who >= 0) await move(pages[who]!, asks[who]);
    else await pages[0]!.waitForTimeout(150);
  }
  throw new Error('the brawl never ended');
}

/**
 * A whole game from the players' screens: everyone picks their hero, the host starts, and all
 * play until the end. With five or more the zone is on, and the knocked out haunt as ghosts.
 */
export async function fullBrawl(browser: Browser, heroes: string[], names: string[]) {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = await table(browser, names);
  for (const [i, p] of pages.entries()) await pickHero(p, heroes[i]!);
  const zone = pages.length >= 5;
  if (zone) await expect(pages[0]!.getByText(/Five or more players/)).toBeVisible();
  await pages[0]!.getByRole('button', { name: 'Start the brawl' }).click();
  await expect(pages[0]!.getByText('Your turn: play a card')).toBeVisible();
  await playToEnd(pages);
  for (const p of pages) await expect.poll(() => isOver(p)).toBe(true);
  // Everyone knocked out stayed at the table as a ghost (and had turns to haunt).
  if (zone) {
    await expect
      .poll(() => pages[0]!.locator('[data-ghost]').count())
      .toBeGreaterThanOrEqual(pages.length - 1);
    await expect(pages[0]!.getByRole('log').first()).toContainText(/ghost/);
  }
}

const ART = process.env.TAVERN_BRAWL_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/**
 * With TAVERN_BRAWL_ART=<folder holding manifest.json and the art>, pages get that manifest and art
 * from disk, to preview the real cards locally; without it, cards show as placeholders.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/tavern-brawl', async (route) =>
    route.fulfill({
      json: JSON.parse(await readFile(join(ART, 'manifest.json'), 'utf8')) as unknown,
    }),
  );
  await page.route('**/api/backroom/assets/tavern-brawl/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/tavern-brawl\//,
      '',
    );
    try {
      await route.fulfill({
        body: await readFile(join(ART, path)),
        contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}
