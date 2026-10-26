import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Encore's specs: a room, the flip, shows and recruits.
//
// The e2e server's rig (ENCORE_TEST_DECK in playwright.config.ts) deals the same hands every
// round, in seat order:
//   3 players: Ana 1 4 7 2 5 8 3 6 9 4 7 5 (she holds the 1/2 card and starts), Ben 8 8 6 3 9 5 7
//   4 6 9 4 7, Cy 5 7 4 6 8 5 7 4 9 9 9 9.
//   2 players: Ana 1 6 8 5 7 3 1 4 6 8 5, Ben 9 9 9 9 3 5 7 3 7 5 8.

const ART = process.env.ENCORE_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/**
 * With ENCORE_ART=<folder holding manifest.json (or the art worker's manifest-draft.json) and the
 * art>, pages get them from disk.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/encore', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/encore/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/encore\//,
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

/** The host opens an Encore room; the others follow the link in one at a time (seat order). */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create an Encore room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const n of rest) {
    const p = await visitor(browser, n, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Players (${pages.length}/5)`)).toBeVisible();
  }
  return pages;
}

export const myTurn = (p: Page) => expect(p.getByText(/^Your turn/)).toBeVisible();

/** Everyone keeps their hand as dealt (each choice accepted before the next); play starts. */
export async function keepAll(pages: Page[], round: number, rounds: number) {
  for (const [i, p] of pages.entries()) {
    await expect(p.getByText(`Round ${round} of ${rounds}`).first()).toBeVisible();
    await p.getByTestId('en-flip-kept').getByRole('button').click();
    if (i < pages.length - 1)
      await expect(p.getByTestId('en-flip-kept').getByRole('button')).toHaveText('✓ Keep it');
  }
  for (const p of pages) await expect(p.getByTestId('en-flip-kept')).toHaveCount(0);
}

const hand = (p: Page) => p.getByRole('list', { name: 'Your hand' });

/** Taps a card (the longest show from it is picked) and shows what the button names. */
export async function show(p: Page, index: number, button: RegExp) {
  await myTurn(p);
  await hand(p).locator(`button[data-hand-index="${index}"]`).click();
  await expect(p.getByTestId('en-show')).toHaveText(button);
  await p.getByTestId('en-show').click();
  await expect(p.getByTestId('en-show')).toHaveCount(0);
}

/** Recruits the table's left card into a gap, turned round or not. */
export async function recruit(p: Page, at: number, opts: { turn?: boolean; button?: RegExp } = {}) {
  await myTurn(p);
  await p.locator('[data-table-end="left"]').click();
  await expect(p.getByTestId('en-placing')).toBeVisible();
  if (opts.turn) await p.getByRole('button', { name: /^↻ Turn it/ }).click();
  await p.locator(`[data-gap="${at}"]`).click();
  const confirm = p.getByRole('button', { name: opts.button ?? /^Recruit it here/ });
  await confirm.click();
  await expect(p.getByTestId('en-placing')).toHaveCount(0);
}

/** Everyone taps Ready after a round's scores; the next round's flip comes up. */
export async function readyAll(pages: Page[]) {
  for (const [i, p] of pages.entries()) {
    await p.getByTestId('en-ready').click();
    if (i < pages.length - 1) await expect(p.getByTestId('en-ready')).toHaveText('✓ Ready');
  }
  for (const p of pages) await expect(p.getByTestId('en-flip-kept')).toBeVisible();
}
