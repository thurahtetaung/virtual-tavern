import { type Browser, type Page, expect, test } from '@playwright/test';
import { YOUR_TURN, readCards, readyUp, votes } from './masquerade-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/') {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

test('four players play Masquerade: the spy escapes, steals a round, then guesses wrong', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
  await expect(host.getByText('Almost ready: 3 players are needed')).toBeVisible();
  const url = host.url();
  const others = await Promise.all(['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, url)));
  const players = [host, ...others];
  const names = new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben', 'Cy'][i]!]));
  await expect(host.getByText('Players (4/12)')).toBeVisible();
  await host.getByLabel('Rounds').selectOption('3');
  await expect(others[0]!.getByLabel('Rounds')).toHaveValue('3');
  await host.getByRole('button', { name: '4 min' }).click();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Round 1: the table names a local, so the spy escapes.
  let dealt = await readCards(players, names);
  const { spy, locals, location } = dealt;
  // Only the locals see the location: not on the spy's card, nor in the spy's ideas.
  await expect(spy.getByTestId('my-card')).not.toContainText(location);
  await expect(spy.getByText(`📍 For ${location}`)).toHaveCount(0);
  await expect(spy.getByTestId('still-possible')).toContainText('Still possible: 30');
  const spyIdeas = spy.getByRole('region', { name: 'Question ideas' });
  await expect(spyIdeas.getByText('Safe questions (fit anywhere)')).toBeVisible();
  const localIdeas = locals[0]!.getByRole('region', { name: 'Question ideas' });
  await expect(localIdeas.getByText(`📍 For ${location}`)).toBeVisible();
  await expect(locals[0]!.getByText('💡 Coaching:')).toBeVisible();
  // The first round says up front that the asking is out loud, and that the spy guesses only if caught.
  await expect(locals[0]!.getByText('The app doesn’t track the talking.')).toBeVisible();
  await expect(spy.getByTestId('spy-guess-rule')).toContainText('If the vote catches you');
  // Crossing a place off is the player's own note.
  const board = spy.getByRole('region', { name: 'Locations' });
  const other = location === 'Bakery' ? 'Gym' : 'Bakery';
  await board.getByRole('button', { name: other, exact: true }).click();
  await expect(board.getByRole('button', { name: other, exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(spy.getByTestId('still-possible')).toContainText('Still possible: 29');
  await expect(spy.getByTestId('nudge')).toBeHidden();
  await readyUp(players);
  const [l1, l2, l3] = locals as [Page, Page, Page];
  const n = (p: Page) => names.get(p)!;
  await votes([
    [l1, n(l2)],
    [l2, n(l1)],
    [l3, n(l1)],
    [spy, n(l1)],
  ]);
  for (const p of players) await expect(p.getByTestId('revealed-location')).toHaveText(location);
  await expect(host.getByRole('list', { name: 'Votes' })).toContainText(`→ ${n(l1)}`);
  await expect(host.getByText('escaped the vote: +2 for the spy.')).toBeVisible();
  await expect(host.getByTestId('vote-tally')).toContainText(`${n(l1)}`);
  await expect(host.getByTestId('vote-tally')).toContainText(' 3');
  await expect(host.getByTestId('points-rule')).toContainText('escapes the vote');
  await expect(spy.getByText('You were the spy')).toBeVisible();
  await host.getByRole('button', { name: 'Next round' }).click();

  // Round 2: the spy is caught, then names the location and steals the round.
  await expect(host.getByText('Round 2/3')).toBeVisible();
  dealt = await readCards(players, names);
  await readyUp(players);
  {
    const [a, b, c] = dealt.locals as [Page, Page, Page];
    const spyName = n(dealt.spy);
    await votes([
      [a, spyName],
      [b, spyName],
      [c, n(b)],
      [dealt.spy, n(a)],
    ]);
    await expect(dealt.spy).toHaveTitle(YOUR_TURN);
    await expect(a).not.toHaveTitle(YOUR_TURN);
    await expect(a.getByText(`${spyName} was caught as the spy and is guessing`)).toBeVisible();
    // The caught spy is spoken to as "you", and the table sees who it was in the votes.
    await expect(dealt.spy.getByTestId('nudge')).toHaveText(
      '🎯 You were caught! One guess at the location',
    );
    await expect(a.getByRole('list', { name: 'Votes' })).toContainText(`${spyName} 🎭 spy`);
    const guess = dealt.spy.getByRole('region', { name: 'Locations' });
    await guess.getByRole('button', { name: `Pick ${dealt.location}`, exact: true }).click();
    await guess.getByRole('button', { name: `Guess ${dealt.location}`, exact: true }).click();
    await expect(a.getByText('named the location: the spy steals the round, +2.')).toBeVisible();
  }
  await host.getByRole('button', { name: 'Next round' }).click();

  // Round 3: caught again, and a wrong guess hands the round to the locals.
  await expect(host.getByText('Round 3/3')).toBeVisible();
  dealt = await readCards(players, names);
  await readyUp(players);
  {
    const [a, b, c] = dealt.locals as [Page, Page, Page];
    const spyName = n(dealt.spy);
    await votes([
      [a, spyName],
      [b, spyName],
      [c, spyName],
      [dealt.spy, n(a)],
    ]);
    const wrong = dealt.location === 'Bakery' ? 'Gym' : 'Bakery';
    const guess = dealt.spy.getByRole('region', { name: 'Locations' });
    await guess.getByRole('button', { name: `Pick ${wrong}`, exact: true }).click();
    await guess.getByRole('button', { name: `Guess ${wrong}`, exact: true }).click();
    await expect(a.getByText(`guessed ${wrong}: the locals win the round.`)).toBeVisible();
    await expect(a.getByTestId('points-rule')).toContainText('every local scores 1');
  }
  // The game is over: a podium for everyone.
  for (const p of players) await expect(p.getByLabel('Podium')).toBeVisible();
  await expect(host.getByText(/wins? the game!/).first()).toBeVisible();
});
