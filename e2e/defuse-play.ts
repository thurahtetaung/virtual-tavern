import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';

// Shared steps for Defuse's specs.
//
// The e2e server builds every bomb from DEFUSE_TEST_SEED (playwright.config.ts). With the default
// 3 modules that bomb holds wires (black/blue/red last: cut the first wire), a keypad (press keys
// 1, 4, 3, 2 in that order) and a password (GREAT).

const ART = process.env.DEFUSE_ART;
const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  mp3: 'audio/mpeg',
  ttf: 'font/ttf',
};

/**
 * With DEFUSE_ART=<folder holding manifest.json (or the art worker's manifest-draft.json) and the
 * art>, pages get them from disk.
 */
export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/defuse', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/defuse/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/defuse\//,
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

/** The host opens a Defuse room; the others follow the link in, in seat order. */
export async function table(browser: Browser, names: string[], look: Look | Look[] = {}) {
  const lookOf = (i: number) => (Array.isArray(look) ? (look[i] ?? {}) : look);
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, lookOf(0));
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Defuse room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const [i, n] of rest.entries()) {
    const p = await visitor(browser, n, lookOf(i + 1));
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByTestId('lobby')).toContainText(`At the table (${pages.length})`);
  }
  for (const p of pages) {
    const intro = p.getByTestId('talk-intro');
    if (await intro.count()) await intro.getByRole('button', { name: 'Got it' }).click();
  }
  return pages;
}

/**
 * Shows the host's settings (folded away so the lobby fits a phone; on a phone's result screen,
 * under the Next bomb tab).
 */
export async function settings(p: Page) {
  const tab = p.getByTestId('result-tab-next');
  if (await tab.isVisible()) await tab.click();
  const panel = p.getByTestId('settings');
  await expect(panel).toBeVisible();
  if ((await panel.getAttribute('open')) === null) await p.getByTestId('settings-toggle').click();
  await expect(panel).toHaveAttribute('open', '');
}

/** Waits for the lights, so the modules take input. */
export async function lightsOn(p: Page) {
  await expect(p.getByTestId('defuser')).toBeVisible();
  await expect(p.getByTestId('lights')).toHaveCount(0, { timeout: 10_000 });
}

/** Opens a module from the bomb's faces (phone layout: through its face tab). */
export async function open(p: Page, kind: string) {
  const zoom = p.getByTestId('zoom').filter({ visible: true });
  if (await zoom.count()) await zoom.getByRole('button', { name: '◂ Bomb' }).click();
  for (const face of ['front', 'rear']) {
    const tab = p.getByTestId(`view-${face}`);
    if (await tab.isVisible()) await tab.click();
    const slot = p.locator(`[data-testid^="slot-"]:visible:has([data-kind="${kind}"])`);
    if (await slot.count()) {
      await slot.first().click();
      return p.getByTestId('zoom').filter({ visible: true });
    }
  }
  throw new Error(`no ${kind} module on the bomb`);
}

/** Defuses the test seed's bomb from the defuser's page. */
export async function defuseAll(p: Page) {
  let zoom = await open(p, 'wires');
  await zoom.getByTestId('wire-0').click();
  await expect(zoom.locator('[data-kind="wires"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(p, 'keypad');
  for (const k of [0, 3, 2, 1]) await zoom.getByTestId(`key-${k}`).click();
  await expect(zoom.locator('[data-kind="keypad"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(p, 'password');
  for (const [c, letter] of [...'GREAT'].entries()) {
    const shown = zoom.getByTestId(`pw-letter-${c}`);
    for (let i = 0; i < 6; i++) {
      const before = (await shown.textContent()) ?? '';
      if (before === letter) break;
      await zoom.getByTestId(`pw-down-${c}`).click();
      // Wait for the server's answer before reading the dial again.
      await expect(shown).not.toHaveText(before);
    }
    await expect(shown).toHaveText(letter);
  }
  await zoom.getByTestId('pw-submit').click();
}
