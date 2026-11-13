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
import { pageErrors, visitor } from './tavern-brawl-play.ts';

// A player on a PC links their phone by code: the phone becomes a second key of the same player
// (a fresh phone gets the back room with it), the PC turns into their table screen, and a Going
// Once round is played from the phone. Then Controls here, and unlinking.

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

/** The four letters on the PC's pairing card. */
async function codeOn(pc: Page) {
  const card = pc.getByTestId('link-code');
  await expect(card).toHaveAttribute('aria-label', /^Code [A-Z] [A-Z] [A-Z] [A-Z]$/);
  return (await card.getAttribute('aria-label'))!.replace(/^Code /, '').replace(/ /g, '');
}

test('a PC and a phone link by code, play a Going Once round with the PC as table screen, then unlink', async ({
  browser,
}) => {
  test.setTimeout(170_000);
  cleanup.push(await importPacks(browser));
  // Hana plays on a PC; Ben and Cleo on phones.
  const [hana, ben, cleo] = (await table(browser, ['Hana', 'Ben', 'Cleo'])) as [Page, Page, Page];
  for (const p of [ben, cleo]) await p.setViewportSize(PHONE.viewport!);

  // The desktop nudge, and its pairing card.
  await expect(hana.getByTestId('link-nudge')).toBeVisible();
  await hana.getByRole('button', { name: 'Link my phone' }).click();
  await expect(hana.getByRole('img', { name: 'QR code that opens the link page' })).toBeVisible();
  const code = await codeOn(hana);

  // A phone that has never been here: a wrong code first, then the right one.
  const phone = await visitor(browser, 'Phone', PHONE);
  await phone.goto('/link');
  const wrong = code === 'ABCD' ? 'ABCE' : 'ABCD';
  await phone.getByTestId('link-code-input').fill(wrong);
  await phone.getByRole('button', { name: 'Link this phone' }).click();
  await expect(phone.getByTestId('link-wrong')).toBeVisible();
  await phone.getByTestId('link-code-input').fill(code);
  await phone.getByRole('button', { name: 'Link this phone' }).click();
  const confirm = phone.getByTestId('link-confirm');
  await expect(confirm).toContainText('Hana');
  await expect(confirm).toContainText('3 players');
  // The back room comes with the code, since this phone has never had it.
  await expect(phone.getByText('This also opens the back room on this phone.')).toBeVisible();
  await phone.getByRole('button', { name: 'Link as Hana' }).click();
  await expect(phone).toHaveURL(hana.url());
  await expect(phone.getByRole('button', { name: /Your PC/ })).toBeVisible();
  // One player, not four.
  await expect(ben.getByText('Bidders (3/6)')).toBeVisible();

  // The PC says so, then becomes the table screen (one tap for its sound).
  await expect(hana.getByTestId('link-done')).toBeVisible();
  const screen = hana.getByTestId('pc-table-screen');
  await expect(screen).toBeVisible();
  await screen.getByRole('button', { name: /Start the table screen/ }).click();
  await expect(screen.getByTestId('phone-status')).toHaveText(/Phone linked/);
  // The phone sees its PC on the table screen.
  await phone.getByRole('button', { name: /Your PC/ }).click();
  await expect(phone.getByTestId('pc-sheet')).toContainText('PC connected · on the table screen');
  await phone.keyboard.press('Escape');
  await expect(phone.getByTestId('pc-sheet')).toBeHidden();

  // Hana hosts from her phone: the round starts and she draws there.
  await phone.getByTestId('go-start').click();
  for (const [seat, p] of [phone, ben, cleo].entries()) {
    for (const [i, title] of TITLES[seat]!.entries()) {
      await expect(p.getByTestId('go-title')).toHaveText(title);
      if (seat === 0 && i === 0) await drawWithFinger(p);
      else await drawWithMouse(p);
      await p.getByTestId('drawing-send').click();
    }
  }
  await expect(phone.getByTestId('go-practice')).toBeVisible();
  await cleo.getByTestId('go-skip-practice').click();
  // Lot 1 goes up: the phone bids for Hana while the PC shows the table screen.
  await lotIs(phone, 1);
  await bid(ben, 400);
  await bid(phone, 500);
  await expect(ben.getByTestId('go-top-bid')).toContainText('Hana');
  await expect(screen).toBeVisible();

  // Controls here: the PC is back on the room's own page, and the phone keeps its controls.
  await screen.getByRole('button', { name: 'Controls here' }).click();
  await expect(hana.getByTestId('linked-strip-controls')).toBeVisible();
  await expect(hana.getByTestId('go-top-bid')).toContainText('$500');
  await expect(phone.getByTestId('go-top-bid')).toContainText('$500');
  await hana.getByRole('button', { name: 'Back to the table screen' }).click();
  await expect(screen).toBeVisible();

  // Unlinking from the PC: the phone leaves at once, the PC keeps playing as Hana.
  await screen.getByRole('button', { name: 'Unlink' }).click();
  await hana.getByRole('button', { name: 'Unlink phone' }).click();
  await expect(phone.getByRole('heading', { name: 'This phone is unlinked' })).toBeVisible();
  await expect(screen).toHaveCount(0);
  await expect(hana.getByTestId('go-top-bid')).toBeVisible();
  await expect(ben.getByText('Bidders (3/6)').or(ben.getByTestId('go-top-bid'))).toBeVisible();

  // Its key is gone: reopening the room asks this phone for a name like any stranger.
  await phone.goto(hana.url());
  await expect(phone.getByRole('button', { name: /Your PC/ })).toHaveCount(0);
});
