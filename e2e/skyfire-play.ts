import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Locator, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Skyfire's specs: a room, clues, plays and discards.
//
// The e2e server's rig (SKYFIRE_TEST_DECK in playwright.config.ts) puts these cards on top of the
// deck, dealt a hand at a time in seat order, with the first seat starting. Card ids are dealing
// positions, so with 2 players Ana holds c1–c5 (yellow 3, yellow 4, white 4, blue 4, green 4) and
// Ben c6–c10 (red 1, green 5, blue 5, white 5, yellow 5); the deck's next card is c11.

const ART = process.env.SKYFIRE_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/**
 * With SKYFIRE_ART=<folder holding manifest.json (or the art worker's manifest-draft.json) and the
 * art>, pages get them from disk.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/skyfire', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/skyfire/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/skyfire\//,
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

/**
 * The host opens a Skyfire room; the others follow the link in one at a time (seat order). A list
 * of looks gives each seat its own.
 */
export async function table(browser: Browser, names: string[], look: Look | Look[] = {}) {
  const lookOf = (i: number) => (Array.isArray(look) ? (look[i] ?? {}) : look);
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, lookOf(0));
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Skyfire room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const [i, n] of rest.entries()) {
    const p = await visitor(browser, n, lookOf(i + 1));
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Players (${pages.length}/5)`)).toBeVisible();
  }
  return pages;
}

export const myTurn = (p: Page) => expect(p.getByText(/^Your turn/)).toBeVisible();

/** Clues the (only, or first) teammate with a colour or number. */
export async function clue(p: Page, what: string | number, button?: RegExp) {
  await myTurn(p);
  await p.getByTestId('sf-clue-open').first().click();
  await p.getByTestId(`sf-clue-${what}`).click();
  if (button) await expect(p.getByTestId('sf-send-clue')).toHaveText(button);
  await p.getByTestId('sf-send-clue').click();
  await expect(p.getByTestId('sf-send-clue')).toHaveCount(0);
}

/** Opens one of your own cards by id and plays or discards it. */
export async function useCard(p: Page, card: string, how: 'play' | 'discard') {
  await myTurn(p);
  await p.getByTestId('sf-my-hand').locator(`[data-card="${card}"]`).click();
  await p.getByTestId(`sf-${how}`).click();
  await expect(p.getByTestId(`sf-${how}`)).toHaveCount(0);
}

/** The ids of a hand's cards, left to right. */
export const handOrder = (hand: Locator) =>
  hand.locator('[data-card]').evaluateAll((els) => els.map((e) => e.getAttribute('data-card')));

/**
 * Drags one of your own cards onto another's place, with the mouse or (phones) a finger, calling
 * `mid` while it is held.
 */
export async function dragCard(
  p: Page,
  from: string,
  onto: string,
  how: 'mouse' | 'touch',
  mid?: () => Promise<void>,
) {
  const hand = p.getByTestId('sf-my-hand');
  const a = (await hand.locator(`[data-card="${from}"]`).boundingBox())!;
  const b = (await hand.locator(`[data-card="${onto}"]`).boundingBox())!;
  const y = a.y + a.height / 2;
  const x = (f: number) => a.x + a.width / 2 + (b.x - a.x) * f;
  if (how === 'mouse') {
    await p.mouse.move(x(0), y);
    await p.mouse.down();
    for (let i = 1; i <= 10; i++) await p.mouse.move(x(i / 10), y);
    await mid?.();
    await p.mouse.up();
    return;
  }
  const cdp = await p.context().newCDPSession(p);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd', f?: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: f === undefined ? [] : [{ x: x(f), y }],
    });
  await touch('touchStart', 0);
  for (let i = 1; i <= 10; i++) await touch('touchMove', i / 10);
  await mid?.();
  await touch('touchEnd');
}
