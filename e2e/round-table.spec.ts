import { type Page, expect, test } from '@playwright/test';
import { checkGuidePeek } from './guide-peek.ts';
import {
  evilPages,
  goodPages,
  leader,
  openTable,
  pageErrors,
  propose,
  quest,
  readRoles,
  teamSize,
  vote,
  withRole,
} from './round-table-play.ts';

const YOUR_TURN = /^● Your turn/;

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

/** A team of `n` Good players, the leader's own page first if they're Good. */
const goodTeam = (pages: Page[], n: number) => pages.slice(0, n);

test('five players: Percival & Morgana, a rejected team, three quests and the assassination', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const t = await openTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee']);
  const { host } = t;
  await host.getByRole('button', { name: /^Percival & Morgana/ }).click();
  await expect(t.players[1]!.getByRole('button', { name: /^Percival & Morgana/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(host.getByTestId('balance')).toContainText('3 Good vs 2 Evil');
  await host.getByRole('button', { name: 'Start game' }).click();
  for (const p of t.players) await expect(p).toHaveTitle(YOUR_TURN);

  await readRoles(t);
  expect([...t.roles.values()].sort()).toEqual(
    ['Assassin', 'Loyal Servant', 'Merlin', 'Morgana', 'Percival'].sort(),
  );
  // What each role knows: Merlin sees both Evil players; Percival sees Merlin and Morgana alike.
  const merlin = withRole(t, 'Merlin');
  const percival = withRole(t, 'Percival');
  const assassin = withRole(t, 'Assassin');
  await merlin.getByRole('button', { name: 'My role' }).click();
  await expect(merlin.getByRole('list', { name: 'What you know' }).getByText('Evil')).toHaveCount(
    2,
  );
  await merlin.keyboard.press('Escape');
  await percival.getByRole('button', { name: 'My role' }).click();
  await expect(
    percival.getByRole('list', { name: 'What you know' }).getByText('Merlin or Morgana'),
  ).toHaveCount(2);
  await percival.keyboard.press('Escape');

  // The first team is rejected by everyone: the vote is shown, and the lead passes on.
  const good = goodPages(t);
  const first = await leader(t);
  // The leader announces a team, the table talks it over, and the leader takes it back.
  const pickSeat = (p: Page) =>
    first.getByRole('button', { name: `Pick ${t.names.get(p)} for the team` });
  await pickSeat(good[1]!).click();
  await pickSeat(good[2]!).click();
  await first.getByRole('button', { name: 'Announce this team' }).click();
  const watcher = t.players.find((p) => p !== first)!;
  await expect(watcher.getByRole('region', { name: 'Announced team' })).toBeVisible();
  await expect(watcher.getByText(/has announced a team for quest 1/)).toBeVisible();
  await expect(watcher.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  await first.getByRole('button', { name: 'Change the team' }).click();
  await pickSeat(good[1]!).click();
  await pickSeat(good[2]!).click();
  await propose(t, goodTeam(good, 2));
  await expect(host.getByTestId('waiting-on')).toBeVisible();
  await vote(t, t.players);
  await expect(host.getByTestId('vote-result')).toContainText('rejected');
  await expect(host.getByTestId('vote-result')).toContainText('Against (5)');
  await expect(host.getByRole('img', { name: '1 of 5 teams rejected in a row' })).toBeVisible();
  expect(await leader(t)).not.toBe(first);

  // Three clean quests.
  for (let i = 0; i < 3; i++) {
    const size = await teamSize(t);
    await quest(t, goodTeam(good, size));
    if (i < 2)
      await expect(host.getByTestId('quest-result')).toContainText(`succeeded: 0 Fail cards`);
  }
  // The assassination: Evil talks, the Assassin names a servant (wrongly), with a confirmation.
  await expect(assassin).toHaveTitle(YOUR_TURN);
  await expect(merlin.getByText(/the Assassin, is choosing/)).toBeVisible();
  const other = evilPages(t).find((p) => p !== assassin)!;
  await expect(other.getByText(/Help .+ \(the Assassin\)/)).toBeVisible();
  const servant = withRole(t, 'Loyal Servant');
  const name = t.names.get(servant)!;
  await assassin
    .getByRole('button', { name: `Name ${name} as Merlin` })
    .first()
    .click();
  await assassin
    .getByRole('button', { name: `Name ${name} as Merlin` })
    .last()
    .click();
  await assassin.getByRole('button', { name: `Yes, it’s ${name}` }).click();
  for (const p of t.players) await expect(p.getByTestId('winner')).toContainText('Good wins');
  await expect(merlin.getByText(/^You win!/)).toBeVisible();
  await expect(assassin.getByText(/^You lose\./)).toBeVisible();
  // The end shows everyone's role and the whole history.
  await expect(host.getByRole('region', { name: 'Everyone’s role' })).toContainText('Morgana');
  await expect(host.getByRole('region', { name: 'History' })).toContainText('rejected');
  // Play again keeps the setup.
  await host.getByRole('button', { name: 'Play again' }).click();
  await expect(host.getByRole('button', { name: '👁️ Show my role' })).toBeVisible();
});

test('seven players with the Lady of the Lake: private checks, a sunk quest and Merlin found', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const t = await openTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay']);
  const { host } = t;
  await host.getByRole('button', { name: /^Classic\+/ }).click();
  await expect(host.getByRole('checkbox', { name: /Lady of the Lake/ })).toBeChecked();
  await expect(host.getByTestId('balance')).toContainText('4 Good vs 3 Evil');
  await host.getByRole('button', { name: 'Start game' }).click();
  await readRoles(t);
  const good = goodPages(t);
  const evil = evilPages(t);
  expect(evil).toHaveLength(3);

  /** The holder checks the first player they may, and returns who it was. */
  const useLady = async () => {
    let holder: Page | undefined;
    await expect
      .poll(async () => {
        for (const p of t.players)
          if (await p.getByText(/^You hold the Lady of the Lake/).isVisible()) {
            holder = p;
            return true;
          }
        return false;
      })
      .toBe(true);
    const choice = holder!
      .getByRole('button', { name: /^Check / })
      .and(holder!.locator(':enabled'));
    const target = (await choice.first().getAttribute('aria-label'))!.replace('Check ', '');
    await choice.first().click();
    await holder!.getByRole('button', { name: `Check ${target}’s loyalty` }).click();
    // Only the holder sees the answer, and only once they peek.
    const result = holder!.getByTestId('lady-result');
    await expect(result).toContainText('Your Lady of the Lake check is in');
    await expect(result).not.toContainText(target);
    const peek = holder!.getByTestId('knowledge-peek');
    await peek.getByRole('button', { name: '👁️ Show' }).click();
    await expect(result).toContainText(target);
    await peek.getByRole('button', { name: '🙈 Hide' }).click();
    for (const p of t.players.filter((x) => x !== holder))
      await expect(p.getByTestId('lady-result')).toHaveCount(0);
    return { holder: holder!, target };
  };

  await quest(t, goodTeam(good, await teamSize(t)));
  // Quest 2 is sunk by an Evil player: everyone sees one Fail card, never whose.
  const size2 = await teamSize(t);
  await quest(t, [evil[0]!, ...goodTeam(good, size2 - 1)], [evil[0]!]);
  await expect(host.getByTestId('quest-result')).toContainText('Quest 2 was sunk: 1 Fail card');
  const first = await useLady();
  // A bystander sees who was checked, never the answer.
  const bystander = t.players.find((p) => p !== first.holder && t.names.get(p) !== first.target)!;
  const history = bystander.getByRole('region', { name: 'History' });
  await expect(history).toContainText(`checked ${first.target}`);
  await expect(history).not.toContainText(`checked ${first.target}:`);
  await quest(t, goodTeam(good, await teamSize(t)));
  const second = await useLady();
  expect(second.holder).toBe(t.players.find((p) => t.names.get(p) === first.target));
  // Quest 4 needs two Fails at seven players: one Fail and it still succeeds.
  await expect(host.getByRole('list', { name: 'Quests' }).getByText('2 fails')).toBeVisible();
  const size4 = await teamSize(t);
  await quest(t, [evil[0]!, ...goodTeam(good, size4 - 1)], [evil[0]!]);
  // Three successes: the Assassin finds Merlin.
  const assassin = await (async () => {
    let found: Page | undefined;
    await expect
      .poll(async () => {
        for (const p of evil)
          if (await p.getByText(/^Good won three quests, but you get one shot/).isVisible()) {
            found = p;
            return true;
          }
        return false;
      })
      .toBe(true);
    return found!;
  })();
  const merlinName = t.names.get(withRole(t, 'Merlin'))!;
  await assassin
    .getByRole('button', { name: `Name ${merlinName} as Merlin` })
    .first()
    .click();
  await assassin
    .getByRole('button', { name: `Name ${merlinName} as Merlin` })
    .last()
    .click();
  await assassin.getByRole('button', { name: `Yes, it’s ${merlinName}` }).click();
  for (const p of t.players) await expect(p.getByTestId('winner')).toContainText('Evil wins');
  await expect(host.getByRole('region', { name: 'Lady of the Lake' })).toContainText(
    `saw ${first.target} as`,
  );
});

test('on a phone, the rules drawer keeps your role hidden until you peek', async ({ browser }) => {
  test.setTimeout(90_000);
  const t = await openTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], {
    viewport: { width: 390, height: 844 },
  });
  await t.host.getByRole('button', { name: 'Start game' }).click();
  await readRoles(t);
  const assassin = withRole(t, 'Assassin');
  await checkGuidePeek(assassin, 'Assassin');
});

