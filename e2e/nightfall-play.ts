import { type Locator, type Page, expect } from '@playwright/test';

/**
 * Opens a section of the day. On a phone it's a tab; from `lg` up every section shows at once,
 * with what you learned behind its Show button (hidden again on the way back to the table).
 */
export async function dayTab(p: Page, name: 'Table' | 'Learned' | 'Roles') {
  if ((p.viewportSize()?.width ?? 0) < 1024) {
    await p.getByRole('tab', { name }).click();
    return;
  }
  if (name === 'Roles') return;
  const show = name === 'Learned';
  const toggle = p.getByRole('button', { name: `${show ? 'Show' : 'Hide'} what you learned` });
  if (await toggle.count()) await toggle.click();
  await expect(
    p.getByRole('button', { name: `${show ? 'Hide' : 'Show'} what you learned` }),
  ).toBeVisible();
}

/** What one player did and learned at night. */
export interface NightLog {
  role: string;
  acted: string[];
  results: string[];
  /** The full-screen "YOUR TURN" came up at least once. */
  woke: boolean;
  /** The idle screen showed its hint (keep the phone face up). */
  faceUp: boolean;
}

/** The host builds the card list with the +/- buttons, from whatever is selected now. */
export async function setRoles(host: Page, want: Record<string, number>) {
  // Sets with no card in yet start folded: open them all.
  const closed = host.locator('details:not([open]) > summary');
  for (let i = 0; i < 12 && (await closed.count()) > 0; i++) await closed.first().click();
  for (const tile of await host.locator('[data-testid^="role-"]').all()) {
    const role = (await tile.getAttribute('data-testid'))!.slice(5);
    const target = want[role] ?? 0;
    for (let i = 0; i < 4; i++) {
      const text = (await tile.locator('span.tabular-nums').textContent())?.trim() ?? '0';
      const now = Number(text.replace('×', '') || 0);
      if (now === target) break;
      const before = text;
      await tile.getByRole('button', { name: now < target ? /^One more/ : /^One less/ }).click();
      await expect(tile.locator('span.tabular-nums')).not.toHaveText(before);
    }
  }
}

/** Everyone looks at their card and presses Ready; returns each player's role. */
export async function getReady(players: Page[]): Promise<string[]> {
  return Promise.all(
    players.map(async (p) => {
      await p.getByRole('button', { name: 'Tap to see your card' }).click();
      const role = (await p.locator('[data-role]').first().getAttribute('data-role'))!;
      await p.getByRole('button', { name: 'Ready', exact: true }).click();
      return role;
    }),
  );
}

/** A left-or-right choice, named by the player on that side ("Pass left, towards Ben"). */
const LEFT = /^(Pass left|Tap .+ \(left\)|Give it to .+ \(left\))/;

/** Answers whatever the night asks, with the first legal choice. */
async function answer(p: Page) {
  // A step can end under any click, so none of them waits long.
  const quick = { timeout: 2000 };
  const prompt = p.getByTestId('prompt');
  const stage = (await prompt.getAttribute('data-stage', quick)) ?? '';
  const confirm = prompt.getByRole('button', { name: 'Confirm' });
  if (await prompt.getByRole('button', { name: LEFT }).count()) {
    await prompt.getByRole('button', { name: LEFT }).click(quick);
    return stage;
  }
  const players = prompt.getByRole('list', { name: 'Players' }).locator('button:enabled');
  const centre = prompt.getByRole('list', { name: 'Centre cards' }).locator('button:enabled');
  const pool = (await players.count()) > 0 ? players : centre;
  // Only unpicked ones: a button tapped again on a later pass (Confirm slow to light up on a
  // busy machine) would be unpicked.
  const unpicked = pool.and(p.locator('[aria-pressed="false"]'));
  for (let i = 0; i < 3 && !(await confirm.isEnabled(quick)); i++)
    await unpicked.first().click(quick);
  await confirm.click(quick);
  return stage;
}

