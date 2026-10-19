import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';
import {
  YOUR_TURN,
  bidAll,
  flip,
  leaveRoom,
  localArt,
  putDown,
  table,
  whoseTurn,
  yourDiscs,
} from './thorns-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/thorns-shots.spec.ts
// With THORNS_ART=<folder holding manifest.json and the art> the pages get that manifest and art
// from disk, to preview the real discs locally; without it, discs show as placeholders.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`thorns screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme, setup: localArt };
    const shot = async (p: Page, name: string) => {
      // Let the flips and fades finish.
      await p.waitForTimeout(600);
      await p.screenshot({
        path: `test-results/thorns-shots/${label}-${name}.png`,
        fullPage: true,
      });
    };
    await openBackroom(await visitor(browser, 'Admin'));
    const pages = (await table(browser, ['Hana', 'Ana', 'Ben'], look)) as [Page, Page, Page];
    const [hana] = pages;
    const nameOf = new Map(pages.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!]));
    await shot(hana, '01-lobby');
    await hana.getByRole('button', { name: 'Start the game' }).click();
    await expect(hana.getByText(/Put your first disc face down/)).toBeVisible();
    await shot(hana, '02-first-disc');

    // Round 1: roses first; the starter adds a rose, the next player hides a thorn on top, the
    // third opens at 1, the starter raises to 3 and the others pass: the starter turns over
    // their own two roses, then the thorn.
    await Promise.all(pages.map((p) => putDown(p)));
    const c = await whoseTurn(pages);
    await putDown(c);
    const next = await whoseTurn(pages.filter((p) => p !== c));
    await putDown(next, 'thorn');
    const third = await whoseTurn(pages.filter((p) => p !== c && p !== next));
    await shot(third, '03-your-turn');
    await yourDiscs(third).getByRole('button', { name: 'Bid 1' }).click();
    await expect(c.getByText(/Raise, or pass/)).toBeVisible();
    await shot(c, '04-bidding');
    await yourDiscs(c).getByRole('button', { name: 'One more' }).click();
    await yourDiscs(c).getByRole('button', { name: 'Raise to 3' }).click();
    await yourDiscs(next).getByRole('button', { name: 'Pass' }).click();
    await yourDiscs(third).getByRole('button', { name: 'Pass' }).click();
    await expect(c.getByText(/Turn over your own discs first/)).toBeVisible();
    await shot(c, '05-flip-own');
    await flip(c, 'your own');
    await flip(c, 'your own');
    await expect(c.getByText(/Pick a stack/)).toBeVisible();
    await shot(c, '06-flip-others');
    await flip(c, `${nameOf.get(next)}’s`);
    await expect(third.getByText(/and loses a disc/)).toBeVisible();
    await shot(third, '07-result');
    await yourDiscs(next).getByRole('button', { name: 'Show my stack' }).click();
    await shot(third, '08-shown');

    // Two more rounds: the starter (still c) bids every disc on rose-only mats and makes it.
    for (const done of [/score a point/, /win with two points/]) {
      await expect(c.getByText(/Put your first disc face down/)).toBeVisible({ timeout: 15_000 });
      await Promise.all(pages.map((p) => putDown(p)));
      await expect(c.getByText(YOUR_TURN)).toBeVisible();
      await bidAll(c);
      await flip(c, 'your own');
      for (const p of pages.filter((x) => x !== c)) await flip(c, `${nameOf.get(p)}’s`);
      await expect(c.getByText(done)).toBeVisible();
    }
    await expect(hana.getByRole('region', { name: 'Every stack' })).toBeVisible();
    await shot(hana, '09-end');
  });
}

test('thorns remove control (phone-dark)', async ({ browser }) => {
  test.setTimeout(120_000);
  const look: Look = {
    viewport: { width: 390, height: 844 },
    colorScheme: 'dark',
    setup: localArt,
  };
  await openBackroom(await visitor(browser, 'Admin'));
  const [hana, ana, ben] = (await table(browser, ['Hana', 'Ana', 'Ben'], look)) as [
    Page,
    Page,
    Page,
  ];
  await hana.getByRole('button', { name: 'Start the game' }).click();
  await Promise.all([hana, ana, ben].map((p) => putDown(p)));
  await leaveRoom(ben);
  await expect(hana.getByRole('button', { name: 'Remove Ben' })).toBeVisible();
  await hana.waitForTimeout(600);
  await hana.screenshot({
    path: 'test-results/thorns-shots/phone-dark-10-remove.png',
    fullPage: true,
  });
});
