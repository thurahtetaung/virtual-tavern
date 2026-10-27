import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { type Look, openBackroom, pageErrors, unlock, visitor } from './tavern-brawl-play.ts';
import { openSettings } from './lobby-settings.ts';

// The server runs with ICONIC_TEST_WORD (playwright.config.ts): every card's first word.
const WORD = 'Paper Lantern';
const PHONE = { width: 390, height: 844 };

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/**
 * ICONIC_ART=<the private r2 folder, with manifest-draft.json> serves the real art in place of
 * asset storage (screenshots only; the test server has none).
 */
async function withArt(page: Page) {
  const art = process.env.ICONIC_ART;
  if (!art) return;
  await page.route(/\/api\/backroom\/assets\/iconic\/(.+)$/, (route) => {
    const path = new URL(route.request().url()).pathname.split('/').slice(5).join('/');
    const file = join(art, path);
    return existsSync(file) ? route.fulfill({ path: file }) : route.continue();
  });
  await page.route(/\/api\/backroom\/manifest\/iconic/, (route) =>
    route.fulfill({
      json: JSON.parse(readFileSync(join(art, 'manifest-draft.json'), 'utf8')) as object,
    }),
  );
}

/** On a wide screen the page fits the window: nothing to scroll. */
async function pageFits(p: Page) {
  await expect
    .poll(() => p.evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight))
    .toBe(true);
}

/**
 * On a wide screen the whole board fits the window: its last row is above the fold, and the
 * page doesn't scroll either.
 */
async function boardFits(p: Page) {
  const board = p.getByTestId('ic-board-full');
  await expect(board).toBeVisible();
  await expect
    .poll(() =>
      board.evaluate((el) => {
        const tiles = [...el.querySelectorAll('[data-icon], [role="img"]')];
        const bottom = Math.max(...tiles.map((t) => t.getBoundingClientRect().bottom));
        return tiles.length === 118 && bottom + window.scrollY <= window.innerHeight;
      }),
    )
    .toBe(true);
  await pageFits(p);
}

/**
 * SCREENSHOTS=1 saves a screen at phone and desktop size, light and dark, to
 * test-results/iconic-shots; `wide` adds 1280×800, 1440×900 and 1920×1080, checking the board
 * (or, for `'page'`, just the page) fits each.
 */
async function shoot(p: Page, name: string, wide: boolean | 'page' = false) {
  if (!process.env.SCREENSHOTS) return;
  const size = p.viewportSize();
  const sizes: [number, number, string][] = [
    [390, 844, 'phone'],
    [1280, 900, 'desktop'],
    ...(wide
      ? ([
          [1280, 800, 'desktop-1280x800'],
          [1440, 900, 'desktop-1440x900'],
          [1920, 1080, 'desktop-1920x1080'],
        ] as [number, number, string][])
      : []),
  ];
  for (const [w, h, device] of sizes) {
    await p.setViewportSize({ width: w, height: h });
    if (wide && w >= 1024) await (wide === 'page' ? pageFits(p) : boardFits(p));
    for (const scheme of ['light', 'dark'] as const) {
      await p.emulateMedia({ colorScheme: scheme });
      // The site switches its theme from script: wait for it before the picture.
      await expect(p.locator('html')).toHaveAttribute('data-theme', scheme);
      // Colour transitions still running from the last theme would show stale colours.
      await p.screenshot({
        path: `test-results/iconic-shots/${name}-${device}-${scheme}.png`,
        animations: 'disabled',
      });
    }
  }
  await p.emulateMedia({ colorScheme: null });
  if (size) await p.setViewportSize(size);
}

