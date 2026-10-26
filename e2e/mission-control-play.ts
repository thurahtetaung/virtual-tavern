import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, openBackroom, unlock, visitor } from './tavern-brawl-play.ts';

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

/** The admin imports the made-up packs; returns how to delete them again. */
export async function importPacks(browser: Browser): Promise<() => Promise<unknown>> {
  const admin = await visitor(browser, 'Admin');
  await openBackroom(admin);
  const ids: string[] = [];
  for (const [kind, data] of [
    ['tasks', TASKS],
    ['voyage', VOYAGE],
  ] as const) {
    const res = await admin.request.post('/api/admin/content-packs', {
      data: { gameId: 'mission-control', kind, name: `E2E ${kind}`, data },
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
  return pages;
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
