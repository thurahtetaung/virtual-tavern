import { expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom, unlock, visitor } from './inquest-play.ts';
import {
  begin,
  guess,
  nextHour,
  playHour,
  reveal,
  seanceTable,
  sendVisions,
  targetOf,
} from './seance-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

test('a ghost and three psychics find everything, read the shared vision in stages and win', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Gwen', 'Ana', 'Ben', 'Cy'], pageErrors);
  const [ghost, ana, ben, cy] = players as [(typeof players)[0], ...typeof players];
  await ana!.page.getByRole('button', { name: /^The purple psychic/ }).click();
  await begin(ghost.page, 'Gwen');

  // The ghost is reminded to stay silent and sees every target; psychics see none.
  await expect(ghost.page.getByText(/You’re the ghost: not a word/)).toBeVisible();
  expect(await targetOf(ghost.page, 'Ana')).toMatch(/^suspect-\d+$/);
  for (const p of [ana!, ben!, cy!]) {
    await expect(p.page.getByText(/waiting for your vision from the ghost/)).toBeVisible();
    await expect(p.page.locator('[aria-label$="’s target)"]')).toHaveCount(0);
  }

  // Hour I: Ana puts ✓ on Ben's and Cy's guesses before guessing herself.
  await sendVisions(ghost.page);
  for (const p of [ben!, cy!]) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  for (const name of ['Ben', 'Cy']) {
    await ana!.page
      .getByRole('region', { name: `${name}’s reading` })
      .getByRole('button', { name: '✓ Right' })
      .click();
  }
  await guess(ana!.page, (await targetOf(ghost.page, 'Ana'))!, true);
  // Everyone is Ready, but nothing is judged until the ghost reveals; anyone may still back out.
  const waiting = (p: (typeof players)[0]) => p.page.getByRole('status', { name: 'Waiting for' });
  await expect(waiting(ben!)).toHaveText(/Everyone’s ready: waiting for the ghost to reveal/);
  const revealButton = ghost.page.getByRole('button', { name: '👻 Reveal the verdicts' });
  await expect(revealButton).toBeVisible();
  await ana!.page.getByRole('button', { name: '✓ Ready' }).click();
  await expect(revealButton).toHaveCount(0);
  await expect(waiting(ghost)).toHaveText(/✗ Ana not ready/);
  await ana!.page.getByRole('button', { name: 'Ready', exact: true }).click();
  await reveal(ghost.page);
  for (const p of players) {
    await expect(p.page.getByRole('region', { name: 'The ghost answers' })).toBeVisible();
    await expect(
      p.page.getByText('👻 The ghost revealed the verdicts', { exact: true }),
    ).toBeVisible();
  }
  await expect(ana!.page.getByText('Right! Next, your place.')).toBeVisible();
  await nextHour(ghost.page);

  // Hour II: everyone right, and Ana spends her last two tokens. Hour III: everyone right.
  await sendVisions(ghost.page);
  for (const p of [ben!, cy!]) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  for (const name of ['Ben', 'Cy']) {
    await ana!.page
      .getByRole('region', { name: `${name}’s reading` })
      .getByRole('button', { name: '✓ Right' })
      .click();
  }
  await guess(ana!.page, (await targetOf(ghost.page, 'Ana'))!, true);
  await nextHour(ghost.page);
  await playHour(ghost.page, [ana!, ben!, cy!]);

  // The final: Ana (4 + 4 tokens = level 8) votes last, after all three cards.
  const pick = ghost.page.getByRole('region', { name: 'Choose the shared vision' });
  await expect(pick).toBeVisible();
  await ghost.page.getByRole('button', { name: 'This is the culprit (group 2)' }).click();
  for (let i = 0; i < 3; i++)
    await pick.getByRole('list', { name: 'Your hand' }).locator('button[data-card]').nth(i).click();
  // Tag the first card privately (the tags show at the end).
  await pick
    .getByRole('list', { name: 'Tags' })
    .getByRole('button', { name: /Suspect/ })
    .first()
    .click();
  await pick.getByRole('button', { name: '👻 Send the shared vision' }).click();

  await expect(ben!.page.getByText(/Vote now, in silence/)).toBeVisible();
  await expect(
    ana!.page.getByText('You see more: you vote once 3 cards are face up.'),
  ).toBeVisible();
  // Only the first card is face up for the psychics.
  await expect(
    ben!.page
      .getByRole('region', { name: 'Shared vision' })
      .getByRole('img', { name: 'Face-down vision' }),
  ).toHaveCount(2);
  for (const p of [ben!, cy!])
    await p.page.getByRole('button', { name: 'Vote for group 2' }).click();
  await expect(ana!.page.getByText(/Vote now, in silence.*3 of 3/)).toBeVisible();
  await ana!.page.getByRole('button', { name: 'Vote for group 2' }).click();

  for (const p of players) {
    await expect(p.page.getByRole('heading', { name: 'The ghost is at peace' })).toBeVisible();
    await expect(p.page.getByRole('region', { name: 'What the ghost meant' })).toBeVisible();
  }
});

