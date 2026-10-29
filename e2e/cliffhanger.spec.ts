import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  PHONE,
  describe as describeCards,
  faceOff,
  importPacks,
  lockIn,
  table,
} from './cliffhanger-play.ts';
import { pageErrors } from './tavern-brawl-play.ts';

// A whole Cliffhanger game on phones, on the rigged deal (`cliffhanger-play.ts`): Ana wins the
// first face-off, keeps her three, describes them and steals the other side's three (six genres
// in one turn); the empty turn of the other team is skipped; Cleo wins the second face-off and the
// first two of her three finish the set, so the team wins at the end of that turn.

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

test('four players play Cliffhanger on phones: face-offs, describing, a steal and the win', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  cleanup.push(await importPacks(browser));
  const [ana, ben, cleo, dev] = (await table(browser, ['Ana', 'Ben', 'Cleo', 'Dev'], PHONE)) as [
    Page,
    Page,
    Page,
    Page,
  ];
  const all = [ana, ben, cleo, dev];

  // Teams fill smaller first: Ana and Cleo, Ben and Dev.
  await expect(ana.getByTestId('team-a')).toContainText('Cleo');
  await expect(ana.getByTestId('team-b')).toContainText('Ben');
  await expect(ana.getByTestId('team-b')).toContainText('Dev');

  // A genre the packs have no titles of is flagged, and Start is refused until it is off again.
  await expect(ana.getByTestId('goal-line')).toHaveText('Collect 1 of each of 8 genres');
  await ana.getByTestId('genre-heart').click();
  await expect(ben.getByTestId('goal-line')).toHaveText('Collect 1 of each of 9 genres');
  await expect(ana.getByTestId('genre-short')).toContainText('Heartwarmers');
  await ana.getByTestId('start').click();
  await expect(
    ana.getByRole('alert').filter({ hasText: 'Too few films in Heartwarmers' }),
  ).toBeVisible();
  await ana.getByTestId('genre-heart').click();
  await expect(ana.getByTestId('genre-short')).toHaveCount(0);
  await ana.getByTestId('start').click();

  // Round 1: Ana against Ben. Ana answers; Ben's clock runs out.
  await expect(ana.getByTestId('said-it')).toBeVisible({ timeout: 15_000 });
  await expect(ben.getByTestId('faceoff')).toBeVisible();
  await faceOff(all, ana);
  await expect(ana.getByTestId('hand-card')).toHaveCount(6);
  await lockIn(ana);

  // Ana describes her three, then steals Ben's three.
  const first = await describeCards(ana, 6);
  expect(first).toEqual([
    'Pretend action 1',
    'Pretend classics 1',
    'Pretend drama 1',
    'Pretend comedy 1',
    'Pretend horror 1',
    'Pretend family 1',
  ]);
  await expect(dev.getByTestId('race-a').first().getByText('6/8')).toBeVisible({ timeout: 15_000 });

  // Round 2: Cleo against Dev (Ben and Dev's team is behind and picks the category).
  await faceOff(all, cleo);
  await lockIn(cleo);
  const second = await describeCards(cleo, 2);
  expect(second).toEqual(['Pretend animation 1', 'Pretend scifi 1']);
  // One left of hers, then Dev's three to steal: the turn goes on.
  await describeCards(cleo, 4);

  // The set is complete: Ana's team wins on every phone.
  for (const p of all) await expect(p.getByTestId('winner')).toBeVisible({ timeout: 15_000 });
  await expect(ana.getByTestId('winner')).toContainText('Your team wins!');
  await expect(ben.getByTestId('winner')).toContainText('Popcorn win!');
  await expect(ana.getByTestId('play-again')).toBeVisible();
});
