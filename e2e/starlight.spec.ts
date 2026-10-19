import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD } from './credentials.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  // The back-room knock is rate-limited per address, so each browser gets its own.
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.7.0.${nextIp++}` },
  });
  await withArt(context);
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

/**
 * STARLIGHT_ART=<folder with cards/ and components/ and manifest.json> serves the private art in
 * place of asset storage (screenshots only; the test server has none).
 */
async function withArt(context: BrowserContext) {
  const art = process.env.STARLIGHT_ART;
  if (!art) return;
  const file = (path: string) => join(art, path);
  await context.route(/\/api\/backroom\/assets\/(reverie|starlight)\/(.+)$/, (route) => {
    const path = new URL(route.request().url()).pathname.split('/').slice(5).join('/');
    return existsSync(file(path)) ? route.fulfill({ path: file(path) }) : route.continue();
  });
  await context.route(/\/api\/backroom\/manifest\/starlight/, (route) =>
    route.fulfill({ json: JSON.parse(readFileSync(file('manifest.json'), 'utf8')) as object }),
  );
  await context.route(/\/api\/backroom\/manifest\/reverie/, (route) =>
    route.fulfill({ json: { sets: [{ id: 'stellar', name: 'Starlight cards' }] } }),
  );
}

async function openBackroom(page: Page) {
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
}

async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

/**
 * SCREENSHOTS=1 saves each main screen at phone and desktop size, light and dark, to
 * test-results/starlight-shots.
 */
async function shoot(p: Page, name: string, phoneTab?: string) {
  if (!process.env.SCREENSHOTS) return;
  const size = p.viewportSize();
  for (const [w, h, device] of [
    [390, 844, 'phone'],
    [1280, 900, 'desktop'],
  ] as const) {
    await p.setViewportSize({ width: w, height: h });
    if (phoneTab && device === 'phone') await p.getByRole('button', { name: phoneTab }).click();
    for (const scheme of ['light', 'dark'] as const) {
      await p.emulateMedia({ colorScheme: scheme });
      await p.screenshot({ path: `test-results/starlight-shots/${name}-${device}-${scheme}.png` });
    }
  }
  await p.emulateMedia({ colorScheme: null });
  if (phoneTab) {
    await p.setViewportSize({ width: 390, height: 844 });
    await p.getByRole('button', { name: '🖼️ Table' }).click();
  }
  if (size) await p.setViewportSize(size);
}

const LIST = 'Starlight test cards';
/** Made-up entries written as a printed card's two words: each side is a word of its own. */
const WORDS = ['Moon / Tide', 'Lantern / Harbour', 'Velvet / Thunder', 'Honey / Clock'];

const card = (p: Page, pos: string) =>
  p.getByRole('button', { name: new RegExp(`^Card ${pos}\\b`) });

/** Each player marks their cards (by grid name) and locks. */
async function markAndLock(marks: [Page, string[]][]) {
  for (const [p, cards] of marks) {
    for (const c of cards) {
      await card(p, c).click();
      await expect(card(p, c)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(p.getByTestId('starlight-count')).toContainText(`${cards.length} marked`);
    await p.getByRole('button', { name: 'Lock my slate' }).click();
  }
}

/** Plays the Reveal: whoever is the Scout shows their first unshown mark, until it's scored. */
async function reveal(host: Page, players: Page[], shots = false) {
  const results = host.getByTestId('starlight-results');
  for (let shows = 0; shows < 40; shows++) {
    if (await results.isVisible()) return;
    let scout: Page | undefined;
    await expect
      .poll(async () => {
        if (await results.isVisible()) return 'done';
        for (const p of players)
          if (await p.getByText('You’re the Scout').count()) {
            scout = p;
            return 'scout';
          }
        return 'none';
      })
      .not.toBe('none');
    if (!scout || (await results.isVisible())) return;
    const moment = host.getByTestId('starlight-moment');
    const before = (await moment.count()) ? await moment.textContent() : null;
    // The marked cards not shown yet are the ones whose label has no outcome.
    const mine = scout.getByRole('button', { name: /^Card [A-E][1-3], marked$/ });
    if (shots && shows === 1) await shoot(scout, 'scout');
    await mine.first().click();
    const dialog = scout.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Show this card' }).click();
    await expect(dialog).toBeHidden();
    await expect
      .poll(async () =>
        (await results.isVisible())
          ? 'moved'
          : ((await moment.count()) ? await moment.textContent() : null) !== before
            ? 'moved'
            : 'waiting',
      )
      .toBe('moved');
    scout = undefined;
  }
  throw new Error('the Reveal never ended');
}

test('four friends play a whole game of Starlight in the back room', async ({ browser }) => {
  test.setTimeout(180_000);
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const created = await admin.request.post('/api/admin/word-lists', {
    data: { name: LIST, words: WORDS, games: ['starlight'] },
  });
  expect(created.ok()).toBe(true);
  const listId = ((await created.json()) as { id: string }).id;
  try {
    // A browser without the back room never sees the list, or that a back-room game has lists.
    const stranger = await visitor(browser, 'Stranger');
    await stranger.goto('/');
    expect(await (await stranger.request.get('/api/word-lists?game=starlight')).json()).toEqual([]);
    expect(await (await stranger.request.get('/api/word-lists')).text()).not.toMatch(
      /Starlight test cards|starlight/,
    );

    const host = await visitor(browser, 'Hana');
    await unlock(host);
    await host.getByRole('button', { name: 'Create a Starlight room' }).click();
    await expect(host).toHaveURL(/\/r\//);
    const url = host.url();
    const others = await Promise.all(
      ['Ana', 'Ben', 'Cy'].map(async (n) => {
        const p = await visitor(browser, n);
        await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
        await expect(p).toHaveURL(url);
        return p;
      }),
    );
    const players = [host, ...others];
    await expect(host.getByText('Players (4/6)')).toBeVisible();
    // The game's own list comes first, so the room starts on it.
    await expect(host.getByText(LIST).first()).toBeVisible();
    await shoot(others[0]!, 'lobby');
    // The game's own cards are the default set, and the picker offers every set.
    await expect(host.getByText('Starlight cards').first()).toBeVisible();
    if (process.env.SCREENSHOTS) {
      await host.getByRole('button', { name: 'Change card sets' }).click();
      await shoot(host, 'card-sets');
      await host.keyboard.press('Escape');
      await expect(host.getByRole('dialog')).toBeHidden();
    }
    await host.getByRole('button', { name: 'Start game' }).click();

    for (let round = 1; round <= 4; round++) {
      const roman = ['I', 'II', 'III', 'IV'][round - 1]!;
      await expect(host.getByText(`Round ${roman} of 4`)).toBeVisible();
      // One plain word for everyone, never the pair, and nobody is asked to choose.
      const word = (
        (await host.getByTestId('starlight-word').locator('b').textContent()) ?? ''
      ).trim();
      expect(WORDS.flatMap((w) => w.split(' / '))).toContain(word);
      for (const p of players) {
        await expect(p.getByTestId('starlight-word').locator('b')).toHaveText(word);
        await expect(p.getByRole('button', { name: /^Flip to|^Play “/ })).toHaveCount(0);
      }
      if (round === 1) await shoot(others[0]!, 'round-start');

      if (round === 1) {
        // Everyone shares A1; Hana and Ana alone share B1 (a Super-Spark); Ben alone has C1.
        const [hana, ana, ben, cy] = players as [Page, Page, Page, Page];
        await card(hana, 'A1').click();
        await card(hana, 'A1').click();
        await expect(card(hana, 'A1')).toHaveAttribute('aria-pressed', 'false');
        await markAndLock([
          [hana, ['A1', 'B1']],
          [ana, ['A1', 'B1']],
          [ben, ['A1', 'C1']],
        ]);
        // Ben can still change his mind until the last slate is locked.
        await ben.getByRole('button', { name: 'Unlock to change' }).click();
        await expect(ben.getByRole('button', { name: 'Lock my slate' })).toBeVisible();
        await ben.getByRole('button', { name: 'Lock my slate' }).click();
        await card(cy, 'A1').click();
        await shoot(cy, 'marking');
        await card(cy, 'A1').click();
        await markAndLock([[cy, ['A1']]]);
        // The counts are public: nobody leads alone with 2 (three players tie), so nobody is in
        // the Dark.
        await expect(host.getByTestId('starlight-dark')).toContainText('Nobody is in the Dark');
      } else if (round === 2) {
        // Hana alone marks two: she is in the Dark, and her second card can only fall.
        const [hana, ...rest] = players as [Page, ...Page[]];
        await markAndLock([
          [hana, ['A1', 'B1']],
          ...rest.map((p) => [p, ['A1']] as [Page, string[]]),
        ]);
        for (const p of players)
          await expect(p.getByTestId('starlight-dark')).toContainText(
            p === hana ? 'You are in the Dark' : 'Hana is in the Dark',
          );
        await shoot(rest[0]!, 'dark', '⭐ Stars');
      } else {
        await markAndLock(players.map((p) => [p, ['A1']] as [Page, string[]]));
      }
      await reveal(host, players, round === 1);
      const results = host.getByTestId('starlight-results');
      await expect(results).toBeVisible();
      if (round === 1) {
        await expect(results).toContainText('1 ✨ · 1 🌟 · 1 🌠');
        await shoot(host, 'round-scored');
      } else if (round === 2) {
        await expect(results).toContainText('1 ✨ · 0 🌟 · 1 🌠');
        await expect(results).toContainText('(fell in the Dark)');
      } else {
        await expect(results).toContainText('1 ✨ · 0 🌟 · 0 🌠');
      }
      await host
        .getByRole('button', { name: round === 4 ? 'See final scores' : 'Next round' })
        .click();
    }
    await expect(host.getByText('Final standings')).toBeVisible();
    for (const p of others) await expect(p.getByText('Final standings')).toBeVisible();
    await shoot(others[1]!, 'final');
  } finally {
    await admin.request.delete(`/api/admin/word-lists/${listId}`);
  }
});
