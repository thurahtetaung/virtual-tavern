import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom } from './inquest-play.ts';
import { play, riggedStart, settle, sfTable, sfVisitor } from './short-fuse-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// Every discarded card opens its details, from the face-up top card and from the pile browser
// (newest first), with a way back to the pile. SCREENSHOTS=1 also saves each step to
// test-results/shots (SHORT_FUSE_ART=<private art folder> previews the real art).
const shots = !!process.env.SCREENSHOTS;

// One theme per size in CI; screenshots take both.
const RUNS = [
  ['phone360', { width: 360, height: 740 }, 'light'],
  ['phone390', { width: 390, height: 844 }, 'dark'],
  ['desktop', { width: 1280, height: 900 }, 'light'],
] as const;
for (const [device, viewport, scheme] of shots
  ? RUNS.flatMap(([d, v]) => (['light', 'dark'] as const).map((s) => [d, v, s] as const))
  : RUNS)
  test(`Short Fuse discard cards open their details (${device}, ${scheme})`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const shot = async (p: typeof host, name: string) => {
      if (shots)
        await p.screenshot({
          path: `test-results/shots/short-fuse-discard-${device}-${scheme}-${name}.png`,
        });
    };
    await openBackroom(await sfVisitor(browser, 'Admin', pageErrors));
    const [hana, ana] = await sfTable(browser, ['Hana', 'Ana'], pageErrors, {
      viewport,
      colorScheme: scheme,
    });
    const host = hana!.page;
    const A = ana!.page;
    await riggedStart(host, {
      hands: [['skip', 'shuffle'], ['attack']],
      top: ['cat1', 'cat2', 'cat3', 'cat4'],
    });
    await play(host, ['shuffle']);
    await settle(host);
    await play(host, ['skip']);
    await settle(host);
    await play(A, ['attack']);
    await settle(A);

    for (const p of [host, A]) await expect(p.getByTestId('discard')).toHaveText('Discard (3)');

    // The face-up top card opens its details, which lead on to the whole pile.
    const top = host.getByTestId('discard-top');
    const topName = (await top.getAttribute('aria-label'))!.replace(
      /^Top of the discard pile: (.*)\. Details$/,
      '$1',
    );
    await top.click();
    const details = host.getByRole('dialog', { name: topName });
    await expect(details).toBeVisible();
    await expect(details.getByTestId('inspect-back')).toBeInViewport();
    await shot(host, 'top');
    await details.getByTestId('inspect-back').click();
    await expect(details).toBeHidden();

    // The pile browser lists every card newest first; each opens, and Back returns to the pile.
    const pile = host.getByRole('dialog', { name: 'Discard pile (3)' });
    await expect(pile).toBeVisible();
    const cards = pile.getByTestId('discard-card');
    await expect(cards).toHaveCount(3);
    const labels = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(labels[0]).toBe(`${topName}: details`);
    await shot(host, 'pile');
    for (const [i, label] of labels.entries()) {
      const name = label!.replace(/: details$/, '');
      await cards.nth(i).click();
      const sheet = host.getByRole('dialog', { name });
      await expect(sheet).toBeVisible();
      if (i === 2) await shot(host, 'card');
      if (i === 0) {
        // The keyboard way back: Escape closes the details and leaves the pile open.
        await host.keyboard.press('Escape');
      } else {
        await sheet.getByTestId('inspect-back').click();
      }
      await expect(sheet).toBeHidden();
      await expect(pile).toBeVisible();
      await expect(cards.nth(i)).toBeFocused();
    }
    // Enter opens a focused card too.
    await host.keyboard.press('Enter');
    await expect(
      host.getByRole('dialog', { name: labels[2]!.replace(/: details$/, '') }),
    ).toBeVisible();
    await host.keyboard.press('Escape');
    await host.keyboard.press('Escape');
    await expect(pile).toBeHidden();

    // The other player sees the same public pile.
    await A.getByTestId('discard').click();
    const theirs = await A.getByRole('dialog', { name: 'Discard pile (3)' })
      .getByTestId('discard-card')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    expect(theirs).toEqual(labels);
  });
