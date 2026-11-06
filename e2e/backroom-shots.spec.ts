import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom } from './tavern-brawl-play.ts';
import { TEST_BACKROOM_WORD } from './credentials.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/backroom-shots.spec.ts
// With BACKROOM_COVERS=<folder holding r2-manifests/<id>/manifest.json and r2/<id>/cover*.webp>
// the lobby gets each game's manifest and cover from disk; without it, every card shows its emblem.
// SHOTS_DIR picks where the pictures go (default test-results/shots/backroom).
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const COVERS = process.env.BACKROOM_COVERS;
const OUT = process.env.SHOTS_DIR ?? 'test-results/shots/backroom';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1440, height: 900 };

let nextIp = 1;
async function visitor(
  browser: Browser,
  viewport: { width: number; height: number },
  colorScheme: 'light' | 'dark',
) {
  const context = await browser.newContext({
    viewport,
    colorScheme,
    isMobile: viewport.width < 500,
    hasTouch: viewport.width < 500,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.44.0.${nextIp++}` },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem('vt.playerName', 'Hana');
  });
  if (COVERS) await localCovers(page, COVERS);
  return page;
}

/** Every back-room manifest and cover from disk. */
async function localCovers(page: Page, dir: string) {
  await page.route('**/api/backroom/manifest/*', async (route) => {
    const id = new URL(route.request().url()).pathname.split('/').pop()!;
    try {
      const file = await readFile(join(dir, 'r2-manifests', id, 'manifest.json'), 'utf8');
      await route.fulfill({ json: JSON.parse(file) as unknown });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
  await page.route('**/api/backroom/assets/*/cover*.webp', async (route) => {
    const [, id, file] = /\/assets\/([^/]+)\/([^/?]+)/.exec(route.request().url())!;
    try {
      await route.fulfill({
        body: await readFile(join(dir, 'r2', id!, file!)),
        contentType: 'image/webp',
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}

async function knock(page: Page) {
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
  await expect(page.getByRole('region', { name: 'Back room games' })).toBeVisible();
}

/** Scrolls the whole page so every lazy cover loads, then waits for them. */
async function allCovers(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('[data-ui="game-card"] img')].every(
          (img) => img.complete,
        ),
      ),
    )
    .toBe(true);
}

test('back room door and lobby screenshots', async ({ browser }) => {
  test.setTimeout(240_000);
  const admin = await browser.newPage();
  await openBackroom(admin);
  for (const [size, viewport] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    for (const scheme of ['light', 'dark'] as const) {
      const page = await visitor(browser, viewport, scheme);
      const name = `${size}-${scheme}`;
      await page.goto('/backroom');
      await expect(page.getByLabel('The word')).toBeVisible();
      await page.screenshot({ path: `${OUT}/door--${name}.png` });
      await page.getByLabel('The word').fill('please');
      await page.getByRole('button', { name: 'Knock' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      await page.screenshot({ path: `${OUT}/door-refused--${name}.png` });
      await page.getByLabel('The word').fill('');
      await knock(page);
      await allCovers(page);
      await page.screenshot({ path: `${OUT}/lobby--${name}.png` });
      await page.screenshot({ path: `${OUT}/lobby-full--${name}.png`, fullPage: true });
      await page.context().close();
    }
  }
});

test("every back-room game's lobby (phone, dark)", async ({ browser }) => {
  test.setTimeout(600_000);
  const admin = await browser.newPage();
  await openBackroom(admin);
  const page = await visitor(browser, PHONE, 'dark');
  await page.goto('/backroom');
  await knock(page);
  const buttons = page.getByRole('button', { name: /^Create an? .* room$/ });
  await expect(buttons.first()).toBeVisible();
  const labels = await buttons.evaluateAll((all) => all.map((b) => b.getAttribute('aria-label')!));
  for (const label of labels) {
    await page.goto('/backroom');
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page).toHaveURL(/\/r\//);
    // The room is in the back room: its deeper surfaces.
    await expect(page.locator('html')).toHaveAttribute('data-room', 'back');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const id = label.replace(/^Create an? /, '').replace(/ room$/, '');
    await page.screenshot({ path: `${OUT}/room--${id.replace(/\W+/g, '-').toLowerCase()}.png` });
  }
  await page.context().close();
});
