import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { YOUR_TURN, myTurn, openCard, sheet, table, take } from './jeweller-play.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig (playwright.config.ts): the first seat starts owning 4 white, 3 black and
// 12 points of cards, the black card L1-35 tops the level-I deck, and only the 4-white-4-black
// noble on the table fits.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('a 2-player game on phones: gems, a purchase, a noble visit, the final round and the end', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport: PHONE })) as [Page, Page];
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Hana's two-tap take: pick three piles, then Take. A pile tapped twice is two of a colour.
  await myTurn(hana);
  await hana.locator('[data-pile="green"]').click();
  await expect(hana.getByText(/Pick 2 more colours, or tap it again for two/)).toBeVisible();
  await hana.locator('[data-pile="red"]').click();
  await hana.locator('[data-pile="white"]').click();
  await hana.getByTestId('jw-take').click();
  await expect(ana.getByText(YOUR_TURN)).toBeVisible();
  await expect(ana.getByRole('button', { name: /^Hana: 12 points, 3 pieces/ })).toBeVisible();
  await take(ana, ['white', 'blue', 'green']);

  // The black card now glows for Hana: her cards cover all but a green and a red.
  await myTurn(hana);
  const card = hana.getByRole('region', { name: 'Cards for sale' }).locator('[data-card="L1-35"]');
  await expect(card).toHaveAttribute('aria-label', /you can buy it$/);
  await openCard(hana, 'L1-35');
  await expect(sheet(hana).getByText('You pay (after your discounts):')).toBeVisible();
  await sheet(hana).getByTestId('jw-buy').click();
  await expect(sheet(hana)).toHaveCount(0);

  // The fourth black card brings the noble: 15 points, so this is the final round.
  await expect(
    hana.getByRole('region', { name: 'Your table' }).locator('[data-noble="N09"]'),
  ).toBeVisible();
  await expect(
    hana.getByRole('region', { name: 'Nobles' }).locator('[data-noble="N09"]'),
  ).toHaveCount(0);
  await expect(ana.getByText(/Final round: Hana reached 15\. Ana plays last\./)).toBeVisible();

  // Ana plays the last turn of the round, and the game ends.
  await take(ana, ['white', 'blue', 'black']);
  await expect(hana.getByText('You win with 15 points!')).toBeVisible();
  await expect(ana.getByText('Hana wins with 15 points!')).toBeVisible();
  await expect(ana.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await hana.getByRole('button', { name: 'Play again' }).click();
  await myTurn(hana);
});

test('over 10 pieces: a guided hand-back; reserved cards stay hidden from the others', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'])) as [Page, Page];
  await hana.getByRole('button', { name: 'Start the game' }).click();

  const reserveFaceUp = async () => {
    await myTurn(ana);
    await ana
      .getByRole('region', { name: 'Cards for sale' })
      .locator('[data-card]')
      .first()
      .click();
    await sheet(ana).getByTestId('jw-reserve').click();
    await expect(sheet(ana)).toHaveCount(0);
  };

  await take(hana, ['white', 'blue', 'green']);
  await reserveFaceUp();
  await take(hana, ['red', 'black', 'white']);
  // A blind reserve from the level-II deck.
  await myTurn(ana);
  await ana.locator('[data-deck="2"]').click();
  await sheet(ana).getByTestId('jw-reserve-deck').click();
  await expect(sheet(ana)).toHaveCount(0);
  await take(hana, ['blue', 'green', 'red']);
  await reserveFaceUp();

  // Hana's fourth take would make 12: the bar warns, then the picker asks for 2 back.
  await myTurn(hana);
  for (const g of ['black', 'white', 'blue']) await hana.locator(`[data-pile="${g}"]`).click();
  await expect(hana.getByText(/You’ll hand back 2 after\./)).toBeVisible();
  await hana.getByTestId('jw-take').click();
  await expect(hana.getByText(/hand back 2 pieces of your choice/)).toBeVisible();
  const picker = hana.getByRole('group', { name: 'Pieces to hand back' });
  await expect(picker.getByText('Hand back 2 pieces (2 chosen):')).toBeVisible();
  await picker.getByRole('button', { name: 'Hand back 2 of 2' }).click();
  await expect(
    hana.getByRole('region', { name: 'Your table' }).getByLabel('10 of 10 pieces'),
  ).toBeVisible();
  await expect(ana.getByText(YOUR_TURN)).toBeVisible();

  // Ana's three reserved cards: hers to see, only their levels for Hana.
  await expect(
    ana.getByRole('group', { name: 'Your reserved cards' }).locator('[data-card]'),
  ).toHaveCount(3);
  const anas = hana.locator('[data-panel]').filter({ hasText: 'Ana' });
  await expect(anas.locator('[data-card]')).toHaveCount(0);
  await expect(anas.getByRole('img', { name: /^A reserved level/ })).toHaveCount(3);
  await expect(
    anas.getByRole('img', { name: 'A reserved level II card (from the deck)' }),
  ).toBeVisible();
});
