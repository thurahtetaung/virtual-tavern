import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Jeweller's specs: a room, taking gems, buying and reserving.

const ART = process.env.JEWELLER_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/** With JEWELLER_ART=<folder holding manifest.json and the art>, pages get them from disk. */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/jeweller', async (route) =>
    route.fulfill({
      json: JSON.parse(await readFile(join(ART, 'manifest.json'), 'utf8')) as unknown,
    }),
  );
  await page.route('**/api/backroom/assets/jeweller/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/jeweller\//,
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

/** The host opens a Jeweller room; everyone else follows the link in. */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Jeweller room' }).click();
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

export const YOUR_TURN = /^Your turn: take gems, reserve a card, or buy one\./;

/** Waits for the player's turn. */
export const myTurn = (p: Page) => expect(p.getByText(YOUR_TURN)).toBeVisible();

/** Takes these gems: taps each pile, then Take. */
export async function take(p: Page, gems: string[]) {
  await myTurn(p);
  for (const g of gems) await p.locator(`[data-pile="${g}"]`).click();
  await p.getByTestId('jw-take').click();
  await expect(p.getByText(YOUR_TURN)).toHaveCount(0);
}

/** Opens a card's sheet from the table. */
export const openCard = (p: Page, id: string) =>
  p.getByRole('region', { name: 'Cards for sale' }).locator(`[data-card="${id}"]`).click();

export const sheet = (p: Page) => p.getByRole('dialog');
