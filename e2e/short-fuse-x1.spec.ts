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
