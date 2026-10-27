import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, openBackroom, unlock, visitor } from './tavern-brawl-play.ts';
import { openSettings } from './lobby-settings.ts';

// Shared steps for Mission Control's specs: made-up task and voyage packs (the real ones are
// private) and a table of phones. The server runs with the test deal (`MISSION_CONTROL_TEST_DEAL`
// in playwright.config.ts): the first seat holds every pink card and the trumps (so is captain),
// the second the blues and low greens, the third the rest; the tasks are 1 and 2 below.

export const TASKS = [
  {
    id: 1,
    check: { kind: 'win-cards', cards: ['p3'] },
    difficulty: { 3: 1, 4: 1, 5: 1 },
    text: 'Take the pink 3',
  },
  {
    id: 2,
    check: { kind: 'tricks', win: [1] },
    difficulty: { 3: 1, 4: 1, 5: 1 },
    text: 'Take trick one',
  },
];
export const VOYAGE = {
  key: 'e2e-voyage',
  name: 'Test voyage',
  missions: [
    {
      n: 1,
      title: 'Shakedown',
      difficulty: 2,
      selection: 'free',
      rule: 'Share the tasks as you like.',
      story: 'Day one. The water is calm.',
    },
    { n: 2, title: 'Second dive', difficulty: 2 },
  ],
  epilogue: { difficulty: 5, title: 'Beyond' },
};

/** A made-up one-card campaign: the test deal makes its tasks the pink 3 (token 1), pink 2 (2). */
export const CARD_VOYAGE = {
  key: 'voyage-1',
  name: 'Card voyage',
  taskSet: 'cards',
  missions: [
    { n: 1, title: 'In order', cards: 2, tokens: ['1', '2'], selection: 'free' },
    {
      n: 2,
      title: 'Feeling well?',
      pick: { role: 'sick', question: 'How do you feel?', replies: ['Good', 'Bad'], self: true },
    },
    {
      n: 3,
      title: 'Level pegging',
      conditions: [
        { check: { kind: 'trick-balance', gap: 2 }, text: 'Nobody gets two tricks ahead' },
      ],
    },
  ],
};

/** The admin imports the made-up packs; returns how to delete them again. */
export async function importPacks(browser: Browser): Promise<() => Promise<unknown>> {
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const ids: string[] = [];
  for (const [kind, data] of [
    ['tasks', TASKS],
    ['voyage', VOYAGE],
    ['voyage', CARD_VOYAGE],
  ] as const) {
    const res = await admin.request.post('/api/admin/content-packs', {
      data: {
        gameId: 'mission-control',
        kind,
        name: data === CARD_VOYAGE ? 'E2E voyage cards' : `E2E ${kind}`,
        data,
      },
    });
    expect(res.status(), await res.text()).toBe(201);
    ids.push(((await res.json()) as { id: string }).id);
  }
  return () => Promise.all(ids.map((id) => admin.request.delete(`/api/admin/content-packs/${id}`)));
}

/** The host opens a room; the others join one at a time (so seat order is known). */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Mission Control room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const name of rest) {
    const p = await visitor(browser, name, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
    await expect(host.getByText(`The crew (${pages.length}/5)`)).toBeVisible();
  }
  // On a phone the host's settings start folded.
  await openSettings(host);
  return pages;
}

/** `MISSION_CONTROL_ART=<folder with manifest.json and the art>` previews the real art in shots. */
const ART = process.env.MISSION_CONTROL_ART;
const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

export async function localArt(page: Page) {
  if (!ART) return;
  await page.route('**/api/backroom/manifest/mission-control', async (route) => {
    const file = await readFile(join(ART, 'manifest.json'), 'utf8').catch(() =>
      readFile(join(ART, 'manifest-draft.json'), 'utf8'),
    );
    await route.fulfill({ json: JSON.parse(file) as unknown });
  });
  await page.route('**/api/backroom/assets/mission-control/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace(
      /^\/api\/backroom\/assets\/mission-control\//,
      '',
    );
    try {
      await route.fulfill({
        body: await readFile(join(ART, path)),
        contentType: TYPES[path.split('.').pop() ?? ''] ?? 'application/octet-stream',
      });
    } catch {
      await route.fulfill({ status: 404 });
    }
  });
}

export const PHONE: Look = { viewport: { width: 390, height: 844 } };

/** The host starts the next mission and everyone reads the briefing. */
export async function brief(pages: Page[], mission = 'Mission 1') {
  await pages[0]!.getByTestId('mc-start').click();
  for (const p of pages) {
    await expect(p.getByTestId('mc-briefing')).toContainText(mission);
    await p.getByTestId('mc-ready').click();
    await expect(p.getByTestId('mc-briefing').or(p.getByTestId('mc-draft'))).toBeVisible();
  }
  for (const p of pages) await expect(p.getByTestId('mc-draft')).toBeVisible();
}

/** Free selection: `page` takes the task with this text and waits until it's theirs. */
export async function claim(page: Page, text: string) {
  const chip = page.getByTestId('mc-task').filter({ hasText: text });
  await chip.getByTestId('mc-claim').click();
  await expect(chip).toContainText('Yours');
}

/** Free selection on the one-card campaign: `page` takes the task for this card ("pink 3"). */
export async function claimCard(page: Page, card: string) {
  const chip = page.getByTestId('mc-task').filter({ has: page.getByRole('img', { name: card }) });
  await chip.getByTestId('mc-claim').click();
  await expect(chip).toContainText('Yours');
}

/** Everyone presses Ready on the shared-out tasks, then Dive. */
export async function dive(pages: Page[]) {
  for (const p of pages) {
    await p.getByTestId('mc-draft-ready').click();
    await expect(p.getByTestId('mc-draft-ready').or(p.getByTestId('mc-distress'))).toBeVisible();
  }
  for (const p of pages) {
    await p.getByTestId('mc-dive').click();
    await expect(p.getByTestId('mc-distress').or(p.getByTestId('mc-trick'))).toBeVisible();
  }
  for (const p of pages) await expect(p.getByTestId('mc-trick')).toBeVisible();
}

/** Plays a card (tap to pick, tap again to play) and waits until it is on the table. */
export async function play(page: Page, card: string) {
  const c = page.getByTestId(`mc-card-${card}`);
  await c.click();
  await expect(c).toHaveAttribute('aria-pressed', 'true');
  await c.click();
  await expect(page.getByTestId(`mc-card-${card}`)).toHaveCount(0);
}
