import { type Browser, type Page, expect } from '@playwright/test';
import { type Player, unlock, visitor } from './inquest-play.ts';

// Helpers to play Séance through the UI. Cards are found by their `data-card` hooks (`suspect-12`,
// `vision-40`), so the helpers work with placeholders (no asset storage) and with real art alike.

export type { Player };

/** The first name creates a Séance room; the rest join it. */
export async function seanceTable(
  browser: Browser,
  names: string[],
  errors: string[],
  opts: Parameters<typeof visitor>[3] = {},
): Promise<Player[]> {
  const host = await visitor(browser, names[0]!, errors, opts);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Séance room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  const rest = await Promise.all(
    names.slice(1).map(async (n) => {
      const p = await visitor(browser, n, errors, opts);
      await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
      await expect(p).toHaveURL(host.url());
      return p;
    }),
  );
  const players = [host, ...rest].map((page, i) => ({ name: names[i]!, page }));
  await expect(host.getByText(`(${names.length}/7)`)).toBeVisible();
  return players;
}

/** The host makes `ghost` the ghost and begins. */
export async function begin(host: Page, ghost: string) {
  await host.getByRole('button', { name: 'Host picks', exact: true }).click();
  await host.getByLabel('Pick the ghost').getByRole('button', { name: ghost, exact: true }).click();
  await host.getByRole('button', { name: 'Begin the séance' }).click();
}

/** The ghost sends every psychic who needs one a one-card vision (the first card of the hand). */
export async function sendVisions(ghost: Page) {
  const needs = ghost.getByRole('button', { name: /^🔍 Choose .*’s vision$/ });
  await expect(needs.first()).toBeVisible();
  while ((await needs.count()) > 0) {
    await needs.first().click();
    const dialog = ghost.getByRole('dialog');
    await dialog
      .getByRole('region', { name: /Your hand/ })
      .locator('button[data-card]')
      .first()
      .click();
    const send = dialog.getByRole('button', { name: /^👻 Send 1 card to / });
    await send.click();
    await expect(dialog).toBeHidden();
  }
}

/** The card the ghost shows as `name`'s target (`suspect-12`), or null once they found all. */
export async function targetOf(ghost: Page, name: string): Promise<string | null> {
  const panel = ghost.getByRole('region', { name: `${name} (ghost view)` });
  const target = panel.getByRole('button', { name: new RegExp(`\\(${name}’s target\\)$`) });
  if ((await target.count()) === 0) return null;
  return target.getAttribute('data-card');
}

/** A psychic taps a candidate (the right one, or any other) and Ready. */
export async function guess(p: Page, card: string, right: boolean) {
  const list = p.getByRole('list', { name: 'Candidates' });
  const button = right
    ? list.locator(`button[data-card="${card}"]`)
    : list.locator(`button[data-card]:not([data-card="${card}"])`).first();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  const ready = p.getByRole('button', { name: 'Ready', exact: true });
  await ready.click();
  await expect(ready).toHaveCount(0);
}

/** One whole hour: visions, everyone guesses (right or wrong), then the ghost moves on. */
export async function playHour(ghost: Page, psychics: Player[], right: boolean | string[] = true) {
  await sendVisions(ghost);
  for (const p of psychics) {
    const card = await targetOf(ghost, p.name);
    if (card === null) continue;
    await guess(p.page, card, right === true || (Array.isArray(right) && right.includes(p.name)));
  }
  await nextHour(ghost);
}

export async function nextHour(ghost: Page) {
  const answers = ghost.getByRole('region', { name: 'The ghost answers' });
  await expect(answers).toBeVisible();
  // The verdicts also move on by themselves after a few seconds, so the button may go first.
  await ghost
    .getByRole('button', { name: /^(Next hour|To the final|See the end)$/ })
    .click({ timeout: 5000 })
    .catch(() => undefined);
  await expect(answers).toHaveCount(0);
}

/**
 * The screenshot tour (`SCREENSHOTS=1`): the lobby, the ghost's screen and compare view, a
 * psychic's vision, compare, others and table tabs, the verdicts, the shared vision, the vote and
 * the end. `prefix` names the files under test-results/shots.
 */
