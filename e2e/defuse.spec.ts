import { type Page, expect } from '@playwright/test';
import { defuseAll, lightsOn, open, settings, table } from './defuse-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// The e2e server builds every bomb from a fixed seed (see defuse-play.ts).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };

test('a bomb defused on a phone while the expert reads, then one that goes off', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  await expect(ana.getByTestId('defuser-line')).toContainText('The host defuses first');
  await ana.getByTestId('start').click();

  // Ana holds the bomb; Ben has the manual and sees nothing of it.
  await lightsOn(ana);
  await expect(ana.getByTestId('timer')).toHaveText(/^0[45]:\d\d$/);
  await expect(ben.getByTestId('status')).toContainText('Ana is defusing bomb 1');
  await expect(ben.getByTestId('defuser')).toHaveCount(0);
  await expect(ben.getByTestId('expert-clock')).toHaveCount(0);
  await ben.getByTestId('manual-search').fill('great');
  await expect(ben.getByTestId('index-password')).toBeVisible();
  await ben.getByTestId('index-password').click();
  await ben.getByRole('button', { name: 'Claim' }).click();
  await expect(ben.getByTestId('page-password')).toContainText('Claimed by');

  // The serial number is on one of the edges.
  const sides: string[] = [];
  for (const side of ['top', 'right', 'bottom', 'left']) {
    await ana.getByTestId(`view-${side}`).click();
    if (await ana.getByTestId('serial').filter({ visible: true }).count()) sides.push(side);
  }
  expect(sides).toHaveLength(1);
  await ana.getByTestId('view-front').click();

  await defuseAll(ana);
  for (const p of [ana, ben]) {
    await expect(p.getByTestId('outcome')).toHaveText('Defused');
    await expect(p.getByTestId('outcome-line')).toContainText('Ana defused bomb 1');
  }
  // Rotation: Ben is next.
  await expect(ana.getByTestId('defuser-line')).toContainText('Ben defuses next');

  // Hardcore: one wrong cut and it goes off in Ben's hands.
  await settings(ana);
  await ana.getByTestId('set-hardcore').click();
  await ana.getByTestId('next-bomb').click();
  await lightsOn(ben);
  await expect(ana.getByTestId('status')).toContainText('Ben is defusing bomb 2');
  const zoom = await open(ben, 'wires');
  await zoom.getByTestId('wire-1').click();
  for (const p of [ana, ben]) await expect(p.getByTestId('outcome')).toHaveText('Exploded');
  await expect(ana.getByTestId('outcome-line')).toContainText('Too many strikes');
  await expect(ana.getByTestId('result')).toContainText('✕');
});
