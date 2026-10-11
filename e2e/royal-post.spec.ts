import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';
import {
  type Exercised,
  dismissReveal,
  playUntil,
  readFirstCard,
  reveal,
  takeTurn,
  whoseTurn,
} from './royal-post-play.ts';

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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.7.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // "Abandon game" asks first.
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

/** The admin signs in and sets the back-room password. */
async function openBackroom(page: Page) {
  await ownLoginLimit(page);
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Back room password').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: /Open the back room|Change password/ }).click();
  await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
}

async function unlock(page: Page, url = '/backroom') {
  await page.goto(url);
  await page.getByLabel('The word').fill(TEST_BACKROOM_WORD);
  await page.getByRole('button', { name: 'Knock' }).click();
}

test('three friends play Royal Post in both editions behind the back room', async ({ browser }) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));

  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();

  const [ana, ben] = await Promise.all(
    ['Ana', 'Ben'].map(async (n) => {
      const p = await visitor(browser, n);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  const players = [host, ana!, ben!];
  await expect(host.getByText('Players (3/4)')).toBeVisible();
  await expect(host.getByText('5 tokens to win').first()).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Round 1')).toBeVisible();

  const done: Exercised = { guard: false, priest: false, handmaid: false, chancellor: false };
  // Classic: play rounds until a Guard guess, a Priest peek and a Handmaid have all happened.
  await playUntil(host, players, 'classic', done, () => done.guard && done.priest && done.handmaid);

  // Over to the 2019 edition.
  const abandon = host.getByRole('button', { name: 'Abandon game' });
  if (await abandon.count()) await abandon.click();
  else await host.getByRole('button', { name: 'Change settings' }).click();
  await host.getByRole('button', { name: /^2019 edition/ }).click();
  await expect(ana!.getByRole('button', { name: /^2019 edition/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(host.getByText('Players (3/6)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Round 1')).toBeVisible();
  await playUntil(host, players, '2019', done, () => done.chancellor);
  expect(done).toEqual({ guard: true, priest: true, handmaid: true, chancellor: true });
});

test('cards on the table open full size: the face-up set-aside cards and the discards', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const ana = await visitor(browser, 'Ana');
  await unlock(ana, `/backroom?next=${encodeURIComponent(new URL(host.url()).pathname)}`);
  await expect(host.getByText('Players (2/4)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Round 1')).toBeVisible();

  // Two players: three cards are set aside face up, and each opens to read (never to play).
  const faceUp = ana.getByRole('list', { name: 'Set aside face up' }).getByRole('button');
  await expect(faceUp).toHaveCount(3);
  await faceUp.first().click();
  const sheet = ana.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Play / })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(sheet).toBeHidden();

  // After one turn, the played card sits in a discard pile and opens the same way.
  const players = [host, ana];
  const turn = await whoseTurn(players, host);
  if (turn === 'over') throw new Error('the round ended before anyone played');
  await takeTurn(turn, players, 'classic', {
    guard: true,
    priest: true,
    handmaid: true,
    chancellor: true,
  });
  const pile = host.getByRole('dialog', { name: /discards$/ });
  // A Baron or King reveal from that turn can open over the table; close it and retry.
  await expect(async () => {
    await dismissReveal(host);
    await host
      .getByRole('button', { name: /’s discards: / })
      .first()
      .click({ timeout: 1000 });
    await expect(pile).toBeVisible({ timeout: 1000 });
  }).toPass();
  await readFirstCard(host, pile.getByRole('list', { name: 'Discard pile' }));
  await pile.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(pile).toBeHidden();
});

test('every card name opens the card: the Guard grid, a private reveal, the log and notes', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const ana = await visitor(browser, 'Ana');
  await unlock(ana, `/backroom?next=${encodeURIComponent(new URL(host.url()).pathname)}`);
  await expect(host.getByText('Players (2/4)')).toBeVisible();

  // The lobby lists the edition's cards, each one readable before the game starts.
  await host.locator('summary', { hasText: 'The cards' }).click();
  await readFirstCard(host, host.getByRole('list', { name: 'The cards' }));
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Round 1')).toBeVisible();

  const players = [host, ana];
  const done: Exercised = { guard: false, priest: false, handmaid: true, chancellor: true };
  let peeker: Page | null = null;
  await playUntil(
    host,
    players,
    'classic',
    done,
    () => done.guard && peeker !== null,
    async (moment, p) => {
      // The Guard's guess: the named card reads in full before it's played.
      if (moment === 'guard-guess') {
        const grid = p.getByRole('group', { name: 'Name a card' });
        await readFirstCard(p, grid);
        await expect(grid.getByRole('button', { name: /unseen$/ }).first()).toBeVisible();
      }
      // The Priest's peek: the card seen opens from the private reveal.
      if (moment === 'priest-reveal' && !peeker) {
        await readFirstCard(p, reveal(p));
        peeker = p;
      }
    },
  );

  // The log and the private notes name cards that open too.
  const records = peeker!.getByRole('region', { name: 'Table records' });
  await records.getByRole('tab', { name: 'Log' }).click();
  await readFirstCard(peeker!, records.getByRole('list', { name: 'What happened' }));
  await records.getByRole('tab', { name: /^Notes/ }).click();
  await readFirstCard(peeker!, records.getByRole('list', { name: 'Your notes' }));
  await records.getByRole('tab', { name: 'Card count' }).click();
  await expect(records.getByRole('list', { name: 'Card count' }).getByRole('listitem')).toHaveCount(
    8,
  );
});

