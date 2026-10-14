import { type Browser, type Page, expect } from '@playwright/test';
import { unlock, visitor } from './inquest-play.ts';

// Helpers to play Hydra (or one of its editions) through the UI. Without asset storage in tests
// Hydra uses its neutral placeholder names (Loyalist, Conspirator, the Usurper, Yes and No); an
// edition's spec serves a made-up manifest with its own words, and passes them as `Words`.

/** The words an edition's table shows, as the helpers look for them. */
export interface Words {
  /** The lobby's "Create a … room" button. */
  create: string | RegExp;
  /** The team words and the cards' colour words (`blue`, `red` index both). */
  team: { blue: string; red: string };
  blue: string;
  red: string;
  leader: string;
  yes: string;
  no: string;
  president: string;
  chancellor: string;
  candidate: string;
  policy: string;
  policies: string;
}

export const HYDRA_WORDS: Words = {
  create: 'Create a Hydra room',
  team: { blue: 'Loyalist', red: 'Conspirator' },
  blue: 'Loyalist',
  red: 'Conspirator',
  leader: 'Usurper',
  yes: 'Yes',
  no: 'No',
  president: 'President',
  chancellor: 'Chancellor',
  candidate: 'Presidential Candidate',
  policy: 'policy',
  policies: 'policies',
};

/** Hydra's card and ballot words (the placeholders). */
export const NAMES = { blue: 'Loyalist', red: 'Conspirator', yes: 'Yes', no: 'No' } as const;

export interface Player {
  name: string;
  page: Page;
  /** The words this table shows (Hydra's by default). */
  w: Words;
  /** Read from the player's own role card. */
  role?: 'blue' | 'red' | 'leader';
  dead?: boolean;
}

/** A browser for Hydra: the big moments are switched off unless `moments` (they cover the table). */
export async function hydraVisitor(
  browser: Browser,
  name: string,
  errors: string[],
  opts: Parameters<typeof visitor>[3] & {
    moments?: boolean;
    /** Serve this as `/api/backroom/manifest/<gameId>` (an edition's made-up names). */
    manifest?: { gameId: string; body: unknown };
    /** Anything else to set up on the page before it loads (more routes, say). */
    setup?: (page: Page) => Promise<void>;
  } = {},
) {
  const { moments = false, manifest, setup, ...rest } = opts;
  const page = await visitor(browser, name, errors, rest);
  if (!moments) await page.addInitScript(() => localStorage.setItem('vt.hydra.moments', 'false'));
  if (manifest)
    await page
      .context()
      .route(`**/api/backroom/manifest/${manifest.gameId}`, (route) =>
        route.fulfill({ json: manifest.body }),
      );
  await setup?.(page);
  return page;
}

