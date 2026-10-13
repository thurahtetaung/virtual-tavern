import { expect, test } from '@playwright/test';
import {
  NAMES,
  type Player,
  claim,
  claimSession,
  eligible,
  hydraTable,
  hydraVisitor,
  legislate,
  nominate,
  president,
  readRoles,
  voteAll,
  whoShows,
} from './hydra-play.ts';
import { openBackroom } from './inquest-play.ts';

// The server stacks red policies on top of every Hydra deck (`HYDRA_TEST_DECK`), so every session
// enacts red and the powers come quickly.

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** One government: nominate someone who isn't the Leader, everyone votes yes, red is enacted. */
async function government(players: Player[], avoid: (p: Player) => boolean = () => false) {
  const alive = players.filter((p) => !p.dead);
  const pres = await president(alive);
  const chan = await eligible(pres, alive, (p) => p.role === 'leader' || avoid(p));
  await nominate(pres, chan.name);
  await voteAll(alive);
  return legislate(alive, 'red');
}

test('five players: peek, mandatory claims, a skipped claim and an execution to the end', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await hydraVisitor(browser, 'Admin', pageErrors));
  const players = await hydraTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], pageErrors);
  const host = players[0]!.page;
  await expect(host.getByTestId('composition')).toContainText('3 Loyalists');
  await host.getByLabel('Claim timer').selectOption('20');
  await host.getByRole('button', { name: 'Start with 5 players' }).click();
  await readRoles(players);
  expect(players.filter((p) => p.role === 'leader')).toHaveLength(1);
  expect(players.filter((p) => p.role === 'red')).toHaveLength(1);

  // Two red policies, each followed by the government's claims (play waits for them).
  for (let i = 0; i < 2; i++) {
    const gov = await government(players);
    await expect(host.getByTestId('waiting-on')).toBeVisible();
    // The first President claims a blue card they never drew: the end screen calls it a lie.
    await claim(gov.pres, { blues: i === 0 ? 1 : 0 });
    await claim(gov.chan, { blues: 0 });
  }
  // The log names the President's stated discard and works out the Chancellor's.
  const second = host.getByTestId('round').filter({ hasText: '#2' }).first();
  await expect(second).toContainText('drew');
  await expect(second).toContainText(`discarded ${NAMES.red}`);
  await expect(second).toContainText(`→ discarded 1 ${NAMES.red}`);
  // The third red policy: the President peeks, then claims what they saw.
  const third = await government(players);
  await claimSession(third);
  const peeker = third.pres;
  const peek = peeker.page.getByRole('dialog', { name: 'Policy peek' });
  await peek.getByRole('button', { name: 'Show cards' }).click();
  await expect(peek.getByRole('button', { name: /policy \(card 3\)/ })).toBeVisible();
  await peek.getByRole('button', { name: 'Done: put them back' }).click();
  await claim(peeker, { cards: ['red', 'red', 'red'] });

  // The danger zone: the Chancellor is cleared, then the government doesn't both claim, so the
  // host skips the missing claim once the claim timer has run out.
  const fourth = await government(players);
  await expect(
    host
      .getByText(/Not Usurper ✓/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await claim(fourth.pres, { blues: 0 });
  for (const p of players)
    await expect(
      p.page.getByText(`${fourth.chan.name} (Chancellor) is choosing a claim…`).first(),
    ).toBeAttached();
  const skip = host.getByRole('button', { name: 'Skip claim' });
  if (fourth.chan.page === host) {
    // The host is the Chancellor: they claim, and the next round shows it.
    await claim(fourth.chan, { blues: 0 });
  } else {
    await expect(skip).toBeVisible({ timeout: 30_000 });
    await skip.click();
    await expect(host.getByText('(no claim, skipped by host)').first()).toBeAttached();
  }
  // The fourth red policy gives an execution: the President shoots the Leader if they can.
  const shooter = fourth.pres;
  const leader = players.find((p) => p.role === 'leader')!;
  const target =
    shooter === leader ? players.find((p) => p !== shooter && p.role !== 'leader')! : leader;
  await shooter.page.getByRole('button', { name: `Execution: ${target.name}` }).click();
  await shooter.page
    .getByTestId('dock')
    .getByRole('button', { name: `Execute ${target.name}…` })
    .click();
  await shooter.page
    .getByTestId('dock')
    .getByRole('button', { name: `Yes, execute ${target.name}` })
    .click();
  if (target === leader) {
    for (const p of players)
      await expect(p.page.getByTestId('winner')).toContainText('The Loyalists win!');
  } else {
    // A Conspirator President shot a Loyalist: they can't vote any more, and play goes on.
    await expect(target.page.getByText(/You’ve been executed/)).toBeVisible();
    target.dead = true;
    const fifth = await government(players);
    await claimSession(fifth);
    await expect(host.getByText(`executed ${target.name}`).first()).toBeAttached();
  }
  // The end shows every role and the truth beside the claims.
  if (target === leader) {
    await expect(host.getByRole('region', { name: 'The truth' })).toContainText('LIE');
    await expect(host.getByLabel('Everyone’s role').getByText('Usurper').first()).toBeVisible();
  }
});