async function table(browser: Browser, names: string[], look: Look = {}) {
  const setup = { ...look, setup: withArt };
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, setup);
  await unlock(host);
  await host.getByRole('button', { name: 'Create an Iconic room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(
    rest.map(async (n) => {
      const p = await visitor(browser, n, setup);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  await expect(host.getByText(`Players (${names.length}/12)`)).toBeVisible();
  return [host, ...others];
}

const CHOOSE = 'Pick a word for the others to guess.';

/** Whoever is asked to pick the word (read from the screens, never assumed). */
async function giverOf(pages: Page[]): Promise<Page> {
  let found: Page | undefined;
  await expect
    .poll(
      async () => {
        for (const p of pages)
          if (await p.getByText(CHOOSE).count()) {
            found = p;
            return true;
          }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

/** An icon's name as the page shows it: "Icon 17", or the manifest's with ICONIC_ART. */
function iconName(n: number): string {
  const art = process.env.ICONIC_ART;
  if (!art) return `Icon ${n}`;
  const m = JSON.parse(readFileSync(join(art, 'manifest-draft.json'), 'utf8')) as {
    icons?: Record<string, { name?: string }>;
  };
  return m.icons?.[String(n)]?.name ?? `Icon ${n}`;
}

const tile = (p: Page, n: number) =>
  p.locator(`button[data-icon="${n}"]`).filter({ visible: true });
const strip = (p: Page) => p.getByTestId('ic-clue-strip');

async function chooseTestWord(giver: Page) {
  await giver.getByRole('button', { name: WORD, exact: true }).click();
  await giver.getByRole('button', { name: `Give clues for “${WORD}”` }).click();
  await expect(giver.getByTestId('ic-answer')).toHaveText(`“${WORD}”`);
}

/** On a phone, one of the two views of the clue screen. */
async function phoneTab(p: Page, which: 'Board' | 'Guesses') {
  if ((p.viewportSize()?.width ?? 1280) >= 1024) return;
  await p.getByRole('tab', { name: new RegExp(which) }).click();
}

async function guess(p: Page, text: string) {
  await phoneTab(p, 'Guesses');
  const box = p.getByLabel('Your guess');
  await box.fill(text);
  await box.press('Enter');
  await expect(box).toHaveValue('');
}

/** The giver marks a guess right, confirms, and the round reveals. */
async function award(giver: Page, text: string) {
  await phoneTab(giver, 'Guesses');
  const row = giver.getByTestId('ic-guesses').getByRole('listitem').filter({ hasText: text });
  await row.getByRole('button', { name: 'Right' }).click();
  await giver.getByRole('button', { name: 'Yes, that’s it' }).click();
}

test('one round on phones: choose, place, guess, judge, undo and reveal', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = await table(browser, ['Hana', 'Ana', 'Ben'], { viewport: PHONE });
  const [hana] = pages as [Page, Page, Page];
  // The built-in lists are picked by level (in the settings, folded on a phone).
  await openSettings(hana);
  await expect(hana.getByText('Iconic: Easy').first()).toBeVisible();
  await shoot(pages[1]!, 'lobby');
  await hana.getByRole('button', { name: 'Start the game' }).click();

  const giver = await giverOf(pages);
  const [first, second] = pages.filter((p) => p !== giver) as [Page, Page];
  const names = ['Hana', 'Ana', 'Ben'];
  const nameOf = (p: Page) => names[pages.indexOf(p)]!;
  // Only the clue giver sees the card.
  await expect(giver.getByTestId('ic-card')).toContainText(WORD);
  await expect(first.getByTestId('ic-card')).toHaveCount(0);
  await expect(first.getByText(`${nameOf(giver)} is picking a word`)).toBeVisible();
  await shoot(giver, 'choosing');
  await chooseTestWord(giver);

  // Placing: the ? marker first, then cubes (a second tap stacks), right-click takes one off.
  await phoneTab(giver, 'Board');
  await giver.getByRole('tab', { name: /Things/ }).click();
  await tile(giver, 3).click();
  await tile(giver, 5).click();
  await tile(giver, 5).click();
  await expect(strip(giver)).toContainText(iconName(3));
  await expect(strip(giver)).toContainText('×2');
  await tile(giver, 5).click({ button: 'right' });
  await expect(strip(giver)).not.toContainText('×2');
  await giver.getByRole('radio', { name: /!1/ }).click();
  await giver.getByRole('tab', { name: /Matter/ }).click();
  await tile(giver, 60).click();
  await expect(strip(giver).locator('[data-set="sub1"]')).toContainText(iconName(60));
  // Everyone reads the same clue, and nobody but the clue giver sees the word.
  for (const p of [first, second]) {
    await expect(strip(p)).toContainText(iconName(3));
    await expect(strip(p).locator('[data-set="sub1"]')).toContainText(iconName(60));
    await expect(p.getByText(WORD)).toHaveCount(0);
  }
  await expect(first.getByLabel('Your guess')).toHaveAttribute('enterkeyhint', 'send');
  await shoot(giver, 'placing', true);

  await guess(first, 'lamp');
  await phoneTab(giver, 'Guesses');
  const lamp = giver.getByTestId('ic-guesses').getByRole('listitem').filter({ hasText: 'lamp' });
  await lamp.getByRole('button', { name: 'Close' }).click();
  await expect(
    first.getByTestId('ic-guesses').getByRole('listitem').filter({ hasText: 'lamp' }),
  ).toContainText('close');
  await shoot(first, 'guessing', true);

  // A matching guess is flagged for the clue giver only, and never awarded by itself.
  await guess(second, 'the paper lanterns');
  const right = giver
    .getByTestId('ic-guesses')
    .getByRole('listitem')
    .filter({ hasText: 'the paper lanterns' });
  await expect(right).toContainText('looks right');
  await expect(second.getByText('looks right')).toHaveCount(0);
  await award(giver, 'the paper lanterns');
  await giver.getByRole('button', { name: 'Undo' }).click();
  await expect(giver.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await expect(giver.getByTestId('ic-reveal')).toHaveCount(0);
  await award(giver, 'the paper lanterns');

  for (const p of pages) {
    await expect(p.getByTestId('ic-reveal')).toContainText(`“${WORD}”`, { timeout: 15_000 });
  }
  await expect(first.getByTestId('ic-reveal')).toContainText(`${nameOf(second)} guessed it`);
  await expect(first.getByTestId('ic-reveal')).toContainText(`${nameOf(second)} +2`);
  await shoot(first, 'reveal', 'page');

  // Someone else gives the next clue (the next seat; players joined at once, so the seat order
  // isn't the order the pages opened in).
  expect(await giverOf(pages)).not.toBe(giver);
});

test('a short game, one word each, to the final standings', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = await table(browser, ['Hana', 'Ana', 'Ben'], {
    viewport: { width: 1280, height: 900 },
  });
  const [hana] = pages as [Page, Page, Page];
  await hana.getByRole('button', { name: 'One word each' }).click();
  await expect(hana.getByRole('button', { name: 'One word each' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await hana.getByRole('button', { name: 'Start the game' }).click();
  const seen = new Set<Page>();
  for (let round = 1; round <= 3; round++) {
    const giver = await giverOf(pages);
    expect(seen.has(giver)).toBe(false);
    seen.add(giver);
    await chooseTestWord(giver);
    // The whole board on a wide screen: every group at once.
    const guesser = pages.find((p) => p !== giver)!;
    await boardFits(giver);
    if (round === 1) {
      // With the first-time tips, and after they're closed.
      await boardFits(guesser);
      await guesser.getByRole('button', { name: 'Got it' }).click();
      await boardFits(guesser);
    }
    await tile(giver, 15 + round).click();
    await expect(strip(guesser)).toContainText(iconName(15 + round));
    await guess(guesser, WORD.toLowerCase());
    await award(giver, WORD.toLowerCase());
    if (round < 3) {
      await expect(guesser.getByTestId('ic-reveal')).toBeVisible({ timeout: 15_000 });
      await pageFits(guesser);
    }
  }
  for (const p of pages)
    await expect(p.getByText('Final standings')).toBeVisible({ timeout: 15_000 });
  await expect(
    hana.getByRole('status').filter({ hasText: /You win!|wins!|share the win/ }),
  ).toBeVisible();
  await expect(hana.getByText('Every word')).toBeVisible();
  await shoot(pages[1]!, 'standings');
});