/**
 * Each player acts whenever their screen lights up, until daybreak. Returns what each did and
 * the results their screen showed.
 */
export async function playNight(
  players: Page[],
  roles: string[],
  onActing?: (p: Page) => Promise<void>,
) {
  return Promise.all(
    players.map(async (p, i) => {
      const log: NightLog = { role: roles[i]!, acted: [], results: [], woke: false, faceUp: false };
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        if (await p.getByRole('button', { name: 'Ready to vote' }).count()) break;
        if (!log.faceUp)
          log.faceUp =
            (await p.getByTestId('idle-hint').filter({ hasText: 'face up' }).count()) > 0;
        if (await p.getByTestId('prompt').count()) {
          if (!log.woke) log.woke = (await p.getByTestId('your-turn').count()) > 0;
          if (onActing) await onActing(p);
          try {
            log.acted.push(await answer(p));
          } catch {
            // The step ended under the click: it's still a fair night.
          }
          continue;
        }
        const result = p.getByTestId('night-result');
        if (await result.count()) {
          if (!log.woke) log.woke = (await p.getByTestId('your-turn').count()) > 0;
          const text = (await result.textContent({ timeout: 1000 }).catch(() => '')) ?? '';
          if (text && !log.results.includes(text)) log.results.push(text);
        }
        await p.waitForTimeout(150);
      }
      merge(log.results, await learned(p));
      return log;
    }),
  );
}

/**
 * Everything the day's Learned tab lists. A night result shows only until its step ends, so a
 * busy machine can miss it on screen; the Learned list keeps every one.
 */
export async function learned(p: Page): Promise<string[]> {
  await dayTab(p, 'Learned');
  // The tab always opens with where you stand; an empty list isn't exposed as a list at all, so
  // it reads as nothing learned.
  await expect(p.getByRole('region', { name: 'Where you stand now' })).toBeVisible();
  const items = await p
    .getByRole('list', { name: 'What you learned tonight' })
    .getByRole('listitem')
    .allTextContents();
  await dayTab(p, 'Table');
  return items;
}

/** Adds `more` to `list`, skipping the ones it already has. */
export function merge(list: string[], more: string[]) {
  for (const text of more)
    if (!list.some((t) => t.includes(text) || text.includes(t))) list.push(text);
}

