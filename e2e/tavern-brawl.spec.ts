import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  dock,
  fullBrawl,
  openBackroom,
  pageErrors,
  pickHero,
  playToEnd,
  table,
  visitor,
} from './tavern-brawl-play.ts';

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const hand = (p: Page) => p.getByRole('region', { name: 'Your hand' });
const playCard = async (p: Page, name: string) => {
  await hand(p)
    .getByRole('button', { name, exact: true })
    .click({ position: { x: 14, y: 90 } });
  await dock(p).click();
};
const row = (p: Page, id: 'Opponents' | 'You') => p.getByRole('list', { name: id });

// The server stacks the druid's and the mage's decks (playwright.config.ts), and the first seat
// goes first, so the first two turns are known: a chain, the howl, two shields, the shield-order
// picker and a taken shield. Then both screens play on to the end, and the host deals again.
test('two heroes brawl: chains, shields, the howl, a taken shield, a knockout', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana] = (await table(browser, ['Hana', 'Ana'])) as [Page, Page];

  await pickHero(hana, 'Druid');
  await ana.getByRole('button', { name: 'Random hero' }).click();
  await expect(ana.getByRole('list', { name: 'Seats' })).not.toContainText('Picking a hero');
  await pickHero(ana, 'Mage');
  await expect(hana.getByRole('list', { name: 'Seats' })).toContainText('Mage');
  await hana.getByRole('button', { name: 'Start the brawl' }).click();

  // The zoom view: the card, what it does, and Play from there.
  await expect(hana.getByText('Your turn: play a card')).toBeVisible();
  await hand(hana).getByRole('button', { name: 'Read Play 2' }).click();
  const zoom = hana.getByRole('dialog');
  await expect(zoom).toContainText('Play 2 more cards');
  await zoom.getByRole('button', { name: 'Close' }).click();

  // ⚡⚡: two more to play.
  await playCard(hana, 'Play 2');
  await expect(hana.getByText(/Play 2 more cards/)).toBeVisible();

  // The howl: an honour-system button, and everyone sees it asked.
  await playCard(hana, 'Power: Howl');
  await expect(ana.getByText(/Hana is making an animal noise/)).toBeVisible();
  await hana.getByRole('button', { name: /I made an animal noise/ }).click();
  await expect(row(ana, 'You')).toContainText('9');

  await playCard(hana, 'Shield 3');
  await playCard(hana, 'Attack 1 + Shield 1');
  await expect(row(hana, 'You').locator('[data-shield]')).toHaveCount(2);
  await expect(ana.getByText('Your turn: play a card')).toBeVisible();

  // Three damage into shields worth 1 and 3: the attacker picks which breaks first.
  await playCard(ana, 'Play 2');
  await playCard(ana, 'Attack 3');
  const choice = ana.getByRole('region', { name: 'Your choice' });
  await expect(choice).toContainText('who takes 3 damage');
  await choice.getByRole('button', { name: /^Hana \(/ }).click();
  await expect(choice).toContainText('which of Hana’s shields');
  await choice.getByRole('button', { name: /Attack 1 \+ Shield 1/ }).click();
  await expect(row(hana, 'You').locator('[data-shield]')).toHaveCount(1);
  await expect(row(hana, 'You').locator('[data-shield]')).toContainText('🛡1');

  // Taking the last shield, damage and all.
  await playCard(ana, 'Power: Take a shield');
  await expect(row(ana, 'You').locator('[data-shield]')).toContainText('🛡1');
  await expect(row(hana, 'You').locator('[data-shield]')).toHaveCount(0);

  await playToEnd([hana, ana]);
  await expect(hana.getByRole('region', { name: 'Knockouts' })).toBeVisible();
  await expect(ana.getByText(/Waiting for Hana .* to start the next brawl/)).toBeVisible();

  await hana.getByRole('button', { name: 'Play again' }).click();
  await expect(hana.getByText('Your turn: play a card')).toBeVisible();
  await expect(row(ana, 'You')).toContainText('10');

  // Mid-game the host abandons it from the Players drawer: everyone is back in the lobby.
  await ana.getByRole('button', { name: /^Players/ }).click();
  await expect(
    ana.getByRole('dialog', { name: 'Players' }).getByRole('button', { name: 'Abandon game' }),
  ).toHaveCount(0);
  await ana.keyboard.press('Escape');
  await hana.getByRole('button', { name: /^Players/ }).click();
  await hana
    .getByRole('dialog', { name: 'Players' })
    .getByRole('button', { name: 'Abandon game' })
    .click();
  await hana
    .getByRole('dialog', { name: 'Abandon this game?' })
    .getByRole('button', { name: 'Abandon game' })
    .click();
  await expect(hana.getByRole('button', { name: 'Start the brawl' })).toBeVisible();
  await expect(ana.getByRole('list', { name: 'Seats' })).toContainText('Mage');
  await expect(hand(ana)).toHaveCount(0);
});

// Full games from every screen (the server starts three or four players on fewer hit points, see
// playwright.config.ts). Five and six are in tavern-brawl-zone.spec.ts.
test('a full brawl: Brute, Mage, Knight, Thief', async ({ browser }) => {
  await fullBrawl(browser, ['Brute', 'Mage', 'Knight', 'Thief'], ['Hana', 'Ana', 'Ben', 'Cy']);
});

test('a full brawl: Ranger, Druid, Thief', async ({ browser }) => {
  await fullBrawl(browser, ['Ranger', 'Druid', 'Thief'], ['Hana', 'Ana', 'Ben']);
});
