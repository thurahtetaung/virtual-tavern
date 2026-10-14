import { type Page, expect, test } from '@playwright/test';
import {
  type Player,
  commitCrime,
  dismissEvent,
  endDiscussion,
  firstRound,
  openBackroom,
  placeBullets,
  presentAll,
  replaceTile,
  startPresentations,
  solve,
  table,
  visitor,
  whoShows,
  withRole,
} from './inquest-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** The host makes `fs` the Forensic Scientist (host picks) and sets toggles off and on. */
async function setUp(host: Page, fs: string, off: string[] = [], on: string[] = []) {
  await host.getByRole('button', { name: 'Host picks', exact: true }).click();
  await host
    .getByLabel('Pick the Forensic Scientist')
    .getByRole('button', { name: fs, exact: true })
    .click();
  for (const name of off) await host.getByRole('button', { name: `✓ ${name}` }).click();
  for (const name of on) {
    await host.getByRole('button', { name, exact: true }).click();
    await expect(host.getByRole('button', { name: `✓ ${name}` })).toBeVisible();
  }
  await host.getByRole('button', { name: 'Start the investigation' }).click();
}

const byName = (players: Player[], name: string) => players.find((p) => p.name === name)!;

test('six players with the Accomplice and Witness: a wrong solve, a right one, then the Reversal', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve'], pageErrors);
  const host = players[0]!;
  await expect(
    host.page.getByText(/6 players: .*Accomplice, Witness and 2 Investigators/),
  ).toBeVisible();
  await setUp(host.page, 'Hana', ['Event tiles'], ['Presentations']);

  const murderer = await commitCrime(players);
  await expect(host.page.getByText('Pick the Location tile for this crime.')).toBeVisible();
  const rest = players.filter((p) => p !== host && p !== murderer);
  const accomplice = await withRole(rest, 'Accomplice');
  const witness = await withRole(rest, 'Witness');
  const investigators = rest.filter((p) => p !== accomplice && p !== witness);
  expect(investigators).toHaveLength(2);
  // The Witness sees the two culprits, not which is which; Investigators see no answer.
  await witness.page.getByRole('button', { name: 'Reveal your role card' }).click();
  await expect(
    witness.page.getByText(
      new RegExp(
        `You saw (${murderer.name} and ${accomplice.name}|${accomplice.name} and ${murderer.name}) leave the scene`,
      ),
    ),
  ).toBeVisible();
  for (const p of investigators) await expect(p.page.getByText('The answer:')).toHaveCount(0);
  await expect(host.page.getByText('🤫 The answer:')).toBeVisible();
  // The Forensic Scientist is public: their card lies face up, and everyone else sees who it is.
  const nav = host.page.getByRole('navigation', { name: 'Game sections' });
  if (await nav.isVisible()) await nav.getByRole('button', { name: 'Me' }).click();
  await expect(
    host.page.getByRole('img', { name: 'Your role card: Forensic Scientist' }),
  ).toBeVisible();
  await expect(host.page.getByText('Everyone knows you’re the Forensic Scientist.')).toBeVisible();
  await expect(host.page.getByRole('button', { name: 'Reveal your role card' })).toHaveCount(0);
  if (await nav.isVisible()) await nav.getByRole('button', { name: 'Scene' }).click();
  for (const p of rest) await expect(p.page.getByText('🔬 Forensic Scientist: Hana')).toBeVisible();
  // The four Location tiles look alike, so the picker letters them.
  for (const letter of ['A', 'B', 'C', 'D'])
    await expect(
      host.page.getByRole('button', { name: `Tile: Location ${letter}`, exact: true }),
    ).toBeVisible();

  await firstRound(host.page);
  await expect(
    host.page.getByRole('list', { name: 'Bullet order' }).getByRole('listitem'),
  ).toHaveCount(6);
  // The table discusses the evidence before anyone presents: a soft clock for everyone, and only
  // the Forensic Scientist can start the presentations.
  for (const p of players) {
    const bar = p.page.getByRole('region', { name: 'Discussion' });
    await expect(bar.getByText('💬 Discuss the evidence')).toBeVisible();
    await expect(bar.getByRole('timer')).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Start presentations' })).toHaveCount(
      p === host ? 1 : 0,
    );
  }
  // Timings never show: the bullet timeline is order only.
  await expect(host.page.getByText(/after \d+ s/)).toHaveCount(0);

  // A wrong guess on the Murderer's cards spends the badge.
  const [wrong, right] = investigators as [Player, Player];
  await solve(wrong.page, murderer.name, 1, 0);
  for (const p of players)
    await expect(
      p.page.getByText(new RegExp(`❌ ${wrong.name} named ${murderer.name}`)),
    ).toBeVisible();
  await expect(wrong.page.getByRole('button', { name: /🔎 Solve · used/ }).first()).toBeDisabled();

  // The first speaker presents; then the right answer opens the Reversal.
  await presentAll(players, 1);
  await solve(right.page, murderer.name, 0, 0);
  for (const p of investigators)
    await expect(p.page.getByText('Solved! But the culprits get one last chance')).toBeVisible();

  const accPanel = accomplice.page.getByRole('region', { name: 'The Reversal' });
  await accPanel.getByRole('button', { name: new RegExp(`^${witness.name}`) }).click();
  const murPanel = murderer.page.getByRole('region', { name: 'The Reversal' });
  // The Murderer sees the Accomplice's tap; nobody else sees either.
  await expect(
    murPanel.getByRole('button', { name: new RegExp(`^${witness.name}.*👈 ${accomplice.name}`) }),
  ).toBeVisible();
  for (const p of investigators)
    await expect(
      p.page.getByRole('region', { name: 'The Reversal' }).getByRole('button'),
    ).toHaveCount(0);
  await murPanel.getByRole('button', { name: new RegExp(`^${witness.name}`) }).click();
  await murPanel.getByRole('button', { name: `Final answer: ${witness.name}` }).click();

  for (const p of players)
    await expect(
      p.page.getByText(
        `${right.name} solved it, but the culprits found the Witness (${witness.name}): the Murderer’s side wins.`,
      ),
    ).toBeVisible();
  // The end shows everyone's role and the bullet timeline.
  await expect(host.page.getByRole('heading', { name: 'Who was who' })).toBeVisible();
  await expect(host.page.getByText(`${murderer.name} · Murderer`).first()).toBeVisible();
  await expect(
    host.page.getByRole('list', { name: 'Bullet timeline' }).getByRole('listitem'),
  ).toHaveCount(6);
  // Play again keeps the settings.
  await host.page.getByRole('button', { name: 'Play again (same settings)' }).click();
  await commitCrime(players);
  await expect(host.page.getByText('Pick the Location tile for this crime.')).toBeVisible();
});

