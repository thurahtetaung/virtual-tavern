import { type Browser, type Page, expect, test } from '@playwright/test';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

async function player(browser: Browser, name: string, url = '/') {
  const page = await (await browser.newContext()).newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  await page.goto(url);
  return page;
}

const YOUR_TURN = /^● Your turn/;

/** The guesser picks a word; returns the secret word as a clue writer sees it. */
async function pickWord(guesser: Page, writer: Page, n: number) {
  await expect(guesser).toHaveTitle(YOUR_TURN);
  await expect(writer).not.toHaveTitle(YOUR_TURN);
  await guesser.getByRole('button', { name: `Pick word ${n}` }).click();
  const word = writer.getByTestId('secret-word');
  await expect(word).toBeVisible();
  return word.innerText();
}

async function sendClue(page: Page, clue: string) {
  await page.getByLabel('Your clue').fill(clue);
  await page.getByRole('button', { name: 'Send clue' }).click();
  // The last clue in moves the card on to guessing, and the form goes away.
  await expect(
    page.getByRole('button', { name: '✓ Sent' }).or(page.getByRole('list', { name: 'Clues' })),
  ).toBeVisible();
}

test('four players play Echo: a hit with cancelled clues, a pass and a miss decided on its own', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const host = await player(browser, 'Hana');
  await host.getByRole('button', { name: 'Create an Echo room' }).click();
  await expect(host.getByText('Almost ready: Echo needs at least 3 players')).toBeVisible();
  const url = host.url();
  // Seat order is the guessing order, so everyone joins one at a time.
  const joined: Page[] = [];
  for (const name of ['Ana', 'Ben', 'Cy']) {
    joined.push(await player(browser, name, url));
    await expect(
      host.getByRole('region', { name: 'Players' }).getByText(name, { exact: true }),
    ).toBeVisible();
  }
  const [ana, ben, cy] = joined as [Page, Page, Page];
  await expect(host.getByText('Everyone is in')).toBeVisible();
  await host.getByRole('button', { name: '8 cards' }).click();
  await expect(ana.getByText('8 cards', { exact: true })).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  // Card 1: Hana guesses. Ana and Ben write the same clue, so both cancel.
  const word = await pickWord(host, ana, 1);
  await expect(host.getByTestId('secret-word')).toHaveCount(0);
  // "Moon" would be refused if it is (or contains) the secret word itself.
  const [same, plural] = 'moons'.includes(word.toLowerCase())
    ? ['Star', 'stars']
    : ['Moon', 'moons'];
  await sendClue(ana, same);
  await sendClue(ben, plural);
  await sendClue(cy, 'Zzyzx');
  await expect(host).toHaveTitle(YOUR_TURN);
  // The guesser is warned that a wrong guess costs two cards before guessing.
  await expect(host.getByText('a wrong guess loses this card and the next')).toBeVisible();
  const shown = host.getByRole('list', { name: 'Your clues' });
  await expect(shown.getByRole('listitem')).toHaveText(['Zzyzx']);
  await expect(host.getByText('2 clues were cancelled.')).toBeVisible();
  await expect(host.getByText(same, { exact: true })).toHaveCount(0);
  await host.getByLabel('Your guess').fill(word.toLowerCase());
  await host.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(cy.getByText('🎉 Got it!')).toBeVisible();
  await expect(cy.getByText('Ana · same as Ben’s')).toBeVisible();
  await expect(host.getByRole('img', { name: 'Score 1' })).toBeVisible();
  await expect(host).toHaveTitle(YOUR_TURN); // the host moves the game on
  // Anyone at the table can deal on, not just the host.
  await expect(ana.getByText('Anyone at the table can press Next card')).toBeVisible();
  await expect(ana.getByRole('button', { name: 'Next card' })).toBeVisible();
  await host.getByRole('button', { name: 'Next card' }).click();

  // Card 2: Ana guesses, and passes.
  await pickWord(ana, ben, 3);
  await sendClue(host, 'Qwvx');
  await sendClue(ben, 'Xkzj');
  await sendClue(cy, 'Pjmq');
  await expect(ana).toHaveTitle(YOUR_TURN);
  await ana.getByRole('button', { name: 'Pass' }).click();
  await expect(host.getByText('⏭️ Passed')).toBeVisible();
  await expect(host.getByText('6 cards left')).toBeVisible();
  await host.getByRole('button', { name: 'Next card' }).click();

  // Card 3: Ben's guess is wrong, and the game decides it on its own: nobody has to judge.
  await pickWord(ben, cy, 5);
  await sendClue(host, 'Qwvx');
  await sendClue(ana, 'Xkzj');
  await sendClue(cy, 'Pjmq');
  await ben.getByLabel('Your guess').fill('Qqqqq');
  await ben.getByRole('button', { name: 'Guess', exact: true }).click();
  await expect(ben.getByText(/Not this time/).first()).toBeVisible();
  await expect(cy.getByRole('button', { name: 'Count it' })).toHaveCount(0);
  await expect(host.getByRole('img', { name: 'Score 1' })).toBeVisible();
});
