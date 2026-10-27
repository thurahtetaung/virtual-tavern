import { type Page, expect } from '@playwright/test';
import { readCards, readyUp, votes } from './masquerade-play.ts';

/**
 * Plays one one-round Masquerade game: the locals vote for each other and the spy joins in, so the
 * spy escapes with no votes at all. Ends on everyone's podium. Returns the spy.
 */
export async function playEscape(players: Page[], names: Map<Page, string>) {
  const dealt = await readCards(players, names);
  await readyUp(players);
  const [a, b] = dealt.locals as [Page, Page];
  await votes([
    [a, names.get(b)!],
    [b, names.get(a)!],
    [dealt.spy, names.get(a)!],
  ]);
  for (const p of players) await expect(p.getByLabel('Podium')).toBeVisible();
  return dealt;
}

/** Phones show the end one part at a time (`EndTabs`): the awards are a tab of their own. */
export async function openAwards(p: Page) {
  if ((p.viewportSize()?.width ?? 1280) < 1024) await p.getByTestId('end-tabs-awards').click();
}

/** The end screen's superlatives show on every device (on phones, under the Awards tab). */
export async function expectStrips(players: Page[]) {
  for (const p of players) {
    await openAwards(p);
    const strip = p.getByRole('region', { name: 'Superlatives' });
    await expect(strip).toBeVisible();
    await expect(strip.locator('dt').first()).toBeVisible();
  }
}

/** The host wraps up; the recap opens on every device. */
export async function wrapUp(host: Page, players: Page[]) {
  await host.getByRole('button', { name: '🍻 Wrap up the night' }).first().click();
  await confirmWrap(host);
  for (const p of players) {
    const sheet = p.getByRole('dialog', { name: /at the tavern/ });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Wrapped up')).toBeVisible();
  }
}

/** Answers the host's "Wrap up the night?" question. */
export async function confirmWrap(host: Page) {
  await host
    .getByRole('dialog', { name: 'Wrap up the night?' })
    .getByRole('button', { name: 'Wrap up', exact: true })
    .click();
}