test('four players: events come up in round 2, through the last call that ends it', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(browser, ['Hal', 'Ida', 'Jon', 'Kim'], pageErrors);
  const host = players[0]!;
  // The printed rules: presentations, and no final accusations.
  await setUp(host.page, 'Hal', ['Final accusations'], ['Presentations']);
  const murderer = await commitCrime(players);
  await firstRound(host.page);
  await presentAll(players, 3);

  // Round 2 draws the events first (the test server orders them): flip a Clue card each…
  await dismissEvent(players, /Event: Cleared Evidence/);
  for (let i = 0; i < 3; i++) {
    const flipper = await whoShows(
      players,
      'Your turn: flip one of your own Clue cards face down.',
    );
    const panel = flipper.page.getByRole('region', { name: 'Flip a Clue card' });
    // The Murderer's Key Evidence (their first Clue card) looks like any other card, so a glance
    // at their screen gives nothing away; flipping it gets a plain refusal.
    if (flipper === murderer) {
      const key = panel.getByRole('button', { name: /^Clue:/ }).first();
      await expect(key).toBeEnabled();
      await expect(panel.getByText('KEY', { exact: true })).toHaveCount(0);
      await key.click();
      await panel.getByRole('button', { name: /^Flip / }).click();
      await expect(panel.getByText('Pick a different card.')).toBeVisible();
      await expect(panel.getByRole('button', { name: /\(ruled out\)/ })).toHaveCount(0);
    }
    await panel
      .getByRole('button', { name: /^Clue:/ })
      .and(panel.locator(':enabled'))
      .nth(flipper === murderer ? 1 : 0)
      .click();
    await panel.getByRole('button', { name: /^Flip / }).click();
    await expect(panel.getByRole('button', { name: /^Flip / })).toHaveCount(0);
  }
  await expect(host.page.getByRole('button', { name: /\(ruled out\)/ })).toHaveCount(3);

  // …a bullet moves…
  await dismissEvent(players, /Event: Shifted Bullet/);
  await expect(
    host.page.getByText('Move one bullet to another item on the same tile.'),
  ).toBeVisible();
  await host.page.locator('button[data-item][data-marked="false"]:visible').first().click();
  await host.page.getByRole('button', { name: /^Move the bullet to/ }).click();

  // …and the last call: two tiles swap in, and this round is the last.
  await dismissEvent(players, /Event: Last Call/);
  await replaceTile(host.page);
  await replaceTile(host.page);
  await placeBullets(host.page, 2);
  for (const p of players)
    await expect(
      p.page.getByText(
        '⏳ Last Call: this is the last round. After its presentations, the game ends.',
      ),
    ).toBeVisible();
  // Then the round's own tile, and the discussion.
  await replaceTile(host.page);
  await placeBullets(host.page, 1);
  await startPresentations(players);
  const speaker = await whoShows(players, /^Your turn to present.*Last chance!/);
  expect(speaker).toBeTruthy();
  await presentAll(players, 3, false);
  for (const p of players)
    await expect(
      p.page.getByText('Time’s up: nobody named the crime, so the Murderer’s side wins.'),
    ).toBeVisible();
});

