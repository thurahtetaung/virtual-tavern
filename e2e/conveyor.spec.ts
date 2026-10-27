import { type Locator, type Page, expect } from '@playwright/test';
import { fillerTurn, order, pick, pickTime, readyAll, settle, table } from './conveyor-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig deals known hands every round (see conveyor-play.ts).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

/** This round's running points in the player's own tray header ("12 +5 this round"). */
async function roundPoints(p: Page) {
  const text = await p.getByRole('region', { name: 'Your tray' }).getByRole('heading').innerText();
  const m = /([+−])(\d+)\s+this round/.exec(text);
  if (!m) throw new Error(`no round points in "${text}"`);
  return (m[1] === '−' ? -1 : 1) * Number(m[2]);
}

/** Whether the element is wholly inside the phone's screen as the page stands. */
async function onScreen(l: Locator) {
  const box = await l.boundingBox();
  return !!box && box.y >= 0 && box.y + box.height <= PHONE.height;
}

// At turn start on a phone, your hand and the Lock in button need no scrolling, at any table size.
for (const [players, turns] of [
  [3, 10],
  [5, 9],
  [8, 7],
] as const) {
  test(`${players} players: a phone shows the hand and Lock in at turn start`, async ({
    browser,
  }) => {
    test.setTimeout(60_000 + players * 25_000);
    await openBackroom(await visitor(browser, 'Admin'));
    const names = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal'].slice(0, players);
    const pages = await table(browser, names, { viewport: PHONE });
    const ana = pages[0]!;
    await ana.locator('[data-menu="first"]').click();
    await ana.getByRole('button', { name: 'Start the game' }).click();
    for (let turn = 1; turn <= 3; turn++) {
      await pickTime(ana, 1, turn);
      await ana.evaluate(() => {
        window.scrollTo(0, 0);
      });
      const hand = ana.getByRole('list', { name: /^Your hand/ });
      await expect.poll(() => onScreen(hand.locator('button[data-k]').first())).toBe(true);
      await expect.poll(() => onScreen(ana.getByTestId('cv-lock'))).toBe(true);
      if (process.env.SCREENSHOTS && players === 5 && turn === 2)
        for (const colorScheme of ['light', 'dark'] as const) {
          await ana.emulateMedia({ colorScheme });
          await ana.waitForTimeout(600);
          await ana.screenshot({
            path: `test-results/conveyor-shots/fit-5p-phone-${colorScheme}.png`,
          });
        }
      await fillerTurn(pages, 1, turn, turns);
    }
  });
}

test('2 players on phones: a miso clash, a menu, a special order and three rounds to the standings', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  const [ana, ben] = pages;
  // The menu for two: uramaki, onigiri, tofu, miso, menu, special order, fruit.
  await ana.locator('[data-menu="two"]').click();
  await expect(ben.getByText(/Table for two/).first()).toBeVisible();
  await ana.getByRole('button', { name: 'Start the game' }).click();

  // Turn 1: both pick a miso soup; Ben sees only that Ana has picked.
  await pickTime(ana, 1, 1);
  await pick(ana, 'miso');
  await expect(ben.getByLabel('picked', { exact: true })).toBeVisible();
  await pick(ben, 'miso');
  for (const p of pages) await expect(p.getByText(/clash!/).first()).toBeVisible();

  // Turn 2: onigiri each (hands swapped).
  await pickTime(ana, 1, 2);
  await pick(ana, 'onigiri-triangle');
  await pick(ben, 'onigiri-circle');

  // Turn 3: Ana orders from the menu; only she sees the four cards drawn.
  await pickTime(ana, 1, 3);
  await pick(ana, 'menu-7');
  await pick(ben, 'tofu');
  await expect(ben.getByText(/Ana is ordering from the/)).toBeVisible();
  await expect(ben.locator('button[data-k]')).toHaveCount(7);
  await order(ana);
  await settle(pages, 1, 3, 10);

  // Turn 4, then turn 5: Ana's special order copies her squid nigiri, worth its 3 points.
  await pick(ana, 'nigiri-squid');
  await pick(ben, 'tofu');
  await pickTime(ana, 1, 5);
  const before = await roundPoints(ana);
  await ana.locator('button[data-k="order"]').click();
  await expect(ana.locator('button[data-target-k="nigiri-squid"]')).toHaveCount(1);
  await expect(ana.locator('button[data-target-k="onigiri-triangle"]')).toHaveCount(1);
  // A used menu is never a target.
  await expect(ana.locator('button[data-target-k^="menu-"]')).toHaveCount(0);
  await expect(ana.getByTestId('cv-lock')).toHaveText('Choose what it copies');
  await ana.locator('button[data-target-k="nigiri-squid"]').click();
  await ana.getByTestId('cv-lock').click();
  await pickTime(ben, 1, 5);
  await ben.locator('button[data-k]').first().click();
  await ben.getByTestId('cv-lock').click();
  await settle(pages, 1, 5, 10);
  await expect(
    ben.getByRole('region', { name: 'Turn 5 reveal' }).getByLabel('copied'),
  ).toBeVisible();
  await expect.poll(() => roundPoints(ana)).toBe(before + 3);
  await ana.getByText('What happened').click();
  await expect(ana.getByText(/^Turn 5: Ana .+ \(as Squid nigiri\), Ben /)).toBeVisible();
  await expect(ben.getByText(/^Turn 5: Ana .+ \(as Squid nigiri\), Ben /)).toHaveCount(1);

  for (let turn = 6; turn <= 10; turn++) await fillerTurn(pages, 1, turn, 10);
  await expect(ana.getByRole('heading', { name: 'Round 1 scores' })).toBeVisible();
  await readyAll(pages);

  for (const round of [2, 3]) {
    for (let turn = 1; turn <= 10; turn++) await fillerTurn(pages, round, turn, 10);
    if (round < 3) await readyAll(pages);
  }
  await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  // Phones show the end one part at a time: the desserts are a tab.
  await ben.getByTestId('end-tabs-desserts').click();
  await expect(ben.getByText('Desserts at the end')).toBeVisible();
  await ana.getByRole('button', { name: 'Play again' }).click();
  await pickTime(ben, 1, 1);
});
