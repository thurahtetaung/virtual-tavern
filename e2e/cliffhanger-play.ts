import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { openSettings } from './lobby-settings.ts';
import { type Look, openBackroom, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Cliffhanger's specs: made-up packs of titles and categories, a table of phones,
// a face-off and a describing turn. The server runs with the test rig (`CLIFFHANGER_TEST_DECK`):
// titles and categories are dealt in the packs' own order, so a spec knows every hand. The titles
// go round the eight genres of the base goal in order (ten of each, as a genre needs for one of
// each), so the face-off winner's team keeps the
// first three, the other side gets the next three, and stealing them all gives six genres in one
// turn; a second round's first two finish the set.

const GENRES = ['action', 'classics', 'drama', 'comedy', 'horror', 'family', 'animation', 'scifi'];
export const FILMS = Array.from({ length: 10 }, (_, i) =>
  GENRES.map((genre) => ({ title: `Pretend ${genre} ${i + 1}`, genre })),
).flat();
export const CATEGORIES = Array.from({ length: 12 }, (_, i) => `Made-up category ${i + 1}`);

/** The admin imports the made-up packs; returns how to delete them again. */
export async function importPacks(browser: Browser): Promise<() => Promise<unknown>> {
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const ids: string[] = [];
  for (const [kind, data] of [
    ['films', { films: FILMS }],
    ['categories', { categories: CATEGORIES }],
  ] as const) {
    const res = await admin.request.post('/api/admin/content-packs', {
      data: { gameId: 'cliffhanger', kind, name: `E2E ${kind}`, data },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  return () => Promise.all(ids.map((id) => admin.request.delete(`/api/admin/content-packs/${id}`)));
}

const ART = process.env.CLIFFHANGER_ART;
const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
};

/** With CLIFFHANGER_ART=<folder holding manifest.json and the art>, pages get them from disk. */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/cliffhanger', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8');
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/cliffhanger/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/cliffhanger\//,
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

export const PHONE: Look = { viewport: { width: 390, height: 844 } };

/**
 * The host opens a room; the others follow the link one at a time. Newcomers join the smaller
 * team, so with Ana, Ben, Cleo and Dev the teams are Ana and Cleo, Ben and Dev.
 */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await localArt(host);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Cliffhanger room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const n of rest) {
    const p = await visitor(browser, n, look);
    await localArt(p);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(
      host.getByRole('region', { name: 'Teams' }).getByText(n, { exact: true }),
    ).toBeVisible();
  }
  await openSettings(host);
  return pages;
}

/** The page of whoever sees a test id now (one of them must, soon). */
export async function whoSees(pages: Page[], testId: string): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const p of pages) {
          if (await p.getByTestId(testId).isVisible()) {
            found = p;
            return true;
          }
        }
        return false;
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  return found!;
}

/**
 * Plays a face-off: the pick of a category if the trailing team gets one, then `winner` says one
 * and the other player lets the clock run out. Returns once the winner is choosing.
 */
export async function faceOff(pages: Page[], winner: Page) {
  await expect
    .poll(
      async () => {
        for (const p of pages) {
          const pick = p.getByText('Your team is behind: pick the category.');
          if (await pick.isVisible()) {
            await p
              .getByRole('button', { name: /^Made-up category/ })
              .first()
              .click();
          }
        }
        return winner
          .getByTestId('said-it')
          .isEnabled()
          .catch(() => false);
      },
      { timeout: 30_000 },
    )
    .toBe(true);
  await winner.getByTestId('said-it').click();
  // The other player's answer clock runs out: the winner chooses their three.
  await expect(winner.getByTestId('keep')).toBeVisible({ timeout: 30_000 });
}

/** The describer taps Got it `n` times, reading each title off the screen first. */
export async function describe(describer: Page, n: number): Promise<string[]> {
  const got: string[] = [];
  const now = describer.getByTestId('now-title');
  for (let i = 0; i < n; i++) {
    await expect(now).toBeVisible({ timeout: 30_000 });
    const title = (await now.textContent())?.trim() ?? '';
    await describer.getByTestId('got-it').click();
    got.push(title);
    if (i < n - 1) await expect(now).not.toHaveText(title);
  }
  return got;
}

/** The face-off winner keeps the first cards offered, in order, one per square, and locks in. */
export async function lockIn(winner: Page) {
  const cards = winner.getByTestId('hand-card');
  for (let i = 0; i < 3; i++) {
    await cards.nth(i).click();
    await expect(cards.nth(i)).toHaveAttribute('aria-pressed', 'true');
  }
  await winner.getByTestId('lock-in').click();
}