/** Ready to vote, then everyone votes as `pick` says (by seat index); waits for the reveal. */
export async function vote(players: Page[], names: string[], pick: (i: number) => number) {
  for (const p of players) {
    // Someone may have pressed it already.
    const ready = p.getByRole('button', { name: 'Ready to vote' });
    if (await ready.count()) await ready.click();
  }
  for (const p of players) await expect(p.getByText('🗳️ The vote')).toBeVisible();
  for (const [i, p] of players.entries()) {
    // Every role's buttons read "Vote for": a Bodyguard's protect is told only behind a peek.
    const button = p.getByRole('button', { name: `Vote for ${names[pick(i)]}`, exact: true });
    await button.click();
    // The last vote ends the vote, so only the others can see theirs pressed.
    if (i < players.length - 1) await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  for (const p of players) await expect(p.getByTestId('teams')).toBeVisible({ timeout: 15_000 });
}

// ---- The Vampire set ----

export const VAMPIRES = ['vampire', 'the-count'];
export const VILLAGE = ['seer', 'cupid', 'pickpocket', 'priest', 'villager'];

/** Each player uncovers their card and covers it again; returns the roles dealt. */
export async function peek(players: Page[]): Promise<string[]> {
  return Promise.all(
    players.map(async (p) => {
      await p.getByRole('button', { name: 'Tap to see your card' }).click();
      const role = (await p.locator('[data-role]').first().getAttribute('data-role'))!;
      await p.getByRole('button', { name: 'Cover it again' }).click();
      return role;
    }),
  );
}

/** What one player saw at night. */
export interface MarkedNight {
  dusk: string | null;
  lovers: string | null;
  results: string[];
}

/**
 * Plays the night with chosen moves: the vampires mark `marked`, Cupid links the werewolf and
 * himself, the Priest and the Pickpocket pass, everyone else takes the first choice. Records
 * the Mark each player saw at dusk, the lovers' screen and every result shown. `onPoll` runs on
 * each look at a player's screen (for screenshots).
 */
export async function playMarkedNight(
  players: Page[],
  names: string[],
  roles: string[],
  marked: number,
  onPoll?: (p: Page, i: number) => Promise<void>,
): Promise<MarkedNight[]> {
  const werewolf = roles.indexOf('werewolf');
  const firstVampire = roles.findIndex((r) => VAMPIRES.includes(r));
  return Promise.all(
    players.map(async (p, i) => {
      const log: MarkedNight = { dusk: null, lovers: null, results: [] };
      const quick = { timeout: 2000 };
      // The test hold keeps a step open while a choice is still to be made, so a click may take
      // its time: a starved browser can need seconds just to see a button hold still.
      const patient = { timeout: 5000 };
      const deadline = Date.now() + 200_000;
      // Player buttons toggle: one tapped again on the next pass (when Confirm was slow to light
      // up) would be unpicked, and a busy machine could go round like that until the step ends.
      const pick = async (button: Locator) => {
        if ((await button.getAttribute('aria-pressed', patient)) !== 'true')
          await button.click(patient);
      };
      const confirm = async (prompt: Locator) => {
        const button = prompt.getByRole('button', { name: 'Confirm' });
        await expect(button).toBeEnabled(patient);
        await button.click(patient);
      };
      const tap = async (prompt: Locator, who: number[]) => {
        const list = prompt.getByRole('list', { name: 'Players' });
        for (const w of who)
          await pick(list.getByRole('button', { name: w === i ? 'You' : names[w]!, exact: true }));
        await confirm(prompt);
      };
      while (Date.now() < deadline) {
        if (await p.getByRole('button', { name: 'Ready to vote' }).count()) break;
        if (onPoll) await onPoll(p, i);
        const dusk = p.getByTestId('dusk');
        if (!log.dusk && (await dusk.count()))
          log.dusk = await dusk
            .locator('[data-mark]')
            .first()
            .getAttribute('data-mark', quick)
            .catch(() => null);
        if (!log.lovers && (await p.getByTestId('lovers').count()))
          log.lovers = await p
            .getByTestId('night-result')
            .textContent(quick)
            .catch(() => null);
        const prompt = p.getByTestId('prompt');
        if (await prompt.count()) {
          const stage = (await prompt.getAttribute('data-stage', quick).catch(() => '')) ?? '';
          try {
            if (stage === 'give-vampire') {
              if (i === firstVampire) await tap(prompt, [marked]);
              else await p.waitForTimeout(300);
            } else if (stage === 'give-love') await tap(prompt, [werewolf, i]);
            else if (['give-clarity', 'pickpocket', 'lone-wolf'].includes(stage))
              await prompt.getByRole('button', { name: 'Skip' }).click(patient);
            else {
              const first = prompt
                .getByRole('list', { name: 'Players' })
                .locator('button:enabled')
                .first();
              if (await first.count()) await pick(first);
              if (await prompt.getByRole('button', { name: 'Confirm' }).count())
                await confirm(prompt);
              else await prompt.getByRole('button', { name: LEFT }).click(patient);
            }
          } catch {
            // The step ended under the click: it's still a fair night.
          }
          continue;
        }
        const result = p.getByTestId('night-result');
        if (await result.count()) {
          const text = (await result.textContent(quick).catch(() => '')) ?? '';
          if (text && !log.results.includes(text)) log.results.push(text);
        }
        await p.waitForTimeout(150);
      }
      merge(log.results, await learned(p));
      return log;
    }),
  );
}
