import { type Browser, type Page, expect } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';

// Helpers to play Inquest through the UI. Tiles are found by their `data-` hooks, so the helpers
// work with placeholders (no asset storage) and with the real names alike.

export interface Player {
  name: string;
  page: Page;
}

let nextIp = 1;

/** A browser with its own rate-limit address and name. */
export async function visitor(
  browser: Browser,
  name: string,
  errors: string[],
  opts: { viewport?: { width: number; height: number }; colorScheme?: 'light' | 'dark' } = {},
) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const context = await browser.newContext({
    ...opts,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.9.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  // Hand over and Abandon ask first.
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

/** The first name creates an Inquest room; the rest join it. */
export async function table(
  browser: Browser,
  names: string[],
  errors: string[],
  opts: Parameters<typeof visitor>[3] = {},
): Promise<Player[]> {
  const host = await visitor(browser, names[0]!, errors, opts);
  await unlock(host);
  await host.getByRole('button', { name: 'Create an Inquest room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  const rest = await Promise.all(
    names.slice(1).map(async (n) => {
      const p = await visitor(browser, n, errors, opts);
      await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
      await expect(p).toHaveURL(host.url());
      return p;
    }),
  );
  const players = [host, ...rest].map((page, i) => ({ name: names[i]!, page }));
  await expect(host.getByText(`(${names.length}/12)`)).toBeVisible();
  return players;
}

/** The player whose page shows `text` (polling until one does). */
export async function whoShows(players: Player[], text: RegExp | string): Promise<Player> {
  let found: Player | undefined;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if ((await p.page.getByText(text).count()) > 0) {
            found = p;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found!;
}

/** The Murderer commits their first Clue and first Means card. */
export async function commitCrime(players: Player[]) {
  const murderer = await whoShows(players, 'Murderer: pick 1 Clue + 1 Means from your own cards.');
  const panel = murderer.page.getByRole('region', { name: 'Choose your crime' });
  await panel
    .getByRole('button', { name: /^Clue:/ })
    .first()
    .click();
  await panel
    .getByRole('button', { name: /^Means:/ })
    .first()
    .click();
  await panel.getByRole('button', { name: /^Commit:/ }).click();
  await expect(panel).toBeHidden();
  return murderer;
}

/** The Forensic Scientist places `n` bullets, each on the first item of a tile without one. */
export async function placeBullets(fs: Page, n: number) {
  for (let i = 0; i < n; i++) {
    await fs.locator('button[data-item]:visible').first().click();
    const place = fs.getByRole('button', { name: /^Place bullet on/ });
    await place.click();
    await expect(place).toHaveCount(0);
  }
}

/** Round 1 for the Forensic Scientist: a Location tile, then the six bullets. */
export async function firstRound(fs: Page) {
  await expect(fs.getByText('Pick the Location tile for this crime.')).toBeVisible();
  await fs.locator('button[data-tile]:visible').first().click();
  await fs.getByRole('button', { name: /^Use “/ }).click();
  await placeBullets(fs, 6);
}

/** The Forensic Scientist swaps the new tile in for the first scene tile they may replace. */
export async function replaceTile(fs: Page) {
  await fs.locator('button[data-slot]:visible').first().click();
  const confirm = fs.getByRole('button', { name: /^Replace “/ });
  await confirm.click();
  await expect(confirm).toHaveCount(0);
}

/** Every speaker taps Done, in turn, `count` times. */
export async function presentAll(players: Player[], count: number) {
  for (let i = 0; i < count; i++) {
    const speaker = await whoShows(players, /^Your turn to present/);
    const done = speaker.page.getByRole('button', { name: 'Done', exact: true });
    await done.click();
    await expect(done).toHaveCount(0);
  }
}

/** Closes the event card that pops up on every screen. */
export async function dismissEvent(players: Player[], name: RegExp) {
  for (const p of players) {
    const dialog = p.page.getByRole('dialog', { name });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Got it' }).click();
    await expect(dialog).toBeHidden();
  }
}

/** Opens Solve and names `suspect`'s `clue`-th Clue and `means`-th Means card (0-based). */
export async function solve(p: Page, suspect: string, clue: number, means: number) {
  await p
    .getByRole('button', { name: /🔎 Solve/ })
    .first()
    .click();
  const d = p.getByRole('dialog', { name: /^Solve/ });
  await d.getByRole('button', { name: suspect, exact: true }).click();
  await d
    .getByRole('button', { name: /^Clue:/ })
    .nth(clue)
    .click();
  await d
    .getByRole('button', { name: /^Means:/ })
    .nth(means)
    .click();
  await d.getByRole('button', { name: '🔎 Solve the crime' }).click();
  await expect(d).toBeHidden();
}

/** The first player whose (revealed) role card names `role`; the card is hidden again after. */
export async function withRole(players: Player[], role: string): Promise<Player> {
  for (const p of players) {
    const nav = p.page.getByRole('navigation', { name: 'Game sections' });
    if (await nav.isVisible()) await nav.getByRole('button', { name: 'Me' }).click();
    const card = p.page.getByRole('button', { name: 'Reveal your role card' });
    await card.click();
    const heading = p.page.getByRole('heading', { level: 3 }).filter({
      hasText:
        /^(Forensic Scientist|Murderer|Accomplice|Witness|Investigator|Former Forensic Scientist)$/,
    });
    await expect(heading).toBeVisible();
    const found = (await heading.textContent()) === role;
    await p.page.getByRole('button', { name: 'Hide your role card' }).click();
    if (found) return p;
  }
  throw new Error(`nobody holds ${role}`);
}
