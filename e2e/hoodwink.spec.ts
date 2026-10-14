import { type Browser, type Page, expect, test } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, TEST_BACKROOM_WORD, ownLoginLimit } from './credentials.ts';

const pageErrors: string[] = [];
/** Decks this spec imported, deleted after each test (pass or fail) so later specs see their own. */
const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});
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
    extraHTTPHeaders: { 'cf-connecting-ip': `10.6.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
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

const YOUR_TURN = /^● Your turn/;
const TRUTH = 'Zebra crossing';

/** Ready-made fakes: "Lie for me" picks one, and a small board is padded with another. */
const DECOYS = ['Coin toss', 'Goat race', 'Snail derby', 'Pie contest'];

/** A tiny made-up deck: every question has the same answer, so the test knows the truth. */
const DECK = {
  name: 'E2E made-up facts',
  description: 'Invented questions for the end-to-end test.',
  questions: Array.from({ length: 5 }, (_, i) => ({
    prompt: `In the invented village of Plimbo ${i + 1}, the mayor is chosen by a ___.`,
    answer: TRUTH,
    alternates: ['Pedestrian crossing'],
    decoys: DECOYS,
  })),
};

/** Imports the deck through the admin API (the import script's route); returns its id. */
async function importDeck(admin: Page): Promise<string> {
  const res = await admin.request.post('/api/admin/question-decks', { data: DECK });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
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

const scoreIs = (page: Page, score: number) =>
  expect(page.getByRole('img', { name: `Your score ${score}` })).toBeVisible();

test('four players play Hoodwink in the back room: a refused truth, merged lies, "Lie for me", house fakes and scores', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const deckId = await importDeck(admin);
  cleanup.push(() => admin.request.delete(`/api/admin/question-decks/${deckId}`));

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
  const everyone = [host, ana, ben, cy];
  // Deck names come from the server through the room (players never fetch the deck list).
  await expect(host.getByRole('region', { name: 'Question decks' })).toContainText(DECK.name);
  await expect(ana.getByRole('region', { name: 'Question decks' })).toContainText(DECK.name);
  await host.getByRole('button', { name: '5 rounds' }).click();
  await expect(ana.getByText('5 rounds')).toBeVisible();
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Round 1, writing: the real answer is refused, and two players write the same lie.
  for (const page of everyone) await expect(page).toHaveTitle(YOUR_TURN);
  await expect(ana.getByTestId('prompt')).toContainText('the mayor is chosen by a');
  await expect(ana.getByTestId('prompt')).not.toContainText(TRUTH);
  await sendLie(ana, 'Tiny ukulele');
  await expect(ana.getByText('1 of 4 lies in')).toBeVisible();
  // "Lie for me" can't throw away a lie you wrote yourself.
  await expect(ana.getByRole('button', { name: '🎲 Lie for me' })).toHaveCount(0);
  await expect(ben.getByRole('button', { name: '🎲 Lie for me' })).toBeVisible();
  // Only players who still need to act see "Your turn" in the tab title.
  await expect(ana).not.toHaveTitle(YOUR_TURN);
  await expect(ben).toHaveTitle(YOUR_TURN);
  // A near-copy (a leading article, a plural, a hyphen) counts as the truth too. The first try is
  // remembered (Ben's vote for the truth won't score this round); a second one is refused.
  await ben.getByLabel('Your lie').fill('The zebra-crossings');
  await ben.getByRole('button', { name: 'Send lie' }).click();
  await expect(ben.getByTestId('typed-truth')).toContainText('won’t score this round');
  await expect(ana.getByTestId('typed-truth')).toHaveCount(0);
  await ben.getByLabel('Your lie').fill('Zebra crossing');
  await ben.getByRole('button', { name: 'Send lie' }).click();
  await expect(ben.getByText('That’s the real answer — write a lie!').first()).toBeVisible();
  await sendLie(ben, 'tiny ukuleles');
  // Both are warned that the lie will be shared; nobody else is.
  await expect(ben.getByTestId('lie-shared')).toBeVisible();
  await expect(ana.getByTestId('lie-shared')).toBeVisible();
  await expect(cy.getByTestId('lie-shared')).toHaveCount(0);
  await sendLie(cy, 'Garden gnome');
  await sendLie(host, 'Purple llama');

  // Voting: four answers (the merged lie once, no house fake needed), and your own lie can't be
  // picked.
  for (const page of everyone) {
    await expect(page.getByRole('list', { name: 'Answers' }).getByRole('button')).toHaveCount(4);
  }
  await expect(
    ana.getByRole('list', { name: 'Answers' }).getByRole('button', { name: /Tiny ukulele/ }),
  ).toBeDisabled();
  await expect(ben.getByRole('button', { name: /Tiny ukulele/ })).toContainText('Your lie');
  await vote(host, 'Tiny ukulele');
  await expect(host).not.toHaveTitle(YOUR_TURN);
  await vote(ana, TRUTH);
  await vote(ben, 'Garden gnome');
  await vote(cy, 'Purple llama');

  // Reveal: the truth, who wrote what, and the points (a merged lie splits its 500).
  const revealed = cy.getByRole('list', { name: 'Answers revealed' });
  await expect(revealed).toContainText('✅ The truth');
  await expect(revealed).toContainText('🎭 Lie by Ana and Ben');
  await expect(revealed).not.toContainText('House fake');
  await expect(cy.getByTestId('prompt')).toContainText(TRUTH);
  await scoreIs(ana, 1250);
  await scoreIs(ben, 250);
  await scoreIs(cy, 500);
  await scoreIs(host, 500);
  await expect(host).toHaveTitle(YOUR_TURN); // the host moves the game on
  await expect(ana).not.toHaveTitle(YOUR_TURN);
  await host.getByRole('button', { name: 'Next round' }).click();

  // Round 2: Ana lets the game lie for her; the other three write the same lie, so the board is
  // padded with a house fake.
  await expect(ana.getByText('Round 2/5')).toBeVisible();
  for (const page of everyone) await expect(page).toHaveTitle(YOUR_TURN);
  await ana.getByRole('button', { name: '🎲 Lie for me' }).click();
  await expect(ana.getByText('🎲 Picked for you: it scores half.')).toBeVisible();
  const autoLie = await ana.getByLabel('Your lie').inputValue();
  expect(DECOYS).toContain(autoLie);
  // One pick per round: the button goes, so it can't be pressed again to see other fakes.
  await expect(ana.getByRole('button', { name: '🎲 Lie for me' })).toHaveCount(0);
  await expect(ana).not.toHaveTitle(YOUR_TURN);
  await expect(cy).toHaveTitle(YOUR_TURN);
  await sendLie(ben, 'Moon cheese');
  await sendLie(cy, 'Moon cheese');
  await sendLie(host, 'Moon cheese');

  const answers = ben.getByRole('list', { name: 'Answers' }).getByRole('button');
  await expect(answers).toHaveCount(4);
  const texts = (await answers.allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
  const house = texts.find((t) => ![TRUTH, 'Moon cheese', autoLie].includes(t));
  expect(DECOYS).toContain(house);
  await vote(host, autoLie);
  await vote(ana, 'Moon cheese');
  await vote(ben, house!);
  await vote(cy, TRUTH);

  // The reveal names the lie picked for Ana and the house fake; Ana's lie scores half (250).
  const second = cy.getByRole('list', { name: 'Answers revealed' });
  await expect(second).toContainText('🏠 House fake');
  await expect(second).toContainText('🎭 Lie by Ana');
  await expect(second).toContainText('🎲 Picked by the game (half points)');
  // The points come with their reasons.
  const anaPoints = cy
    .getByRole('list', { name: 'Points this round' })
    .getByRole('listitem')
    .filter({ hasText: /^Ana\s*\+/ });
  await expect(anaPoints).toContainText('+250');
  await expect(anaPoints).toContainText('fooled Hana (half: picked for you)');
  // 500 shared three ways rounds down to 150 each.
  await scoreIs(ana, 1500);
  await scoreIs(ben, 400);
  await scoreIs(cy, 1650);
  await scoreIs(host, 650);
  await host.getByRole('button', { name: 'Next round' }).click();
  await expect(ana.getByText('Round 3/5')).toBeVisible();
  for (const page of everyone) await expect(page).toHaveTitle(YOUR_TURN);

  // The admin stats page shows the game: its lies in the word cloud and how often the truth won.
  await admin.goto('/tavern-keeper/stats?tab=games&game=hoodwink');
  const words = admin.getByRole('region', { name: 'Words', exact: true });
  await expect(words.getByRole('button', { name: 'Lies' })).toHaveAttribute('aria-pressed', 'true');
  await expect(words.getByRole('list', { name: 'Lies' })).toContainText('tiny ukulele');
  await expect(words.getByRole('list', { name: 'Lies' })).toContainText('moon cheese');
  await expect(admin.getByRole('meter', { name: 'Votes that found the truth' })).toHaveAttribute(
    'aria-valuenow',
    '25',
  );
});
