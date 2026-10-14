import { type Page, expect, test } from '@playwright/test';
import {
  dock,
  isOver,
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
});

for (const mix of [
  { heroes: ['Brute', 'Mage', 'Knight', 'Thief'], names: ['Hana', 'Ana', 'Ben', 'Cy'] },
  { heroes: ['Ranger', 'Druid', 'Thief'], names: ['Hana', 'Ana', 'Ben'] },
  // Five or more: neighbours only, and the knocked out haunt the table as ghosts.
  {
    heroes: ['Dragon', 'Owl', 'Psychic', 'Slime', 'Eye'],
    names: ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'],
  },
  {
    heroes: ['Mimic', 'Eye', 'Slime', 'Druid', 'Ranger', 'Brute'],
    names: ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli'],
  },
]) {
  test(`a full brawl: ${mix.heroes.join(', ')}`, async ({ browser }) => {
    test.setTimeout(300_000);
    await openBackroom(await visitor(browser, 'Admin'));
    const pages = await table(browser, mix.names);
    for (const [i, p] of pages.entries()) await pickHero(p, mix.heroes[i]!);
    const zone = pages.length >= 5;
    if (zone) await expect(pages[0]!.getByText(/Five or more players/)).toBeVisible();
    await pages[0]!.getByRole('button', { name: 'Start the brawl' }).click();
    await expect(pages[0]!.getByText('Your turn: play a card')).toBeVisible();
    await playToEnd(pages);
    for (const p of pages) await expect.poll(() => isOver(p)).toBe(true);
    // Everyone knocked out stayed at the table as a ghost (and had turns to haunt).
    if (zone) {
      await expect
        .poll(() => pages[0]!.locator('[data-ghost]').count())
        .toBeGreaterThanOrEqual(pages.length - 1);
      await expect(pages[0]!.getByRole('log').first()).toContainText(/ghost/);
    }
  });
}
