import { expect, test } from '@playwright/test';
import { fullBrawl, pageErrors } from './tavern-brawl-play.ts';

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// Five or more: neighbours only, and the knocked out haunt the table as ghosts. The server starts
// these games on fewer hit points (playwright.config.ts), so each ends in a few rounds.
test('a full brawl: Dragon, Owl, Psychic, Slime, Eye', async ({ browser }) => {
  await fullBrawl(
    browser,
    ['Dragon', 'Owl', 'Psychic', 'Slime', 'Eye'],
    ['Hana', 'Ana', 'Ben', 'Cy', 'Dee'],
  );
});

test('a full brawl: Mimic, Eye, Slime, Druid, Ranger, Brute', async ({ browser }) => {
  await fullBrawl(
    browser,
    ['Mimic', 'Eye', 'Slime', 'Druid', 'Ranger', 'Brute'],
    ['Hana', 'Ana', 'Ben', 'Cy', 'Dee', 'Eli'],
  );
});
