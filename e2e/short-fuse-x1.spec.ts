import { expect, test } from '@playwright/test';
import { openBackroom } from './inquest-play.ts';
import { draw, play, riggedStart, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('expansion 1: the Black Hole face up, a rearrange, a targeted attack and a reverse', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
  const [hana, ana, ben] = await sfTable(browser, ['Hana', 'Ana', 'Ben'], pageErrors);
  const host = hana!.page;
  await host.getByTestId('toggle-x1').click();
  await expect(ben!.page.getByTestId('readout')).toContainText('Black Hole');

  await riggedStart(host, {
    hands: [
      ['defuse', 'skip'],
      ['alter3', 'aim', 'nope'],
      ['reverse', 'cat1'],
    ],
    top: ['void', 'cat2', 'cat3', 'cat4', 'cat5'],
  });

  // Hana draws the Black Hole: no Defuse, she puts it back face up, on top.
  await draw(host);
  await expect(host.getByRole('dialog', { name: 'Put Black Hole back, face up' })).toBeVisible();
  await host.getByRole('button', { name: 'Top', exact: true }).click();
  await host.getByTestId('place-confirm').click();
  await expect(ana!.page.getByTestId('pile')).toContainText('face up on top!');

  // Ana rearranges: the Black Hole goes third, and everyone sees its stripe in the pile.
  await play(ana!.page, ['alter3']);
  await settle(ana!.page);
  const sheet = ana!.page.getByRole('dialog', { name: 'Rearrange the top of the pile' });
  await expect(sheet.getByRole('listitem').first()).toContainText('Black Hole');
  await sheet.getByRole('button', { name: 'Move down' }).first().click();
  await sheet.getByRole('button', { name: 'Move down' }).nth(1).click();
  await expect(sheet.getByRole('listitem').nth(2)).toContainText('Black Hole');
  await ana!.page.getByTestId('order-confirm').click();
  await expect(ben!.page.getByTestId('pile')).toContainText('face up inside');
  await expect(ben!.page.getByTestId('void-stripe')).toBeVisible();

  // A targeted attack on Ben skips Hana's seat; Ben reverses, which ends one of his two turns.
  await play(ana!.page, ['aim'], 'Ben');
  await settle(ana!.page);
  await expect(host.getByTestId('owed')).toHaveText('×2');
  await play(ben!.page, ['reverse']);
  await settle(ben!.page);
  await expect(host.getByText('Play goes ← right to left')).toBeVisible();
  await draw(ben!.page);
  // Play now goes back to Ana, then Hana, who finds the Black Hole face up on top.
  await draw(ana!.page);
  await expect(host.getByTestId('pile')).toContainText('face up on top!');
  await draw(host);
  await expect(ana!.page.getByText('Hana fell into Black Hole').first()).toBeVisible();
});

// The face-up Black Hole opens its details while it is on top of the draw pile; deeper down its
// stripe stays a plain mark. SCREENSHOTS=1 takes every size in both themes to test-results/shots.
const shots = !!process.env.SCREENSHOTS;
const RUNS = [
  ['phone360', { width: 360, height: 740 }],
  ['phone390', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 900 }],
] as const;
for (const [device, viewport, scheme] of shots
  ? RUNS.flatMap(([d, v]) => (['light', 'dark'] as const).map((s) => [d, v, s] as const))
  : ([[RUNS[0][0], RUNS[0][1], 'light']] as const))
  test(`expansion 1: the face-up Black Hole on top opens its details (${device}, ${scheme})`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
    const [hana, ana] = await sfTable(browser, ['Hana', 'Ana'], pageErrors, {
      viewport,
      colorScheme: scheme,
    });
    const host = hana!.page;
    const A = ana!.page;
    const shot = async (p: typeof host, name: string) => {
      if (shots)
        await p.screenshot({
          path: `test-results/shots/short-fuse-void-top-${device}-${scheme}-${name}.png`,
        });
    };
    await host.getByTestId('toggle-x1').click();
    await expect(A.getByTestId('readout')).toContainText('Black Hole');
    await riggedStart(host, {
      hands: [['cat1'], ['alter3']],
      top: ['void', 'cat2', 'cat3', 'cat4'],
    });
    await draw(host);
    await host.getByRole('button', { name: 'Top', exact: true }).click();
    await host.getByTestId('place-confirm').click();
    await expect(A.getByTestId('pile')).toContainText('face up on top!');
    await shot(A, 'pile');

    // A tap opens its details; Escape closes them and gives the focus back.
    const top = A.getByTestId('pile-top');
    await top.click();
    const details = A.getByRole('dialog', { name: 'Black Hole' });
    await expect(details).toBeVisible();
    await shot(A, 'details');
    await A.keyboard.press('Escape');
    await expect(details).toBeHidden();
    await expect(top).toBeFocused();
    // Enter opens it too, and the close button is the way back.
    await A.keyboard.press('Enter');
    await expect(details).toBeVisible();
    await details.getByRole('button', { name: 'Close' }).click();
    await expect(details).toBeHidden();
    await expect(host.getByTestId('pile-top')).toBeVisible();

    // Moved third, it is only a stripe in the side view, which opens nothing.
    await play(A, ['alter3']);
    await settle(A);
    const sheet = A.getByRole('dialog', { name: 'Rearrange the top of the pile' });
    await sheet.getByRole('button', { name: 'Move down' }).first().click();
    await sheet.getByRole('button', { name: 'Move down' }).nth(1).click();
    await expect(sheet.getByRole('listitem').nth(2)).toContainText('Black Hole');
    await A.getByTestId('order-confirm').click();
    for (const p of [host, A]) {
      await expect(p.getByTestId('pile')).toContainText('face up inside');
      await expect(p.getByTestId('void-stripe')).toBeVisible();
      await expect(p.getByTestId('pile-top')).toHaveCount(0);
      await expect(p.getByTestId('pile').getByRole('button')).toHaveCount(0);
    }
    await A.getByTestId('void-stripe').click({ force: true });
    await expect(A.getByRole('dialog')).toHaveCount(0);
    await shot(A, 'stripe');
  });
