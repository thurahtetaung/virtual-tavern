import { type Page, expect, test } from '@playwright/test';
import {
  type Player,
  commitCrime,
  dismissEvent,
  endDiscussion,
  firstRound,
  openBackroom,
  placeBullets,
  replaceTile,
  solve,
  table,
  visitor,
  withRole,
} from './inquest-play.ts';

// The Allies expansion: its roles through the Allies Phase and a Reversal, and a forced Change of
// Heart (the test server puts perfect-crime first, peeking at the next event).

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** The host picks `fs`, switches the Allies expansion on with `roles`, and sets toggles off. */
async function setUp(host: Page, fs: string, roles: string[], off: string[] = []) {
  await host.getByRole('button', { name: 'Host picks', exact: true }).click();
  await host
    .getByLabel('Pick the Forensic Scientist')
    .getByRole('button', { name: fs, exact: true })
    .click();
  await host.getByRole('button', { name: 'Allies expansion', exact: true }).click();
  await expect(host.getByRole('button', { name: '✓ Allies expansion' })).toBeVisible();
  for (const name of roles) {
    await host.getByRole('button', { name, exact: true }).click();
    await expect(host.getByRole('button', { name: `✓ ${name}` })).toBeVisible();
  }
  for (const name of off) await host.getByRole('button', { name: `✓ ${name}` }).click();
  await host.getByRole('button', { name: 'Start the investigation' }).click();
}

test('eight players with every Allies role: the Allies Phase, then the Reversal', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(
    browser,
    ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eve', 'Fay', 'Gus'],
    pageErrors,
  );
  const host = players[0]!;
  await setUp(
    host.page,
    'Hana',
    ['Lab Technician', 'Inside Man', 'Protective Detail'],
    ['Event tiles'],
  );
  const murderer = await commitCrime(players);
  await firstRound(host.page);
  const rest = players.filter((p) => p !== host && p !== murderer);
  const accomplice = await withRole(rest, 'Accomplice');
  const witness = await withRole(rest, 'Witness');
  const lab = await withRole(rest, 'Lab Technician');
  const inside = await withRole(rest, 'Inside Man');
  const guard = await withRole(rest, 'Protective Detail');
  // The Protective Detail knows the Witness.
  await guard.page.getByRole('button', { name: 'Reveal your role card' }).click();
  await expect(guard.page.getByText(`The Witness is ${witness.name}.`)).toBeVisible();
  await guard.page.getByRole('button', { name: 'Hide your role card' }).click();

  // After round 1: the Allies Phase. The Lab Technician checks one of the Murderer's cards.
  await endDiscussion(players, 'Next round');
  await expect(lab.page.getByText(/^Allies Phase: check one card/)).toBeVisible();
  for (const p of players.filter((x) => x !== lab))
    await expect(p.page.getByText('The allies are at work…')).toBeVisible();
  const check = lab.page.getByRole('region', { name: 'Check a card' });
  await check.getByLabel('Whose card').getByRole('button', { name: murderer.name }).click();
  await check
    .getByRole('button', { name: /^Clue:/ })
    .first()
    .click();
  await check.getByRole('button', { name: /^Check / }).click();
  await expect(lab.page.getByText(/🤫 Your check: .* is part of the crime 👍/)).toBeVisible();

  // Then the Inside Man takes his own badge, to look innocent; the table hears only who lost one.
  await expect(inside.page.getByText('Allies Phase: take one player’s badge.')).toBeVisible();
  const take = inside.page.getByRole('region', { name: 'Take a badge' });
  await take.getByRole('button', { name: `${inside.name} (you)` }).click();
  await take.getByRole('button', { name: `Take ${inside.name}’s badge` }).click();
  for (const p of players)
    await expect(p.page.getByText(`📣 ${inside.name} lost their badge.`)).toBeVisible();

  // Round 2, then the Protective Detail names the crime: the Reversal.
  await replaceTile(host.page);
  await placeBullets(host.page, 1);
  await expect(host.page.getByText('The table is discussing the evidence.')).toBeVisible();
  await solve(guard.page, murderer.name, 0, 0);
  // The Inside Man joins the Murderer and the Accomplice there.
  const insidePanel = inside.page.getByRole('region', { name: 'The Reversal' });
  await expect(insidePanel.getByText(/Your side: /)).toBeVisible();
  const decoy = rest.find((p) => p !== accomplice && p !== witness && p !== inside)!;
  await insidePanel.getByRole('button', { name: new RegExp(`^${decoy.name}`) }).click();
  const murPanel = murderer.page.getByRole('region', { name: 'The Reversal' });
  await expect(
    murPanel.getByRole('button', { name: new RegExp(`^${decoy.name}.*👈 ${inside.name}`) }),
  ).toBeVisible();
  await expect(murPanel.getByRole('button', { name: new RegExp(`^${inside.name}`) })).toHaveCount(
    0,
  );
  await murPanel.getByRole('button', { name: new RegExp(`^${decoy.name}`) }).click();
  await murPanel.getByRole('button', { name: `Final answer: ${decoy.name}` }).click();
  for (const p of players)
    await expect(
      p.page.getByText(
        `${guard.name} solved it, and the Witness stayed hidden: the Investigators win.`,
      ),
    ).toBeVisible();
  await expect(host.page.getByText(`${inside.name} · Inside Man`)).toBeVisible();
  await expect(
    host.page.getByText(`The Inside Man took ${inside.name}’s badge`, { exact: false }),
  ).toBeVisible();
  await expect(
    host.page.getByText(/The Lab Technician checked .*part of the crime 👍/),
  ).toBeVisible();
});

test('a forced Change of Heart switches the Forensic Scientist, who then loses', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  await openBackroom(await visitor(browser, 'Admin', pageErrors));
  const players = await table(browser, ['Hal', 'Ida', 'Jon', 'Kim'], pageErrors);
  const host = players[0]!;
  await setUp(host.page, 'Hal', []);
  const murderer = await commitCrime(players);
  await firstRound(host.page);
  await endDiscussion(players, 'Next round');

  // Round 2: the Change of Heart peeks at an event (set aside), so the Forensic Scientist switches.
  await dismissEvent(players, /Event: Change of Heart/);
  await expect(host.page.getByText(/🎭 Secret: you peeked at an event/)).toBeVisible();
  for (const p of players.slice(1)) await expect(p.page.getByText(/🎭 Secret/)).toHaveCount(0);
  // The peeked event never happens; the next ones do.
  await dismissEvent(players, /Event: Shifted Bullet/);
  await host.page.locator('button[data-item][data-marked="false"]:visible').first().click();
  await host.page.getByRole('button', { name: /^Move the bullet to/ }).click();
  await dismissEvent(players, /Event: Last Call/);
  await replaceTile(host.page);
  await replaceTile(host.page);
  await placeBullets(host.page, 2);
  await replaceTile(host.page);
  await placeBullets(host.page, 1);

  // An Investigator names the crime: the Investigators win, but not the switched Forensic Scientist.
  const solver: Player = players.find((p) => p !== host && p !== murderer)!;
  await expect(solver.page.getByText(/^Discuss the evidence/)).toBeVisible();
  await solve(solver.page, murderer.name, 0, 0);
  await expect(host.page.getByText(/named the crime: the Investigators win/)).toBeVisible();
  await expect(host.page.getByText(/· Forensic Scientist \(switched sides\)/)).toBeVisible();
  await expect(host.page.getByText(/an event, and switched to the Murderer’s side/)).toBeVisible();
  await expect(host.page.getByText(/Forensic Scientist \(switched sides\) 🏆/)).toHaveCount(0);
});
