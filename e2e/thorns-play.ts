import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';
import { openSettings } from './lobby-settings.ts';

// Shared steps for Thorns' specs: a room, putting discs down, bidding and turning discs over.

const ART = process.env.THORNS_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/** With THORNS_ART=<folder holding manifest.json and the art>, pages get them from disk. */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/thorns', async (route) =>
    route.fulfill({
      json: JSON.parse(await readFile(join(ART, 'manifest.json'), 'utf8')) as unknown,
    }),
  );
  await page.route('**/api/backroom/assets/thorns/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/thorns\//,
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

/** The host opens a Thorns room; everyone else follows the link in. */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Thorns room' }).click();
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
  // On a phone the host's settings start folded.
  await openSettings(host);
  return [host, ...others];
}

export const YOUR_TURN = 'Your turn: add a disc to your stack, or open the bidding.';
export const yourDiscs = (p: Page) => p.getByRole('region', { name: 'Your discs' });

/** Puts down a disc (by its id, whatever the manifest calls it): the one asked for, else any. */
export async function putDown(p: Page, want: 'rose' | 'thorn' | 'chance' = 'rose') {
  const discs = yourDiscs(p);
  await expect(discs.locator('[data-place]').first()).toBeVisible();
  const wanted = discs.locator(`[data-place="${want}"]`);
  if ((await wanted.count()) > 0) await wanted.first().click();
  else await discs.locator('[data-place]').first().click();
}

/** Whose turn it is, read from the screens. */
export async function whoseTurn(pages: Page[]): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(async () => {
      for (const p of pages) if (await p.getByText(YOUR_TURN).isVisible()) found = p;
      return found !== undefined;
    })
    .toBe(true);
  return found!;
}

/** Bids every disc on the mats (3), which makes the challenge at once. */
export async function bidAll(p: Page) {
  const discs = yourDiscs(p);
  await discs.getByRole('button', { name: 'One more' }).click();
  await discs.getByRole('button', { name: 'One more' }).click();
  await discs.getByRole('button', { name: 'Bid 3' }).click();
}

export const flip = (p: Page, whose: string) =>
  p.getByRole('button', { name: `Turn over ${whose} top disc` }).click();

/** Leaves the room for good from the Players drawer. */
export async function leaveRoom(p: Page) {
  await p.getByRole('button', { name: /^Players/ }).click();
  await p
    .getByRole('dialog', { name: 'Players' })
    .getByRole('button', { name: 'Leave room' })
    .click();
  await p
    .getByRole('dialog', { name: 'Leave this room?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
}