test('seven players: investigate, a special election and the term-limit reasons', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await hydraVisitor(browser, 'Admin', pageErrors));
  const players = await hydraTable(
    browser,
    ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fin'],
    pageErrors,
  );
  const host = players[0]!.page;
  await host.getByRole('button', { name: 'Start with 7 players' }).click();
  await readRoles(players);
  const first = await government(players);
  await claimSession(first);
  // The next President sees the last government term-limited, with the reason on tap.
  const pres = await president(players);
  const limited = [first.pres, first.chan].find((p) => p !== pres)!;
  const seat = pres.page
    .getByRole('button', { name: new RegExp(`^${limited.name}: was the last elected`) })
    .filter({ visible: true });
  // It's aria-disabled (it can't be picked), but a tap explains why.
  await seat.click({ force: true });
  await expect(pres.page.getByRole('alert').filter({ hasText: 'term-limited' })).toBeVisible();
  // Red #2 at seven players: investigate.
  const chan = await eligible(pres, players, (p) => p.role === 'leader');
  await nominate(pres, chan.name);
  await voteAll(players);
  const second = await legislate(players, 'red');
  await claimSession(second);
  const inv = second.pres;
  const suspect = players.find((p) => p !== inv)!;
  await inv.page.getByRole('button', { name: `Investigate loyalty: ${suspect.name}` }).click();
  await inv.page
    .getByTestId('dock')
    .getByRole('button', { name: `Investigate ${suspect.name}` })
    .click();
  const team = suspect.role === 'blue' ? NAMES.blue : NAMES.red;
  await expect(inv.page.getByTestId('claim-form')).toContainText(
    `${suspect.name}’s party card is ${team}`,
  );
  await claim(inv, { team: 'blue' });
  for (const p of players)
    await expect(p.page.getByText(`says ${suspect.name} is`).first()).toBeAttached();
  // Red #3: a special election, then back to the left of the caller.
  const third = await government(players);
  await claimSession(third);
  const caller = third.pres;
  const pick = players.find(
    (p) => p !== caller && p !== players[(players.indexOf(caller) + 1) % 7],
  )!;
  await caller.page.getByRole('button', { name: `Special election: ${pick.name}` }).click();
  await caller.page
    .getByTestId('dock')
    .getByRole('button', { name: `Make ${pick.name} the next candidate` })
    .click();
  await expect(
    pick.page.getByText('You’re the Presidential Candidate: nominate a Chancellor.'),
  ).toBeVisible();
  const left = players[(players.indexOf(caller) + 1) % 7]!;
  await expect(host.getByTestId('next-president')).toContainText(left.name);
});

test('three failed governments: the people enact the top policy', async ({ browser }) => {
  test.setTimeout(180_000);
  await openBackroom(await hydraVisitor(browser, 'Admin', pageErrors));
  const players = await hydraTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], pageErrors);
  const host = players[0]!.page;
  await host.getByRole('button', { name: 'Start with 5 players' }).click();
  await readRoles(players);
  const everyone = players.map((p) => p.name);
  for (let i = 0; i < 3; i++) {
    const pres = await president(players);
    const chan = await eligible(pres, players, () => false);
    await nominate(pres, chan.name);
    await voteAll(players, everyone);
    if (i < 2)
      await expect(host.getByLabel(`Election tracker: ${i + 1} of 3 failed`).first()).toBeVisible();
  }
  await expect(host.getByTestId('chaos')).toBeVisible();
  await expect(host.getByTestId('chaos')).toBeHidden({ timeout: 10_000 });
  await expect(host.getByText(/Chaos: the people enacted/).first()).toBeAttached();
  await expect(host.getByLabel('Election tracker: 0 of 3 failed').first()).toBeVisible();
  await expect(host.getByTestId('deck-chip').first()).toContainText('10 Conspirator');
  await whoShows(players, 'You’re the Presidential Candidate: nominate a Chancellor.');
});
