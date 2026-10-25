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

  // Lot 1 is Hana's "Apple" (worth $3,500): Ben and Cleo fight over it, Ben wins at $600.
  for (const p of all) await lotIs(p, 1);
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
  await bid(ben, 600);
  // The Sold card shows briefly: check every phone at once.
  await Promise.all(
    all.map(async (p) => {
      const sold = p.getByTestId('go-sold');
      await expect(sold).toContainText('SOLD to');
      await expect(sold).toContainText('Apple');
      await expect(sold).toContainText('Worth $3,500');
      if (p === hana) await expect(sold).toContainText('You earn $300 commission');
    }),
  );

  // Ben is down to $800: the bank opens by itself. He borrows; the others pass.
  await expect(ben.getByTestId('go-bank')).toBeVisible();
  await ben.getByTestId('go-take-loan').click();
  await hana.getByRole('button', { name: 'No thanks' }).click();
  await cleo.getByRole('button', { name: 'No thanks' }).click();

  // Lots 2–4 go unsold; their values still show.
  await lotIs(ben, 2);
  await expect(ben.getByTestId('go-cash')).toContainText('$1,800');
  await expect(ben.getByTestId('go-cash')).toContainText('owes the bank $1,500');
  for (const n of [2, 3, 4]) {
    await lotIs(cleo, n);
    await expect(cleo.getByTestId('go-sold')).toContainText('Unsold – it was worth', {
      timeout: 20_000,
    });
  }

  // Half-time, then lot 5 (Hana's "Top hat"): Cleo screws Ben into bidding $400.
  await expect(cleo.getByTestId('go-halftime')).toBeVisible();
  await lotIs(cleo, 5);
  await cleo.getByTestId('go-screw').click();
  const picker = cleo.getByTestId('go-screw-picker');
  await picker.getByRole('button', { name: /Ben/ }).click();
  await expect(hana.getByTestId('go-screw-banner')).toContainText(
    'Cleo screwed Ben: Ben bids $400',
  );
  await expect(hana.getByTestId('go-top-bid')).toContainText('$400');
  await expect(hana.getByTestId('go-top-bid')).toContainText('🔩 by Cleo');
  await expect(ben.getByTestId('go-sold')).toContainText('A forced buy, thanks to Cleo', {
    timeout: 20_000,
  });

  // The rest go unsold, then the end: standings and the gallery on every phone.
  for (const p of all) await expect(p.getByTestId('go-gallery')).toBeVisible({ timeout: 60_000 });
  for (const p of all) {
    // The rack-up counts the money first.
    await expect(p.getByText('Final standings')).toBeVisible({ timeout: 15_000 });
    await expect(p.getByTestId('go-gallery').getByText('Apple')).toBeVisible();
    await expect(p.getByTestId('go-gallery').getByText('Fez')).toBeVisible();
  }
  // Ben: $1,800 − $400 = $1,400 cash, two drawings worth $3,500 + $1,000, $1,500 debt.
  await expect(ben.getByText('cash $1,400 + art $4,500 − debt $1,500')).toBeVisible();
});
