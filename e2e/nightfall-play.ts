import { type Page, expect } from '@playwright/test';

/** What one player did and learned at night. */
export interface NightLog {
  role: string;
  acted: string[];
  results: string[];
}

/** The host builds the card list with the +/- buttons, from whatever is selected now. */
export async function setRoles(host: Page, want: Record<string, number>) {
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

/** Answers whatever the night asks, with the first legal choice. */
async function answer(p: Page) {
  // A step can end under any click, so none of them waits long.
  const quick = { timeout: 2000 };
  const prompt = p.getByTestId('prompt');
  const stage = (await prompt.getAttribute('data-stage', quick)) ?? '';
  const confirm = prompt.getByRole('button', { name: 'Confirm' });
  if (await prompt.getByRole('button', { name: 'Left →' }).count()) {
    await prompt.getByRole('button', { name: 'Left →' }).click(quick);
    return stage;
  }
  const players = prompt.getByRole('list', { name: 'Players' }).locator('button:enabled');
  const centre = prompt.getByRole('list', { name: 'Centre cards' }).locator('button:enabled');
  const pool = (await players.count()) > 0 ? players : centre;
  for (let i = 0; i < 3 && !(await confirm.isEnabled(quick)); i++) await pool.nth(i).click(quick);
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
      const log: NightLog = { role: roles[i]!, acted: [], results: [] };
      const deadline = Date.now() + 150_000;
      while (Date.now() < deadline) {
        if (await p.getByRole('button', { name: 'Ready to vote' }).count()) break;
        if (await p.getByTestId('prompt').count()) {
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
          const text = (await result.textContent({ timeout: 1000 }).catch(() => '')) ?? '';
          if (text && !log.results.includes(text)) log.results.push(text);
        }
        await p.waitForTimeout(150);
      }
      return log;
    }),
  );
}

/** Ready to vote, then everyone votes as `pick` says (by seat index); waits for the reveal. */
export async function vote(players: Page[], names: string[], pick: (i: number) => number) {
  for (const p of players) await p.getByRole('button', { name: 'Ready to vote' }).click();
  for (const p of players) await expect(p.getByText('🗳️ The vote')).toBeVisible();
  for (const [i, p] of players.entries()) {
    const button = p.getByRole('button', { name: `Vote for ${names[pick(i)]}` });
    await button.click();
    // The last vote ends the vote, so only the others can see theirs pressed.
    if (i < players.length - 1) await expect(button).toHaveAttribute('aria-pressed', 'true');
  }
  for (const p of players) await expect(p.getByTestId('teams')).toBeVisible({ timeout: 15_000 });
}
