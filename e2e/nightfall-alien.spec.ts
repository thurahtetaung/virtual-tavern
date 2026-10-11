import { type Browser, type Locator, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { getReady, peek, setRoles } from './nightfall-play.ts';

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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.13.${worker}.${(nextIp++ % 250) + 1}` },
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

/** Opens a table in the Alien options and makes one entry certain (every other at 0). */
async function onlyEntry(host: Page, table: string, entry: string) {
  const panel = host.getByTestId(`weights-${table}`);
  if (!(await panel.getAttribute('open'))) await panel.locator('summary').click();
  for (const row of await panel.getByRole('listitem').all()) {
    const label = (await row.locator('span').first().textContent())!.trim();
    const weight = row.getByTestId('weight');
    const want = label === entry ? 5 : 0;
    for (let i = 0; i < 30; i++) {
      const now = Number(await weight.textContent());
      if (now === want) break;
      await row.getByRole('button', { name: now > want ? /^Less likely/ : /^More likely/ }).click();
      await expect(weight).not.toHaveText(String(now));
    }
  }
}

/** What one player did and saw at night. */
interface AlienNight {
  told: string[];
  results: string[];
  closed: boolean;
  stages: string[];
}

/**
 * Plays the night: the Psychic looks, the Exposer turns the centre cards he must, everyone else
 * skips what they may (so no card moves). Records every instruction and result shown.
 */
async function playAlienNight(players: Page[]): Promise<AlienNight[]> {
  return Promise.all(
    players.map(async (p) => {
      const log: AlienNight = { told: [], results: [], closed: false, stages: [] };
      const quick = { timeout: 2000 };
      const deadline = Date.now() + 150_000;
      const add = async (list: string[], loc: Locator) => {
        if (!(await loc.count())) return;
        const text =
          (await loc
            .first()
            .textContent(quick)
            .catch(() => '')) ?? '';
        if (text && !list.includes(text)) list.push(text);
      };
      while (Date.now() < deadline) {
        if (await p.getByRole('button', { name: 'Ready to vote' }).count()) break;
        await add(log.told, p.getByTestId('told'));
        if (await p.getByTestId('eyes-closed').count()) log.closed = true;
        await add(log.results, p.getByTestId('night-result'));
        const prompt = p.getByTestId('prompt');
        if (await prompt.count()) {
          try {
            const stage = (await prompt.getAttribute('data-stage', quick)) ?? '';
            if (!log.stages.includes(stage)) log.stages.push(stage);
            const confirm = prompt.getByRole('button', { name: 'Confirm' });
            if (stage === 'psychic') {
              await prompt
                .getByRole('list', { name: 'Players' })
                .locator('button:enabled')
                .first()
                .click(quick);
              await confirm.click(quick);
            } else if (stage === 'expose') {
              const cards = prompt
                .getByRole('list', { name: 'Centre cards' })
                .locator('button:enabled');
              for (let i = 0; i < 3 && !(await confirm.isEnabled(quick)); i++)
                await cards.nth(i).click(quick);
              await confirm.click(quick);
            } else await prompt.getByRole('button', { name: 'Skip' }).click(quick);
          } catch {
            // The step ended under the click: it's still a fair night.
          }
          continue;
        }
        await p.waitForTimeout(150);
      }
      await add(log.results, p.getByTestId('night-result'));
      return log;
    }),
  );
}

test('aliens among werewolves: instructions, the Cow, numbers, a ripple and an epic battle', async ({
  browser,
}) => {
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
    alien: 2,
    werewolf: 1,
    psychic: 1,
    rascal: 1,
    exposer: 1,
    cow: 1,
    villager: 1,
  });
  await expect(host.getByTestId('card-count')).toHaveText(/^8 of 8 cards/);
  // Players are numbered in seat order, and everyone sees the numbers and the epic-battle hint.
  await expect(others[1]!.getByTestId('player-number')).toHaveCount(5);
  await expect(others[1]!.getByTestId('epic-hint')).toContainText('Werewolves and aliens');
  // The Alien options: the aliens just stare; the night ends in a one-minute ripple.
  await expect(others[0]!.getByTestId('alien-options')).toBeVisible();
  await onlyEntry(host, 'alien', 'Just stare');
  await onlyEntry(host, 'ripple', 'One-minute day');
  await others[0]!.getByTestId('weights-alien').locator('summary').click();
  await expect(
    others[0]!.getByTestId('weights-alien').getByRole('listitem').filter({ hasText: 'Just stare' }),
  ).toContainText('100%');
  await host
    .getByRole('group', { name: 'Time for each role at night' })
    .getByRole('button', { name: '8 s', exact: true })
    .click();
  // Seats follow the order players joined (they joined at once): read it off the lobby.
  const seats = (
    await host
      .locator('main li')
      .filter({ has: host.getByTestId('player-number') })
      .allTextContents()
  ).map((t) => names.find((n) => t.includes(n))!);
  expect([...seats].sort()).toEqual([...names].sort());
  await host.getByRole('button', { name: 'Deal the cards' }).click();

  // Deal until an alien, the werewolf and the Cow are all at the table.
  let roles: string[] = [];
  for (let tries = 0; tries < 40; tries++) {
    roles = await peek(players);
    if (roles.includes('alien') && roles.includes('werewolf') && roles.includes('cow')) break;
    await host.getByRole('button', { name: 'Shuffle and deal again' }).click();
    await expect(host.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();
    if (tries === 39) throw new Error(`no usable deal; last ${roles.join()}`);
  }
  const W = roles.indexOf('werewolf');
  const cow = roles.indexOf('cow');
  const aliens = roles.flatMap((r, i) => (r === 'alien' ? [i] : []));
  const n = players.length;
  // Neighbours by seat, not by the order of `names`.
  const seat = (i: number) => seats.indexOf(names[i]!);
  const at = (s: number) => names.indexOf(seats[((s % n) + n) % n]!);
  const tipped = [at(seat(cow) + 1), at(seat(cow) - 1)].some((i) => aliens.includes(i));

  expect(await getReady(players)).toEqual(roles);
  await expect(host.getByTestId(/night-(idle|acting)/)).toBeVisible({ timeout: 15_000 });
  const nights = await playAlienNight(players);

  // The aliens were told to stare, and saw each other; nobody else was told.
  for (const a of aliens) {
    expect(nights[a]!.told.join(' ')).toContain('Just stare at each other.');
    const others = aliens.filter((x) => x !== a).map((x) => names[x]!);
    expect(nights[a]!.results.join(' ')).toContain(
      others.length ? `Your fellow aliens: ${others.join(' and ')}` : 'No other alien woke up.',
    );
    // They saw the Cow's fist.
    expect(nights[a]!.results.join(' ')).toContain(`fist: ${names[cow]}`);
  }
  // The Cow kept her eyes closed and learned whether an alien sat beside her.
  expect(nights[cow]!.closed).toBe(true);
  expect(nights[cow]!.told).toEqual([]);
  expect(nights[cow]!.results.join(' ')).toContain(
    tipped ? 'An alien tapped your fist' : 'Nobody tapped your fist',
  );
  for (const [i, r] of roles.entries()) {
    if (r === 'psychic') {
      expect(nights[i]!.told.join(' ')).toMatch(
        /may look at one card of any (even|odd)-numbered player/,
      );
      expect(nights[i]!.results.join(' ')).toMatch(/You saw .+’s card/);
    }
    if (r === 'villager') expect(nights[i]!.told).toEqual([]);
  }

  // Daybreak: a one-minute day, announced to everyone; numbers on the table.
  for (const p of players) {
    await expect(p.getByRole('timer')).toHaveAttribute('aria-label', /^([1-5]?\d|60) seconds left/);
    await expect(p.getByTestId('player-number')).toHaveCount(5);
  }
  for (const p of players) {
    await p.getByRole('tab', { name: 'Learned' }).click();
    await expect(p.getByTestId('announcement')).toHaveCount(1);
    await expect(p.getByTestId('announcement')).toContainText('one minute before the vote');
    await p.getByRole('tab', { name: 'Table' }).click();
  }
  // Centre cards the Exposer turned face up are there for everyone.
  const exposer = roles.indexOf('exposer');
  if (exposer >= 0) for (const p of players) await expect(p.getByTestId('centre-up')).toBeVisible();

  // Everyone votes for the werewolf; the werewolf votes for a villager who isn't an alien.
  const victim = roles.findIndex((r, i) => i !== W && r !== 'alien');
  for (const p of players) {
    // The one-minute day may already be over.
    const ready = p.getByRole('button', { name: 'Ready to vote' });
    if (await ready.count()) await ready.click();
  }
  for (const p of players) await expect(p.getByText('🗳️ The vote')).toBeVisible();
  for (const [i, p] of players.entries()) {
    const button = p.getByRole('button', { name: `Vote for ${names[i === W ? victim : W]}` });
    await button.click();
    if (i < players.length - 1) await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  for (const p of players) await expect(p.getByTestId('teams')).toBeVisible({ timeout: 15_000 });

  // An epic battle (aliens, werewolves, villagers): first and second place die. A werewolf died
  // and no alien did, so the aliens win; the village needed two evil sides to lose a player.
  await expect(host.getByTestId('epic')).toBeVisible();
  const deaths = host.getByTestId('death');
  await expect(deaths).toHaveCount(2);
  const rows = host.getByTestId('reveal-player');
  await expect(rows).toHaveCount(5);
  const byName = new Map(
    await rows.evaluateAll((els) =>
      els.map(
        (e) =>
          [
            e.getAttribute('data-player')!,
            { team: e.getAttribute('data-team'), won: e.getAttribute('data-won') === 'true' },
          ] as const,
      ),
    ),
  );
  const finals = names.map((name) => byName.get(name)!);
  expect(finals.map((f) => f.team)).toEqual(
    roles.map((r) => (r === 'alien' ? 'alien' : r === 'werewolf' ? 'werewolf' : 'village')),
  );
  expect(finals.map((f) => f.won)).toEqual(roles.map((r) => r === 'alien'));
  await expect(host.getByTestId('why')).toContainText('Aliens won');
  for (const p of players)
    await expect(p.getByTestId('team-line').filter({ hasText: 'Aliens win' })).toBeVisible();

  // The night, step by step: the aliens' instruction and the ripple are in the replay.
  await host.getByRole('tab', { name: 'The night, step by step' }).click();
  const steps = await host
    .getByTestId('timeline-step')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
  expect(steps).toEqual(['aliens', 'werewolves', 'psychic', 'rascal', 'exposer', 'ripple']);
  await expect(host.getByTestId('timeline-step').first()).toContainText(
    'Just stare at each other.',
  );
  await expect(host.getByTestId('timeline-step').last()).toContainText('one minute');
});