/** The first name creates a Hydra room; the rest join it. */
export async function hydraTable(
  browser: Browser,
  names: string[],
  errors: string[],
  opts: Parameters<typeof hydraVisitor>[3] = {},
  w: Words = HYDRA_WORDS,
): Promise<Player[]> {
  const host = await hydraVisitor(browser, names[0]!, errors, opts);
  await unlock(host);
  await host.getByRole('button', { name: w.create }).click();
  await expect(host).toHaveURL(/\/r\//);
  const path = new URL(host.url()).pathname;
  const rest = await Promise.all(
    names.slice(1).map(async (n) => {
      const p = await hydraVisitor(browser, n, errors, opts);
      await unlock(p, `/backroom?next=${encodeURIComponent(path)}`);
      await expect(p).toHaveURL(host.url());
      return p;
    }),
  );
  const players: Player[] = [host, ...rest].map((page, i) => ({ name: names[i]!, page, w }));
  await expect(host.getByText(`Players (${names.length}/10)`)).toBeVisible();
  // Seat order is join order, which the parallel joins scramble: read it from the lobby.
  const seated = await host.getByTestId('seat-order').getByRole('listitem').allTextContents();
  const order = (p: Player) => seated.findIndex((t) => t.includes(p.name));
  return players.sort((a, b) => order(a) - order(b));
}

/** Everyone reads their role (recording it) and taps Ready. */
export async function readRoles(players: Player[]) {
  for (const p of players) {
    const card = p.page.getByRole('region', { name: 'Your role card' });
    // Face down, nothing under the card gives the side away.
    await expect(p.page.getByTestId('role-details-hidden')).toBeVisible();
    await expect(p.page.getByTestId('role-details')).toHaveCount(0);
    await card.getByRole('button', { name: '👁️ Show my role' }).click();
    await expect(p.page.getByTestId('role-details')).toBeVisible();
    const text = (await p.page.getByTestId('role-name').first().textContent()) ?? '';
    p.role = text.includes(p.w.leader) ? 'leader' : text.includes(p.w.team.red) ? 'red' : 'blue';
    await card.getByRole('button', { name: '🙈 Hide my role' }).click();
    await expect(p.page.getByTestId('role-details')).toHaveCount(0);
    await p.page.getByRole('button', { name: /I’ve read my role: Ready/ }).click();
  }
  for (const p of players)
    await expect(
      p.page
        .getByRole('status')
        .filter({ hasText: new RegExp(`${p.w.candidate}|is choosing a ${p.w.chancellor}`) })
        .first(),
    ).toBeVisible();
}

/** The player whose page shows `text` (polling until one does). */
export async function whoShows(players: Player[], text: RegExp | string): Promise<Player> {
  let found: Player | undefined;
  await expect
    .poll(
      async () => {
        for (const p of players) {
          if ((await p.page.getByText(text).count()) > 0) {
            found = p;
            return true;
          }
        }
        return false;
      },
      { timeout: 20_000 },
    )
    .toBe(true);
  return found!;
}

export const president = (players: Player[]) =>
  whoShows(
    players,
    `You’re the ${players[0]!.w.candidate}: nominate a ${players[0]!.w.chancellor}.`,
  );

/** The President nominates `chancellor` (by name). */
export async function nominate(pres: Player, chancellor: string) {
  await pres.page
    .getByRole('button', { name: `Nominate ${chancellor} as ${pres.w.chancellor}` })
    .click();
  await pres.page
    .getByTestId('dock')
    .getByRole('button', { name: `Nominate ${chancellor}` })
    .click();
}

/** Everyone in `players` (the living) votes (`no` lists who votes No). */
export async function voteAll(players: Player[], no: string[] = []) {
  for (const p of players) {
    const ballot = no.includes(p.name) ? p.w.no : p.w.yes;
    const button = p.page.getByRole('button', { name: `Vote ${ballot}` });
    await button.click();
    // Counted (or it was the last vote, which resolves the election at once).
    await expect(async () => {
      if ((await button.count()) === 0) return;
      const pressed = await button
        .getAttribute('aria-pressed', { timeout: 1000 })
        .catch(() => null);
      if (pressed === 'true' || (await button.count()) === 0) return;
      await button.click({ timeout: 2000 });
      throw new Error('not counted yet');
    }).toPass({ timeout: 15_000 });
  }
}

/** The President discards and the Chancellor enacts the first card of `color` (or the first). */
export async function legislate(players: Player[], color: 'blue' | 'red' = 'red') {
  const w = players[0]!.w;
  const pres = await whoShows(
    players,
    `You’re the ${w.president}: discard one of your three ${w.policies}.`,
  );
  const sheet = pres.page.getByRole('dialog', { name: `You’re the ${w.president}` });
  await sheet.getByRole('button', { name: 'Show cards' }).click();
  const other = color === 'red' ? w.blue : w.red;
  const drop = sheet.getByRole('button', { name: new RegExp(`^Discard: ${other}`) });
  await ((await drop.count()) > 0 ? drop : sheet.getByRole('button', { name: /^Discard: / }))
    .first()
    .click();
  await sheet.getByRole('button', { name: /^Discard this/ }).click();
  const chan = await whoShows(players, `You’re the ${w.chancellor}: enact one ${w.policy}`);
  const two = chan.page.getByRole('dialog', { name: `You’re the ${w.chancellor}` });
  await expect(two.getByText(/Shuffled: the order says nothing/)).toBeVisible();
  await two.getByRole('button', { name: 'Show cards' }).click();
  const want = two.getByRole('button', { name: new RegExp(`^Enact: ${w[color]}`) });
  await ((await want.count()) > 0 ? want : two.getByRole('button', { name: /^Enact: / }))
    .first()
    .click();
  await two.getByRole('button', { name: /^Enact this/ }).click();
  await expect(two).toBeHidden();
  return { pres, chan };
}

/** `p` makes the claim their sheet asks for: blue count, peek cards or a colour. */
export async function claim(
  p: Player,
  what: {
    blues?: number;
    /** President: the colour they say they discarded (red unless they claim three blue). */
    discarded?: 'blue' | 'red';
    cards?: ('blue' | 'red')[];
    team?: 'blue' | 'red';
  } = {},
) {
  const form = p.page.getByTestId('claim-form');
  await expect(form).toBeVisible({ timeout: 15_000 });
  if (what.cards) {
    for (const [i, c] of what.cards.entries())
      await form.getByRole('button', { name: `Card ${i + 1}: ${p.w[c]}` }).click();
  } else if (what.team) {
    await form.getByRole('button', { name: `Claim ${p.w.team[what.team]}` }).click();
  } else {
    const blues = what.blues ?? 0;
    const n = (await form.getByText('Say the three cards you drew').count()) > 0 ? 3 : 2;
    const drew = `${n - blues} ${p.w.red}, ${blues} ${p.w.blue}`;
    const discarded = what.discarded ?? (blues === 3 ? 'blue' : 'red');
    await form
      .getByRole('button', {
        name: n === 3 ? `${drew}, discarded ${p.w[discarded]}` : drew,
        exact: true,
      })
      .click();
  }
  await form.getByRole('button', { name: 'Make this claim' }).click();
  await form.getByRole('button', { name: 'Confirm claim' }).click();
  await expect(form).toBeHidden();
}

/** The government's claims after a session: the President's three, then the Chancellor's two. */
export async function claimSession(gov: { pres: Player; chan: Player }) {
  await claim(gov.pres, { blues: 0 });
  await claim(gov.chan, { blues: 0 });
}

/** The first alive seat (in table order) the President may nominate, skipping `avoid`. */
export async function eligible(pres: Player, players: Player[], avoid: (p: Player) => boolean) {
  for (const p of players) {
    if (p === pres || avoid(p)) continue;
    const seat = pres.page.getByRole('button', {
      name: `Nominate ${p.name} as ${pres.w.chancellor}`,
    });
    if ((await seat.count()) > 0) return p;
  }
  throw new Error('nobody to nominate');
}
