import { expect } from '@playwright/test';
import { BOMBS, bombTitle, playBomb } from './defuse-3d-modules-play.ts';
import { test } from './fixtures.ts';
import { pageErrors } from './tavern-brawl-play.ts';

// Every module kind solved through the 3D view: the second and third bombs of BOMBS (the others are
// in defuse-3d-modules.spec.ts). See defuse-3d.spec.ts.

test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

for (const bomb of [BOMBS[1]!, BOMBS[2]!])
  test(bombTitle(bomb), async ({ browser }) => {
    test.setTimeout(480_000);
    await playBomb(browser, bomb);
  });