test('the clock runs out after the seventh hour', async ({ browser }) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Hal', 'Ida', 'Jo'], pageErrors);
  const [ghost, ...psychics] = players as [(typeof players)[0], ...typeof players];
  await begin(ghost.page, 'Hal');
  for (let hour = 1; hour <= 7; hour++) {
    await expect(ghost.page.getByRole('list', { name: /^Hour/ })).toHaveAttribute(
      'aria-label',
      new RegExp(`^Hour ${['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'][hour - 1]} of VII$`),
    );
    await playHour(ghost.page, psychics, false);
  }
  for (const p of players) {
    await expect(p.page.getByRole('heading', { name: 'The ghost wanders on' })).toBeVisible();
    await expect(p.page.getByText(/The seventh hour has passed/)).toBeVisible();
  }
});

test('when the ghost goes away, the host hands the seat to a new joiner, never a psychic', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Kim', 'Lou', 'Max'], pageErrors);
  const [host, lou, max] = players as [(typeof players)[0], ...typeof players];
  await begin(host.page, 'Max');
  await expect(max!.page.getByText(/You’re the ghost: not a word/)).toBeVisible();
  await sendVisions(max!.page);
  const url = host.page.url();
  await max!.page.context().close();

  await expect(host.page.getByText(/Waiting for the ghost \(Max, offline\)/)).toBeVisible();
  // Only people watching are offered: the psychics are not.
  await expect(host.page.getByRole('button', { name: /^Hand the ghost to/ })).toHaveCount(0);
  const zed = await visitor(browser, 'Zed', pageErrors);
  await unlock(zed, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
  await expect(zed).toHaveURL(url);
  await host.page.getByRole('button', { name: 'Hand the ghost to Zed' }).click();
  await host.page
    .getByRole('dialog', { name: 'Make Zed the ghost?' })
    .getByRole('button', { name: 'Hand the ghost over' })
    .click();
  await expect(zed.getByText(/You’re the ghost: not a word/)).toBeVisible();
  await expect(lou!.page.getByText(/Zed is the ghost now/)).toBeVisible();
  await expect(host.page.getByRole('button', { name: /^Hand the ghost to/ })).toHaveCount(0);

  // The new ghost carries on: the psychics guess, and the next hour's visions come from Zed.
  for (const p of [host, lou!]) await guess(p.page, (await targetOf(zed, p.name))!, true);
  await nextHour(zed);
  await sendVisions(zed);
  await expect(
    lou!.page.getByText('Your vision is here: which place does it point to?'),
  ).toBeVisible();
});

test('the host retires a departed psychic’s seat and the others play on to the line-up', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await seanceTable(browser, ['Gwen', 'Ana', 'Ben', 'Cy'], pageErrors);
  const [ghost, ana, ben, cy] = players as [(typeof players)[0], ...typeof players];
  await begin(ghost.page, 'Gwen');
  await expect(ghost.page.getByText(/You’re the ghost: not a word/)).toBeVisible();

  // Cy leaves for good: the ghost needn't send them a vision, and the host may retire the seat.
  await cy!.page.getByRole('button', { name: /^Players/ }).click();
  await cy!.page
    .getByRole('dialog', { name: 'Players' })
    .getByRole('button', { name: 'Leave room' })
    .click();
  await cy!.page
    .getByRole('dialog', { name: 'Leave this room?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
  await expect(ana!.page.getByText(/Cy left\. Someone watching can take over/)).toBeVisible();
  await sendVisions(ghost.page);
  await expect(ghost.page.getByRole('button', { name: /^🔍 Choose Cy’s vision$/ })).toHaveCount(0);
  await ghost.page.getByRole('button', { name: 'Retire Cy’s seat' }).click();
  await ghost.page
    .getByRole('dialog', { name: 'Retire Cy’s seat?' })
    .getByRole('button', { name: 'Retire the seat' })
    .click();
  await expect(ben!.page.getByText(/The host retired Cy’s seat/)).toBeVisible();
  await expect(ghost.page.getByRole('region', { name: 'Cy (ghost view)' })).toHaveCount(0);

  // Ana and Ben find everything; the line-up has their two groups only.
  const psychics = [ana!, ben!];
  for (const p of psychics) await guess(p.page, (await targetOf(ghost.page, p.name))!, true);
  await nextHour(ghost.page);
  const final = ghost.page.getByText(/Everyone found their cards! Pick the culprit/);
  const choose = ghost.page.getByRole('button', { name: /^🔍 Choose/ });
  for (;;) {
    await expect(final.or(choose.first())).toBeVisible();
    if (await final.isVisible()) break;
    await playHour(ghost.page, psychics);
  }
  await expect(
    ghost.page.getByRole('button', { name: 'This is the culprit (group 2)' }),
  ).toBeVisible();
  await expect(
    ghost.page.getByRole('button', { name: 'This is the culprit (group 3)' }),
  ).toHaveCount(0);
});
