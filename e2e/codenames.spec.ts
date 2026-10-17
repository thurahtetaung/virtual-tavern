import { readFileSync } from 'node:fs';
import { type Browser, type Download, type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { strFromU8, unzipSync } from 'fflate';
import { TEST_ADMIN_PASSWORD, ownLoginLimit } from './credentials.ts';
import { openAdminSection } from './admin-sections.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  return page;
}

async function player(browser: Browser, name: string, url = '/') {
  const page = await newPage(browser);
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const downloaded = async (download: Download) => readFileSync(await download.path());

const board = (page: Page) => page.getByRole('region', { name: 'Word cards' });
const cards = (page: Page, name?: RegExp) =>
  name ? board(page).getByRole('button', { name }) : board(page).getByRole('button');
const card = (page: Page, word: string) => cards(page, new RegExp(`^${word}(,|$)`));

test('four friends play a game of Codenames to the end', async ({ browser }) => {
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\/[a-z]+-[a-z]+-[a-z]+-[a-z0-9]{4}$/);
  const roomUrl = host.url();

  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, roomUrl)),
  );
  await expect(host.getByText('Pick a team below')).toBeVisible();
  // Each seat says what it does, so first-timers can choose.
  await expect(
    host.getByText('Sees the secret key and gives one-word clues.').first(),
  ).toBeVisible();
  await expect(host.getByText('Guess the words from the clues.').first()).toBeVisible();

  await host
    .getByRole('region', { name: 'Red team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await ana!.getByRole('button', { name: 'Join Red as Operative' }).click();
  await ben!
    .getByRole('region', { name: 'Blue team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await cy!.getByRole('button', { name: 'Join Blue as Operative' }).click();

  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await expect(ana!.getByText('Waiting for Hana (host) to start the game')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(cards(host)).toHaveCount(25);
  // Everyone sees their own team and role, and which score is theirs.
  await expect(host.getByTestId('my-role')).toHaveText('You: Red Spymaster');
  await expect(cy!.getByTestId('my-role')).toHaveText('You: Blue Operative');
  await expect(cy!.getByText('Blue (you) to find')).toBeVisible();

  // Whoever's team starts (dealt at random), its spymaster gives a clue.
  const clueTurn = (p: Page) => p.getByText('Your turn! Give your team');
  await expect
    .poll(async () => (await clueTurn(host).count()) + (await clueTurn(ben!).count()))
    .toBe(1);
  const redStarts = (await clueTurn(host).count()) > 0;
  const [spy, op, otherOp] = redStarts ? [host, ana!, cy!] : [ben!, cy!, ana!];
  // The tab title flags whoever has to act, so a background tab stands out.
  await expect(spy).toHaveTitle(/^● Your turn · Codenames/);
  await expect(op).toHaveTitle('Codenames · Virtual Tavern');
  // The host can't skip a turn someone can still play; the refusal goes once the table moves on
  // (well before its own few seconds are up).
  const skipRefusal = host.getByRole('alert').filter({ hasText: 'can’t be skipped yet' });
  const refuseSkip = async () => {
    await host.getByRole('button', { name: 'Skip stuck turn' }).click();
    await host
      .getByRole('dialog', { name: 'Skip the current turn?' })
      .getByRole('button', { name: 'Skip turn' })
      .click();
    await expect(skipRefusal).toBeVisible();
  };
  await refuseSkip();
  await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
  await spy.getByRole('button', { name: '2', exact: true }).click();
  await spy.getByRole('button', { name: 'Give clue' }).click();

  await expect(op.getByText('Your turn to guess')).toBeVisible();
  await expect(op).toHaveTitle(/^● Your turn · Codenames/);
  await expect(spy).toHaveTitle('Codenames · Virtual Tavern');
  await expect(otherOp.getByText('team is guessing')).toBeVisible();
  await expect(op.locator('text=TAVERN').first()).toBeVisible();
  await expect(skipRefusal).toBeHidden({ timeout: 3000 });
  // Refused again mid-guess, then gone as soon as an Operative's guess changes the turn.
  await refuseSkip();
  const ours = cards(spy, new RegExp(`, ${redStarts ? 'Red' : 'Blue'} agent`)).first();
  const oursWord = (await ours.getAttribute('aria-label'))!.split(',')[0]!;
  await card(op, oursWord).click();
  await op.getByRole('button', { name: `Guess ${oursWord.toUpperCase()}` }).click();
  await expect(skipRefusal).toBeHidden({ timeout: 3000 });

  // Operatives never see the key; the spymaster finds the assassin for us.
  const assassinLabel = await cards(spy, /Assassin/).getAttribute('aria-label');
  const assassinWord = assassinLabel!.split(',')[0]!;
  await expect(cards(op, /Assassin/)).toHaveCount(0);

  await card(op, assassinWord).click();
  await op.getByRole('button', { name: `Guess ${assassinWord.toUpperCase()}` }).click();
  await expect(otherOp.getByText("☠ It's the assassin!")).toBeVisible();

  await expect(host.getByText('team wins!').first()).toBeVisible();
  await expect(cards(otherOp, /Assassin/)).toHaveCount(1);
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible();
  await expect(ana!.getByText('Waiting for Hana (host) to start the next game')).toBeVisible();
});

test('the table is told when the Spymaster drops out, and the host can skip the turn', async ({
  browser,
}) => {
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, host.url())),
  );
  await host.getByRole('button', { name: 'Join Red as Operative' }).click();
  await ana!
    .getByRole('region', { name: 'Red team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await ben!
    .getByRole('region', { name: 'Blue team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await cy!.getByRole('button', { name: 'Join Blue as Operative' }).click();
  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(cards(host)).toHaveCount(25);

  // One of the two Spymasters is asked for the first clue.
  const turnOf = async () =>
    (await ana!.getByText('Your turn! Give your team').isVisible())
      ? 'red'
      : (await ben!.getByText('Your turn! Give your team').isVisible())
        ? 'blue'
        : null;
  await expect.poll(turnOf).not.toBeNull();
  const redStarts = (await turnOf()) === 'red';
  const [spy, team, other] = redStarts ? [ana!, 'Red', 'Blue'] : [ben!, 'Blue', 'Red'];
  const spyName = redStarts ? 'Ana' : 'Ben';
  await spy.context().close();

  await expect(
    host.getByText(`${spyName} (${team} Spymaster) seems to be offline. You can skip their turn.`),
  ).toBeVisible();
  await expect(cy!.getByText('seems to be offline. The host can skip their turn.')).toBeVisible();
  await host.getByRole('button', { name: `Skip ${team}'s turn` }).click();
  await expect(cy!.getByText(`The host skipped ${team}'s turn.`)).toBeVisible();
  await expect(cy!.getByText(`${other}'s turn now.`)).toBeVisible();
});

test('a newcomer opening a link is asked for their name first', async ({ browser }) => {
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);

  const guest = await newPage(browser);
  await guest.goto(host.url());
  await expect(guest.getByText("You're invited to play Codenames!")).toBeVisible();
  await guest.getByPlaceholder('Your name').fill('Newbie');
  await guest.getByRole('button', { name: 'Join' }).click();
  await expect(host.getByText('Newbie').first()).toBeVisible();

  await guest.getByRole('button', { name: 'Read the 2-minute guide' }).click();
  const guide = guest.getByRole('dialog');
  await expect(guide.getByRole('region', { name: 'How a game goes' })).toBeVisible();
  await guide.getByRole('tab', { name: 'Rules' }).click();
  await expect(guide.getByText('Giving a clue (Spymaster)')).toBeVisible();
});

test('admins manage word lists that hosts can pick', async ({ browser }) => {
  const admin = await newPage(browser);
  // Repeats share the server and can run side by side, so each run gets its own list.
  const tag = Math.random().toString(36).slice(2, 7);
  const NAME = `E2E Planets ${tag}`;
  const SLUG = `e2e-planets-${tag}`;
  // Two sign-ins (a wrong one first), so keep them off the shared rate-limit bucket.
  await ownLoginLimit(admin);
  await admin.goto('/tavern-keeper');
  await admin.getByLabel('Admin password').fill('wrong');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByText('Wrong password.')).toBeVisible();
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await openAdminSection(admin, 'Word lists');
  await expect(admin.getByRole('button', { name: '+ New list' })).toBeVisible();
  // Deleted again at the end, so the shared server doesn't collect lists.
  const removeList = async () => {
    const all = (await (await admin.request.get('/api/admin/word-lists')).json()) as {
      id: string;
      name: string;
    }[];
    for (const l of all.filter((l) => l.name === NAME))
      expect((await admin.request.delete(`/api/admin/word-lists/${l.id}`)).ok()).toBe(true);
  };

  await admin.getByRole('button', { name: '+ New list' }).click();
  await admin.getByLabel('Name', { exact: true }).fill(NAME);
  await admin.getByLabel(/^Words/).fill('Moon\nmoon\nMars, Venus\nComet');
  await expect(admin.getByText('4 unique words')).toBeVisible();
  await expect(admin.getByText('1 duplicates will be dropped')).toBeVisible();
  // A new list is offered in every word-list game; at least one must stay ticked. (It stays in
  // all of them: a Codenames-only list would become the default for every later Codenames room here.)
  const usedBy = admin.getByRole('group', { name: 'Used by' });
  for (const game of ['Codenames', 'Enigma', 'Echo'])
    await usedBy.getByRole('checkbox', { name: game }).uncheck();
  await expect(admin.getByText('Pick at least one game.')).toBeVisible();
  await expect(admin.getByRole('button', { name: 'Save list' })).toBeDisabled();
  for (const game of ['Codenames', 'Enigma', 'Echo'])
    await usedBy.getByRole('checkbox', { name: game }).check();
  await admin.getByRole('button', { name: 'Save list' }).click();
  await expect(
    admin.getByRole('button', {
      name: new RegExp(`^${NAME}\\s*Codenames\\s*Enigma\\s*Echo\\s*4 words$`),
    }),
  ).toBeVisible();

  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  const lists = host.getByRole('region', { name: 'Word lists' });
  await expect(lists.getByText('Starter')).toBeVisible();
  await host.getByRole('button', { name: 'Change word lists' }).click();
  const picker = host.getByRole('dialog');
  await picker.getByRole('searchbox').fill('planets');
  await picker.getByRole('checkbox', { name: NAME }).check();
  await expect(picker.getByText('2 lists')).toBeVisible();
  await picker.getByRole('button', { name: 'Save' }).click();
  await expect(picker).toBeHidden();
  await expect(lists.getByText(NAME)).toBeVisible();
  await expect(lists.getByText('Starter')).toBeVisible();

  // Switching the list off hides it from hosts at once, even in a room that had it selected.
  const row = admin.getByRole('listitem').filter({ hasText: NAME });
  const enabled = row.getByRole('switch', { name: 'Enabled' });
  const patched = () => admin.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok());
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await Promise.all([patched(), enabled.click()]);
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  await admin.reload();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');

  // One list as .txt, straight from its row; every list (disabled ones too) as a zip backup.
  const [txt] = await Promise.all([
    admin.waitForEvent('download'),
    row.getByRole('button', { name: `Download ${NAME} as .txt` }).click(),
  ]);
  expect(txt.suggestedFilename()).toBe(`${SLUG}.txt`);
  expect((await downloaded(txt)).toString('utf8')).toBe('Moon\nMars\nVenus\nComet\n');
  const [zip] = await Promise.all([
    admin.waitForEvent('download'),
    admin.getByRole('button', { name: 'Download all (.zip)' }).click(),
  ]);
  expect(zip.suggestedFilename()).toMatch(/^virtual-tavern-word-lists-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await downloaded(zip)));
  const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as {
    lists: Record<string, { name: string; enabled: boolean }>;
  };
  expect(manifest.lists[SLUG]).toMatchObject({ name: NAME, enabled: false });
  expect(strFromU8(files[`${SLUG}.txt`]!).split('\n')[0]).toBe('Moon');
  expect(Object.values(manifest.lists).map((l) => l.name)).toContain('Starter');

  await host.reload();
  await expect(lists.getByText('Starter')).toBeVisible();
  await expect(lists.getByText(NAME)).toBeHidden();
  await expect(lists.getByText(/from this list \(\d+ words\)/)).toBeVisible();
  await host.getByRole('button', { name: 'Change word lists' }).click();
  await expect(picker.getByText(/^1 list ·/)).toBeVisible();
  // Other lists still match "planets"; the disabled one doesn't show up among them.
  await picker.getByRole('searchbox').fill('planets');
  await expect(picker.getByRole('checkbox').first()).toBeVisible();
  await expect(picker.getByRole('checkbox', { name: NAME })).toHaveCount(0);
  await picker.getByRole('button', { name: 'Cancel' }).click();

  const fresh = await player(browser, 'Fern');
  await fresh.getByRole('button', { name: 'Create a Codenames room' }).click();
  await fresh.getByRole('button', { name: 'Change word lists' }).click();
  await fresh.getByRole('dialog').getByRole('searchbox').fill('planets');
  await expect(fresh.getByRole('dialog').getByRole('checkbox').first()).toBeVisible();
  await expect(fresh.getByRole('dialog').getByRole('checkbox', { name: NAME })).toHaveCount(0);

  // Switched back on, the room's saved selection includes it again.
  await Promise.all([patched(), enabled.click()]);
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await expect(row.getByText('Disabled', { exact: true })).toBeHidden();
  await host.reload();
  await expect(lists.getByText(NAME)).toBeVisible();
  await expect(lists.getByText(/from these lists/)).toBeVisible();
  await removeList();
});

