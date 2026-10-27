import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { escapeRegExp } from '../packages/game-sdk/src/regex.ts';
import { unlock, visitor } from './inquest-play.ts';
import { openSettings } from './lobby-settings.ts';

// Helpers to play Short Fuse through the UI. Without asset storage the cards use their neutral
// placeholder names (Bomb, Defuse, Nope, Cat A…); the hand's buttons carry `data-card` with the
// card's id-free type, so the helpers work with the real art too. The server runs with
// `SHORT_FUSE_TEST_RIG=1`, so the host can fix the hands and the top of the pile in the lobby.

export interface Player {
  name: string;
  page: Page;
}

/**
 * Screenshots only: with `SHORT_FUSE_ART` set to the private art folder (with its `manifest.json`),
 * the browser is served that art in place of asset storage. Never committed; without the variable
 * nothing changes.
 */
async function previewArt(page: Page) {
  const dir = process.env.SHORT_FUSE_ART;
  if (!dir || !existsSync(join(dir, 'manifest.json'))) return;
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
  const context = page.context();
  await context.route('**/api/backroom/manifest/short-fuse', (r) => r.fulfill({ json: manifest }));
  await context.route('**/api/backroom/assets/short-fuse/**', (r) => {
    const path = decodeURIComponent(
      new URL(r.request().url()).pathname.replace(/^\/api\/backroom\/assets\/short-fuse\//, ''),
    );
    const file = join(dir, path);
    return !path.includes('..') && existsSync(file)
      ? r.fulfill({ body: readFileSync(file), contentType: 'image/webp' })
      : r.fulfill({ status: 404 });
  });
}

export async function sfVisitor(
  browser: Browser,
  name: string,
  errors: string[],
  opts: Parameters<typeof visitor>[3] = {},
) {
  const page = await visitor(browser, name, errors, opts);
  await previewArt(page);
  // First-time tips stay out of the way unless a spec wants them.
  await page.addInitScript(() =>
    localStorage.setItem(
      'vt.short-fuse.tips',
      JSON.stringify(['bombs', 'nope', 'owed', 'pile', 'pairs']),
    ),
  );
  return page;
}

/** The first name creates a Short Fuse room; the rest join it. */
export async function sfTable(
  browser: Browser,
  names: string[],
  errors: string[],
  opts: Parameters<typeof visitor>[3] = {},
): Promise<Player[]> {
  const host = await sfVisitor(browser, names[0]!, errors, opts);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Short Fuse room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  // One at a time, so the seats are in the order of `names` (a rig deals by seat).
  const rest: Page[] = [];
  for (const [i, n] of names.slice(1).entries()) {
    const p = await sfVisitor(browser, n, errors, opts);
    await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
    await expect(p).toHaveURL(host.url());
    await expect(host.getByText(`Players (${i + 2}/10)`)).toBeVisible();
    rest.push(p);
  }
  // On a phone the host's settings start folded.
  await openSettings(host);
  return [host, ...rest].map((page, i) => ({ name: names[i]!, page }));
}

/** The host fixes the next game's hands (by seat) and the top of the pile, then starts. */
export async function riggedStart(
  host: Page,
  rig: { hands: string[][]; top: string[]; first?: number; size?: number },
) {
  // Back from a game, the lobby can still shift as the room's award strip comes in, so a tap on
  // the summary can miss it (the details takes the tap, or it lands as the summary moves): tap
  // until the panel is open, never toggling an open one shut.
  const panel = host.getByTestId('rig');
  await expect(async () => {
    if (!(await panel.evaluate((d) => (d as HTMLDetailsElement).open)))
      await panel.locator('summary').click({ timeout: 2_000 });
    await expect(host.getByLabel('Rig')).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await host.getByLabel('Rig').fill(JSON.stringify({ first: 0, ...rig }));
  await host.getByRole('button', { name: 'Use this setup' }).click();
  await expect(host.getByTestId('rig')).toContainText('(armed)');
  await host.getByTestId('start').click();
  await expect(host.getByTestId('short-fuse')).toBeVisible();
}

const hand = (p: Page) => p.getByTestId('hand');

/** Taps cards of these types in the player's hand (in order, one card each). */
export async function select(p: Page, types: string[]) {
  const seen: Record<string, number> = {};
  for (const t of types) {
    const i = seen[t] ?? 0;
    seen[t] = i + 1;
    await hand(p).locator(`[data-card="${t}"]`).nth(i).click();
  }
}

/** Plays cards (and picks a target, and names a card for three of a kind). */
export async function play(p: Page, types: string[], target?: string, named?: string) {
  await select(p, types);
  await p.getByTestId('play').click();
  if (named) await p.getByTestId('named').selectOption({ label: named });
  if (target)
    await p
      .getByTestId('targets')
      .getByRole('button', { name: new RegExp(`^${escapeRegExp(target)}`) })
      .click();
}

/** Waits until the Nope countdown has run out on this page. */
export async function settle(p: Page) {
  await expect(p.getByTestId('nope-panel')).toBeVisible();
  await expect(p.getByTestId('nope-panel')).toBeHidden({ timeout: 15_000 });
}

export async function draw(p: Page) {
  await p.getByTestId('draw').click();
}

/** Counts of each card type in the player's hand. */
export async function handTypes(p: Page): Promise<string[]> {
  return hand(p)
    .locator('[data-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-card') ?? ''));
}
