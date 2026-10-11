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
/** Votes for the first table card that isn't the voter's own. */
async function vote(page: Page) {
  const cards = table(page);
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    await cards.nth(i).click();
    const btn = page.getByRole('button', { name: `Vote for #${i + 1}` });
    if (await btn.isVisible()) {
      await btn.click();
      return;
    }
    await page.keyboard.press('Escape');
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
  await expect(host.getByText('Players (4/8)')).toBeVisible();
  await expect(host.getByText('Everyone is seated')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  for (let round = 1; round <= 2; round++) {
    await expect(host.getByText(`Turn ${round}`)).toBeVisible();
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
    await expect(table(host)).toHaveCount(4);
    for (const p of players) if (p !== storyteller) await vote(p);
    await expect(host.getByText('Cards revealed!')).toBeVisible();
    // The storyteller's card is marked and every table card now shows its owner.
    await expect(host.getByText('📖', { exact: false }).first()).toBeVisible();
    await host.getByRole('button', { name: 'Next turn' }).click();
  }
  await expect(host.getByText('Turn 3')).toBeVisible();
  // Scores were awarded: at least one player is above zero.
  const scores = await host.getByRole('list', { name: 'Scores' }).innerText();
  expect(scores).toMatch(/[1-9]/);
});
