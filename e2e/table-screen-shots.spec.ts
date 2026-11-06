import { type Page, expect } from '@playwright/test';
import { TEST_ADMIN_PASSWORD, ownLoginLimit } from './credentials.ts';
import { test } from './fixtures.ts';
import { auditTv } from './tv-audit.ts';

// Opt-in visual check: SCREENSHOTS=1 pnpm exec playwright test e2e/table-screen-shots.spec.ts
// The table screen's own pages at 1920 × 1080 (pairing, in both of the screen's themes; the start
// tap) and the generic table screen of every game without its own, each from an admin playtest
// (which opens the table screen without a code). The browser asks for light mode throughout:
// the table screen runs dark unless switched. Every shot is measured (`tv-audit.ts`).
test.skip(!process.env.SCREENSHOTS, 'set SCREENSHOTS=1 to capture');

const DIR = process.env.SHOTS_DIR ?? 'test-results/table-screen-shots';
/** Games with a table screen of their own: their specs shoot them. */
const OWN_STAGE = new Set(['going-once', 'sketchy', 'defuse', 'cliffhanger']);

interface PlaytestGame {
  id: string;
  name: string;
  minPlayers: number;
}

async function startShow(page: Page) {
  await page.getByRole('button', { name: '▶ Start the show' }).click();
  await expect(page.locator('[data-poster]')).toBeVisible();
  await page.waitForTimeout(600);
}

test('the table screen poster: pairing, both themes, and every generic game', async ({
  browser,
}) => {
  test.setTimeout(900_000);
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    colorScheme: 'light',
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await ownLoginLimit(page);
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('link', { name: '🧪 Playtest' })).toBeVisible();

  // Pairing: dark out of the box, whatever the device asks for; then the screen's own Light.
  await page.goto('/stage');
  await expect(page.getByLabel('Pairing code')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await auditTv(page, 'pairing dark', `${DIR}/pairing-dark.png`);
  await page
    .getByRole('group', { name: 'This screen’s colours' })
    .getByRole('button', { name: 'Light' })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await auditTv(page, 'pairing light', `${DIR}/pairing-light.png`);

  const games = (await (
    await page.request.get('/api/admin/playtest/games')
  ).json()) as PlaytestGame[];
  const made: string[] = [];
  const open = async (game: PlaytestGame) => {
    const seats = Array.from({ length: game.minPlayers }, (_, i) => ({ name: `Seat ${i + 1}` }));
    for (let attempt = 0; ; attempt++) {
      const res = await page.request.post('/api/admin/playtests', {
        data: { gameId: game.id, seats },
      });
      // Ten playtests a minute: wait out the limit.
      if (res.status() === 429 && attempt < 3) {
        await page.waitForTimeout(61_000);
        continue;
      }
      expect(res.ok(), `${game.id}: ${await res.text()}`).toBe(true);
      const { roomId } = (await res.json()) as { roomId: string };
      made.push(roomId);
      return roomId;
    }
  };

  try {
    const generic = games.filter((g) => !OWN_STAGE.has(g.id));
    // One generic screen in the screen's light theme, then back to dark for the rest.
    const first = generic[0]!;
    await page.goto(`/stage/${await open(first)}`);
    await startShow(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await auditTv(page, `generic ${first.id} light`, `${DIR}/generic-${first.id}-light.png`);
    await page.goto('/stage');
    await expect(page.getByLabel('Pairing code')).toBeVisible();
    await page
      .getByRole('group', { name: 'This screen’s colours' })
      .getByRole('button', { name: 'Dark' })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    for (const [i, game] of generic.entries()) {
      const roomId = i === 0 ? made[0]! : await open(game);
      await page.goto(`/stage/${roomId}`);
      if (i === 0) {
        // The one tap that starts the show (and may play sound) before it is under way.
        await expect(page.getByRole('button', { name: '▶ Start the show' })).toBeVisible();
        await auditTv(page, 'start tap', `${DIR}/start.png`);
      }
      await startShow(page);
      await expect(page.getByTestId('generic-stage')).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await auditTv(page, `generic ${game.id}`, `${DIR}/generic-${game.id}.png`);
    }
  } finally {
    for (const roomId of made) await page.request.delete(`/api/admin/playtests/${roomId}`);
    await context.close();
  }
  expect(errors).toEqual([]);
});
