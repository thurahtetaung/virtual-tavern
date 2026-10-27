import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Locator, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';
import { openSettings } from './lobby-settings.ts';

// Shared steps for Conveyor's specs: a room, picks, the menu and the special order.
//
// The e2e server's rig (CONVEYOR_TEST_DECK in playwright.config.ts) deals the same hands every
// round with 2 players: hand A to Ana, hand B to Ben, and they swap each turn:
//   A: miso, onigiri ●, menu, tofu, special order, uramaki ×4, egg nigiri, uramaki ×3, tofu,
//      onigiri ■
//   B: miso, onigiri ▲, tofu, squid nigiri, uramaki ×4, egg nigiri, salmon nigiri, onigiri ▬, tofu,
//      uramaki ×5
// (Desserts aren't rigged: which ones join the deck each round is drawn.)

const ART = process.env.CONVEYOR_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/** With CONVEYOR_ART=<folder holding manifest.json and the art>, pages get them from disk. */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/conveyor', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8');
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/conveyor/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/conveyor\//,
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

/** The host opens a Conveyor room; the others follow the link in one at a time (seat order). */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Conveyor room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const n of rest) {
    const p = await visitor(browser, n, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`Players (${pages.length}/8)`)).toBeVisible();
  }
  // On a phone the host's settings start folded.
  await openSettings(host);
  return pages;
}

/** Selects a card unless it already is (a second tap would put it back). */
async function choose(card: Locator) {
  if ((await card.getAttribute('aria-pressed')) !== 'true') await card.click();
}

/** Waits until this player is asked to pick on turn `turn` of round `round`. */
export const pickTime = (p: Page, round: number, turn: number) =>
  expect(p.getByText(new RegExp(`^Round ${round} of 3, turn ${turn} of \\d+: pick`))).toBeVisible();

/** Taps the card (by variant) and locks it in, with the special order's target if given. */
export async function pick(p: Page, k: string, target?: string) {
  await choose(p.locator(`button[data-k="${k}"]`).first());
  if (target) await p.locator(`button[data-target-k="${target}"]`).first().click();
  await p.getByTestId('cv-lock').click();
}

/**
 * Any card that needs no choice (the first plain one; else whatever is left, copying the first
 * card it may), locked in.
 */
export async function pickAny(p: Page) {
  const cards = p.locator('button[data-k]');
  await expect(cards.first()).toBeVisible();
  const ks = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-k') ?? ''));
  const i = ks.findIndex((k) => k !== 'order' && !k.startsWith('menu-'));
  await choose(cards.nth(i < 0 ? 0 : i));
  const target = p.locator('button[data-target-k]');
  if (await target.count()) await target.first().click();
  await p.getByTestId('cv-lock').click();
}

/** The menu's four cards: plays the first that isn't a menu. */
export async function order(p: Page) {
  await expect(p.getByText(MENU)).toBeVisible();
  const cards = p.locator('button[data-k]');
  const ks = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-k') ?? ''));
  await choose(cards.nth(ks.findIndex((k) => !k.startsWith('menu-'))));
  const target = p.locator('button[data-target-k]');
  if (await target.count()) await target.first().click();
  await p.getByTestId('cv-lock').click();
  // The table moves on before the next look for a menu.
  await expect(p.getByText(MENU)).toHaveCount(0);
}

const MENU = /: play one of the four cards drawn\./;

/**
 * A whole turn of filler picks: each player picks in turn, then any menu that comes up is ordered
 * from, until the next turn (or the round's scores, or the end) is on everyone's screen.
 */
export async function fillerTurn(pages: Page[], round: number, turn: number, turns: number) {
  for (const p of pages) {
    await pickTime(p, round, turn);
    await pickAny(p);
  }
  await settle(pages, round, turn, turns);
}

/** Orders from any menu that comes up until the table has moved on. */
export async function settle(pages: Page[], round: number, turn: number, turns: number) {
  const next =
    turn < turns
      ? new RegExp(`^Round ${round} of 3, turn ${turn + 1} of`)
      : round < 3
        ? new RegExp(`^Round ${round} of 3 is scored`)
        : /wins? with|share the win/;
  for (;;) {
    let menu = -1;
    await expect
      .poll(async () => {
        for (const [i, p] of pages.entries())
          if (await p.getByText(MENU).count()) {
            menu = i;
            return 'menu';
          }
        for (const p of pages) if (!(await p.getByText(next).count())) return 'waiting';
        return 'next';
      })
      .not.toBe('waiting');
    if (menu < 0) return;
    await order(pages[menu]!);
  }
}

/** Everyone taps Ready after a round's scores. */
export async function readyAll(pages: Page[]) {
  for (const p of pages) await p.getByRole('button', { name: 'Ready', exact: true }).click();
}
