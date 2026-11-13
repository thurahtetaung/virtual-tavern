import { type Page, expect } from '@playwright/test';

export const YOUR_TURN = /^● Your turn/;
const SPY = 'You’re the spy';

export interface Dealt {
  spy: Page;
  locals: Page[];
  location: string;
  names: Map<Page, string>;
}

/**
 * Reads each page's card through its peek (Show, read, Hide): exactly one spy, and every local holds
 * the same location. The cards are left covered, as they are dealt.
 */
export async function readCards(players: Page[], names: Map<Page, string>): Promise<Dealt> {
  const titles: string[] = [];
  for (const p of players) {
    const title = p.getByTestId('card-title');
    await expect(p.getByTestId('card-cover')).toBeVisible();
    await expect(title).toHaveCount(0);
    await p.getByRole('button', { name: 'Show your card' }).click();
    await expect(title).toBeVisible();
    titles.push(await title.innerText());
    await p.getByRole('button', { name: 'Hide your card' }).click();
    await expect(title).toHaveCount(0);
  }
  const spies = players.filter((_, i) => titles[i] === SPY);
  expect(spies).toHaveLength(1);
  const locals = players.filter((_, i) => titles[i] !== SPY);
  const location = titles.find((t) => t !== SPY)!;
  for (const t of titles.filter((t) => t !== SPY)) expect(t).toBe(location);
  return { spy: spies[0]!, locals, location, names };
}

/** Everyone taps Ready to vote; the vote opens and every player is asked to vote. */
export async function readyUp(players: Page[]) {
  const [first, ...rest] = players as [Page, ...Page[]];
  await first.getByRole('button', { name: 'Ready to vote' }).click();
  await expect(rest[0]!.getByTestId('nudge')).toContainText(`1 of ${players.length} ready to vote`);
  for (const p of rest) await p.getByRole('button', { name: 'Ready to vote' }).click();
  for (const p of players) {
    await expect(p.getByRole('region', { name: 'Vote' })).toBeVisible();
    await expect(p).toHaveTitle(YOUR_TURN);
  }
  await expect(first.getByTestId('nudge')).toHaveText(`🗳️ 0 of ${players.length} voted`);
}

/** Casts the votes in order; every vote but the last is checked in before the next. */
export async function votes(ballots: [Page, string][]) {
  for (const [i, [p, name]] of ballots.entries()) {
    await p.getByRole('button', { name: `Vote for ${name}` }).click();
    if (i < ballots.length - 1) {
      await expect(p.getByRole('button', { name: `Vote for ${name}` })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(p).not.toHaveTitle(YOUR_TURN);
    }
  }
}
