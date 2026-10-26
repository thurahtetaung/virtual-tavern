import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { YOUR_TURN, option, pick, place, sheet, table, take } from './mosaic-play.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig (playwright.config.ts): the first seat starts; the factories hold
// blue blue yellow yellow / red ×4 / black ×4 / light blue ×4 / yellow ×4; and the first seat's
// top wall row has every colour but blue, so a blue in line 1 ends the game after this round.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('a 2-player game on phones: the pick sheet, the marker, an Ouch, the wall-tiling and the end', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Two blues: the sheet says line 1 fills with one spilling, and what is left behind.
  await pick(hana, 'blue', 1);
  const line1 = sheet(hana).locator('button[data-target="0"]');
  await expect(line1).toContainText('1 here, fills it ✓; 1 spill to the floor');
  await expect(line1).toContainText('+5 at round end');
  await expect(sheet(hana).getByTestId('mo-leaves')).toContainText('Leaves 2 yellow → centre.');
  await place(hana, 1);
  await expect(
    hana.getByRole('region', { name: 'Your board' }).getByLabel(/^Floor: 1 of 7/),
  ).toBeVisible();

  await take(ana, 'red', 2, 4);
  await take(hana, 'black', 3, 4);
  await take(ana, 'light blue', 4, 5);

  // Four yellows on the floor: the sheet warns, and everyone sees the Ouch.
  await pick(hana, 'yellow', 5);
  await sheet(hana).locator('button[data-target="floor"]').click();
  await expect(sheet(hana).getByText(/That spills 4 tiles; line 5 would spill 0\./)).toBeVisible();
  await sheet(hana).getByTestId('mo-place').click();
  await expect(ana.getByTestId('mo-ouch')).toHaveText(/Ouch: Hana ate -7!/);

  // The centre's yellows bring the first-player marker with them.
  await pick(ana, 'yellow', 'centre');
  await expect(sheet(ana).getByText(/\+ the first-player marker/)).toBeVisible();
  await place(ana, 2);

  // The round's wall-tiling ends the game: Hana's top row is full.
  for (const p of [hana, ana]) await expect(p.getByTestId('mo-tiling')).toBeVisible();
  await expect(hana.getByText('You win with 2 points!')).toBeVisible();
  await expect(ana.getByText('Hana wins with 2 points!')).toBeVisible();
  await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await expect(hana.getByTestId('mo-bonus').first()).toContainText('Rows 1 × 2', {
    timeout: 10_000,
  });
  await hana.getByRole('button', { name: 'Play again' }).click();
  await expect(hana.getByText(YOUR_TURN)).toBeVisible();
});

// The wave 2 options, one game each on the same rig.

test('the grey wall: full lines wait for their owner to pick a lit space, and a line with none falls', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await option(hana, 'mo-grey');
  await hana.getByRole('button', { name: 'Start the game' }).click();

  await take(hana, 'blue', 1, 1);
  await take(ana, 'red', 2, 2);
  // The rig leaves row 4 no space for a black: its free spaces sit under blacks. The sheet says so.
  await pick(hana, 'black', 3);
  await expect(sheet(hana).locator('button[data-target="3"]')).toContainText(
    'no wall space left: it would fall to the floor',
  );
  await place(hana, 4);
  await take(ana, 'light blue', 4, 5);
  await take(hana, 'yellow', 5, 5);
  await take(ana, 'yellow', 'centre', 3);

  // Hana's blue has one space left in its row; Ana's red line has several.
  const choice = ana.getByTestId('mo-wall-choice');
  await expect(choice).toContainText('Line 2');
  await choice.locator('[data-cell="1:4"] button').click();
  await ana.getByTestId('mo-wall-place').click();

  // Hana's blacks fall: the tiling says why, and her floor costs the spilled blue and four blacks.
  await expect(hana.getByTestId('mo-tiling-note').first()).toContainText(
    'Line 4 had no legal wall space: its tiles fell to the floor.',
    { timeout: 10_000 },
  );
  await expect(
    hana
      .locator('[data-tiling]')
      .getByRole('img', { name: /^Floor: \d of 7, -8 points$/ })
      .first(),
  ).toBeVisible();
  await expect(hana.getByText('You win with 2 points!')).toBeVisible();
  await expect(
    ana.locator('[data-tiling]').getByRole('img', { name: 'red, row 2' }).first(),
  ).toBeVisible();
});

test('jokers: a joker alone fills a line and goes to the wall in its place; real tiles still complete a colour', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await option(hana, 'mo-jokers');
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Picking the joker offers it alone or with the blue beside it.
  await pick(hana, 'joker', 1);
  const choices = sheet(hana).getByTestId('mo-jokers');
  await expect(choices.getByRole('radio', { name: '1 joker alone' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(choices.getByRole('radio', { name: 'jokers + 1 blue' })).toBeVisible();
  await place(hana, 1);
  await expect(
    hana.getByRole('img', { name: 'Line 1: 1 of 1 with 1 joker' }).first(),
  ).toBeVisible();

  await take(ana, 'red', 2, 4);
  await take(hana, 'black', 3, 4);
  await take(ana, 'light blue', 4, 5);
  // The rig has yellows on rows 3 to 5: two in line 2 complete the colour with real tiles.
  await take(hana, 'yellow', 5, 2);
  await take(ana, 'yellow', 'centre', 3);
  await take(hana, 'blue', 'centre', 3);

  // The joker takes the row's last space: the row is full, but it is no colour; yellow is.
  await expect(hana.getByText('You win with 18 points!')).toBeVisible();
  await expect(hana.getByRole('img', { name: 'joker, row 1' }).first()).toBeVisible();
  await expect(hana.getByTestId('mo-bonus').first()).toContainText('Colours 1 × 10', {
    timeout: 10_000,
  });
});

test('special factories: leftovers sent to a neighbour, and a floor shield', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await option(hana, 'mo-specials');
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Factory 1 sends its leftovers on: the yellows go right, to factory 2.
  await pick(hana, 'blue', 1);
  await expect(sheet(hana).getByTestId('mo-special-note')).toContainText('left and right');
  await sheet(hana).getByTestId('mo-split').locator('[data-side="right"]').click();
  await expect(sheet(hana).getByTestId('mo-leaves')).toContainText('Sends 2 yellow right.');
  await place(hana, 1);
  await expect(ana.locator('[data-factory="1"]')).toHaveAttribute('aria-label', /yellow, yellow/);

  await take(ana, 'red', 2, 4);
  // Factory 3 is the floor shield: Hana keeps it for the round.
  await take(hana, 'black', 3, 4);
  await expect(hana.getByRole('img', { name: 'Floor shield: empty' }).first()).toBeVisible();
  await expect(ana.locator('[data-factory="2"]')).toHaveAttribute(
    'aria-label',
    /Hana’s floor shield/,
  );
  await take(ana, 'light blue', 4, 5);
  await take(hana, 'yellow', 5, 'floor');
  await expect(
    hana.getByRole('img', { name: 'Floor shield: caught a tile, no cost' }).first(),
  ).toBeVisible();
  await take(ana, 'yellow', 'centre', 3);

  await expect(hana.getByText('You win with 2 points!')).toBeVisible();
  await expect(hana.getByTestId('mo-tiling-note').first()).toContainText(
    'The shield caught a yellow: no cost.',
    { timeout: 10_000 },
  );
});
