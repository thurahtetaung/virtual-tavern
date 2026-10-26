import { type Browser, expect } from '@playwright/test';
import { test } from './fixtures.ts';

// The rules guide: the rules page and the in-room drawer, on a phone.

const pageErrors: string[] = [];
test.afterEach(() => {
  expect(pageErrors).toEqual([]);
  pageErrors.length = 0;
});

let nextIp = 1;
async function phone(browser: Browser, name = 'Hana') {
  const worker = Number(process.env.TEST_WORKER_INDEX ?? 0) % 200;
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    extraHTTPHeaders: { 'cf-connecting-ip': `10.52.${worker}.${(nextIp++ % 250) + 1}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript((n) => localStorage.setItem('vt.playerName', n), name);
  return page;
}

test('a rules page teaches the game in steps, then holds the rules and a cheat sheet', async ({
  browser,
}) => {
  const page = await phone(browser);
  await page.goto('/rules/echo');
  const tabs = page.getByRole('tablist', { name: 'Guide' });
  await expect(tabs.getByRole('tab', { name: 'Learn' })).toHaveAttribute('aria-selected', 'true');

  // The stepper: one step at a time, to "That's the whole game".
  const stepper = page.getByRole('region', { name: 'How a game goes' });
  await expect(
    stepper.getByRole('heading', { name: '1. One guesser, a hidden word' }),
  ).toBeVisible();
  await expect(stepper.getByRole('button', { name: '← Back' })).toBeDisabled();
  // One dot per step, as many as the counter says.
  await expect(stepper.getByText('1 of 6')).toBeVisible();
  await expect(stepper.getByTestId('guide-dots').locator('i')).toHaveCount(6);
  for (let i = 2; i <= 6; i++) {
    await stepper.getByRole('button', { name: 'Next →' }).click();
    await expect(stepper.getByRole('heading', { name: new RegExp(`^${i}\\. `) })).toBeVisible();
  }
  await stepper.getByRole('button', { name: '← Back' }).click();
  await expect(stepper.getByRole('heading', { name: /^5\. / })).toBeVisible();
  await stepper.getByRole('button', { name: 'Next →' }).click();
  await stepper.getByRole('button', { name: 'Next →' }).click();
  await expect(stepper.getByRole('heading', { name: 'That’s the whole game' })).toBeVisible();
  await expect(stepper.getByRole('button', { name: 'Create an Echo room' })).toBeVisible();

  // Rules: the basics first, the first one open; edge cases last, folded.
  await tabs.getByRole('tab', { name: 'Rules' }).click();
  const basics = page.getByRole('region', { name: 'Basics' });
  await expect(basics.getByText('A card, step by step')).toBeVisible();
  await expect(basics.locator('details').first()).toHaveAttribute('open', '');
  const edge = page.getByRole('region', { name: 'Options & edge cases' });
  await expect(edge.getByText('Coming and going')).toBeVisible();
  await expect(edge.locator('details').first()).not.toHaveAttribute('open', '');

  // The cheat sheet: tables, words and tips.
  await tabs.getByRole('tab', { name: 'Cheat sheet' }).click();
  await expect(page.getByRole('region', { name: 'How did you do? (13 cards)' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Tips' })).toBeVisible();
});

test('the roles open as cards, and a line-up picker marks what is in the game', async ({
  browser,
}) => {
  const page = await phone(browser);
  await page.goto('/rules/round-table');
  const tabs = page.getByRole('tablist', { name: 'Guide' });
  await tabs.getByRole('tab', { name: 'Roles' }).click();
  await page.getByRole('button', { name: 'Merlin', exact: true }).click();
  const sheet = page.getByTestId('guide-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Win three quests');
  await page.getByRole('dialog', { name: 'Merlin' }).getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toHaveCount(0);

  // Filters: Evil only.
  await page.getByRole('button', { name: 'Evil', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Merlin', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Morgana', exact: true })).toBeVisible();

  // A line-up: "In this game" shows only its cards, and Rules greys what it doesn't use.
  await page.getByLabel('Show the rules for').selectOption({ label: 'First game' });
  await page.getByRole('button', { name: 'In this game' }).click();
  await expect(page.getByRole('button', { name: 'Merlin', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Morgana', exact: true })).toHaveCount(0);
  await tabs.getByRole('tab', { name: 'Rules' }).click();
  const lady = page.locator('details').filter({ hasText: 'Lady of the Lake (option)' });
  await expect(lady.getByText('Not in this game')).toBeVisible();
  await page.getByLabel('Show the rules for').selectOption({ label: 'Everything' });
  await expect(lady.getByText('Not in this game')).toHaveCount(0);
});

test('a first-timer sees the game in steps in the lobby, once; the drawer knows the room', async ({
  browser,
}) => {
  const page = await phone(browser);
  // New to every game (the suite marks the intros seen).
  await page.goto('/');
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage))
      if (k.startsWith('vt.guide.intro.')) localStorage.removeItem(k);
  });
  await page.goto('/rules/round-table');
  await page.getByRole('button', { name: 'Create a Round Table room' }).last().click();
  await expect(page).toHaveURL(/\/r\//);

  const intro = page.getByRole('region', { name: 'New to Round Table?' });
  await expect(intro.getByRole('heading', { name: '1. Read your secret role' })).toBeVisible();
  for (let i = 0; i < 5; i++) await intro.getByRole('button', { name: 'Next →' }).click();
  await intro.getByRole('button', { name: 'Got it, let’s play' }).click();
  await expect(intro).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('Players (1/')).toBeVisible();
  await expect(page.getByRole('region', { name: 'New to Round Table?' })).toHaveCount(0);

  // The drawer opens on Learn, says what this room plays, and filters the roles to it.
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'How to play Round Table' });
  await expect(drawer.getByRole('tab', { name: 'Learn' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByText(/In your room:/)).toBeVisible();
  await drawer.getByRole('tab', { name: 'Roles' }).click();
  await expect(drawer.getByRole('button', { name: 'In this game' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(drawer.getByRole('button', { name: 'Merlin', exact: true })).toBeVisible();
  await drawer.getByRole('button', { name: 'Merlin', exact: true }).click();
  await expect(page.getByTestId('guide-sheet')).toContainText('Win three quests');
  await page.getByRole('dialog', { name: 'Merlin' }).getByRole('button', { name: 'Close' }).click();
  // Closing the card leaves the drawer open.
  await expect(drawer.getByRole('tab', { name: 'Roles' })).toBeVisible();
  // Every opening starts on Learn again.
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
  await page.getByRole('button', { name: 'Rules', exact: true }).click();
  await expect(drawer.getByRole('tab', { name: 'Learn' })).toHaveAttribute('aria-selected', 'true');
});
