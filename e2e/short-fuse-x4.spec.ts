import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom } from './inquest-play.ts';
import {
  draw,
  handTypes,
  play,
  riggedStart,
  select,
  settle,
  sfTable,
  sfVisitor,
} from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** A seat by its player's exact name ("Ana" isn't "Hana"). */
const seat = (p: Page, name: string) =>
  p.locator('[data-seat]').filter({ has: p.getByText(name, { exact: true }) });

test('expansion 4: a ghost, Look Twice, Feed the Ghosts, a Second Life with Foresight', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('toggle-x4').click();
  await expect(A.getByTestId('toggle-x4')).toHaveAttribute('aria-checked', 'true');
  await expect(A.getByTestId('readout')).toContainText('Second Life each');

  await riggedStart(host, {
    hands: [
      ['skip', 'revive', 'cat1'],
      ['feed', 'cat2'],
      ['dig', 'seer', 'cat3'],
    ],
    top: ['bomb', 'bomb', 'cat4', 'cat5'],
  });

  // Hana skips; Ana draws a bomb with nothing to save her and stays on as a ghost.
  await play(host, ['skip']);
  await settle(host);
  await draw(A);
  await expect(seat(B, 'Ana').getByTestId('ghost')).toBeVisible();
  await expect(A.getByText(/You’re a ghost: no turns/).first()).toBeVisible();
  await expect.poll(() => handTypes(A)).toEqual(expect.arrayContaining(['feed', 'cat2']));

  // Ben looks at the top card (a bomb), puts it back and draws the next one.
  await expect(B.getByTestId('draw')).toBeVisible();
  await play(B, ['dig']);
  await settle(B);
  await expect(B.getByRole('dialog')).toContainText('the top card');
  await B.getByTestId('dig-next').click();
  await expect(B.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => handTypes(B)).toContain('cat4');

  // Off turn, the ghost feeds herself: Hana and Ben each give her a card.
  await expect(host.getByTestId('draw')).toBeVisible();
  await select(A, ['feed']);
  await A.getByTestId('now-dock')
    .getByRole('button', { name: /yourself/ })
    .click();
  await settle(A);
  await host.getByRole('dialog').locator('[data-card="cat1"]').click();
  await host.getByTestId('pick-confirm').click();
  await B.getByRole('dialog').locator('[data-card="cat3"]').click();
  await B.getByTestId('pick-confirm').click();
  await expect(seat(host, 'Ana')).toContainText('🂠 3');

  // Hana draws the bomb Ben left on top: her Second Life must bring Ana back.
  await draw(host);
  await expect(host.getByTestId('revive')).toBeVisible();
  await host.getByTestId('revive-ghost').click();
  await host.getByTestId('revive-button').click();
  // The Second Life can't be Noped; Ben plays Foresight to watch the hiding.
  await expect(B.getByTestId('seer-button')).toBeVisible();
  await expect(B.getByTestId('nope-button')).toHaveCount(0);
  await B.getByTestId('seer-button').click();
  await settle(B);
  await host.getByTestId('place-top').click();
  await host.getByTestId('place-confirm').click();
  await host.getByTestId('place-bottom').click();
  await host.getByTestId('place-confirm').click();
  await expect(seat(B, 'Ana').getByTestId('ghost')).toHaveCount(0);
  await expect(B.getByTestId('last-action')).toBeVisible();
  await expect(B.locator('[data-testid="memory"]:visible')).toContainText('You watched Hana');
  // Hana's turn ended: Ana is back in the turn order and plays next.
  await expect(A.getByTestId('draw')).toBeVisible();
});

test('Chaos: the everything deck, its pile cap, and a Copy played as a Favor', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('preset-chaos').click();
  await expect(A.getByTestId('preset-chaos')).toHaveAttribute('aria-checked', 'true');
  for (const x of ['x1', 'x2', 'x3', 'x4'])
    await expect(A.getByTestId(`toggle-${x}`)).toHaveAttribute('aria-checked', 'true');
  // 3 players: at most 36 cards before the 3 bombs (one of them the Black Hole) go in.
  await expect(A.getByTestId('readout')).toContainText('draw pile of 39');

  await riggedStart(host, {
    hands: [
      ['favor', 'copy', 'cat1'],
      ['cat2', 'cat5'],
      ['cat3', 'nope'],
    ],
    top: ['cat4', 'skip'],
  });
  await expect(B.getByText(/\+ Expansion 4/).first()).toBeVisible();

  await play(host, ['favor'], 'Ana');
  await settle(host);
  await A.getByRole('dialog').locator('[data-card="cat2"]').click();
  await A.getByTestId('pick-confirm').click();

  // The Copy becomes the Favor on top of the discard pile.
  await select(host, ['copy']);
  await expect(host.getByTestId('play')).toHaveText(/Play Copy as Favor/);
  await host.getByTestId('play').click();
  await host.getByTestId('targets').getByRole('button', { name: /^Ben/ }).click();
  await expect(B.getByTestId('nope-panel')).toContainText('Copy as Favor');
  await settle(B);
  await B.getByRole('dialog').locator('[data-card="cat3"]').click();
  await B.getByTestId('pick-confirm').click();
  await expect
    .poll(() => handTypes(host))
    .toEqual(expect.arrayContaining(['cat1', 'cat2', 'cat3']));
  await draw(host);
  await expect(A.getByTestId('draw')).toBeVisible();
});

