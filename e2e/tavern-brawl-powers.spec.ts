import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  openBackroom,
  pageErrors,
  pickHero,
  playUntil,
  table,
  unlock,
  visitor,
} from './tavern-brawl-play.ts';

// Every hero's cards and mighty powers, wherever a player looks for them: the guide (rules page
// and the room's drawer), the lobby's hero pick and the table, on a phone and on a desktop.
// Without the private manifest, heroes and cards show their placeholder names.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 860 };

for (const [label, viewport] of [
  ['phone', PHONE],
  ['desktop', DESKTOP],
] as const) {
  test(`the guide shows each hero's mighty powers and every card by hero (${label})`, async ({
    browser,
  }) => {
    await openBackroom(await visitor(browser, 'Admin'));
    const page = await visitor(browser, 'Reader', { viewport });
    await unlock(page);
    await page.goto('/rules/tavern-brawl');
    const tabs = page.getByRole('tablist', { name: 'Guide' });

    // Heroes: the mage's sheet has its mighty powers, in plain words, and a link to its cards.
    await tabs.getByRole('tab', { name: 'Heroes' }).click();
    await page.getByRole('button', { name: 'Mage', exact: true }).click();
    const sheet = page.getByTestId('guide-sheet');
    const powers = sheet.getByRole('region', { name: 'Mighty powers' });
    await expect(powers).toContainText('Power: Swap hit points ×2');
    await expect(powers).toContainText('Swap hit points with an opponent.');
    await sheet.getByRole('button', { name: /See every card/ }).click();

    // Cards: opened at the mage's group, each card with what it does.
    await expect(tabs.getByRole('tab', { name: 'Cards' })).toHaveAttribute('aria-selected', 'true');
    const mage = page.locator('#guide-cards-mage');
    await expect(mage).toHaveAttribute('open', '');
    await expect(mage.getByRole('button', { name: /^Attack 1 \+ Play 1: / })).toContainText(
      'Deal 1 damage to one opponent, then play another card.',
    );
    await expect(mage.getByRole('button', { name: /^Power: Blast all: / })).toContainText(
      '✦ Mighty power',
    );
    await mage.getByRole('button', { name: /^Power: Blast all: / }).click();
    const card = page.getByTestId('guide-card-sheet');
    await expect(card).toContainText('Every player, you included, takes 3 damage.');
    await expect(card).toContainText('×2 in the deck');
    await page
      .getByRole('dialog', { name: 'Power: Blast all' })
      .getByRole('button', { name: 'Close' })
      .click();

    // Jump to another hero; the set filter keeps only that set's heroes.
    await page
      .getByRole('navigation', { name: 'Jump to' })
      .getByRole('button', { name: 'Slime' })
      .click();
    await expect(page.locator('#guide-cards-slime')).toHaveAttribute('open', '');
    await page.getByRole('button', { name: 'Monster heroes' }).click();
    await expect(page.getByTestId('guide-card-group')).toHaveCount(6);
    await expect(page.locator('#guide-cards-mage')).toHaveCount(0);

    // The cheat sheet: the symbols and a mighty power line per power.
    await tabs.getByRole('tab', { name: 'Cheat sheet' }).click();
    const table = page.getByRole('region', { name: 'Mighty powers' });
    await expect(table).toContainText('Power: Copy hit points');
    await expect(page.getByRole('region', { name: 'The symbols' })).toContainText('🐾');
  });

  test(`the hero pick and the table show every hero's powers (${label})`, async ({ browser }) => {
    test.setTimeout(90_000);
    await openBackroom(await visitor(browser, 'Admin'));
    const [hana, ana] = (await table(browser, ['Hana', 'Ana'], { viewport })) as [Page, Page];

    // The pick: each hero lists its powers; the sheet explains them and picks from there.
    const slime = hana.getByRole('button', { name: 'Mighty powers and deck: Slime' });
    await expect(slime).toContainText('Power: Through shields');
    await slime.click();
    const sheet = hana.getByTestId('tb-hero-sheet');
    await expect(sheet.getByRole('region', { name: 'Mighty powers' })).toContainText(
      'This turn your attack cards ignore shields, this one included, then deal 3 damage to one opponent, straight through shields.',
    );
    await sheet.getByText(/The whole deck \(28 cards\)/).click();
    await expect(sheet.getByRole('list', { name: 'The deck' }).getByRole('button')).not.toHaveCount(
      0,
    );
    await hana.getByRole('button', { name: 'Pick Slime' }).click();
    await expect(hana.locator('[data-hero="slime"]')).toHaveAttribute('aria-pressed', 'true');
    await pickHero(ana, 'eye', true);

    // The drawer filters the cards to the heroes in the room.
    await hana.getByRole('button', { name: 'Rules', exact: true }).first().click();
    const drawer = hana.getByRole('dialog', { name: /How to play/ });
    await drawer.getByRole('tab', { name: 'Cards' }).click();
    await expect(drawer.getByRole('button', { name: 'In this game' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(drawer.getByTestId('guide-card-group')).toHaveCount(2);
    await expect(drawer.locator('#guide-cards-slime')).toHaveAttribute('open', '');
    await drawer.getByRole('button', { name: 'Close' }).click();
    await expect(drawer).toBeHidden();

    await hana.getByRole('button', { name: 'Start the brawl' }).click();
    await expect(hana.locator('[data-seq]')).toBeVisible();

    // A seat opens that hero's sheet, for players and watchers alike.
    await hana.locator('[data-seat-hero="eye"]').click();
    const eye = hana.getByRole('dialog', { name: 'Eye' });
    await expect(eye.getByRole('region', { name: 'Mighty powers' })).toContainText(
      'Power: Steer attacks',
    );
    await eye.getByRole('button', { name: 'Close' }).click();

    // Every hero at the table, in one place: the Powers tab on a phone, the sidebar on a desktop.
    if (label === 'phone') await ana.getByRole('tab', { name: '✦ Powers' }).click();
    else await ana.getByText('✦ Mighty powers').click();
    const panel = ana.getByTestId('tb-powers').locator('visible=true');
    await expect(panel.getByRole('region', { name: 'You: Eye' })).toContainText('Power: Praise me');
    await expect(panel.getByRole('region', { name: 'Hana: Slime' })).toContainText(
      'Power: Shield snack',
    );
    await panel.getByRole('button', { name: 'Mighty powers and deck: Slime' }).click();
    await expect(ana.getByRole('dialog', { name: 'Slime' })).toContainText('played by Hana');
    // Nothing from anyone's hand: the sheet is the deck list, the same for everyone.
    await expect(ana.getByRole('dialog', { name: 'Slime' })).not.toContainText('in hand');
    await ana.getByRole('dialog', { name: 'Slime' }).getByRole('button', { name: 'Close' }).click();
    // Your own hero reads as yours, mid-sentence too.
    await panel.getByRole('button', { name: 'Mighty powers and deck: Eye' }).click();
    await expect(ana.getByRole('dialog', { name: 'Eye' })).toContainText('played by you');
  });
}

test('a knocked-out seat still shows that hero’s powers and deck, never a hand', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const pages = await table(browser, ['Hana', 'Ana', 'Kim'], { viewport: PHONE });
  for (const [p, hero] of [
    [pages[0]!, 'brute'],
    [pages[1]!, 'knight'],
    [pages[2]!, 'ranger'],
  ] as const)
    await pickHero(p, hero, true);
  await pages[0]!.getByRole('button', { name: 'Start the brawl' }).click();

  // Three on 3 hit points: play until someone is out, then another player taps their seat.
  const outSeat = (p: Page) => p.getByRole('button', { name: /, (out|ghost): their hero$/ });
  const watcher = async () => {
    for (const p of pages) if (await outSeat(p).count()) return p;
    return null;
  };
  await playUntil(pages, async () => (await watcher()) !== null);
  const page = (await watcher())!;
  const label = (await outSeat(page).first().getAttribute('aria-label'))!;
  const [who, hero] = label.split(', ') as [string, string];
  await outSeat(page).first().click();
  const sheet = page.getByRole('dialog', { name: hero });
  await expect(sheet.getByRole('region', { name: 'Mighty powers' })).toBeVisible();
  await expect(sheet).toContainText(`played by ${who}`);
  await sheet.getByText(/The whole deck \(28 cards\)/).click();
  await expect(sheet.getByRole('list', { name: 'The deck' }).getByRole('button')).not.toHaveCount(
    0,
  );
  // The deck list is the same for everyone: nothing from the hand they had.
  await expect(sheet).not.toContainText('in hand');
  await expect(sheet.locator('[data-hand]')).toHaveCount(0);
});
