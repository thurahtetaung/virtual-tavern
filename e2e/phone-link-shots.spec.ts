import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import * as goingOnce from './going-once-play.ts';
import * as sketchy from './sketchy-play.ts';
import { type Look, pageErrors, visitor } from './tavern-brawl-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/phone-link-shots.spec.ts
// (SHOTS_DIR=<folder> to write them elsewhere). A PC at 1280×720 and a phone at 390×844, dark and
// light: the nudge, the pairing card, the phone's code and confirm screens, the PC as table screen
// (Going Once and Sketchy), Controls here, and unlinking from each side.
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/phone-link-shots';
const PC = { width: 1280, height: 720 };
const PHONE = { width: 390, height: 844 };

const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
  expect(pageErrors.splice(0), 'uncaught errors in the browser').toEqual([]);
});

/** Opens the pairing card on the PC and links a fresh phone through `/link`. */
async function linkPhone(
  browser: Browser,
  pc: Page,
  look: Look,
  shot?: (p: Page, n: string) => Promise<unknown>,
) {
  await pc.getByRole('button', { name: 'Link my phone' }).click();
  const card = pc.getByTestId('link-code');
  await expect(card).toHaveAttribute('aria-label', /^Code [A-Z] [A-Z] [A-Z] [A-Z]$/);
  const code = (await card.getAttribute('aria-label'))!.replace(/^Code /, '').replace(/ /g, '');
  await shot?.(pc, 'pc-2-pairing-card');
  const phone = await visitor(browser, 'Phone', { ...look, viewport: PHONE });
  await phone.goto('/link');
  await phone.getByTestId('link-code-input').fill(code.slice(0, 2));
  await shot?.(phone, 'phone-1-type');
  await phone.getByTestId('link-code-input').fill(code);
  await phone.getByRole('button', { name: 'Link this phone' }).click();
  await expect(phone.getByTestId('link-confirm')).toBeVisible();
  await shot?.(phone, 'phone-2-confirm');
  await phone.getByRole('button', { name: /^Link as / }).click();
  await expect(phone.getByRole('button', { name: /Your PC/ })).toBeVisible();
  await expect(pc.getByTestId('link-done')).toBeVisible();
  await shot?.(pc, 'pc-3-linked');
  const screen = pc.getByTestId('pc-table-screen');
  await expect(screen).toBeVisible();
  await screen.getByRole('button', { name: /Start the table screen/ }).click();
  await expect(screen.getByText(/Setting up the table|Opening the door/)).toHaveCount(0);
  return phone;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`phone link screenshots: Going Once (${colorScheme})`, async ({ browser }) => {
    test.setTimeout(120_000);
    const look: Look = { viewport: PC, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `${DIR}/${colorScheme}-${name}.png` });
    cleanup.push(await goingOnce.importPacks(browser));
    const [hana] = (await goingOnce.table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [Page];
    await expect(hana.getByTestId('link-nudge')).toBeVisible();
    await shot(hana, 'pc-1-nudge');

    const phone = await linkPhone(browser, hana, look, shot);
    await shot(phone, 'phone-3-in-room');
    const screen = hana.getByTestId('pc-table-screen');
    await expect(screen.getByTestId('phone-status')).toHaveText(/Phone linked/);
    await shot(hana, 'pc-4-table-screen-going-once-lobby');

    await phone.getByRole('button', { name: /Your PC/ }).click();
    await expect(phone.getByTestId('pc-sheet')).toContainText('on the table screen');
    await shot(phone, 'phone-4-pc-sheet');
    await phone.keyboard.press('Escape');
    await expect(phone.getByTestId('pc-sheet')).toBeHidden();

    await screen.getByRole('button', { name: 'Controls here' }).click();
    await expect(hana.getByTestId('linked-strip-controls')).toBeVisible();
    await shot(hana, 'pc-5-controls-here');
    await hana.getByRole('button', { name: 'Back to the table screen' }).click();

    await screen.getByRole('button', { name: 'Unlink' }).click();
    await expect(hana.getByRole('button', { name: 'Unlink phone' })).toBeVisible();
    await shot(hana, 'pc-6-unlink-confirm');
    await hana.getByRole('button', { name: 'Unlink phone' }).click();
    await expect(phone.getByRole('heading', { name: 'This phone is unlinked' })).toBeVisible();
    await shot(phone, 'phone-5-unlinked');
    await expect(screen).toHaveCount(0);
    await shot(hana, 'pc-7-after-unlink');
  });

  test(`phone link screenshots: Sketchy (${colorScheme})`, async ({ browser }) => {
    test.setTimeout(90_000);
    const look: Look = { viewport: PC, colorScheme };
    const shot = (p: Page, name: string) =>
      p.screenshot({ path: `${DIR}/${colorScheme}-${name}.png` });
    cleanup.push(await sketchy.importPacks(browser));
    const [hana] = (await sketchy.table(browser, ['Hana', 'Ben', 'Cleo'], look)) as [Page];
    const phone = await linkPhone(browser, hana, look);
    await expect(hana.getByTestId('pc-table-screen').getByTestId('phone-status')).toBeVisible();
    await shot(hana, 'pc-8-table-screen-sketchy-lobby');
    // The phone unlinks itself: the PC is back on the controls with a note.
    await phone.getByRole('button', { name: /Your PC/ }).click();
    await phone.getByRole('button', { name: 'Unlink this phone' }).click();
    await phone.getByRole('button', { name: 'Unlink this phone' }).last().click();
    await expect(phone.getByRole('heading', { name: 'This phone is unlinked' })).toBeVisible();
    await expect(hana.getByText('Your phone was unlinked.', { exact: false })).toBeVisible();
    await shot(hana, 'pc-9-unlinked-from-phone');
  });
}