test('on a phone, what you know stays off the seats until you peek', async ({ browser }) => {
  test.setTimeout(90_000);
  const t = await openTable(browser, ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'], {
    viewport: { width: 390, height: 844 },
  });
  await t.host.getByRole('button', { name: 'Start game' }).click();
  await readRoles(t);
  for (const page of [withRole(t, 'Assassin'), withRole(t, 'Merlin')]) {
    const seats = page.getByRole('list', { name: 'Seats' });
    const badge = seats.getByText('Evil', { exact: true });
    const peek = page.getByTestId('knowledge-peek');
    await expect(peek).toContainText('What you know is hidden');
    await expect(badge).toHaveCount(0);
    // Hold to peek, let go to hide.
    const box = (await peek
      .getByRole('button', { name: 'Hold to see what you know' })
      .boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(badge.first()).toBeVisible();
    await page.mouse.up();
    await expect(badge).toHaveCount(0);
    // Or switch it on and off.
    await peek.getByRole('button', { name: '👁️ Show' }).click();
    await expect(badge.first()).toBeVisible();
    await peek.getByRole('button', { name: '🙈 Hide' }).click();
    await expect(badge).toHaveCount(0);
  }
  // A Loyal Servant knows nobody, and has the same control.
  await expect(withRole(t, 'Loyal Servant').getByTestId('knowledge-peek')).toBeVisible();
});
