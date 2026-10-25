import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';

// Screenshots of every game's guide (rules page and in-room drawer; phone and desktop; light and
// dark): `SCREENSHOTS=1 pnpm exec playwright test e2e/guide-shots.spec.ts`. Shots land in
// test-results/shots/guides. `GUIDE_SHOTS=nightfall,echo` limits the games. `GUIDE_ART` may name
// a private JSON file mapping game ids to local art folders (each with its `manifest.json`), which
// the browser is then served in place of asset storage. Never committed.

test.skip(!process.env.SCREENSHOTS, 'screenshots only on request');
test.setTimeout(600_000);

const PUBLIC = ['codenames', 'enigma', 'echo', 'masquerade', 'round-table'];
const PRIVATE = [
  'reverie',
  'hoodwink',
  'royal-post',
  'masquerade-originals',
  'nightfall',
  'inquest',
  'seance',
  'hydra',
  'hogwarts',
  'tavern-brawl',
  'short-fuse',
  'thorns',
  'iconic',
  'stampede',
  'jeweller',
];
const only = (process.env.GUIDE_SHOTS ?? '').split(',').filter(Boolean);
const games = [...PUBLIC, ...PRIVATE].filter((g) => !only.length || only.includes(g));
const OUT = 'test-results/shots/guides';

const art: Record<string, string> = process.env.GUIDE_ART
  ? (JSON.parse(readFileSync(process.env.GUIDE_ART, 'utf8')) as Record<string, string>)
  : {};

const TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  svg: 'image/svg+xml',
};

async function previewArt(page: Page) {
  for (const [id, dir] of Object.entries(art)) {
    if (!existsSync(join(dir, 'manifest.json'))) continue;
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as unknown;
    await page.route(`**/api/backroom/manifest/${id}`, (r) => r.fulfill({ json: manifest }));
    await page.route(`**/api/backroom/assets/${id}/**`, (r) => {
      const path = decodeURIComponent(
        new URL(r.request().url()).pathname.slice(`/api/backroom/assets/${id}/`.length),
      );
      const file = join(dir, path);
      return !path.includes('..') && existsSync(file) && statSync(file).isFile()
        ? r.fulfill({
            body: readFileSync(file),
            contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
          })
        : r.fulfill({ status: 404 });
    });
  }
}

const LOOKS = [
  { name: 'phone', viewport: { width: 390, height: 844 } },
  { name: 'desktop', viewport: { width: 1280, height: 860 } },
] as const;

