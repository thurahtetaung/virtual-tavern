import { type Browser, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
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
  // Covered, the spy's and a local's screens say the same: no role chip, no card, no coaching,
  // no ideas for the card and no mark on the real location, and none of it in the page.
  for (const p of [spy, locals[0]!]) {
    await expect(p.getByTestId('card-cover')).toBeVisible();
    // (The rules guide says “You’re the spy” in general terms on every page: the card's title is the tell.)
    await expect(p.getByTestId('card-title')).toHaveCount(0);
    await expect(p.getByText('💡 Coaching:')).toHaveCount(0);
    await expect(p.getByText('Safe questions (fit anywhere)')).toHaveCount(0);
    await expect(p.getByText(`📍 For ${location}`)).toHaveCount(0);
    await expect(p.getByText('📍 Here')).toHaveCount(0);
    await expect(p.getByText(/^(🎭 Spy|📍 Local)$/)).toHaveCount(0);
    await expect(p.getByText('Peek at your card. Locals: find the spy')).toBeVisible();
  }
  // Only the locals see the location: not on the spy's card, nor in the spy's ideas.
  await spy.getByRole('button', { name: 'Show your card' }).click();
  await expect(spy.getByTestId('my-card')).not.toContainText(location);
  await expect(spy.getByTestId('spy-guess-rule')).toContainText('If the vote catches you');
  await spy.getByRole('button', { name: 'Hide your card' }).click();
  await expect(spy.getByTestId('my-card')).toHaveCount(0);
  await expect(spy.getByTestId('still-possible')).toContainText('Still possible: 30');
  const spyIdeas = spy.getByRole('region', { name: 'Question ideas' });
  await spyIdeas.getByRole('button', { name: 'Show ideas for your card' }).click();
  await expect(spyIdeas.getByText('Safe questions (fit anywhere)')).toBeVisible();
  await expect(spy.getByText(`📍 For ${location}`)).toHaveCount(0);
  const localIdeas = locals[0]!.getByRole('region', { name: 'Question ideas' });
  await localIdeas.getByRole('button', { name: 'Show ideas for your card' }).click();
  await expect(localIdeas.getByText(`📍 For ${location}`)).toBeVisible();
  // Holding the cover shows the card only while held.
  const cover = locals[0]!.getByRole('button', { name: 'Hold to see your card' });
  await cover.hover();
  await locals[0]!.mouse.down();
  await expect(locals[0]!.getByTestId('card-title')).toHaveText(location);
  await expect(locals[0]!.getByText('💡 Coaching:')).toBeVisible();
  await locals[0]!.mouse.up();
  await expect(locals[0]!.getByTestId('card-title')).toHaveCount(0);
  // The first round says up front that the asking is out loud, and that the spy guesses only if caught.
  await expect(locals[0]!.getByText('The app doesn’t track the talking.')).toBeVisible();
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
  await expect(host.getByText(/escaped the vote: (.+ scores|you score) 2\./)).toBeVisible();
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
    await expect(
      a.getByText(`named the location and stole the round: ${spyName} scores 2`),
    ).toBeVisible();
    await expect(a.getByTestId('named-line')).toHaveText(`The vote named ${spyName}.`);
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

test('on a phone the card stays covered until you peek, and the board marks nothing', async ({
  browser,
}) => {
  const phone = async (name: string, url = '/') => {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
    await page.goto(url);
    return page;
  };
  const host = await phone('Hana');
  await host.getByRole('button', { name: 'Create a Masquerade room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const others = await Promise.all(['Ana', 'Ben'].map((n) => phone(n, host.url())));
  const players = [host, ...others];
  await expect(host.getByText('Players (3/12)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  const { spy, locals, location } = await readCards(
    players,
    new Map(players.map((p, i) => [p, ['Hana', 'Ana', 'Ben'][i]!])),
  );
  const local = locals[0]!;
  for (const p of [spy, local]) {
    await expect(p.getByRole('button', { name: 'Hold to see your card' })).toBeVisible();
    await expect(p.getByTestId('card-title')).toHaveCount(0);
    await expect(p.getByText(/^(🎭 Spy|📍 Local)$/)).toHaveCount(0);
  }
  // Hold: the card shows while the finger is down, and goes as soon as it lifts.
  await local.getByRole('button', { name: 'Hold to see your card' }).hover();
  await local.mouse.down();
  await expect(local.getByTestId('card-title')).toHaveText(location);
  await local.mouse.up();
  await expect(local.getByTestId('card-title')).toHaveCount(0);
  // The Locations tab rings nothing for a local, and the Ideas tab keeps the card's ideas peeked.
  await local.getByRole('navigation', { name: 'Game sections' }).getByText('Locations').click();
  const board = local.getByRole('region', { name: 'Locations' });
  await expect(board.getByRole('button', { name: location, exact: true })).toBeVisible();
  await expect(board.getByText('📍 Here')).toHaveCount(0);
  await local.getByRole('navigation', { name: 'Game sections' }).getByText('Ideas').click();
  const ideas = local.getByRole('region', { name: 'Question ideas' });
  await expect(ideas.getByText(`📍 For ${location}`)).toHaveCount(0);
  await ideas.getByRole('button', { name: 'Show ideas for your card' }).click();
  await expect(ideas.getByText(`📍 For ${location}`)).toBeVisible();
  await ideas.getByRole('button', { name: 'Hide ideas for your card' }).click();
  await expect(ideas.getByText(`📍 For ${location}`)).toHaveCount(0);
});