test('the host hands the case over when the Forensic Scientist drops out', async ({ browser }) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(browser, ['Lou', 'Max', 'Nia', 'Oz'], pageErrors);
  const host = players[0]!;
  await setUp(host.page, 'Max', ['Event tiles']);
  await commitCrime(players);
  const fs = byName(players, 'Max');
  await expect(fs.page.getByText('Pick the Location tile for this crime.')).toBeVisible();
  await fs.page.context().close();
  const left = players.filter((p) => p !== fs);

  await expect(
    host.page.getByText('⏸ Waiting for the Forensic Scientist (Max, offline).'),
  ).toBeVisible();
  await host.page.getByRole('button', { name: 'Hand over' }).click();
  const next = await whoShows(left, 'Pick the Location tile for this crime.');
  for (const p of left)
    await expect(
      p.page.getByText(
        `${next.name} is now the Forensic Scientist. ${next.name}’s cards stay on the table`,
      ),
    ).toBeVisible();
  // The new Forensic Scientist sees the answer and can no longer solve.
  await expect(next.page.getByText('🤫 The answer:')).toBeVisible();
  await expect(next.page.getByRole('button', { name: /🔎 Solve/ })).toHaveCount(0);
  await firstRound(next.page);
  await expect(
    next.page.getByRole('list', { name: 'Bullet order' }).getByRole('listitem'),
  ).toHaveCount(6);
});

test('presentations off and final accusations: rounds move on, then everyone accuses in turn', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(browser, ['Pia', 'Quin', 'Rae', 'Sol'], pageErrors);
  const host = players[0]!;
  // The defaults: no presentations, final accusations on.
  await expect(host.page.getByRole('button', { name: 'Presentations', exact: true })).toBeVisible();
  await expect(host.page.getByRole('button', { name: '✓ Final accusations' })).toBeVisible();
  await setUp(host.page, 'Pia', ['Event tiles']);
  const murderer = await commitCrime(players);
  await firstRound(host.page);

  // The Forensic Scientist moves the rounds on from the discussion.
  for (const p of players)
    await expect(
      p.page
        .getByRole('region', { name: 'Discussion' })
        .getByRole('button', { name: 'Next round' }),
    ).toHaveCount(p === host ? 1 : 0);
  await endDiscussion(players, 'Next round');
  for (const round of [2, 3]) {
    await replaceTile(host.page);
    await placeBullets(host.page, 1);
    await endDiscussion(players, round === 2 ? 'Next round' : 'Start final accusations');
  }
  await expect(host.page.getByRole('button', { name: /^Your turn to present/ })).toHaveCount(0);

  // Final accusations, one by one in seat order from the left of the Forensic Scientist.
  const order = players.slice(1);
  const innocent = order.filter((p) => p !== murderer);
  let solver: Player | undefined;
  let wrongDone = false;
  for (let i = 0; i < order.length && !solver; i++) {
    const accuser = await whoShows(order, /^Final accusations: your turn/);
    for (const p of players.filter((x) => x !== accuser))
      await expect(
        p.page.getByText(`Final accusations: ${accuser.name} is accusing…`).first(),
      ).toBeVisible();
    if (i === 0) {
      // Nobody else can accuse out of turn, and nobody is offered their own cards.
      const other = order.find((p) => p !== accuser)!;
      await expect(other.page.getByRole('button', { name: /🔎 Solve/ }).first()).toBeDisabled();
      await accuser.page.getByRole('button', { name: '⚖️ Accuse' }).click();
      const sheet = accuser.page.getByRole('dialog', { name: /^Solve/ });
      await expect(sheet.getByRole('button', { name: other.name, exact: true })).toBeVisible();
      await expect(sheet.getByRole('button', { name: accuser.name, exact: true })).toHaveCount(0);
      await accuser.page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();
    }
    if (accuser === murderer) {
      // The Murderer bluffs on someone else's cards.
      await solve(accuser.page, innocent[0]!.name, 0, 0);
    } else if (!wrongDone) {
      // A wrong pair on the Murderer's cards, public at once.
      wrongDone = true;
      await solve(accuser.page, murderer.name, 1, 1);
      for (const p of players)
        await expect(
          p.page.getByText(new RegExp(`❌ (${accuser.name}|You) accused ${murderer.name}`)).first(),
        ).toBeVisible();
    } else {
      await solve(accuser.page, murderer.name, 0, 0);
      solver = accuser;
      break;
    }
    await expect(accuser.page.getByText(/^Final accusations: your turn/)).toHaveCount(0);
  }
  expect(solver).toBeDefined();
  for (const p of players)
    await expect(
      p.page.getByText(
        `Case closed! ${solver!.name} named the crime in the final accusations: the Investigators win.`,
      ),
    ).toBeVisible();
  await expect(host.page.getByRole('heading', { name: 'Final accusations' })).toBeVisible();
  await expect(
    host.page.getByRole('list', { name: 'Final accusations' }).getByText(/✅/),
  ).toHaveCount(1);
});