export async function seanceScreenshots(
  browser: Browser,
  label: 'desktop' | 'phone',
  opts: Parameters<typeof visitor>[3],
  prefix = 'seance',
) {
  const errors: string[] = [];
  const shot = (p: Page, name: string) =>
    p.screenshot({
      path: `test-results/shots/${prefix}-${label}-${name}.png`,
      fullPage: label === 'desktop',
    });
  const tab = async (p: Page, name: string) => {
    if (label === 'phone')
      await p
        .getByRole('navigation', { name: 'Game sections' })
        .getByRole('button', { name })
        .click();
  };
  const players = await seanceTable(browser, ['Gwen', 'Ana', 'Ben', 'Cy', 'Dee'], errors, opts);
  const [ghostP, ...psychics] = players as [Player, ...Player[]];
  const ghost = ghostP.page;
  const ana = psychics[0]!.page;
  // Ana picks the fifth psychic (purple).
  await ana.getByRole('region', { name: 'Your psychic' }).getByRole('button').nth(4).click();
  await shot(ghost, 'lobby');
  await begin(ghost, 'Gwen');
  await expect(ghost.getByText(/You’re the ghost: not a word/)).toBeVisible();
  await shot(ghost, 'ghost');
  await shot(ana, 'waiting');
  // The ghost's compare view: Ana's target over the hand.
  await ghost.getByRole('button', { name: /^🔍 Choose Ana’s vision$/ }).click();
  const dialog = ghost.getByRole('dialog');
  const hand = dialog.getByRole('region', { name: /Your hand/ }).locator('button[data-card]');
  await hand.nth(0).click();
  await hand.nth(2).click();
  await shot(ghost, 'ghost-compare');
  await dialog.getByRole('button', { name: /^👻 Send 2 cards to Ana$/ }).click();
  await expect(dialog).toBeHidden();
  await sendVisions(ghost);
  await tab(ghost, 'Hand');
  await shot(ghost, 'ghost-hand');
  await tab(ghost, 'Psychics');
  // Ben and Cy guess; Ana looks at her vision.
  for (const p of psychics.slice(1, 3))
    await guess(p.page, (await targetOf(ghost, p.name))!, p.name === 'Ben');
  await shot(ana, 'mine');
  await ana.getByRole('button', { name: '🔍 Compare' }).click();
  await shot(ana, 'compare');
  await ana.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await tab(ana, 'Others');
  await ana
    .getByRole('region', { name: 'Ben’s reading' })
    .getByRole('button', { name: '✓ Right' })
    .click();
  await ana
    .getByRole('region', { name: 'Cy’s reading' })
    .getByRole('button', { name: '✗ Wrong' })
    .click();
  await shot(ana, 'others');
  await tab(ana, 'Table');
  await shot(ana, 'table');
  await tab(ana, 'My vision');
  await guess(ana, (await targetOf(ghost, 'Ana'))!, true);
  await guess(psychics[3]!.page, (await targetOf(ghost, 'Dee'))!, false);
  await expect(ana.getByRole('region', { name: 'The ghost answers' })).toBeVisible();
  await shot(ana, 'reveal');
  await shot(ghost, 'ghost-reveal');
  await nextHour(ghost);
  // Play on (everyone right) until the final.
  const final = ghost.getByText(/Everyone found their cards! Pick the culprit/);
  const choose = ghost.getByRole('button', { name: /^🔍 Choose/ });
  for (;;) {
    await expect(final.or(choose.first())).toBeVisible();
    if (await final.isVisible()) break;
    await playHour(ghost, psychics);
  }
  const pick = ghost.getByRole('region', { name: 'Choose the shared vision' });
  await tab(ghost, 'Final');
  await expect(pick).toBeVisible();
  await ghost.getByRole('button', { name: 'This is the culprit (group 3)' }).click();
  for (let i = 0; i < 3; i++)
    await pick.getByRole('list', { name: 'Your hand' }).locator('button[data-card]').nth(i).click();
  await pick
    .getByRole('list', { name: 'Tags' })
    .getByRole('button', { name: /Suspect/ })
    .first()
    .click();
  await shot(ghost, 'ghost-shared');
  await pick.getByRole('button', { name: '👻 Send the shared vision' }).click();
  const voter = psychics.find((p) => p.name !== 'Ana')!.page;
  await expect(voter.getByText(/Vote now, in silence/)).toBeVisible();
  await shot(voter, 'vote');
  // Everyone votes when their turn comes.
  for (let round = 0; round < 3; round++) {
    for (const p of psychics) {
      const b = p.page.getByRole('button', { name: 'Vote for group 3' });
      if ((await b.count()) > 0) await b.click();
    }
  }
  await expect(
    ghost.getByRole('heading', { name: /The ghost (is at peace|wanders on)/ }),
  ).toBeVisible();
  await shot(ana, 'end');
  if (label === 'desktop') {
    const tv = await visitor(browser, 'Tv', errors, {
      viewport: { width: 1920, height: 1080 },
      colorScheme: 'dark',
    });
    await unlock(tv, `/backroom?next=${encodeURIComponent(new URL(ghost.url()).pathname)}`);
    await expect(tv.getByRole('heading', { name: /The ghost/ })).toBeVisible();
    await tv.screenshot({ path: `test-results/shots/${prefix}-tv-end.png`, fullPage: true });
    await tv.context().close();
  }
  for (const p of players) await p.page.context().close();
  expect(errors).toEqual([]);
}
