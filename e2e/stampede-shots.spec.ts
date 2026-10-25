import { type Page, expect } from '@playwright/test';
import { test } from './fixtures.ts';
import { type Look, openBackroom, visitor } from './tavern-brawl-play.ts';
import { answer, answerAll, importDeck, nextQuestion, revealed, table } from './stampede-play.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/stampede-shots.spec.ts
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

for (const [label, viewport, colorScheme] of [
  ['phone-light', { width: 390, height: 844 }, 'light'],
  ['phone-dark', { width: 390, height: 844 }, 'dark'],
  ['desktop-light', { width: 1280, height: 860 }, 'light'],
  ['desktop-dark', { width: 1280, height: 860 }, 'dark'],
] as const) {
  test(`stampede screenshots (${label})`, async ({ browser }) => {
    test.setTimeout(300_000);
    const look: Look = { viewport, colorScheme };
    const shot = async (p: Page, name: string) => {
      // Let the cows land.
      await p.waitForTimeout(900);
      await p.screenshot({
        path: `test-results/stampede-shots/${label}-${name}.png`,
        fullPage: true,
      });
    };
    const admin = await visitor(browser, 'Admin');
    await openBackroom(admin);
    const deckId = await importDeck(admin);
    try {
      const pages = (await table(browser, ['Hana', 'Ana', 'Ben', 'Cy'], look)) as [
        Page,
        Page,
        Page,
        Page,
      ];
      const [hana, ana, ben, cy] = pages;
      await shot(ana, 'lobby');
      await hana.getByRole('button', { name: '🐄 5' }).click();
      await hana.getByRole('button', { name: 'Start game' }).click();

      // Answering: one answer in, the others still writing.
      await answer(hana, 'Pancakes');
      await expect(ana.getByTestId('ticks')).toContainText('✅');
      await shot(ana, 'answering');
      await ben.getByTestId('answer-input').fill('Pankakes');
      await shot(ben, 'answer-typed');
      await answer(ben, 'Pankakes');
      await shot(hana, 'waiting-moo');
      await answer(ana, 'pancake');
      await answer(cy, 'Toast');

      // The last answer reveals the round, the typo grouped with the herd.
      await revealed(pages);
      await shot(ana, 'reveal');
      await shot(cy, 'reveal-pink');
      await shot(hana, 'reveal-host');
      if (viewport.width < 500) {
        await ana.getByTestId('tab-scores').click();
        await shot(ana, 'scores-tab');
        await ana.getByTestId('tab-play').click();
      }

      // On to the end: Hana and Ana herd up until Hana leads at 5.
      for (let i = 0; i < 3; i++) {
        await nextQuestion(hana, pages);
        await answerAll(pages, ['tea', 'tea', `b${i}`, `c${i}`]);
        await revealed(pages);
      }
      await nextQuestion(hana, pages);
      await answerAll(pages, ['tea', 'milk', 'tea', 'juice']);
      await expect(ana.getByText('🏆 Hana wins!')).toBeVisible();
      await shot(ana, 'standings');
      await shot(hana, 'standings-host');
    } finally {
      await admin.request.delete(`/api/admin/question-decks/${deckId}`);
    }
  });
}
