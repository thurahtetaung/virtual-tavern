import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import {
  PHONE,
  TITLES,
  bid,
  drawWithFinger,
  drawWithMouse,
  importPacks,
  lotIs,
  table,
} from './going-once-play.ts';
import { pageErrors } from './tavern-brawl-play.ts';

// A whole Going Once game on phones: drawings, a contested lot, the bank, a screw and the end,
// on the rigged deal (`going-once-play.ts`). The title groups are made up and deleted afterwards.

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

test('three players play Going Once on phones: drawings, a contested lot, a loan, a screw and the gallery', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  cleanup.push(await importPacks(browser));

  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'], PHONE)) as [
    Page,
    Page,
    Page,
  ];
  const all = [hana, ben, cleo];
  // Sound: every device by default, the auctioneer's voice off until the host turns it on; the
  // practice lot is on for a room's first game. Guests see the host's choices.
  await expect(hana.getByRole('radio', { name: 'Every device' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await expect(ben.getByTestId('go-voice')).toHaveAttribute('aria-checked', 'false');
  await hana.getByTestId('go-voice').click();
  await expect(ben.getByTestId('go-voice')).toHaveAttribute('aria-checked', 'true');
  // With the voice on, the auctioneer sets the pace: the pace control is greyed with a note.
  await expect(hana.getByTestId('go-pace-help')).toContainText('The auctioneer sets the pace');
  await expect(hana.getByRole('radio', { name: 'Fast' })).toBeDisabled();
  // This game plays without the voice (its chants would make every lot several times longer).
  await hana.getByTestId('go-voice').click();
  await expect(ben.getByTestId('go-voice')).toHaveAttribute('aria-checked', 'false');
  await expect(hana.getByRole('radio', { name: 'Fast' })).toBeEnabled();
  // The room offers only the auctioneer's seven colours.
  await ben.getByRole('button', { name: /^Players/ }).click();
  const drawer = ben.getByRole('dialog', { name: 'Players' });
  await drawer.getByRole('button', { name: 'Change name or colour' }).click();
  await expect(
    drawer.getByRole('radiogroup', { name: 'Your colour' }).getByRole('radio'),
  ).toHaveCount(7);
  await ben.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(ben.getByTestId('go-practice-setting')).toHaveAttribute('aria-checked', 'true');
  await hana.getByTestId('go-start').click();

  // Drawing: each player's titles, in seat order of the two families.
  for (const [seat, p] of all.entries()) {
    for (const [i, title] of TITLES[seat]!.entries()) {
      await expect(p.getByTestId('go-title')).toHaveText(title);
      if (seat === 0 && i === 0) await drawWithFinger(p);
      else await drawWithMouse(p);
      await p.getByTestId('drawing-send').click();
    }
  }

  // The room's first game opens with the practice lot, on every phone; anyone may skip it for all.
  for (const p of all) await expect(p.getByTestId('go-practice')).toBeVisible();
  await cleo.getByTestId('go-skip-practice').click();
  for (const p of all) await expect(p.getByTestId('go-practice')).toHaveCount(0);

  // Lot 1 is Hana's "Apple" (worth $3,500): Ben and Cleo fight over it, Ben wins at $600.
  for (const p of all) await lotIs(p, 1);
  // Each player's tip for the lot stays under the bidding, from their own art buyer.
  for (const p of all)
    await expect(p.getByTestId('go-psst').filter({ visible: true })).toContainText(
      /The collector|The old lady|The socialite/,
    );
  // The host's line, from the made-up host pack, on every phone.
  for (const p of all)
    await expect(p.getByTestId('go-host')).toContainText('E2E host: the first lot!');
  await expect(hana.getByText('🎨 Your drawing')).toBeVisible();
  await expect(ben.getByText('🎨 Your drawing')).toHaveCount(0);
  // On a 390×844 phone the bid row stays pinned on screen under the drawing.
  await expect(ben.getByTestId('go-bid-400')).toBeInViewport({ ratio: 1 });
  await bid(ben, 400);
  await expect(cleo.getByTestId('go-top-bid')).toContainText('$400');
  await bid(cleo, 500);
  await expect(ben.getByTestId('go-top-bid')).toContainText('$500');
  // Who leads and the bids before stay on screen with the floating bid bar.
  await expect(ben.getByTestId('go-top-bid')).toBeInViewport({ ratio: 1 });
  await expect(ben.getByTestId('go-ladder')).toBeInViewport({ ratio: 1 });
  await bid(ben, 600);
  // The Sold card only shows for a moment, so everything below is checked on what stays on
  // screen: the bank's sheet, cash, the Lots tab and the end gallery (the rig keeps the close at
  // full length, so each bid above has the usual seconds to land).

  // Ben is down to $800: the bank opens by itself and waits for everyone. He borrows; the others pass.
  // After the close (about 8 s) and the Sold card.
  await expect(ben.getByTestId('go-bank')).toBeVisible({ timeout: 30_000 });
  await ben.getByTestId('go-take-loan').click();
  await hana.getByRole('button', { name: 'No thanks' }).click();
  await cleo.getByRole('button', { name: 'No thanks' }).click();
  await expect(ben.getByTestId('go-cash')).toContainText('$1,800');
  await expect(ben.getByTestId('go-cash')).toContainText('owes the bank $1,500');
  // Hana drew "Apple": half of Ben's $600 is hers.
  await expect(hana.getByTestId('go-cash')).toContainText('$1,700');
  // Lot 1 in everyone's Lots tab: title, artist, buyer, price and value.
  for (const p of all) {
    await p.getByRole('tab', { name: '🧾 Lots' }).click();
    const lot1 = p
      .getByRole('region', { name: 'Bidding' })
      .getByTestId('go-log')
      .getByRole('listitem')
      .filter({ hasText: 'Apple' });
    await expect(lot1).toContainText(p === hana ? 'by you' : 'by Hana');
    await expect(lot1).toContainText(p === ben ? 'You paid $600 · worth $3,500' : 'Ben paid $600');
  }

  // Lots 2–4 go unsold; half-time follows. Lot 5 is Hana's "Top hat": Cleo screws Ben into bidding
  // $400, and nobody outbids him.
  await lotIs(cleo, 5, 90_000);
  await cleo.getByTestId('go-screw').click();
  const picker = cleo.getByTestId('go-screw-picker');
  await picker.getByRole('button', { name: /Ben/ }).click();
  // The log keeps the screw (the banner over the lot only shows for a moment).
  await hana.getByRole('tab', { name: '🧾 Lots' }).click();
  await expect(
    hana
      .getByRole('region', { name: 'Bidding' })
      .getByText('🔩 Cleo screwed Ben into bidding $400.'),
  ).toBeVisible();

  // The rest go unsold (each opens with its 2 s intro), then the end: standings and the gallery on
  // every phone.
  for (const p of all) await expect(p.getByTestId('go-gallery')).toBeVisible({ timeout: 120_000 });
  for (const p of all) {
    // The rack-up counts the money first.
    await expect(p.getByText('Final standings')).toBeVisible({ timeout: 15_000 });
    await expect(p.getByTestId('go-gallery').getByText('Apple')).toBeVisible();
    await expect(p.getByTestId('go-gallery').getByText('Fez')).toBeVisible();
  }
  // The gallery keeps every lot's result: the contested one, the forced buy and the unsold ones.
  const gallery = cleo.getByTestId('go-gallery');
  await expect(gallery.getByRole('listitem').filter({ hasText: 'Apple' })).toContainText(
    'Ben paid $600',
  );
  await expect(gallery.getByRole('listitem').filter({ hasText: 'Top hat' })).toContainText(
    'Ben paid $400',
  );
  for (const title of ['Pear', 'Quince', 'Green ball'])
    await expect(gallery.getByRole('listitem').filter({ hasText: title })).toContainText(
      'Unsold · worth',
    );
  // Ben: $1,800 − $400 = $1,400 cash, two drawings worth $3,500 + $1,000, $1,500 debt.
  await expect(ben.getByText('cash $1,400 + art $4,500 − debt $1,500')).toBeVisible();
});
