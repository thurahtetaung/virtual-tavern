import { type Page, expect } from '@playwright/test';
import { flat, lightsOn, open, results, settings, table } from './defuse-play.ts';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';

// Missions and the different manual. The e2e server builds every bomb from DEFUSE_TEST_SEED and
// gives every different manual that seed too, so both bombs below are known:
// - Mission 1.1 (front face only): a blue DETONATE button to press and let go, six wires
//   (cut the fourth) and a keypad (keys 3, 1, 2, 4).
// - Free Play under the different manual: the same three modules as the printed manual's bomb,
//   but its five wires say "Otherwise, cut the third wire" (the printed manual cuts the first).

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const PHONE = { width: 390, height: 844 };
const SHOTS = process.env.DEFUSE_WAVE2_SHOTS;
const shot = async (p: Page, name: string) => {
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The binder's results page names the mission; then Back to the results. */
async function binder(p: Page, how: 'Defused' | 'Exploded', mission: string) {
  await expect(p.getByTestId('binder-outcome')).toHaveText(how, { timeout: 30_000 });
  await p.getByTestId('binder').click();
  await expect(p.getByTestId('binder')).toHaveAttribute('data-done', 'yes');
  await expect(p.getByTestId('binder-page')).toContainText(mission);
  await p.getByTestId('binder-back').click();
  await expect(p.getByTestId('outcome')).toHaveText(how);
  await expect(p.getByTestId('outcome-mission')).toContainText(mission);
}

test('the host picks a bomb binder mission and the table plays it to the end', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  await flat([ana, ben]);

  // Every mission is there from the start; picking one replaces Free Play's own settings.
  await settings(ana);
  await expect(ana.getByTestId('set-mission').locator('option')).toHaveCount(33);
  await ana.getByTestId('set-mission').selectOption('s1-1');
  await expect(ana.getByTestId('mission-card')).toContainText('Mission 1.1');
  await expect(ana.getByTestId('mission-card')).toContainText('5:00 · 3 modules');
  await expect(ana.getByTestId('mission-card')).toContainText('front face only');
  await expect(ana.getByTestId('set-modules')).toHaveCount(0);
  await shot(ana, 'lobby-mission');
  await expect(ben.getByTestId('lobby')).toContainText('Mission 1.1');

  await ana.getByTestId('start').click();
  await lightsOn(ana);
  await expect(ana.getByTestId('timer')).toHaveText(/^0[45]:\d\d$/);
  // Front face only: the rear holds nothing.
  await ana.getByTestId('view-rear').click();
  await expect(ana.locator('[data-testid^="slot-"]:visible [data-kind]')).toHaveCount(0);

  let zoom = await open(ana, 'button');
  await zoom.getByTestId('big-button').click();
  await expect(zoom.locator('[data-kind="button"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(ana, 'wires');
  await zoom.getByTestId('wire-3').click();
  await expect(zoom.locator('[data-kind="wires"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(ana, 'keypad');
  for (const k of [2, 0, 1, 3]) await zoom.getByTestId(`key-${k}`).click();

  for (const p of [ana, ben]) await binder(p, 'Defused', 'Mission 1.1');
  // Back to Free Play: its settings return.
  await settings(ana);
  await ana.getByTestId('set-mission').selectOption('');
  await expect(ana.getByTestId('set-modules')).toBeVisible();
});

test('a different manual: the experts read its rules and the bomb follows them', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const [ana, ben] = (await table(browser, ['Ana', 'Ben'], { viewport: PHONE })) as [Page, Page];
  await flat([ana, ben]);

  await settings(ana);
  await ana.getByTestId('manual-each').click();
  await ana.getByTestId('set-helpers').click();
  await shot(ana, 'lobby-manual');

  await ana.getByTestId('start').click();
  await lightsOn(ana);
  // The manual is the bomb's own: marked as different, never with a number on it.
  await expect(ben.getByTestId('manual-cover')).toHaveText(
    /A different manual: new with this bomb/,
  );
  await expect(ben.getByTestId('manual-cover')).not.toHaveText(/\d/);
  await ben.getByTestId('index-wires').click();
  const page = ben.getByTestId('page-wires');
  await expect(page).toContainText('Otherwise, cut the third wire.');
  // The printed manual's page images would be wrong: none is offered.
  await expect(page.getByRole('button', { name: 'Page' })).toHaveCount(0);
  await shot(ben, 'manual-page');

  // The wire table lookup: blue, black, blue, black, red from the top.
  const colour = async (i: number, want: string) => {
    const b = ben.getByTestId(`lookup-wire-${i}`);
    for (let n = 0; n < 5 && !((await b.textContent()) ?? '').endsWith(want); n++) await b.click();
    await expect(b).toHaveText(`${i + 1}. ${want}`);
  };
  await ben.getByRole('button', { name: 'One wire more' }).click();
  await ben.getByRole('button', { name: 'One wire more' }).click();
  for (const [i, c] of ['blue', 'black', 'blue', 'black', 'red'].entries()) await colour(i, c);
  await expect(ben.getByTestId('wires-answer')).toHaveText('Cut the third wire (blue).');
  await shot(ben, 'helper-wires');
  if (SHOTS) {
    // The maze tracer: the first maze's circle, then a light and a triangle.
    await ben.getByRole('button', { name: '◂ Index' }).click();
    await ben.getByTestId('index-maze').click();
    for (const cell of ['0-0', '1-1', '4-3']) await ben.getByTestId(`tracer-${cell}`).click();
    await expect(ben.getByTestId('tracer-step')).toContainText('Maze 1:');
    await ben.getByTestId('tracer-step').scrollIntoViewIfNeeded();
    await shot(ben, 'helper-maze');
  }

  // Ana cuts what the different manual says, then the rest as the printed manual would.
  let zoom = await open(ana, 'wires');
  await zoom.getByTestId('wire-2').click();
  await expect(zoom.locator('[data-kind="wires"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(ana, 'keypad');
  for (const k of [0, 3, 2, 1]) await zoom.getByTestId(`key-${k}`).click();
  await expect(zoom.locator('[data-kind="keypad"]')).toHaveAttribute('data-solved', '1');
  zoom = await open(ana, 'password');
  for (const [c, letter] of [...'GREAT'].entries()) {
    const shown = zoom.getByTestId(`pw-letter-${c}`);
    for (let i = 0; i < 6; i++) {
      const before = (await shown.textContent()) ?? '';
      if (before === letter) break;
      await zoom.getByTestId(`pw-down-${c}`).click();
      await expect(shown).not.toHaveText(before);
    }
    await expect(shown).toHaveText(letter);
  }
  await zoom.getByTestId('pw-submit').click();
  for (const p of [ana, ben]) await results(p, 'Defused');
  await expect(ana.getByTestId('result')).toContainText('0 strikes');
});
