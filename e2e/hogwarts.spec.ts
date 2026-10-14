import { expect, test } from '@playwright/test';
import {
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
} from './hydra-play.ts';
import { MANIFEST, WORDS } from './hogwarts-manifest.ts';
import { openBackroom, unlock } from './inquest-play.ts';

// Hydra's themed edition, played with a made-up manifest: every name, a few copy lines and the
// team colours come from it, as the real (private) one does. Nothing of Hydra's own words may
// show. The server stacks red policies on top of every deck (`HYDRA_TEST_DECK`).

/**
 * Hydra's own words, which the edition replaces everywhere. (The room's header shows the game's
 * listed name, which the admin sets to the edition's title in production.)
 */
const HYDRA =
  /\b(President|Presidential|Chancellor|polic(y|ies)|Loyalists?|Conspirators?|Usurper)\b/i;

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const opts = { manifest: { gameId: 'hogwarts', body: MANIFEST } };

async function government(players: Player[]) {
  const alive = players.filter((p) => !p.dead);
  const pres = await president(alive);
  const chan = await eligible(pres, alive, (p) => p.role === 'leader');
  await nominate(pres, chan.name);
  await voteAll(alive);
  return legislate(alive, 'red');
}

/** The table's visible text, minus the room shell's own (game name, room chrome). */
async function gameText(player: Player) {
  return player.page.locator('main').innerText();
}

test("the back room's card and rules page use the edition's words", async ({ browser }) => {
  await openBackroom(await hydraVisitor(browser, 'Admin', pageErrors));
  const page = await hydraVisitor(browser, 'Hana', pageErrors, opts);
  await unlock(page);
  const tagline = /pass laws in secret, and find the Archon/;
  await expect(page.getByText(tagline)).toBeVisible();
  await expect(page.getByText(/Hydra’s hidden-role/)).toHaveCount(0);
  await page.goto('/rules/hogwarts');
  await expect(page.getByText(tagline).first()).toBeVisible();
  await expect(page.locator('main')).not.toContainText(HYDRA);
});

test('the themed edition: five players, a peek, claims with a discard and an execution', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await hydraVisitor(browser, 'Admin', pageErrors));
  const players = await hydraTable(
    browser,
    ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'],
    pageErrors,
    opts,
    WORDS,
  );
  const host = players[0]!.page;
  // The room header and the lobby name the edition alike, from its manifest.
  await expect(host.getByRole('heading', { name: 'Lantern', level: 1 })).toBeVisible();
  await expect(host.getByRole('heading', { name: 'Lantern', level: 2 })).toBeVisible();
  await expect(host.getByTestId('composition')).toContainText('3 Glows');
  await expect(host.getByTestId('composition')).toContainText('Sunlit and');
  await host.getByLabel('Claim timer').selectOption('20');
  await host.getByRole('button', { name: 'Start with 5 players' }).click();
  await readRoles(players);
  expect(players.filter((p) => p.role === 'leader')).toHaveLength(1);
  // On desktop the Me content shows once, in the sidebar (never again under the table).
  await expect(host.getByRole('region', { name: 'Your role card' })).toHaveCount(1);
  // The scoreboard explains itself in the edition's words.
  await host.getByTestId('scoreboard').click();
  await expect(host.getByTestId('score-legend')).toContainText('Glows: 0 of 5 Sunlit edicts');
  await expect(host.getByTestId('score-legend')).toContainText('electing the Archon as Keeper');
  await host.getByTestId('scoreboard').click();
  await expect(host.getByTestId('score-legend')).toBeHidden();

  // Two sessions with their claims; the President names their discard.
  for (let i = 0; i < 2; i++) {
    const gov = await government(players);
    await expect(host.getByText('Grill the Warden and the Keeper').first()).toBeVisible();
    await claim(gov.pres, { blues: i === 0 ? 1 : 0 });
    await claim(gov.chan, { blues: 0 });
  }
  const second = host.getByTestId('round').filter({ hasText: '#2' }).first();
  await expect(second).toContainText('(Warden) drew');
  await expect(second).toContainText('discarded Shadowed');
  await expect(second).toContainText('→ discarded 1 Shadowed');
  for (const p of players) expect(await gameText(p)).not.toMatch(HYDRA);

  // The peek, under the edition's name for it.
  const third = await government(players);
  await claimSession(third);
  const peek = third.pres.page.getByRole('dialog', { name: 'Glimpse' });
  await peek.getByRole('button', { name: 'Show cards' }).click();
  await expect(peek.getByRole('button', { name: /edict \(card 3\)/ })).toBeVisible();
  await peek.getByRole('button', { name: 'Done: put them back' }).click();
  await claim(third.pres, { cards: ['red', 'red', 'red'] });

  // The danger zone: the Keeper is cleared with the edition's own stamp.
  const fourth = await government(players);
  await expect(
    host
      .getByText(/Cleared: not Archon/)
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  await claimSession(fourth);

  // The fourth red edict gives the execution.
  const shooter = fourth.pres;
  const leader = players.find((p) => p.role === 'leader')!;
  const target =
    shooter === leader ? players.find((p) => p !== shooter && p.role !== 'leader')! : leader;
  await shooter.page.getByRole('button', { name: `Snuff: ${target.name}` }).click();
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
      await expect(p.page.getByTestId('winner')).toContainText('The Glows win!');
    await expect(host.getByRole('region', { name: 'The truth' })).toContainText('LIE');
    await expect(host.getByLabel('Everyone’s role').getByText('Archon').first()).toBeVisible();
  } else {
    await expect(target.page.getByText(/You’ve been executed/)).toBeVisible();
  }
  for (const p of players) expect(await gameText(p)).not.toMatch(HYDRA);
});
