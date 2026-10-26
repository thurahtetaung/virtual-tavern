import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Mosaic's specs: a room, and a take through the pick sheet.

const ART = process.env.MOSAIC_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/**
 * With MOSAIC_ART=<folder holding manifest.json (or the art worker's manifest-draft.json) and the
 * art>, pages get them from disk.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/mosaic', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/mosaic/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/mosaic\//,
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

/** The host opens a Mosaic room; everyone else follows the link in. */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Mosaic room' }).click();
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
  await expect(host.getByText(`Players (${names.length}/4)`)).toBeVisible();
  return [host, ...others];
}

export const YOUR_TURN = /^Your turn: tap a tile/;

/** Waits for the player's turn. */
export const myTurn = (p: Page) => expect(p.getByText(YOUR_TURN)).toBeVisible();

export const sheet = (p: Page) => p.getByRole('dialog');

/** Opens the pick sheet for a colour on a factory (1-based) or in the centre. */
export async function pick(p: Page, colour: string, from: number | 'centre') {
  await myTurn(p);
  const where = from === 'centre' ? 'the centre' : `factory ${from}`;
  // Every tile of a group is a button for the same group: tap the first.
  await p
    .getByRole('button', { name: new RegExp(`^\\d+ ${colour} from ${where}$`) })
    .first()
    .click();
  await expect(sheet(p)).toBeVisible();
}

/** Picks a line (1-based) or the floor in the open sheet and places the tiles. */
export async function place(p: Page, target: number | 'floor') {
  await sheet(p)
    .locator(`button[data-target="${target === 'floor' ? 'floor' : target - 1}"]`)
    .click();
  await sheet(p).getByTestId('mo-place').click();
  await expect(sheet(p)).toHaveCount(0);
}

/** A whole take: the colour, from where, to which line. */
export async function take(
  p: Page,
  colour: string,
  from: number | 'centre',
  target: number | 'floor',
) {
  await pick(p, colour, from);
  await place(p, target);
  await expect(p.getByText(YOUR_TURN)).toHaveCount(0);
}
