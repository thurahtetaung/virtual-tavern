import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { openBackroom, pageErrors, visitor } from './tavern-brawl-play.ts';
import {
  YOUR_TURN,
  answer,
  answerAll,
  importDeck,
  nextQuestion,
  revealed,
  table,
} from './stampede-play.ts';

const PHONE = { width: 390, height: 844 };

/** Decks this spec imported, deleted after each test (pass or fail) so later specs see their own. */
const cleanup: (() => Promise<unknown>)[] = [];
test.afterEach(async () => {
  for (const undo of cleanup.splice(0)) await undo();
});
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

const pinkLine = (p: Page) => p.getByTestId('pink-line');

test('four players on phones play Stampede to 5: a typo grouped by itself, a tie, the Pink Cow moving and the win', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const deckId = await importDeck(admin);
  cleanup.push(() => admin.request.delete(`/api/admin/question-decks/${deckId}`));

  const pages = (await table(browser, ['Hana', 'Ana', 'Ben', 'Cy'], { viewport: PHONE })) as [
    Page,
    Page,
    Page,
    Page,
  ];
  const [hana, ana, ben, cy] = pages;
  // The deck reaches the lobby through the room, tagged only for this game.
  await expect(hana.getByRole('region', { name: 'Question decks' })).toContainText(
    'E2E pretend questions',
  );
  await hana.getByRole('button', { name: '🐄 5' }).click();
  await expect(hana.getByRole('button', { name: '🐄 5' })).toHaveAttribute('aria-pressed', 'true');
  await hana.getByRole('button', { name: 'Start game' }).click();

  // Round 1: answers stay secret until all are in, then group themselves (a typo included).
  for (const p of pages) await expect(p).toHaveTitle(YOUR_TURN);
  await answer(hana, 'Pizza');
  await answer(cy, 'Soup');
  await expect(hana.getByTestId('ticks')).toContainText('✅');
  await expect(hana.locator('body')).not.toContainText('Soup');
  await answer(ana, 'pizza');
  await answer(ben, 'Pizzaa');
  await revealed(pages);
  await expect(ben.getByTestId('herd')).toContainText('Pizza');
  await expect(ben.getByTestId('herd')).toContainText('×3');
  // Each player's own spelling shows under the group.
  await expect(ben.getByTestId('herd')).toContainText('“Pizzaa”');
  // Cy was the only one alone: the Pink Cow leaves the middle for Cy.
  await expect(pinkLine(ana)).toContainText('middle → Cy');
  await expect(pinkLine(cy)).toContainText('middle → you');

  // Round 2: a tie at the top scores nobody, and the Pink Cow stays.
  await nextQuestion(hana, pages);
  await answerAll(pages, ['cat', 'cat', 'dog', 'dog']);
  await revealed(pages);
  await expect(ana.getByTestId('no-herd')).toContainText('Tie at the top');
  await expect(pinkLine(ana)).toContainText('stays with Cy');

  // Round 3: Hana alone takes it from Cy.
  await nextQuestion(hana, pages);
  await answerAll(pages, ['Mars', 'Moon', 'moon', 'Moon']);
  await revealed(pages);
  await expect(pinkLine(ben)).toContainText('Cy → Hana');
  // The holder is marked on the scoreboard (the phone's Scores tab).
  await ben.getByTestId('tab-scores').click();
  await expect(ben.locator('[data-testid^="score-"]', { hasText: 'Hana' })).toContainText('🩷');
  await expect(ben.getByTestId('scoreboard')).toContainText('Hana holds the Pink Cow');
  await ben.getByTestId('tab-play').click();

  // Rounds 4–5: Ana, Ben and Cy herd up; Hana stays alone with the cow.
  for (let i = 0; i < 2; i++) {
    await nextQuestion(hana, pages);
    await answerAll(pages, [`odd${i}`, 'tea', 'tea', 'tea']);
    await revealed(pages);
  }
  // Round 6: Ana reaches 5 alone at the top (Ben and Hana alone: the cow stays put).
  await nextQuestion(hana, pages);
  await answerAll(pages, ['zebra', 'tea', 'yak', 'tea']);
  await expect(ana.getByText('🏆 You win!')).toBeVisible();
  await expect(ben.getByText('🏆 Ana wins!')).toBeVisible();
  await expect(cy.getByRole('region', { name: 'Final standings' })).toContainText('Ana');
});
