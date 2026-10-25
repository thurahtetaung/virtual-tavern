import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, openBackroom, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Sketchy's specs: made-up prompt and house-title packs, a table of phones, and
// drawing on the pad. The server runs with the test rig (`SKETCHY_TEST_RIG`): prompts are dealt
// in the pack's own order (seat order, a reroll takes the next one) and the drawings come up in
// seat order, so a spec knows who draws what.

export const PROMPTS = [
  { prompt: 'Purple Elephant', alternates: ['violet elephant'] },
  { prompt: 'flying toaster' },
  { prompt: 'sad robot' },
  { prompt: 'happy cloud' },
  { prompt: 'tiny castle' },
  { prompt: 'loud fish' },
  { prompt: 'jazz cat' },
  { prompt: 'grumpy moon' },
  { prompt: 'polite volcano' },
  { prompt: 'dancing chair' },
  { prompt: 'sleepy bus' },
  { prompt: 'brave sock' },
  { prompt: 'nervous cactus' },
  { prompt: 'secret garden' },
];
export const DECOYS = [
  'casual monday',
  'paprika',
  'regret',
  'swag',
  'doodles',
  'chaos',
  'the future',
  'a cloud',
].map((text) => ({ text }));

/** The admin imports the made-up packs; returns how to delete them again. */
export async function importPacks(browser: Browser): Promise<() => Promise<unknown>> {
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const ids: string[] = [];
  for (const [kind, data] of [
    ['prompts', PROMPTS],
    ['decoys', DECOYS],
  ] as const) {
    const res = await admin.request.post('/api/admin/content-packs', {
      data: { gameId: 'sketchy', kind, name: `E2E ${kind}`, data },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  return () => Promise.all(ids.map((id) => admin.request.delete(`/api/admin/content-packs/${id}`)));
}

/** The host opens a room; the others join one at a time (so seat order is known). */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Sketchy room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const name of rest) {
    const p = await visitor(browser, name, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Players (${pages.length}/8)`)).toBeVisible();
  }
  return pages;
}

export const PHONE: Look = { viewport: { width: 390, height: 844 } };

/** Draws a line on the pad with the mouse, then sends it and waits until the server has it. */
export async function drawAndSend(page: Page) {
  const pad = page.getByTestId('drawing-pad');
  await expect(pad).toBeVisible();
  const box = (await pad.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
  await page.mouse.up();
  await expect(pad.getByRole('img', { name: /Drawing area, [1-9]/ })).toBeVisible();
  await page.getByTestId('drawing-send').click();
  // The pad goes once the server has the drawing (the last one in moves the table on at once).
  await expect(pad).toHaveCount(0);
}

/** Writes a fake title and waits until the server has it. */
export async function writeLie(page: Page, text: string) {
  await page.getByTestId('sketchy-lie').fill(text);
  await page.getByRole('button', { name: 'Send title' }).click();
  // The last title in moves the table on to picking at once.
  await expect(
    page.getByRole('button', { name: '✓ Sent' }).or(page.getByTestId('sketchy-board')),
  ).toBeVisible();
}

/** Picks a title on the board and waits until the server has it. */
export async function pick(page: Page, text: string) {
  const option = page.getByTestId('sketchy-board').getByRole('button', { name: text, exact: true });
  await option.click();
  // The last pick in starts the reveal at once.
  await expect(
    page
      .getByTestId('sketchy-board')
      .getByRole('button', { name: text, exact: true, pressed: true })
      .or(page.getByTestId('reveal-sequence'))
      .or(page.getByTestId('artist-moment')),
  ).toBeVisible();
}

/** Likes a title on the board and waits until the server has it. */
export async function like(page: Page, text: string) {
  const button = page.getByRole('button', { name: `Like “${text}”` });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

/** Waits for the drawing's results (after the one-by-one reveal), on every page. */
export async function results(pages: Page[], prompt: string) {
  for (const p of pages) {
    await expect(p.getByTestId('artist-moment')).toContainText(`drew “${prompt}”`, {
      timeout: 30_000,
    });
  }
}

/** A player's score in the scores panel. */
export const scoreOf = (page: Page, name: string) =>
  page.getByTestId('sketchy-scores').getByRole('listitem').filter({ hasText: name });
