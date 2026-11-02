import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { openSettings } from './lobby-settings.ts';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Red Herring's specs: a room, the word, card plays, explanations and votes.
//
// The e2e server's rig (RED_HERRING_TEST_DEAL=2 in playwright.config.ts) deals the cards in number
// order (the first seat holds 1–6, the second 7–12…), the first seat picks the first word and the
// word-picker passes to the left each round, and the Conspirator always sits two seats after the
// word-picker. So in a 4-player game the Conspirator of round k is the seat k + 1 (mod 4).

const ART = process.env.RED_HERRING_ART;
const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
};

/**
 * With RED_HERRING_ART=<folder holding manifest.json (or manifest-draft.json) and the art>, pages
 * get them from disk.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/red-herring', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/red-herring/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/red-herring\//,
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

/** The host opens a Red Herring room; the others follow the link in, in seat order. */
export async function table(browser: Browser, names: string[], look: Look | Look[] = {}) {
  const lookOf = (i: number) => (Array.isArray(look) ? (look[i] ?? {}) : look);
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, lookOf(0));
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Red Herring room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const [i, n] of rest.entries()) {
    const p = await visitor(browser, n, lookOf(i + 1));
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Players (${pages.length}/10)`)).toBeVisible();
  }
  await openSettings(host);
  return pages;
}

/** Plays the first card of `p`'s hand (it must be their turn). */
export async function playCard(p: Page) {
  const hand = p.getByTestId('rh-hand');
  await expect(hand).toContainText('tap a card to look, then play it');
  await hand.locator('button[data-card]').first().click();
  await p.getByRole('button', { name: 'Play this card' }).click();
  await expect(p.getByRole('button', { name: 'Play this card' })).toHaveCount(0);
}

/** The word-picker plays a card and writes the word. */
export async function writeWord(p: Page, word: string) {
  await playCard(p);
  await p.getByLabel('Your secret word').fill(word);
  await p.getByRole('button', { name: 'Send' }).click();
  await expect(p.getByTestId('rh-word-form')).toHaveCount(0);
}

/** What `p`'s notebook says (opened with Show, closed again). */
export async function notebook(p: Page): Promise<string> {
  await p.getByRole('button', { name: 'Show your notebook' }).click();
  const page = p.getByTestId('rh-notebook-page');
  await expect(page.getByTestId('rh-word').or(page.getByTestId('rh-conspirator'))).toBeVisible();
  // The Conspirator's page has no word.
  const word = (await page.getByTestId('rh-word').count())
    ? ((await page.getByTestId('rh-word').textContent()) ?? '')
    : '';
  await p.getByRole('button', { name: 'Hide your notebook' }).click();
  return word.trim();
}

/** `order[i]` explains, everyone in turn, then the host starts the vote. */
export async function explainAll(order: Page[], host: Page) {
  for (const p of order) {
    await expect(p.getByTestId('rh-spotlight')).toContainText('You explain');
    await p.getByRole('button', { name: 'Done', exact: true }).click();
  }
  await host.getByRole('button', { name: 'Start the vote' }).click();
}

/** `p` accuses `name` and confirms. */
export async function accuse(p: Page, name: string) {
  await p.getByRole('button', { name: `Accuse ${name}` }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Accuse' }).click();
  // The last vote turns the ballot into the reveal.
  await expect(p.getByText(`You voted for ${name}.`).or(p.getByTestId('rh-reveal'))).toBeVisible();
}

/** Every player plays both cards, in round order (the word-picker's first card is down). */
export async function playLaps(order: Page[]) {
  for (const p of [...order.slice(1), ...order]) await playCard(p);
}

/** Pages in round order: the word-picker first, then clockwise. */
export const roundOrder = (pages: Page[], picker: number) => [
  ...pages.slice(picker),
  ...pages.slice(0, picker),
];
