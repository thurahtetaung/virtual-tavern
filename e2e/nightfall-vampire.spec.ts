import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import {
  VAMPIRES,
  VILLAGE,
  dayTab,
  getReady,
  peek,
  playMarkedNight,
  setRoles,
} from './nightfall-play.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// The back-room knock and admin sign-in are rate-limited per address, so each browser gets its
// own (a range no other spec uses).
let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.11.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

test('werewolves and vampires: Marks at dusk, lovers, and an epic battle', async ({ browser }) => {
  test.setTimeout(360_000);
  const admin = await visitor(browser, 'Admin');
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();

  const names = ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'];
  const host = await visitor(browser, names[0]!);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Nightfall room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const others = await Promise.all(
    names.slice(1).map(async (n) => {
      const p = await visitor(browser, n);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  const players = [host, ...others];
  await expect(host.getByText('Players (5/10)')).toBeVisible();

  await setRoles(host, {
    vampire: 1,
    'the-count': 1,
    werewolf: 1,
    seer: 1,
    cupid: 1,
    pickpocket: 1,
    priest: 1,
    villager: 1,
  });
  await expect(host.getByTestId('card-count')).toHaveText(/^8 of 8 cards · 5 Marks/);
  await expect(host.getByTestId('marks-setup')).toBeVisible();
  await expect(others[0]!.getByTestId('epic-hint')).toContainText('at least 2 votes');
  await expect(others[0]!.getByTestId('epic-hint')).toContainText('tied for second');
  await host
    .getByRole('group', { name: 'Time for each role at night' })
    .getByRole('button', { name: '8 s', exact: true })
    .click();
  await host.getByRole('button', { name: 'Deal the cards' }).click();

  // Deal until the werewolf, a vampire, Cupid and a plain villager to mark are all at the table.
  let roles: string[] = [];
  for (let tries = 0; tries < 40; tries++) {
    roles = await peek(players);
    const ok =
      roles.includes('werewolf') &&
      roles.some((r) => VAMPIRES.includes(r)) &&
      roles.includes('cupid') &&
      roles.some((r) => ['villager', 'seer', 'pickpocket'].includes(r));
    if (ok) break;
    const before = roles.join();
    await host.getByRole('button', { name: 'Shuffle and deal again' }).click();
    // A new deal covers everyone's card again (it may deal the same cards, rarely).
    await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    if (tries === 39) throw new Error(`no usable deal; last ${before}`);
  }
  const W = roles.indexOf('werewolf');
  const marked = ['villager', 'seer', 'pickpocket']
    .map((r) => roles.indexOf(r))
    .find((i) => i >= 0)!;
  const cupid = roles.indexOf('cupid');
  const T = roles.findIndex((r) => VAMPIRES.includes(r));

  expect(await getReady(players)).toEqual(roles);
  await expect(host.getByTestId(/night-(idle|acting)/)).toBeVisible({ timeout: 15_000 });
  const nights = await playMarkedNight(players, names, roles, marked);
  // Every pick was the test's own: none was left to the step's clock (the test hold, see
  // playwright.config.ts, waits for late clicks).
  for (const [i, n] of nights.entries())
    expect(n.results.join(' '), `${names[i]}'s night`).not.toContain('time ran out');

  // At dusk everyone saw their own Mark: the Vampire's on the marked player, Love on the lovers.
  expect(nights[marked]!.dusk).toBe('vampire');
  expect(nights[W]!.dusk).toBe('love');
  expect(nights[cupid]!.dusk).toBe('love');
  for (const [i, n] of nights.entries()) {
    expect(n.dusk, `${names[i]} saw a Mark`).not.toBeNull();
    if (roles[i] === 'priest') expect(n.dusk).toBe('clarity');
  }
  // The lovers woke and saw each other; nobody else did.
  expect(nights[W]!.lovers).toContain(names[cupid]);
  expect(nights[cupid]!.lovers).toContain(names[W]);
  for (const [i, n] of nights.entries()) if (i !== W && i !== cupid) expect(n.lovers).toBeNull();
  // Private results.
  const said = (i: number) => nights[i]!.results.join(' ');
  for (const [i, r] of roles.entries()) {
    if (r === 'vampire' || r === 'the-count')
      expect(said(i)).toMatch(new RegExp(`Mark of the Vampire to ${names[marked]}`));
    if (r === 'the-count') expect(said(i)).toMatch(/Mark of Fear to/);
    if (r === 'cupid') expect(said(i)).toMatch(/Mark of Love to/);
    if (r === 'priest') expect(said(i)).toMatch(/Mark of Clarity to yourself/);
  }

  // By day, each player's Mark is the one they saw (once they uncover it), and tapping it reads it.
  for (const p of players) {
    await expect(p.getByTestId('my-mark')).toHaveCount(0);
    await p.getByTestId('my-secrets').getByRole('button', { name: '👁️ Show your card' }).click();
  }
  for (const [i, p] of players.entries())
    await expect(p.getByTestId('my-mark').locator('[data-mark]').first()).toHaveAttribute(
      'data-mark',
      nights[i]!.dusk!,
    );
  await players[marked]!.getByTestId('my-mark').getByRole('button').click();
  await expect(players[marked]!.getByRole('dialog')).toContainText('Vampire');
  await players[marked]!.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await dayTab(players[cupid]!, 'Learned');
  await expect(
    players[cupid]!.getByRole('list', { name: 'What you learned tonight' }),
  ).toContainText(`Your love: ${names[W]}`);
  // Where Cupid stands now: in love, which the recap spells out.
  await expect(players[cupid]!.getByTestId('standing')).toContainText('You are in love');
  await dayTab(players[cupid]!, 'Table');
  // The marked player's recap puts the Mark of the Vampire first.
  await dayTab(players[marked]!, 'Learned');
  await expect(players[marked]!.getByTestId('standing')).toContainText(
    'you are a Vampire, whatever your card',
  );
  await dayTab(players[marked]!, 'Table');
  // The Roles tab lists the Marks that can turn up, and words the village's win for both sides.
  await dayTab(host, 'Roles');
  await expect(host.getByTestId('marks-in-play').getByRole('button')).toHaveCount(4);
  await expect(host.getByRole('list', { name: 'Roles in play' })).toContainText('epic battle');
  await dayTab(host, 'Table');

  // Everyone votes for the werewolf, who votes for a vampire: first and second place.
  for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
  for (const p of players) await expect(p.getByText('🗳️ The vote')).toBeVisible();
  const pick = (i: number) => (i === W ? T : W);
  for (const [i, p] of players.entries()) {
    const button = p.getByRole('button', { name: `Vote for ${names[pick(i)]}` });
    await button.click();
    if (i < players.length - 1) await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  for (const p of players) await expect(p.getByTestId('teams')).toBeVisible({ timeout: 15_000 });

  await expect(host.getByTestId('epic')).toContainText('tied for second');
  const deaths = host.getByTestId('death');
  await expect(deaths).toHaveCount(3);
  await expect(
    deaths.filter({
      hasText: new RegExp(`\\b${names[W]} got the most votes \\(4\\) and died\\.`),
    }),
  ).toHaveAttribute('data-place', '1');
  await expect(
    deaths.filter({ hasText: new RegExp(`\\b${names[T]} came second`) }),
  ).toHaveAttribute('data-place', '2');
  await expect(
    deaths.filter({ hasText: new RegExp(`\\b${names[cupid]} died as`) }),
  ).toHaveAttribute('data-cause', 'love');

  // The reveal: every player's Mark, team and result.
  const rows = host.getByTestId('reveal-player');
  await expect(rows).toHaveCount(5);
  // The marked player's Marks through the night: Clarity, then the Vampire's.
  await expect(
    host.locator(`[data-testid="reveal-player"][data-player="${names[marked]}"]`),
  ).toContainText(/Marks:.*Mark of Clarity.*Mark of the Vampire/);
  // Rows come in seat order; line them up with `names`.
  const byName = new Map(
    await rows.evaluateAll((els) =>
      els.map(
        (e) =>
          [
            e.getAttribute('data-player')!,
            {
              mark: e.getAttribute('data-mark'),
              team: e.getAttribute('data-team'),
              won: e.getAttribute('data-won') === 'true',
            },
          ] as const,
      ),
    ),
  );
  const finals = names.map((n) => byName.get(n)!);
  // Nobody moved a Mark after dusk (the Pickpocket passed): the reveal shows what each saw.
  expect(finals.map((f) => f.mark)).toEqual(nights.map((n) => n.dusk));
  expect(finals[marked]!.team).toBe('vampire');
  // A werewolf and a vampire died: only the village wins (the lover too).
  const village = roles.map((r, i) => VILLAGE.includes(r) && i !== marked);
  expect(finals.map((f) => f.won)).toEqual(village);
  expect(finals.map((f) => f.team === 'village')).toEqual(village);
  for (const p of players) await expect(p.getByTestId('reveal-player')).toHaveCount(5);

  // The night, step by step, dusk included.
  await host.getByRole('tab', { name: 'The night, step by step' }).click();
  const steps = await host
    .getByTestId('timeline-step')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
  expect(steps).toEqual([
    'vampires',
    'the-count',
    'cupid',
    'priest',
    'dusk',
    'lovers',
    'werewolves',
    'seer',
    'pickpocket',
  ]);
  // At dusk, each player's own Mark; in the lovers' step, the lovers.
  await expect(host.getByTestId('timeline-step').nth(4)).toContainText(
    new RegExp(`${names[marked]}’s Mark: \\S*Mark of the Vampire`),
  );
  await expect(host.getByTestId('timeline-step').nth(5)).toContainText(names[cupid]!);
});
