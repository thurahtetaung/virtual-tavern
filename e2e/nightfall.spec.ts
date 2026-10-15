import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import { dayTab, getReady, playNight, setRoles, vote } from './nightfall-play.ts';
import { openAdminSection } from './admin-sections.ts';

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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.9.${worker}.${(nextIp++ % 250) + 1}` },
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

const TITLE = 'Moonlit Test Title';
const WOLVES = ['werewolf', 'alpha-wolf', 'mystic-wolf', 'dream-wolf'];

test('five friends play a night, a day and a vote, and see the whole night replayed', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const admin = await visitor(browser, 'Admin');
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await admin.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await admin.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(admin.getByRole('button', { name: 'Change password' })).toBeVisible();
  // Without asset storage there's no music to pick yet.
  await openAdminSection(admin, 'Nightfall music');
  await expect(
    admin.getByRole('region', { name: 'Nightfall music' }).getByText('No tracks uploaded yet'),
  ).toBeVisible();
  await expect(admin.getByText('Upload the Nightfall assets to choose music')).toBeVisible();
  // The real title lives in the database and reaches unlocked browsers only.
  await openAdminSection(admin, 'Back-room titles');
  await admin.getByLabel('Nightfall', { exact: true }).fill(TITLE);
  const titles = admin
    .getByRole('listitem')
    .filter({ has: admin.getByLabel('Nightfall', { exact: true }) });
  await titles.getByRole('button', { name: 'Save' }).click();
  await expect(titles.getByRole('button', { name: 'Save' })).toBeDisabled();

  try {
    const names = ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'];
    const host = await visitor(browser, names[0]!);
    await unlock(host);
    await host.getByRole('button', { name: `Create a ${TITLE} room` }).click();
    await expect(host).toHaveURL(/\/r\//);
    await expect(host.getByText(TITLE).first()).toBeVisible();
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
    // The recommended cards follow the table as friends sit down.
    await expect(host.getByTestId('card-count')).toHaveText(/^8 of 8 cards/);
    const setups = host.getByRole('list', { name: 'Ready-made setups' });
    await expect(
      setups.getByRole('button', { name: /^Recommended for 5 Beginner/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(setups.getByRole('button', { name: /^Total mayhem Chaos/ })).toBeVisible();
    await expect(others[0]!.getByRole('list', { name: 'Ready-made setups' })).toHaveCount(0);
    await expect(host.getByTestId('narration-help')).toContainText('host’s phone');

    await setRoles(host, {
      doppelganger: 1,
      werewolf: 2,
      seer: 1,
      robber: 1,
      troublemaker: 1,
      drunk: 1,
      insomniac: 1,
    });
    await expect(host.getByTestId('card-count')).toHaveText(/^8 of 8 cards/);
    await host
      .getByRole('group', { name: 'Time for each role at night' })
      .getByRole('button', { name: '5 s', exact: true })
      .click();
    await expect(
      others[0]!
        .getByRole('group', { name: 'Time for each role at night' })
        .getByRole('button', { name: '5 s', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await host.getByRole('button', { name: 'Deal the cards' }).click();

    const roles = await getReady(players);
    expect(roles.length).toBe(5);
    await expect(host.getByTestId(/night-(idle|acting)/)).toBeVisible({ timeout: 15_000 });
    // The night counts steps, not nights (checked while everyone plays it).
    const stepShown = expect(host.getByText(/^Step \d of 8$/).first())
      .toBeVisible({ timeout: 15_000 })
      .then(
        () => null,
        (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
      );
    const nights = await playNight(players, roles);
    const stepError = await stepShown;
    if (stepError) throw stepError;

    // Every card in this game wakes, so every phone lit up with YOUR TURN at least once, roles
    // that only learn something included, and the idle screen asked for phones face up.
    for (const [i, log] of nights.entries()) {
      expect(log.woke, `${names[i]} (${log.role}) saw YOUR TURN`).toBe(true);
      expect(log.faceUp, `${names[i]} saw the face-up hint`).toBe(true);
    }

    // Each player who acted saw their own results, and only theirs.
    for (const [i, log] of nights.entries()) {
      // A Confirm can land just as a 5 s step closes, so only a look that landed is checked.
      if (log.role === 'seer' && log.results.length)
        expect(log.results.join(' ')).toMatch(/You saw/);
      if (log.role === 'robber' && log.acted.length)
        expect(log.results.join(' ')).toMatch(/You swapped cards with/);
      if (log.role === 'doppelganger') expect(log.results.join(' ')).toMatch(/You looked at/);
      if (log.role === 'drunk' && log.results.length)
        expect(log.results.join(' ')).toMatch(/centre card/);
      if (
        ![
          'seer',
          'robber',
          'doppelganger',
          'drunk',
          'troublemaker',
          'insomniac',
          'werewolf',
        ].includes(log.role)
      )
        expect(log.results, `${names[i]} learned nothing`).toEqual([]);
    }
    // The day shows what you learned.
    const seer = roles.indexOf('seer');
    if (seer >= 0 && nights[seer]!.results.length) {
      await dayTab(players[seer]!, 'Learned');
      await expect(
        players[seer]!.getByRole('list', { name: 'What you learned tonight' }),
      ).toContainText('You saw');
      // Learned opens with where you stand now.
      await expect(players[seer]!.getByTestId('standing')).toContainText('Where you stand now');
      await expect(players[seer]!.getByTestId('standing')).toContainText('Started as');
      await dayTab(players[seer]!, 'Table');
    }
    await dayTab(host, 'Roles');
    await expect(host.getByRole('list', { name: 'Roles in play' }).getByRole('button')).toHaveCount(
      7,
    );
    // Copies are counted, the village's win is worded for a werewolf game, and the
    // Doppelgänger's second wake is listed.
    await expect(host.getByTestId('copies')).toHaveText('×2');
    await expect(host.getByRole('list', { name: 'Roles in play' })).toContainText(
      'at least one Werewolf dies',
    );
    await expect(host.getByRole('list', { name: 'Roles in play' })).not.toContainText('Vampire');
    await expect(host.getByTestId('doppel-rewakes')).toContainText('Insomniac');
    await expect(host.getByTestId('marks-in-play')).toHaveCount(0);
    await dayTab(host, 'Table');

    // The day names who it is waiting for, and the host may open the vote early.
    await host.getByRole('button', { name: 'Ready to vote' }).click();
    // Names come in seat order, which the shuffle decides.
    const waiting = host.getByRole('status').filter({ hasText: /Waiting for: / });
    for (const name of ['Ana', 'Ben', 'Cy', 'Dee']) await expect(waiting).toContainText(name);
    await expect(host.getByRole('button', { name: 'Start the vote now' })).toBeVisible();
    await expect(others[0]!.getByRole('button', { name: 'Start the vote now' })).toHaveCount(0);

    // Everyone but Hana votes for Hana; Hana votes for Ana. Hana dies.
    await vote(players, names, (i) => (i === 0 ? 1 : 0));
    const rows = host.getByTestId('reveal-player');
    await expect(rows).toHaveCount(5);
    const finals = await rows.evaluateAll((els) =>
      els.map((e) => ({
        name: e.getAttribute('data-player')!,
        final: e.getAttribute('data-final')!,
        won: e.getAttribute('data-won'),
      })),
    );
    const isWolf = (r: string) => WOLVES.includes(r);
    const village = (r: string) => !isWolf(r) && !['tanner', 'minion', 'squire'].includes(r);
    const expected = finals.map((f) => {
      if (isWolf(finals[0]!.final)) return village(f.final);
      if (finals.some((x) => isWolf(x.final))) return isWolf(f.final);
      return false;
    });
    expect(finals.map((f) => f.won === 'true')).toEqual(expected);
    await expect(host.getByTestId('death')).toContainText('Hana got the most votes (4) and died.');
    // The full tally, and why the winners won.
    await expect(host.getByTestId('tally')).toContainText('Hana 4');
    await expect(host.getByTestId('why').first()).toContainText(/won|Nobody won/);
    await expect(host.getByTestId('team-line').first()).toBeVisible();
    // Guests are told who moves the game on.
    await expect(others[0]!.getByTestId('waiting-host')).toHaveText(
      'Waiting for Hana (host) to play again or change the setup…',
    );
    for (const p of players) await expect(p.getByTestId('reveal-player')).toHaveCount(5);
    await expect(host.getByTestId('reveal-legend')).toContainText('dealt → ended as');

    // The night, step by step: every step of the plan, in wake order.
    await host.getByRole('tab', { name: 'The night, step by step' }).click();
    await expect(host.getByTestId('timeline-step')).toHaveCount(8);
    const steps = await host
      .getByTestId('timeline-step')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-step')));
    expect(steps).toEqual([
      'doppelganger',
      'werewolves',
      'seer',
      'robber',
      'troublemaker',
      'drunk',
      'insomniac',
      'doppelganger-insomniac',
    ]);
    // The replay is the same for everyone, in the third person.
    await expect(host.getByRole('list', { name: 'The night, step by step' })).not.toContainText(
      /\b(you|your)\b/i,
    );
    // A step for a card in the centre still ran, and says so.
    await expect(host.getByTestId('timeline-step').first()).toContainText(
      roles.includes('doppelganger') ? 'looked at' : 'Nobody at the table had this card',
    );

    // A card name opens its details anywhere.
    await host.getByTestId('timeline-step').first().getByRole('button').first().click();
    await expect(host.getByRole('dialog')).toBeVisible();
    await host.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    // Play again with the same cards: straight to getting ready.
    await host.getByRole('button', { name: 'Play again' }).click();
    for (const p of players)
      await expect(p.getByRole('button', { name: 'Tap to see your card' })).toBeVisible();

    // The rules page uses the title the admin set, for unlocked browsers.
    await others[0]!.goto('/rules/nightfall');
    await expect(others[0]!.getByRole('heading', { level: 1 })).toContainText(
      `How to play ${TITLE}`,
    );
  } finally {
    await admin.goto('/tavern-keeper');
    await openAdminSection(admin, 'Back-room titles');
    const field = admin.getByLabel('Nightfall', { exact: true });
    await field.fill('');
    await admin
      .getByRole('listitem')
      .filter({ has: field })
      .getByRole('button', { name: 'Save' })
      .click();
  }
});
