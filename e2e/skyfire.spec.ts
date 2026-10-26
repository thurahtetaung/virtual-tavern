import { type Page, expect } from '@playwright/test';
import { clue, myTurn, table, useCard } from './skyfire-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig deals known hands (see skyfire-play.ts).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('2 players on phones: a clue, a play, a discard, a reorder, misfires to the end and the replay', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  const [ana, ben] = pages;
  await ana.getByRole('button', { name: 'Start the show' }).click();

  // Ben sees Ana's cards but not his own.
  await expect(ben.getByTestId('sf-my-hand').locator('[data-card]')).toHaveCount(5);
  await expect(
    ben.locator('[data-testid^="sf-hand-"] [data-suit="yellow"][data-rank="3"]'),
  ).toBeVisible();
  await expect(ben.getByTestId('sf-my-hand').locator('[data-suit]')).toHaveCount(0);

  // Ana tells Ben about his 1: the clue lands on his red 1, and a token is spent.
  await clue(ana, 1, /^Tell Ben: 1s · 1 card/);
  await expect(ben.getByTestId('sf-clues')).toHaveAttribute('data-clues', '7');
  await expect(ben.getByTestId('sf-since')).toContainText('Ana told you: 1s, 1 card.');

  // Ben plays it: the red firework starts, and Ana reacts.
  await useCard(ben, 'c6', 'play');
  await expect(ana.getByTestId('sf-firework-red')).toHaveAttribute('data-height', '1');
  await ana.getByRole('button', { name: 'React 👏' }).click();
  // Tapping one of Ben's cards opens its sheet: his new red 2 is playable now.
  await ana.locator('[data-testid^="sf-hand-"] [data-card="c11"]').click();
  await expect(ana.getByTestId('sf-detail')).toContainText('Playable now');
  await ana.keyboard.press('Escape');
  await expect(ben.getByTestId('sf-reactions')).toHaveText('Ana 👏');

  // Ben moves a card left while Ana thinks; she sees the new order.
  await ben.getByTestId('sf-my-hand').locator('[data-card="c9"]').click();
  await ben.getByRole('button', { name: '◀ Move left' }).click();
  await ben.keyboard.press('Escape');
  const benHand = ana.locator('[data-testid^="sf-hand-"]').first().locator('[data-card]');
  await expect
    .poll(async () => benHand.evaluateAll((els) => els.map((e) => e.getAttribute('data-card'))))
    .toEqual(['c11', 'c7', 'c9', 'c8', 'c10']);

  // Ana discards her oldest card: the clue comes back.
  await useCard(ana, 'c5', 'discard');
  await expect(ben.getByTestId('sf-clues')).toHaveAttribute('data-clues', '8');
  await ben.getByRole('tab', { name: /^Discards/ }).click();
  await expect(ben.getByTestId('sf-discards')).toContainText('Discards (1)');
  await ben.getByRole('tab', { name: 'Table' }).click();

  // Three misfires end the show at 0.
  await useCard(ben, 'c7', 'play');
  await expect(ana.getByTestId('sf-fuses')).toHaveAttribute('data-fuses', '1');
  await useCard(ana, 'c1', 'play');
  await myTurn(ben);
  await useCard(ben, 'c8', 'play');
  for (const p of pages) {
    await expect(p.getByTestId('sf-final-score')).toContainText('0');
    await expect(p.getByTestId('sf-reached')).toHaveText('The fireworks reached 1.');
  }

  // The replay shows every hand face up, Ben's own included.
  await expect(
    ben.getByTestId('sf-replay').locator('[data-suit="red"][data-rank="1"]'),
  ).toBeVisible();
  await ben.getByTestId('sf-replay-next').click();
  await expect(ben.getByTestId('sf-replay-turn')).toHaveText('Ana told you: 1s, 1 card.');
  await ana.getByRole('button', { name: 'Play again' }).click();
  await expect(ben.getByTestId('sf-my-hand')).toBeVisible();
});
