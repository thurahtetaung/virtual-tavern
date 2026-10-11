import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD } from './credentials.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

let nextIp = 1;
async function visitor(browser: Browser, name: string) {
  // The back-room knock is rate-limited per address, so each browser gets its own.
  const context = await browser.newContext({
    extraHTTPHeaders: { 'cf-connecting-ip': `10.1.0.${nextIp++}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

async function openBackroom(page: Page) {
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

/** The card buttons in a region (not its action buttons). */
const cardsIn = (region: ReturnType<Page['getByRole']>) =>
  region.getByRole('button', { name: /^Card / });
const hand = (page: Page) => cardsIn(page.getByRole('region', { name: 'Your hand' }));
const table = (page: Page) => cardsIn(page.getByRole('region', { name: 'Table' }));

/** The storyteller tells with their first card; a player gives their first card. */
async function tell(page: Page, clue: string) {
  await hand(page).first().click();
  await page.getByRole('button', { name: 'Tell a story with this card' }).click();
  await page.getByPlaceholder('A word, a line, a feeling…').fill(clue);
  await page.getByRole('button', { name: 'Tell', exact: true }).click();
}
async function give(page: Page) {
  await hand(page).first().click();
  await page.getByRole('button', { name: 'Give this card' }).click();
  await page.getByRole('button', { name: 'Give this card' }).click();
}
/**
 * Votes for the first table card that isn't the voter's own (or, with `change`, isn't their
 * current vote either), waiting for the card view to open before reading its button.
 */
async function vote(page: Page, change = false) {
  const cards = table(page);
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const btn = dialog.getByRole('button', {
      name: change ? `Change vote to #${i + 1}` : `Vote for #${i + 1}`,
    });
    if ((await btn.count()) > 0) {
      await btn.click();
      await expect(dialog).toBeHidden();
      return i + 1;
    }
    await dialog.getByRole('button', { name: 'Close' }).first().click();
    await expect(dialog).toBeHidden();
  }
  throw new Error('no card to vote for');
}

test('four friends play Reverie behind the back room', async ({ browser }) => {
  test.setTimeout(120_000);
  await openBackroom(await visitor(browser, 'Admin'));

  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Reverie room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();

  // A stranger with the link is sent to the door.
  const stranger = await visitor(browser, 'Stranger');
  await stranger.goto(url);
  await expect(stranger).toHaveURL(/\/backroom\?next=/);

  const [ana, ben, cy] = await Promise.all(
    ['Ana', 'Ben', 'Cy'].map(async (n) => {
      const p = await visitor(browser, n);
      await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(p).toHaveURL(url);
      return p;
    }),
  );
  const players = [host, ana!, ben!, cy!];
  const late = await visitor(browser, 'Eve');
  await expect(host.getByText('Players (4/8)')).toBeVisible();
  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  for (let round = 1; round <= 2; round++) {
    await expect(host.getByText(`Turn ${round}`)).toBeVisible();
    if (round === 1) {
      // A late joiner is told they are watching, and when they can sit down.
      await unlock(late, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
      await expect(late).toHaveURL(url);
      await expect(
        late.getByText(/You’re watching this turn\..*take a seat at the reveal/),
      ).toBeVisible();
    }
    // Everyone holds six cards; the storyteller is whoever sees the prompt.
    for (const p of players) await expect(hand(p)).toHaveCount(6);
    let storyteller: Page | undefined;
    for (const p of players) {
      if (await p.getByText('You are the storyteller').isVisible()) storyteller = p;
    }
    expect(storyteller).toBeTruthy();
    await tell(storyteller!, `clue ${round}`);
    await expect(ana!.getByText(`“clue ${round}”`)).toBeVisible();
    for (const p of players) if (p !== storyteller) await give(p);
    await expect(table(host)).toHaveCount(players.length);
    const voters = players.filter((p) => p !== storyteller);
    // The first voter changes their mind before the last vote is in.
    await vote(voters[0]!);
    const changed = await vote(voters[0]!, true);
    await expect(voters[0]!.getByText(`You voted for #${changed}.`)).toBeVisible();
    for (const p of voters.slice(1)) await vote(p);
    await expect(host.getByText('Cards revealed!')).toBeVisible();
    // The storyteller's card is marked in words and every voter is named.
    await expect(host.getByText('📖 Story card')).toBeVisible();
    await expect(voters[0]!.getByText('✋ Your vote')).toBeVisible();
    await expect(host.getByText(/^Votes: /).first()).toBeVisible();
    if (round === 1) {
      // The hint's button, next to the status line (the Players panel has one too).
      await late.getByRole('button', { name: 'Take a seat' }).first().click();
      await expect(host.getByText('Players (5/8)')).toBeVisible();
      players.push(late);
    }
    await host.getByRole('button', { name: 'Next turn' }).click();
  }
  await expect(host.getByText('Turn 3')).toBeVisible();
  // Scores were awarded: at least one player is above zero.
  const scores = await host.getByRole('list', { name: 'Scores' }).innerText();
  expect(scores).toMatch(/[1-9]/);
});
