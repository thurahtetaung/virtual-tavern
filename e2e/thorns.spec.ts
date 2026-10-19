import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';
import { YOUR_TURN, bidAll, flip, putDown, table, whoseTurn, yourDiscs } from './thorns-play.ts';

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('a full game: a won challenge, failed ones, the Last Chance disc and the win', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = (await table(browser, ['Hana', 'Ana', 'Ben'])) as [Page, Page, Page];
  const [hana] = pages;
  const nameOf = new Map(pages.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
  await hana.getByRole('button', { name: 'Start the game' }).click();

  // Round 1: everyone puts down a rose at once; whoever starts bids all three and makes it.
  await Promise.all(pages.map((p) => putDown(p)));
  const c = await whoseTurn(pages);
  const [v, w] = pages.filter((p) => p !== c) as [Page, Page];
  await expect(yourDiscs(c).getByRole('button', { name: 'Pass' })).toHaveCount(0);
  await bidAll(c);
  await expect(c.getByText(/Turn over your own discs first/)).toBeVisible();
  // Your own first: the others' stacks aren't offered yet.
  await expect(
    c.getByRole('button', { name: `Turn over ${nameOf.get(v)}’s top disc` }),
  ).toHaveCount(0);
  await flip(c, 'your own');
  await flip(c, `${nameOf.get(v)}’s`);
  await flip(c, `${nameOf.get(w)}’s`);
  await expect(v.getByText(new RegExp(`${nameOf.get(c)} turned over 3 discs`))).toBeVisible();
  await expect(c.getByLabel('1 of 2 points').first()).toBeVisible();

  // Three failed challenges on v's thorn: c goes 4 → 1 discs, then borrows the Last Chance disc.
  for (const left of [3, 2, 1]) {
    await expect(c.getByText(/Put your first disc face down/)).toBeVisible({ timeout: 15_000 });
    await putDown(c);
    await putDown(v, 'thorn');
    await putDown(w);
    await expect(c.getByText(YOUR_TURN)).toBeVisible();
    await bidAll(c);
    // A thorn of c's own (a rose may have been lost) ends it at once: c picks the disc to lose.
    await flip(c, 'your own');
    const own = c.getByText(/You hit your own/);
    const next = c.getByRole('button', { name: `Turn over ${nameOf.get(v)}’s top disc` });
    // Settled on one or the other before reading which.
    await expect(own.or(next)).toBeVisible();
    if (await own.isVisible()) {
      await yourDiscs(c)
        .getByRole('button', { name: /^Lose a/ })
        .first()
        .click();
    } else {
      await flip(c, `${nameOf.get(v)}’s`);
      await expect(
        w.getByText(`${nameOf.get(c)} hit ${nameOf.get(v)}’s thorn and loses a disc.`, {
          exact: false,
        }),
      ).toBeVisible();
    }
    await expect(
      w.getByLabel(`${left} ${left === 1 ? 'disc' : 'discs'} left`).first(),
    ).toBeVisible();
  }
  await expect(w.getByText(/gets the Last Chance disc for the next round/)).toBeVisible();
  // Only c knows which discs they lost.
  await expect(yourDiscs(c)).toContainText('Lost (only you know)');
  await expect(yourDiscs(w)).not.toContainText('Lost');

  // Round 5: c holds two discs, puts the Last Chance disc down, and everyone sees it marked.
  await expect(c.getByText(/Put your first disc face down/)).toBeVisible({ timeout: 15_000 });
  await expect(yourDiscs(c).locator('[data-place]')).toHaveCount(2);
  await putDown(c, 'chance');
  await expect(
    v.locator(`[data-mat]`).getByRole('img', { name: 'face-down Last Chance disc' }),
  ).toBeVisible();
  await putDown(v);
  await putDown(w);
  await expect(c.getByText(YOUR_TURN)).toBeVisible();
  await bidAll(c);
  await flip(c, 'your own');
  await flip(c, `${nameOf.get(v)}’s`);
  await flip(c, `${nameOf.get(w)}’s`);

  // Two points: c wins, everyone's stacks are shown, and the host can deal again.
  await expect(c.getByText('You win with two points!')).toBeVisible();
  await expect(v.getByText(`${nameOf.get(c)} wins with two points!`)).toBeVisible();
  await expect(v.getByRole('region', { name: 'Every stack' })).toBeVisible();
  await hana.getByRole('button', { name: 'Play again' }).click();
  await expect(v.getByText(/Put your first disc face down/)).toBeVisible();
});
