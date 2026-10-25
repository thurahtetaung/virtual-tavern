import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, openBackroom, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Going Once's specs: made-up title groups, a rigged table, drawing on the pad
// and bidding. The server allows the test rig (`GOING_ONCE_TEST_RIG`), which fixes the deal
// (titles in seat order, every first-family drawing worth $3,500 and the other $1,000, the
// house's $2,000, lots in seat order with the house last), halves every clock and starts everyone
// on $1,400, so the first sale brings the bank.

export const GROUPS = [
  { id: 'e2e-fruit', titles: ['Apple', 'Pear', 'Quince', 'Green ball', 'Plum', 'Fig', 'Medlar'] },
  { id: 'e2e-hats', titles: ['Top hat', 'Bowler', 'Fez', 'Stovepipe', 'Bucket', 'Drum', 'Cap'] },
];

/** Each seat's two titles under the rig, in seat order. */
export const TITLES: [string, string][] = [
  ['Apple', 'Top hat'],
  ['Pear', 'Bowler'],
  ['Quince', 'Fez'],
];

/** A few made-up host lines. */
export const HOST = {
  'opening-first': ['E2E host: the first lot!'],
  opening: ['E2E host: who starts?'],
  sold: ['E2E host: sold!'],
  unsold: ['E2E host: nobody wanted it.'],
};

// Local previews only: GOING_ONCE_ART=<folder with manifest.json and the art> serves them to the
// pages, and GOING_ONCE_PACKS=<folder with pack-groups/lines/host.json> imports those packs instead
// of the made-up ones (screenshots read every title from the page, so any groups work).
const ART = process.env.GOING_ONCE_ART;
const PACKS = process.env.GOING_ONCE_PACKS;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/going-once', async (route) =>
    route.fulfill({
      json: JSON.parse(await readFile(join(ART, 'manifest.json'), 'utf8')) as unknown,
    }),
  );
  await page.route('**/api/backroom/assets/going-once/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/going-once\//,
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

/** The admin imports made-up title groups and lines; returns how to delete them again. */
export async function importPacks(browser: Browser): Promise<() => Promise<unknown>> {
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const ids: string[] = [];
  const own = async (kind: string) =>
    JSON.parse(await readFile(join(PACKS!, `pack-${kind}.json`), 'utf8')) as unknown;
  const packs: [string, unknown][] = PACKS
    ? [
        ['groups', await own('groups')],
        ['lines', await own('lines')],
        ['host', await own('host')],
      ]
    : [
        ['groups', GROUPS],
        ['lines', { someoneKnows: ['E2E line: {player} knows this one.'] }],
        ['host', HOST],
      ];
  for (const [kind, data] of packs) {
    const res = await admin.request.post('/api/admin/content-packs', {
      data: { gameId: 'going-once', kind, name: `E2E ${kind}`, data },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  return () => Promise.all(ids.map((id) => admin.request.delete(`/api/admin/content-packs/${id}`)));
}

/** The host opens a room and rigs it; the others join one at a time (so seat order is known). */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Going Once room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const name of rest) {
    const p = await visitor(browser, name, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Bidders (${pages.length}/6)`)).toBeVisible();
  }
  await host.getByRole('button', { name: 'Rig next game' }).click();
  await expect(host.getByTestId('go-rig')).toContainText('on (×0.5');
  return pages;
}

export const PHONE: Look = { viewport: { width: 390, height: 844 } };

/** Draws a short line on the pad with a finger (touch events), checking the page never scrolls. */
export async function drawWithFinger(page: Page) {
  const pad = page.getByTestId('drawing-pad');
  await expect(pad).toBeVisible();
  const box = (await pad.boundingBox())!;
  const before = await page.evaluate(() => window.scrollY);
  const cdp = await page.context().newCDPSession(page);
  const at = (f: number) => ({
    x: box.x + box.width * (0.2 + 0.6 * f),
    y: box.y + box.height * (0.3 + 0.4 * f),
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] });
  for (let i = 1; i <= 8; i++)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i / 8)] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(pad.getByRole('img', { name: 'Drawing area, 1 line' })).toBeVisible();
  expect(await page.evaluate(() => window.scrollY)).toBe(before);
}

/** Draws with the mouse. */
export async function drawWithMouse(page: Page) {
  const pad = page.getByTestId('drawing-pad');
  await expect(pad).toBeVisible();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(pad.getByRole('img', { name: /Drawing area, [1-9]/ })).toBeVisible();
}

export const lotIs = (p: Page, n: number) => expect(p.getByText(`Lot ${n}/8`)).toBeVisible();
export const bid = async (p: Page, amount: number) => {
  const button = p.getByTestId(`go-bid-${amount}`);
  await expect(button).toBeEnabled();
  await button.click();
};