test('watchers get a seat: a bigger edition seats them, and the podium offers Take a seat', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  await openBackroom(await visitor(browser, 'Admin'));
  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Royal Post room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  const friends: Page[] = [];
  for (const n of ['Ana', 'Ben', 'Cy', 'Dee', 'Eve']) {
    const p = await visitor(browser, n);
    await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
    await expect(p.getByText(/^Players \(/)).toBeVisible();
    friends.push(p);
  }
  const [ana, ben, cy, dee, eve] = friends as [Page, Page, Page, Page, Page];

  // Classic seats four: Dee and Eve wait, and the host is told so.
  await expect(host.getByText('Players (4/4)')).toBeVisible();
  await expect(eve.getByText('The table is full, so you’re watching.')).toBeVisible();
  await expect(host.getByText('Dee and Eve are watching')).toBeVisible();

  // The 2019 edition seats six: they sit down by themselves.
  await host.getByRole('button', { name: /^2019 edition/ }).click();
  await expect(host.getByText('Players (6/6)')).toBeVisible();
  await expect(eve.getByRole('button', { name: 'Just watch' })).toBeVisible();

  // A quick two-player game; the rest choose to watch.
  for (const p of [ben, cy, dee, eve]) {
    await p.getByRole('button', { name: 'Just watch' }).click();
    await expect(p.getByRole('button', { name: 'Take a seat' })).toBeVisible();
  }
  await expect(host.getByText('Players (2/6)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(host.getByText('Round 1')).toBeVisible();
  const done: Exercised = { guard: true, priest: true, handmaid: true, chancellor: true };
  await playUntil(host, [host, ana], '2019', done, (gameOver) => gameOver);

  // The podium: Ben takes a seat for the next game; guests know who deals.
  const podium = ben.getByLabel('Game result');
  await expect(podium).toBeVisible();
  await expect(ana.getByLabel('Game result')).toContainText(
    'Waiting for Hana (host) to start the next game',
  );
  await podium.getByRole('button', { name: 'Take a seat' }).click();
  await expect(podium.getByRole('button', { name: 'Just watch' })).toBeVisible();
  await expect(host.getByLabel('Game result')).toContainText('Next game (3/6)');
  await host.getByRole('button', { name: 'Play again' }).click();
  await expect(ben.getByRole('region', { name: 'Your hand' })).toBeVisible();
});
