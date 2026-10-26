import { type Page, expect } from '@playwright/test';
import { keepAll, myTurn, readyAll, recruit, show, table } from './encore-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server's rig deals known hands every round (see encore-play.ts).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

const roundEnd = (p: Page) => p.getByTestId('en-round-end');

test('a 3-player game: shows, recruits, a Recruit & Show, rounds ending unbeaten, the standings', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Ana', 'Ben', 'Cy'])) as [Page, Page, Page];
  const [ana, ben, cy] = pages;
  await ana.getByRole('button', { name: 'Start the game' }).click();

  // Round 1: both versions of the hand are offered, and the choice stays secret.
  await expect(ana.getByTestId('en-flip-turned')).toBeVisible();
  await keepAll(pages, 1, 3);
  await expect(ana.getByText(/^Your turn: the table is empty/)).toBeVisible();
  await show(ana, 0, /^Show 1 · the table is empty$/);
  await expect(ben.getByTestId('en-table').locator('[data-card="1-2"]')).toBeVisible();
  await show(ben, 0, /^Show 8-8 · 2 cards beat 1$/);
  await recruit(cy, 0, { button: /^Recruit it here · Ben \+1$/ });
  // One more recruit and Ben's show has gone all the way round.
  await expect(
    ana.getByText(/Careful: if you only recruit, the round ends and Ben wins it\./),
  ).toBeVisible();
  await recruit(ana, 0);
  for (const p of pages)
    await expect(roundEnd(p)).toContainText(/Nobody beat (Ben’s|your) show \(8-8\)/);
  await expect(ben.getByRole('table', { name: 'Round 1 scores' })).toContainText('+3');
  await readyAll(pages);

  // Round 2: Ben starts; Cy recruits his 6 into 5 _ 7 and shows the run at once.
  await keepAll(pages, 2, 3);
  await show(ben, 2, /^Show 6 · the table is empty$/);
  await myTurn(cy);
  await cy.getByTestId('en-recruit-show').click();
  await expect(cy.getByTestId('en-placing')).toContainText('Recruiting the 6');
  await cy.locator('[data-gap="1"]').click();
  await expect(cy.getByTestId('en-placing')).toContainText('Makes a run of 3: 5-6-7');
  await cy.getByRole('list', { name: 'Your hand' }).locator('button[data-hand-index="0"]').click();
  await cy.getByRole('button', { name: /^🎪 Recruit & show 5-6-7/ }).click();
  await expect(ana.getByTestId('en-table').locator('[data-card]')).toHaveCount(3);
  await expect(cy.getByTestId('en-recruit-show')).toHaveCount(0);
  await recruit(ana, 0, { button: /^Recruit it here · Cy \+1$/ });
  await recruit(ben, 0);
  await expect(roundEnd(ana)).toContainText('Nobody beat Cy’s show (5-6-7)');
  await readyAll(pages);

  // Round 3: Cy shows four 9s, nobody beats them, and the game ends.
  await keepAll(pages, 3, 3);
  await show(cy, 8, /^Show 9-9-9-9 · the table is empty$/);
  await recruit(ana, 0);
  await recruit(ben, 0);
  await expect(ana.getByText('Cy wins with -9 points!')).toBeVisible();
  await expect(cy.getByText('You win with -9 points!')).toBeVisible();
  await expect(ben.getByRole('heading', { name: 'Final standings' })).toBeVisible();
  await expect(ben.getByRole('table', { name: 'Scores by round' })).toContainText('-21');
  await ana.getByRole('button', { name: 'Play again' }).click();
  await expect(ana.getByTestId('en-flip-kept')).toBeVisible();
});

test('2 players on phones: recruiting costs a chip and keeps the turn, and no chips left ends the round', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  const [ana, ben] = pages;
  await ana.getByRole('button', { name: 'Start the game' }).click();
  await keepAll(pages, 1, 2);
  await expect(ana.getByText('22 cards waiting for round 2')).toBeVisible();
  await show(ana, 0, /^Show 1 · the table is empty$/);
  await show(ben, 0, /^Show 9-9-9-9 · 4 cards beat 1$/);

  // Nothing beats four 9s: Ana pays her chips to recruit, turning each 9 over.
  await expect(ana.getByText(/nothing beats Ben’s 9-9-9-9, so recruit/)).toBeVisible();
  await expect(ana.getByTestId('en-recruit-show')).toHaveCount(0);
  await expect(ana.getByTestId('en-recruit')).toHaveText('🤝 Recruit (3 chips left)');
  await recruit(ana, 0, { turn: true, button: /^Pay a chip and recruit it here$/ });
  await expect(ana.getByTestId('en-recruit')).toHaveText('🤝 Recruit (2 chips left)');
  await recruit(ana, 11, { turn: true, button: /^Pay a chip and recruit it here$/ });
  await expect(ana.getByTestId('en-recruit')).toHaveText('🤝 Recruit (1 chip left)');
  await recruit(ana, 0, { turn: true, button: /^Pay a chip and recruit it here$/ });

  // No chip and nothing that beats the last 9: the round ends, and Ben's hand costs nothing.
  for (const p of pages) await expect(roundEnd(p)).toContainText('no chips were left');
  await expect(ana.getByRole('table', { name: 'Round 1 scores' })).toContainText('-13');
  await expect(ana.getByRole('table', { name: 'Round 1 scores' })).toContainText('+4');
  await readyAll(pages);
  await expect(ana.getByText('Round 2 of 2 · Ben starts')).toBeVisible();
});
