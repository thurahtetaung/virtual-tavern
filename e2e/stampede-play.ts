import { type Browser, type Page, expect } from '@playwright/test';
import { type Look, unlock, visitor } from './tavern-brawl-play.ts';
import { openSettings } from './lobby-settings.ts';

// Shared steps for Stampede's specs: a made-up open-question deck, a room, answering and the
// reveal. The questions are invented; real decks are private and never committed.

export const DECK = {
  name: 'E2E pretend questions',
  description: 'Invented open questions for the end-to-end test.',
  games: ['stampede'],
  questions: Array.from({ length: 12 }, (_, i) => ({
    prompt: `What would you take to the invented island of Plimbo ${i + 1}?`,
  })),
};

/** Imports the deck through the admin API (the import script's route); returns its id. */
export async function importDeck(admin: Page): Promise<string> {
  const res = await admin.request.post('/api/admin/question-decks', { data: DECK });
  expect(res.status(), await res.text()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** The host opens a Stampede room; everyone else follows the link in, one at a time. */
export async function table(browser: Browser, names: string[], look: Look = {}) {
  const [hostName, ...rest] = names;
  const host = await visitor(browser, hostName!, look);
  await unlock(host);
  await host.getByRole('button', { name: 'Create a Stampede room' }).click();
  await expect(host).toHaveURL(/\/r\//);
  const url = host.url();
  const pages = [host];
  for (const n of rest) {
    const p = await visitor(browser, n, look);
    await unlock(p, `/backroom?next=${encodeURIComponent(new URL(url).pathname)}`);
    await expect(p).toHaveURL(url);
    pages.push(p);
  }
  await expect(host.getByText(`Players (${names.length}/20)`)).toBeVisible();
  // On a phone the host's settings start folded.
  await openSettings(host);
  return pages;
}

export const YOUR_TURN = /^● Your turn/;

/** Writes and locks in an answer. */
export async function answer(p: Page, text: string) {
  await expect(p.getByTestId('answer-input')).toBeVisible();
  await p.getByTestId('answer-input').fill(text);
  await p.getByTestId('answer-input').press('Enter');
  // Locked in, or (the last answer) the round went straight to the reveal.
  await expect(
    p
      .getByRole('button', { name: `✓ Locked in: ${text}` })
      .or(p.getByTestId('reveal-board'))
      .or(p.getByRole('region', { name: 'Final standings' }))
      .first(),
  ).toBeVisible();
}

/** Everyone answers, in order (the last one ends the writing). */
export async function answerAll(pages: Page[], answers: string[]) {
  for (const [i, p] of pages.entries()) await answer(p, answers[i]!);
}

/** Everyone sees the reveal (it comes as soon as the last answer is in). */
export async function revealed(pages: Page[]) {
  for (const p of pages) await expect(p.getByTestId('reveal-board')).toBeVisible();
}

/** The host asks the next question. */
export async function nextQuestion(host: Page, pages: Page[]) {
  await host.getByTestId('next').click();
  for (const p of pages) await expect(p.getByTestId('answer-input')).toBeVisible();
}