test('Look Twice and Foresight open their sheets game after game', async ({ browser }) => {
  test.setTimeout(200_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('toggle-x4').click();

  for (const round of [1, 2]) {
    await riggedStart(host, {
      hands: [['skip', 'revive'], [], ['dig', 'seer']],
      top: ['bomb', 'bomb', 'cat4', 'cat5'],
    });
    // Ana becomes a ghost; Ben looks at the bomb on top and draws the card under it.
    await play(host, ['skip']);
    await settle(host);
    await draw(A);
    await expect(B.getByTestId('draw')).toBeVisible();
    await play(B, ['dig']);
    await settle(B);
    await expect(B.getByRole('dialog')).toContainText('the top card');
    await B.getByTestId('dig-next').click();
    // Hana's Second Life brings Ana back; Ben watches both bombs go back on top.
    await draw(host);
    await host.getByTestId('revive-button').click();
    await B.getByTestId('seer-button').click();
    await settle(B);
    for (let i = 0; i < 2; i++) {
      await host.getByTestId('place-top').click();
      await host.getByTestId('place-confirm').click();
    }
    await expect(B.getByTestId('watch-sheet').getByRole('listitem')).toHaveCount(2);
    await expect(B.getByTestId('watch-sheet')).toContainText('Hana put');
    await B.getByTestId('watch-close').click();
    await expect(B.getByTestId('watch-sheet')).toHaveCount(0);
    // Ana and Ben draw those bombs with nothing to save them: Hana wins.
    await draw(A);
    await expect(B.getByTestId('draw')).toBeVisible();
    await draw(B);
    await expect(host.getByTestId('winner')).toBeVisible({ timeout: 10_000 });
    await expect(B.getByTestId('watch-sheet')).toHaveCount(0);
    if (round === 1) {
      await host.getByRole('button', { name: 'Change setup' }).click();
      await expect(host.getByTestId('start')).toBeVisible();
    }
  }
});

test('a Copy of Look Twice opens its sheet in a second game, and a Noped one opens nothing', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  const A = ana!.page;
  const B = ben!.page;
  await host.getByTestId('toggle-x4').click();

  // Game 1 ends at once: Hana and Ana draw bombs with nothing to save them.
  await riggedStart(host, { hands: [[], [], []], top: ['bomb', 'bomb'] });
  await draw(host);
  await expect(A.getByTestId('draw')).toBeVisible();
  await draw(A);
  await expect(host.getByTestId('winner')).toBeVisible({ timeout: 10_000 });

  for (const noped of [false, true]) {
    await host.getByRole('button', { name: 'Change setup' }).click();
    // A short pile: three cats, then the two bombs that end the game.
    await riggedStart(host, {
      hands: [['dig'], ['copy'], ['nope']],
      top: ['cat1', 'cat2', 'cat3', 'bomb', 'bomb'],
      size: 5,
    });
    // Hana keeps the top card; Ana copies the Look Twice on the discard pile.
    await play(host, ['dig']);
    await host.getByTestId('dig-keep').click();
    await expect(A.getByTestId('draw')).toBeVisible();
    await select(A, ['copy']);
    await expect(A.getByTestId('play')).toHaveText(/ as /);
    await A.getByTestId('play').click();
    if (noped) {
      await B.getByTestId('nope-button').click();
      await settle(A);
      await expect(A.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => handTypes(A)).toEqual([]);
      await draw(A);
    } else {
      await settle(A);
      await expect(A.getByRole('dialog')).toContainText('the top card');
      await A.getByTestId('dig-next').click();
      await expect(A.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => handTypes(A)).toEqual(['cat3']);
    }
    // Ben takes the last cat; Hana and Ana draw the bombs and Ben wins.
    await expect(B.getByTestId('draw')).toBeVisible();
    await draw(B);
    await expect(host.getByTestId('draw')).toBeVisible();
    await draw(host);
    await expect(A.getByTestId('draw')).toBeVisible({ timeout: 10_000 });
    await draw(A);
    await expect(host.getByTestId('winner')).toContainText('Ben', { timeout: 10_000 });
  }
});
