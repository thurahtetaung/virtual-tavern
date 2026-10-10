import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD } from './credentials.ts';

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
  await expect(ana!.getByText('Waiting for the host')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();
  await expect(cards(host)).toHaveCount(25);

  // Whoever's team starts, its spymaster gives a clue.
  const redStarts = await host.getByText('Your turn! Give your team').isVisible();
  const [spy, op, otherOp] = redStarts ? [host, ana!, cy!] : [ben!, cy!, ana!];
  // The tab title flags whoever has to act, so a background tab stands out.
  await expect(spy).toHaveTitle(/^● Your turn · Codenames/);
  await expect(op).toHaveTitle('Codenames · Virtual Tavern');
  await spy.getByPlaceholder('e.g. Ocean').fill('Tavern');
  await spy.getByRole('button', { name: '2', exact: true }).click();
  await spy.getByRole('button', { name: 'Give clue' }).click();

  await expect(op.getByText('Your turn to guess')).toBeVisible();
  await expect(op).toHaveTitle(/^● Your turn · Codenames/);
  await expect(spy).toHaveTitle('Codenames · Virtual Tavern');
  await expect(otherOp.getByText('team is guessing')).toBeVisible();
  await expect(op.locator('text=TAVERN').first()).toBeVisible();

  // Operatives never see the key; the spymaster finds the assassin for us.
  const assassinLabel = await cards(spy, /Assassin/).getAttribute('aria-label');
  const assassinWord = assassinLabel!.split(',')[0]!;
  await expect(cards(op, /Assassin/)).toHaveCount(0);

  await card(op, assassinWord).click();
  await op.getByRole('button', { name: `Guess ${assassinWord.toUpperCase()}` }).click();
  await expect(otherOp.getByText("☠ It's the assassin!")).toBeVisible();

  await expect(host.getByText('team wins!').first()).toBeVisible();
  await expect(cards(otherOp, /Assassin/)).toHaveCount(1);
  await expect(host.getByRole('button', { name: 'Play again (same teams)' })).toBeVisible();
  await expect(ana!.getByText('Waiting for the host to start the next game')).toBeVisible();
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
  await expect(guest.getByRole('dialog').getByText('Giving a clue (Spymaster)')).toBeVisible();
});

test('admins manage word lists that hosts can pick', async ({ browser }) => {
  const admin = await newPage(browser);
  await admin.goto('/admin');
  await admin.getByLabel('Admin password').fill('wrong');
  await admin.getByRole('button', { name: 'Sign in' }).click();
  await expect(admin.getByText('Wrong password.')).toBeVisible();
  await admin.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await admin.getByRole('button', { name: 'Sign in' }).click();

  await admin.getByRole('button', { name: '+ New list' }).click();
  await admin.getByLabel('Name', { exact: true }).fill('E2E Planets');
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
    admin.getByRole('button', { name: /^E2E Planets\s*Codenames\s*Enigma\s*Echo\s*4 words$/ }),
  ).toBeVisible();

  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create a Codenames room' }).click();
  const lists = host.getByRole('region', { name: 'Word lists' });
  await expect(lists.getByText('Starter')).toBeVisible();
  await host.getByRole('button', { name: 'Change word lists' }).click();
  const picker = host.getByRole('dialog');
  await picker.getByRole('searchbox').fill('planets');
  await picker.getByRole('checkbox', { name: /E2E Planets/ }).check();
  await expect(picker.getByText('2 lists')).toBeVisible();
  await picker.getByRole('button', { name: 'Save' }).click();
  await expect(picker).toBeHidden();
  await expect(lists.getByText('E2E Planets')).toBeVisible();
  await expect(lists.getByText('Starter')).toBeVisible();
});
