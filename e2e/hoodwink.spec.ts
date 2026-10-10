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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.2.0.${nextIp++}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

/** The admin signs in and sets the back-room password. */
async function openBackroom(page: Page) {
  await page.goto('/admin');
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

const YOUR_TURN = /^● Your turn/;
const TRUTH = 'Zebra crossing';

/** A tiny made-up deck: every question has the same answer, so the test knows the truth. */
const DECK = {
  name: 'E2E made-up facts',
  description: 'Invented questions for the end-to-end test.',
  questions: Array.from({ length: 5 }, (_, i) => ({
    prompt: `In the invented village of Plimbo ${i + 1}, the mayor is chosen by a ___.`,
    answer: TRUTH,
    alternates: ['Pedestrian crossing'],
  })),
};

/** Imports the deck as the signed-in admin; false if this server has no question decks yet. */
async function importDeck(admin: Page): Promise<boolean> {
  const res = await admin.request.post('/api/admin/question-decks', { data: DECK });
  if (res.status() === 404) return false;
  expect(res.status(), await res.text()).toBe(201);
  return true;
}

async function sendLie(page: Page, lie: string) {
  await expect(page).toHaveTitle(YOUR_TURN);
  await page.getByLabel('Your lie').fill(lie);
  await page.getByRole('button', { name: 'Send lie' }).click();
  // The last lie in opens the vote, and the form goes away.
  await expect(
    page.getByRole('button', { name: '✓ Sent' }).or(page.getByRole('list', { name: 'Answers' })),
  ).toBeVisible();
}

async function vote(page: Page, answer: string) {
  await expect(page).toHaveTitle(YOUR_TURN);
  const option = page.getByRole('list', { name: 'Answers' }).getByRole('button', { name: answer });
  await option.click();
  await expect(
    option.or(page.getByRole('list', { name: 'Answers revealed' })).first(),
  ).toBeVisible();
}

test('four players play a round of Hoodwink in the back room: a refused truth, a merged lie, votes and scores', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  // TODO: drop this skip once the question-deck admin API is merged into this branch.
  test.skip(!(await importDeck(admin)), 'POST /api/admin/question-decks is not available yet');

  const host = await visitor(browser, 'Hana');
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Hoodwink room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  await expect(host.getByText('Almost ready: Hoodwink needs at least 3 players')).toBeVisible();
  const url = host.url();
  // Joined one at a time, so seat order (and the spelling a merged lie keeps) is fixed.
  const joined: Page[] = [];
  for (const name of ['Ana', 'Ben', 'Cy']) {
    const page = await visitor(browser, name);
    await unlock(page, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(page).toHaveURL(url);
    joined.push(page);
    await expect(
      host.getByRole('region', { name: 'Players' }).getByText(name, { exact: true }),
    ).toBeVisible();
  }
  const [ana, ben, cy] = joined as [Page, Page, Page];
  await expect(host.getByRole('region', { name: 'Question decks' })).toContainText(DECK.name);
  await host.getByRole('button', { name: '5 rounds' }).click();
  await expect(ana.getByText('5 rounds')).toBeVisible();
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Writing: the real answer is refused, and two players write the same lie.
  await expect(ana.getByTestId('prompt')).toContainText('the mayor is chosen by a');
  await expect(ana.getByTestId('prompt')).not.toContainText(TRUTH);
  await ana.getByLabel('Your lie').fill('zebra crossings');
  await ana.getByRole('button', { name: 'Send lie' }).click();
  await expect(ana.getByText('That’s the real answer — write a lie!').first()).toBeVisible();
  await sendLie(ana, 'Tiny ukulele');
  await expect(ana.getByText('1 of 4 lies in')).toBeVisible();
  await sendLie(ben, 'tiny ukuleles');
  await sendLie(cy, 'Garden gnome');
  await sendLie(host, 'Purple llama');

  // Voting: four answers (the merged lie once), and your own lie can't be picked.
  for (const page of [host, ana, ben, cy]) {
    await expect(page.getByRole('list', { name: 'Answers' }).getByRole('button')).toHaveCount(4);
  }
  await expect(
    ana.getByRole('list', { name: 'Answers' }).getByRole('button', { name: /Tiny ukulele/ }),
  ).toBeDisabled();
  await expect(ben.getByRole('button', { name: /Tiny ukulele/ })).toContainText('Your lie');
  await vote(host, 'Tiny ukulele');
  await vote(ana, TRUTH);
  await vote(ben, 'Garden gnome');
  await vote(cy, 'Purple llama');

  // Reveal: the truth, who wrote what, and the points (a merged lie splits its 500).
  const revealed = cy.getByRole('list', { name: 'Answers revealed' });
  await expect(revealed).toContainText('✅ The truth');
  await expect(revealed).toContainText('🎭 Lie by Ana and Ben');
  await expect(cy.getByTestId('prompt')).toContainText(TRUTH);
  await expect(ana.getByRole('img', { name: 'Your score 1250' })).toBeVisible();
  await expect(ben.getByRole('img', { name: 'Your score 250' })).toBeVisible();
  await expect(cy.getByRole('img', { name: 'Your score 500' })).toBeVisible();
  await expect(host.getByRole('img', { name: 'Your score 500' })).toBeVisible();
  await expect(host).toHaveTitle(YOUR_TURN); // the host moves the game on
  await host.getByRole('button', { name: 'Next round' }).click();
  await expect(ana.getByText('Round 2/5')).toBeVisible();
  await expect(ana).toHaveTitle(YOUR_TURN);
});
