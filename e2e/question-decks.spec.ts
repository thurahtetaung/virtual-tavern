import { readFileSync } from 'node:fs';
import { type Browser, type Download, expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { TEST_ADMIN_PASSWORD } from './credentials.ts';

const pageErrors: string[] = [];
test.afterEach(() => {
  const errors = pageErrors.splice(0);
  expect(errors, 'uncaught errors in the browser').toEqual([]);
});

// Admin sign-in is rate-limited per address, so each sign-in comes from its own address.
let nextIp = 1;
async function signedInAdmin(browser: Browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    extraHTTPHeaders: { 'cf-connecting-ip': `10.4.0.${nextIp++}` },
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.goto('/tavern-keeper');
  await page.getByLabel('Admin password').fill(TEST_ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Question decks' })).toBeVisible();
  return page;
}

const downloaded = async (download: Download) => readFileSync(await download.path());

// A tiny made-up deck: real decks are private and never committed.
const SECRET = 'glimmerwick';
const DECK = {
  name: 'E2E Oddities',
  description: 'Made up for tests.',
  questions: [
    { prompt: 'The pretend town of Testby is famous for ___.', answer: SECRET },
    { prompt: 'Which imaginary bird hums at night?', answer: 'moonwren', adult: true },
  ],
};

test('admins list, switch, download and delete question decks', async ({ browser }) => {
  const admin = await signedInAdmin(browser);
  await expect(admin.getByText('No decks yet.')).toBeVisible();

  // Decks arrive through the admin API (the import script's route), never through the page.
  const created = await admin.request.post('/api/admin/question-decks', { data: DECK });
  expect(created.status()).toBe(201);
  await admin.reload();

  const section = admin.getByRole('region', { name: 'Question decks' });
  const row = section.getByRole('listitem').filter({ hasText: 'E2E Oddities' });
  await expect(row.getByText('2 questions')).toBeVisible();
  await expect(row.getByText('Adult', { exact: true })).toBeVisible();
  await expect(row.getByText('Made up for tests.')).toBeVisible();
  // Phone-first: the row fits the viewport without sideways scrolling.
  expect(
    await admin.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  // Deck names are protected: nothing public mentions them, and the back-room deck list
  // answers 404 to a browser that hasn't unlocked the back room.
  const player = await browser.newContext();
  for (const url of ['/api/games', '/api/word-lists', '/api/backroom/question-decks/hoodwink']) {
    const res = await player.request.get(url);
    expect(await res.text(), url).not.toContain('E2E Oddities');
  }
  expect((await player.request.get('/api/backroom/question-decks/hoodwink')).status()).toBe(404);
  await player.close();

  const enabled = row.getByRole('switch', { name: 'Enabled' });
  const patched = () => admin.waitForResponse((r) => r.request().method() === 'PATCH' && r.ok());
  await expect(enabled).toHaveAttribute('aria-checked', 'true');
  await Promise.all([patched(), enabled.click()]);
  await expect(enabled).toHaveAttribute('aria-checked', 'false');
  await expect(row.getByText('Disabled', { exact: true })).toBeVisible();
  await admin.reload();
  await expect(enabled).toHaveAttribute('aria-checked', 'false');

  const [json] = await Promise.all([
    admin.waitForEvent('download'),
    row.getByRole('button', { name: 'Download E2E Oddities as .json' }).click(),
  ]);
  expect(json.suggestedFilename()).toBe('e2e-oddities.json');
  const file = JSON.parse((await downloaded(json)).toString('utf8')) as {
    name: string;
    questions: { answer: string; adult: boolean }[];
  };
  expect(file.name).toBe('E2E Oddities');
  expect(file.questions.map((q) => [q.answer, q.adult])).toEqual([
    [SECRET, false],
    ['moonwren', true],
  ]);

  const [zip] = await Promise.all([
    admin.waitForEvent('download'),
    section.getByRole('button', { name: 'Download all decks (.zip)' }).click(),
  ]);
  expect(zip.suggestedFilename()).toMatch(/^virtual-tavern-question-decks-\d{4}-\d{2}-\d{2}\.zip$/);
  const files = unzipSync(new Uint8Array(await downloaded(zip)));
  expect(JSON.parse(strFromU8(files['manifest.json']!))).toEqual({
    decks: {
      'e2e-oddities': {
        name: 'E2E Oddities',
        description: 'Made up for tests.',
        games: ['hoodwink'],
        enabled: false,
      },
    },
  });
  expect(JSON.parse(strFromU8(files['e2e-oddities.json']!))).toMatchObject({
    questions: [{ answer: SECRET }, { answer: 'moonwren' }],
  });

  // Deleting asks first; dismissing keeps the deck.
  admin.once('dialog', (d) => void d.dismiss());
  await row.getByRole('button', { name: 'Delete E2E Oddities' }).click();
  await expect(row).toBeVisible();
  admin.once('dialog', (d) => void d.accept());
  await row.getByRole('button', { name: 'Delete E2E Oddities' }).click();
  await expect(row).toBeHidden();
  await expect(section.getByText('No decks yet.')).toBeVisible();
});
