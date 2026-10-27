import { type Page, expect } from '@playwright/test';
import { clue, dragCard, handOrder, localArt, myTurn, table, useCard } from './skyfire-play.ts';
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

  // The replay shows every hand face up, Ben's own included (on phones, the end's Replay tab).
  await ben.getByTestId('end-tabs-replay').click();
  await expect(
    ben.getByTestId('sf-replay').locator('[data-suit="red"][data-rank="1"]'),
  ).toBeVisible();
  await ben.getByTestId('sf-replay-next').click();
  await expect(ben.getByTestId('sf-replay-turn')).toHaveText('Ana told you: 1s, 1 card.');
  await ana.getByRole('button', { name: 'Play again' }).click();
  await expect(ben.getByTestId('sf-my-hand')).toBeVisible();
});

const DESKTOP = { width: 1440, height: 900 };
const shot = async (p: Page, name: string) => {
  if (process.env.SCREENSHOTS)
    await p.screenshot({ path: `test-results/skyfire-shots/drag-${name}.png` });
};

test('dragging a card reorders your hand, with the mouse and with a finger', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(
    browser,
    ['Ana', 'Ben'],
    [
      { viewport: DESKTOP, colorScheme: 'dark' },
      { viewport: PHONE, colorScheme: 'light' },
    ],
  )) as [Page, Page];
  await ana.getByRole('button', { name: 'Start the show' }).click();
  await myTurn(ana);
  const anaMine = ana.getByTestId('sf-my-hand');
  const benMine = ben.getByTestId('sf-my-hand');
  const anaOnBen = ben.locator('[data-testid^="sf-hand-"]').first();
  const benOnAna = ana.locator('[data-testid^="sf-hand-"]').first();
  await expect.poll(() => handOrder(anaMine)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);

  // Ana drags her first card onto her fourth with the mouse; both screens show the new order.
  await dragCard(ana, 'c1', 'c4', 'mouse', async () => {
    await expect(anaMine.locator('[data-card="c1"]')).toHaveCSS('transform', /matrix/);
    await shot(ana, 'mid-desktop-dark');
  });
  for (const hand of [anaMine, anaOnBen])
    await expect.poll(() => handOrder(hand)).toEqual(['c2', 'c3', 'c4', 'c1', 'c5']);
  await expect(ana.getByRole('dialog')).toHaveCount(0);
  await shot(ana, 'after-desktop-dark');

  // Ben drags his last card to the far left with a finger, while it isn't his turn.
  await dragCard(ben, 'c10', 'c6', 'touch', async () => {
    await expect(benMine.locator('[data-card="c10"]')).toHaveCSS('transform', /matrix/);
    await shot(ben, 'mid-phone-light');
  });
  for (const hand of [benMine, benOnAna])
    await expect.poll(() => handOrder(hand)).toEqual(['c10', 'c6', 'c7', 'c8', 'c9']);
  await expect(ben.getByRole('dialog')).toHaveCount(0);
  await shot(ben, 'after-phone-light');

  // A tap still opens the card.
  await anaMine.locator('[data-card="c2"]').click();
  await expect(ana.getByTestId('sf-play')).toBeVisible();
});

test('5 players on phones: every turn fits the screen without scrolling', async ({ browser }) => {
  test.setTimeout(200_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const names = ['Ana', 'Ben', 'Cy', 'Dee', 'Eve'];
  const pages = await table(browser, names, { viewport: PHONE, setup: localArt });
  // A short reminder clock, so it runs out on the first turn.
  await pages[0]!.getByLabel('Turn timer').selectOption('30');
  await pages[0]!.getByRole('button', { name: 'Start the show' }).click();
  const fits = async (p: Page) =>
    expect
      .poll(() => p.evaluate(() => document.documentElement.scrollHeight))
      .toBeLessThanOrEqual(PHONE.height);
  // The first-time tips fit, and so does the clock running out on top of them.
  await myTurn(pages[0]!);
  for (const p of pages) await expect(p.getByTestId('sf-tips')).toBeVisible();
  for (const p of pages) await fits(p);
  await shot(pages[0]!, 'fit-tips-phone-light');
  for (const p of pages)
    await expect(p.getByRole('status').filter({ hasText: 'Time’s up' })).toBeVisible({
      timeout: 40_000,
    });
  for (const p of pages) await fits(p);
  await shot(pages[0]!, 'fit-expired-phone-light');
  await shot(pages[1]!, 'fit-expired-other-phone-light');
  // The tips open in a sheet, then are put away.
  await pages[0]!
    .getByTestId('sf-tips')
    .getByRole('button', { name: /New here/ })
    .click();
  await expect(pages[0]!.getByRole('dialog')).toContainText('Drag your cards to reorder them.');
  await pages[0]!.getByRole('dialog').getByRole('button', { name: 'Got it' }).click();
  for (const p of pages.slice(1)) await p.getByRole('button', { name: 'Got it' }).click();
  for (const p of pages) await expect(p.getByTestId('sf-tips')).toHaveCount(0);
  // Five clues round the table, then Ana (the host) on turn with a full "since" list.
  for (let turn = 0; turn <= names.length; turn++) {
    const p = pages[turn % names.length]!;
    await myTurn(p);
    for (const q of pages) await fits(q);
    if (turn < names.length) await clue(p, 1);
  }
});