test('a team that loses its Spymaster is told why its turns are skipped, and can fill the seat', async ({
  browser,
}) => {
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const roomUrl = host.url();
  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map((n) => player(browser, n, roomUrl)),
  );
  await host
    .getByRole('region', { name: 'Red team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await ana!.getByRole('button', { name: 'Join Red as Operative' }).click();
  await ben!
    .getByRole('region', { name: 'Blue team' })
    .getByRole('button', { name: 'Be the Spymaster' })
    .click();
  await cy!.getByRole('button', { name: 'Join Blue as Operative' }).click();
  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(cards(cy!)).toHaveCount(25);
  await expect(cy!.getByTestId('no-spymaster')).toHaveCount(0);

  // Blue's Spymaster leaves.
  ben!.on('dialog', (d) => void d.accept());
  await ben!.getByRole('button', { name: /^Players/ }).click();
  await ben!
    .getByRole('dialog', { name: 'Players' })
    .getByRole('button', { name: 'Leave room' })
    .click();
  await ben!
    .getByRole('dialog', { name: 'Leave this room?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();

  // Blue's only operative is told, but can't move up: nobody would be left to guess. Red knows
  // why Blue never plays.
  await expect(cy!.getByTestId('no-spymaster')).toContainText(
    'Your team has no Spymaster, so your turns are skipped. You’re its only Operative, so someone else needs to take the seat.',
  );
  await expect(cy!.getByTestId('no-spymaster').getByRole('button')).toHaveCount(0);
  await expect(host.getByTestId('no-spymaster')).toContainText(
    "Blue has no Spymaster, so Blue's turns are skipped. Nobody here can take it: wait for someone to join, or go back to the lobby.",
  );
  // Nobody here can take the seat, so the host is offered the way out, and nothing else.
  await expect(host.getByTestId('no-spymaster').getByRole('button')).toHaveText(['Back to lobby']);
  // A newcomer is offered the seat, and takes it.
  const dee = await player(browser, 'Dee', roomUrl);
  const alert = dee.getByTestId('no-spymaster');
  await alert.getByRole('button', { name: 'Be the Blue Spymaster' }).click();
  await expect(cy!.getByTestId('no-spymaster')).toHaveCount(0);
  await expect(host.getByTestId('no-spymaster')).toHaveCount(0);
});
