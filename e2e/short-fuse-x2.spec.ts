import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom } from './inquest-play.ts';
import { draw, play, riggedStart, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('expansion 2: a Mark, a Blindfold, Recycle, a held Bomb, a Bomb Stack and a blind search', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('toggle-x2').click();
  // One Bomb more than usual: as many as there are players.
  await expect(B.getByTestId('readout')).toContainText('3 bombs');

  await riggedStart(host, {
    hands: [
      ['shelter', 'mark', 'blind', 'cat1'],
      ['recycle', 'stack', 'cat3'],
      ['cat4', 'cat4', 'cat4'],
    ],
    top: ['bomb'],
  });

  // A Mark turns one of Ana's cards to face the table.
  await play(host, ['mark'], 'Ana');
  await settle(host);
  const anaSeat = B.locator('[data-seat]').filter({ hasText: 'Ana' });
  await expect(anaSeat.getByTestId('marked')).toBeVisible();

  // The Blindfold: Ben's hand turns face down, and everyone sees it on his seat.
  await play(host, ['blind'], 'Ben');
  await settle(host);
  await expect(B.getByTestId('blind-hand').getByRole('button')).toHaveCount(3);
  await expect(B.getByTestId('hand')).toHaveCount(0);
  await expect(
    A.locator('[data-seat]').filter({ hasText: 'Ben' }).getByTestId('blind'),
  ).toBeVisible();

  // Hana draws the rigged Bomb: her Bomb Shelter keeps it, so the table only sees a draw.
  await draw(host);
  await expect(A.getByTestId('last-action')).toContainText('Hana drew a card.');

  // Ana's Recycle: everyone puts a card in, Ben blind; then the pile is shuffled.
  await play(A, ['recycle']);
  await settle(A);
  await host.getByRole('dialog').locator('[data-card="cat1"]').click();
  await host.getByTestId('pick-confirm').click();
  await A.getByRole('dialog').locator('[data-card="cat3"]').click();
  await A.getByTestId('pick-confirm').click();
  await B.getByRole('dialog').getByRole('button', { name: 'Face-down card 1' }).click();
  await B.getByTestId('pick-confirm').click();
  await expect(A.getByTestId('last-action')).toContainText('3 cards went into the pile');
  await expect(B.locator('[data-testid="memory"]:visible')).toContainText(
    'You put Cat D into the pile',
  );

  // Ana's Bomb Stack puts every Bomb in the pile on top, for all to see; her turn ends.
  await play(A, ['stack']);
  await settle(A);
  await expect(host.getByTestId('known-top')).toContainText('2 on top');

  // Blindfolded Ben plays a card blind: a lone Cat is lost.
  await B.getByTestId('blind-hand').getByRole('button').first().click();
  await B.getByTestId('play-blind').click();
  await expect(host.getByTestId('last-action')).toContainText('Ben turned over a Cat D: lost');
  // Then he draws a Bomb and searches his last face-down card: no Defuse, he explodes.
  await draw(B);
  await expect(B.getByTestId('search')).toBeVisible();
  await expect(host.getByText('turning cards over').first()).toBeVisible();
  await B.getByTestId('search').getByRole('button', { name: 'Face-down card 1' }).click();
  await expect(B.getByTestId('explosion')).toBeVisible();
  await expect(A.getByText('Ben exploded').first()).toBeVisible();
});

test('expansion 2: a Bomb Shelter keeps a drawn Bomb secretly in hand', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana] = await sfTable(browser, ['Hana', 'Ana'], pageErrors);
  const host = hana!.page;
  await host.getByTestId('toggle-x2').click();
  await riggedStart(host, {
    hands: [['shelter', 'superskip'], ['cat1']],
    top: ['bomb', 'cat2'],
  });
  await draw(host);
  // Nobody else learns it was a Bomb: the table sees a plain draw.
  await expect(ana!.page.getByTestId('last-action')).toContainText('Hana drew a card.');
  await expect(host.locator('[data-testid="hand"] [data-card="bomb"]')).toHaveCount(1);
  await expect(host.locator('[data-testid="memory"]:visible')).toContainText('keeping a Bomb safe');
});