let ip = 1;
async function visitor(browser: Browser, look: (typeof LOOKS)[number], scheme: 'light' | 'dark') {
  const context = await browser.newContext({
    viewport: look.viewport,
    isMobile: look.name === 'phone',
    hasTouch: look.name === 'phone',
    colorScheme: scheme,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.77.0.${(ip++ % 250) + 1}` },
  });
  const page = await context.newPage();
  await previewArt(page);
  await page.addInitScript(() => {
    localStorage.setItem('vt.playerName', 'Hana');
    // The first-time lobby intro shows in every room here (the suite marks it seen).
    for (const k of Object.keys(localStorage))
      if (k.startsWith('vt.guide.intro.')) localStorage.removeItem(k);
  });
  return page;
}

async function unlock(page: Page) {
  await page.goto('/backroom');
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
  await expect(page.getByLabel('The word')).toHaveCount(0);
}

async function tabs(page: Page, prefix: string, scope: Page | ReturnType<Page['locator']>) {
  const shoot = async (name: string) => {
    // Lazy art loads once it scrolls into view.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
  };
  await shoot('learn');
  const tablist = scope.getByRole('tablist', { name: 'Guide' });
  const names = await tablist.getByRole('tab').allInnerTexts();
  for (const [i, label] of names.entries()) {
    if (i === 0) continue;
    await tablist.getByRole('tab').nth(i).click();
    await shoot(i === names.length - 1 ? 'ref' : i === names.length - 2 ? 'rules' : 'tiles');
    if (i === 1 && names.length === 4) {
      // The first tile's sheet.
      await scope.getByRole('tabpanel').getByRole('listitem').first().getByRole('button').click();
      await expect(page.getByTestId('guide-sheet')).toBeVisible();
      await shoot('sheet');
      await page
        .getByTestId('guide-sheet')
        .locator('xpath=ancestor::dialog[1]')
        .getByRole('button', { name: 'Close' })
        .first()
        .click();
      await expect(page.getByTestId('guide-sheet')).toHaveCount(0);
    }
    void label;
  }
}

test.beforeAll(async ({ browser }) => {
  const admin = await (await browser.newContext()).newPage();
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
});

for (const look of LOOKS)
  for (const scheme of ['light', 'dark'] as const)
    test(`guides: ${look.name} ${scheme}`, async ({ browser }) => {
      const page = await visitor(browser, look, scheme);
      await unlock(page);
      for (const id of games) {
        await page.goto(`/rules/${id}`);
        await expect(page.getByRole('tablist', { name: 'Guide' })).toBeVisible();
        // The named guide (manifest words and art) loads after the plain one.
        await page.waitForTimeout(600);
        await tabs(page, `${id}-${look.name}-${scheme}`, page);
        // The drawer in a fresh room's lobby.
        if (look.name === 'phone') {
          await page.goto(`/rules/${id}`);
          await page
            .getByRole('button', { name: /^Create an? .* room$/ })
            .last()
            .click();
          await expect(page).toHaveURL(/\/r\//);
          const intro = page.getByRole('region', { name: /^New to / });
          await expect(intro).toBeVisible();
          await page.screenshot({ path: `${OUT}/${id}-${look.name}-${scheme}-lobby-intro.png` });
          await intro.getByRole('button', { name: 'Skip' }).click();
          await page.getByRole('button', { name: 'Rules', exact: true }).click();
          const drawer = page.getByRole('dialog');
          await expect(drawer.getByRole('tablist', { name: 'Guide' })).toBeVisible();
          await page.waitForTimeout(300);
          await tabs(page, `${id}-${look.name}-${scheme}-drawer`, drawer);
        }
      }
    });

// A dealt Nightfall game: the drawer's "You are" card, the cards in play and the wake order.
for (const scheme of ['light', 'dark'] as const)
  test(`Nightfall in a game: phone ${scheme}`, async ({ browser }) => {
    test.skip(only.length > 0 && !only.includes('nightfall'));
    const look = LOOKS[0];
    const host = await visitor(browser, look, scheme);
    await unlock(host);
    await host.goto('/rules/nightfall');
    await host
      .getByRole('button', { name: /^Create an? .* room$/ })
      .last()
      .click();
    await expect(host).toHaveURL(/\/r\//);
    const path = new URL(host.url()).pathname;
    for (const name of ['Ana', 'Ben']) {
      const p = await visitor(browser, look, scheme);
      await p.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
      await unlock(p);
      await p.goto(path);
    }
    await expect(host.getByText('Players (3/10)')).toBeVisible();
    await host
      .getByRole('region', { name: /^New to / })
      .getByRole('button', { name: 'Skip' })
      .click();
    await host.getByRole('button', { name: 'Deal the cards' }).click();
    await host.getByRole('button', { name: '👁️ Show your card' }).click();
    await host.getByRole('button', { name: 'Rules', exact: true }).click();
    const drawer = host.getByRole('dialog');
    // The role is hidden until the viewer holds the peek.
    const hidden = drawer.getByRole('button', { name: 'Hold to see my role' });
    await expect(hidden).toBeVisible();
    await hidden.hover();
    await host.mouse.down();
    await expect(drawer.getByRole('region', { name: 'You are' })).toBeVisible();
    await host.waitForTimeout(500);
    await host.screenshot({ path: `${OUT}/nightfall-room-phone-${scheme}-you.png` });
    await host.mouse.up();
    await tabs(host, `nightfall-room-phone-${scheme}`, drawer);
    await drawer.getByRole('tab', { name: 'Rules' }).click();
    await drawer.getByText('Wake order in this game').scrollIntoViewIfNeeded();
    await host.screenshot({ path: `${OUT}/nightfall-room-phone-${scheme}-wake.png` });
  });
