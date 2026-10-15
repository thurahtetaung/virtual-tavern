import { expect, test } from '@playwright/test';
import { openBackroom } from './inquest-play.ts';
import {
  draw,
  handTypes,
  play,
  riggedStart,
  settle,
  sfTable,
  sfVisitor,
} from './short-fuse-play.ts';
import { openSettings } from './lobby-settings.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('three players: a Favor, a pair, a Nope chain, an attack, a Defuse and two explosions', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;

  // The Adult deck is marked 18+ in the lobby, for everyone.
  await openSettings(ana!.page);
  await expect(ana!.page.getByTestId('preset-adult').getByTestId('adult-badge')).toBeVisible();
  await expect(host.getByTestId('readout')).toContainText('draw pile of 29');
  // A guest reads the timing and house rules too, in their own fold below the players.
  await ana!.page.getByText('Timing and house rules').click();
  await expect(ana!.page.getByText('45 seconds', { exact: true })).toBeVisible();
  // …which are plainly read-only for them.
  const rules = ana!.page.locator('details', { hasText: 'Timing and house rules' });
  await expect(rules.getByText('Only the host can change these.')).toBeVisible();
  await expect(rules.getByRole('switch', { name: /Five different cards/ })).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  // (The host's fold is closed, so its switch is looked up among hidden elements.)
  await expect(
    host.getByRole('switch', { name: /Five different cards/, includeHidden: true }),
  ).not.toHaveAttribute('aria-disabled');

  await riggedStart(host, {
    hands: [
      ['favor', 'cat1', 'cat1', 'attack', 'nope', 'skip'],
      ['nope', 'cat2', 'cat3', 'defuse'],
      ['nope', 'cat4'],
    ],
    top: ['cat5', 'bomb', 'bomb'],
  });
  await expect(host.getByTestId('bombs-out')).toContainText('2 bombs');

  // A Favor: everyone sees the same countdown; only Nope holders who didn't play get the button.
  await play(host, ['favor'], 'Ana');
  await expect(ben!.page.getByTestId('nope-panel')).toBeVisible();
  await expect(ben!.page.getByTestId('nope-button')).toBeVisible();
  await expect(host.getByTestId('nope-panel')).toBeVisible();
  await expect(host.getByTestId('nope-button')).toHaveCount(0);
  await settle(host);
  await ana!.page.getByRole('dialog').locator('[data-card="cat2"]').click();
  await ana!.page.getByTestId('pick-confirm').click();
  await expect.poll(() => handTypes(host)).toContain('cat2');

  // A pair of cats steals a random card from Ben.
  await play(host, ['cat1', 'cat1'], 'Ben');
  await settle(host);
  await expect(ana!.page.getByTestId('last-action')).toContainText('Hana stole a card from Ben');
  await expect(ben!.page.locator('[data-testid="hand"] [data-card]')).toHaveCount(1);

  // An attack, Noped by Ana and Noped back by Hana: it goes ahead, and Ana owes two turns.
  await play(host, ['attack']);
  await ana!.page.getByTestId('nope-button').click();
  await expect(host.getByTestId('nope-state')).toContainText('cancelled');
  await host.getByTestId('nope-button').click();
  await expect(ana!.page.getByTestId('nope-state')).toContainText('going ahead');
  await settle(ana!.page);
  await expect(host.getByTestId('owed')).toHaveText('×2');

  // Ana draws safely, then the Bomb: she defuses it and hides it on top.
  await draw(ana!.page);
  await expect(ana!.page.getByTestId('draw')).toContainText('Draw');
  await draw(ana!.page);
  await expect(ana!.page.getByTestId('bomb-strip')).toBeVisible();
  await expect(ben!.page.getByText('Ana drew a Bomb!').first()).toBeVisible();
  await ana!.page.getByTestId('defuse-button').click();
  await ana!.page.getByRole('button', { name: 'Top', exact: true }).click();
  await expect(ana!.page.getByTestId('place-where')).toContainText('On top');
  await ana!.page.getByTestId('place-confirm').click();
  await expect(host.getByTestId('last-action')).toContainText('Ana hid the Bomb back in the pile');

  // Ben draws it with no Defuse and explodes; he watches the rest.
  await draw(ben!.page);
  await expect(ben!.page.getByTestId('explosion')).toBeVisible();
  await expect(ben!.page.getByRole('status').filter({ hasText: 'You’re out' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(ben!.page.getByTestId('hand')).toHaveCount(0);

  // Hana draws the last Bomb: Ana wins, and everything is revealed.
  await draw(host);
  await expect(host.getByTestId('winner')).toHaveText('Ana wins!', { timeout: 10_000 });
  await expect(ben!.page.getByTestId('end-pile')).toBeVisible();
  await expect(ana!.page.getByText('Where things were hidden')).toBeVisible();
  await host.getByTestId('play-again').click();
  await expect(ana!.page.getByTestId('hand')).toBeVisible();
  await expect(ben!.page.getByTestId('hand')).toBeVisible();
});
