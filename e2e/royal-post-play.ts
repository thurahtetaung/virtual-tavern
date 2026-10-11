import { type Locator, type Page, expect } from '@playwright/test';

// Shared by the Royal Post spec and its screenshots: plays turns through the UI like a person
// would, steering towards the cards a test wants to see played.

export type Edition = 'classic' | '2019';

// With no asset storage in tests, cards show their role words: "Guard (1)".
export const RANKS: Record<Edition, Record<string, number>> = {
  classic: {
    Guard: 1,
    Priest: 2,
    Baron: 3,
    Handmaid: 4,
    Prince: 5,
    King: 6,
    Countess: 7,
    Princess: 8,
  },
  '2019': {
    Spy: 0,
    Guard: 1,
    Priest: 2,
    Baron: 3,
    Handmaid: 4,
    Prince: 5,
    Chancellor: 6,
    King: 7,
    Countess: 8,
    Princess: 9,
  },
};

export const handRegion = (p: Page) => p.getByRole('region', { name: 'Your hand' });
/** The "what to do now" line (the rules drawer is in the page too, so search only here). */
export const hint = (p: Page, text: RegExp | string) =>
  p.getByRole('status').filter({ hasText: text });
export const reveal = (p: Page) => p.getByRole('dialog', { name: 'Only you can see this' });

async function handOf(p: Page): Promise<string[]> {
  const labels = await handRegion(p)
    .getByRole('button', { name: /\(\d\)(, .*)?$/ })
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
  return labels.map((l) => l.replace(/ \(\d\)(, .*)?$/, ''));
}

/**
 * Opens the first card chip (or readable card) in `scope` and checks it shows the card to read,
 * never to play, then closes it.
 */
export async function readFirstCard(p: Page, scope: Locator) {
  const chip = scope.getByRole('button', { name: /^Read / }).first();
  const label = (await chip.getAttribute('aria-label'))!.replace(/^Read /, '');
  await chip.click();
  const sheet = p.getByRole('dialog', { name: label, exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('button', { name: /^Play / })).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close', exact: true }).last().click();
  await expect(sheet).toBeHidden();
}

/** Closes a private reveal if one is showing. */
export async function dismissReveal(p: Page) {
  if (await reveal(p).isVisible()) {
    await reveal(p).getByRole('button', { name: 'Got it' }).click();
    await expect(reveal(p)).toBeHidden();
  }
}

/** The page whose turn it is, or 'over' once the round (or game) has ended. */
export async function whoseTurn(players: Page[], host: Page): Promise<Page | 'over'> {
  const found: { who: Page | 'over' | null } = { who: null };
  await expect
    .poll(async () => {
      if (await hint(host, /^Round over!|wins? the game|Nobody won/).count()) {
        found.who = 'over';
        return true;
      }
      for (const p of players) {
        if (await hint(p, /^Your turn/).count()) {
          found.who = p;
          return true;
        }
      }
      return false;
    })
    .toBe(true);
  return found.who!;
}

export interface Exercised {
  guard: boolean;
  priest: boolean;
  handmaid: boolean;
  chancellor: boolean;
  /** Steered towards too when present and false (the screenshots want them). */
  baron?: boolean;
  prince?: boolean;
}

export type Moment =
  | 'my-turn'
  | 'targeting'
  | 'guard-guess'
  | 'chancellor'
  | 'priest-reveal'
  | 'baron-reveal'
  | 'handmaid'
  | 'prince'
  | 'countess'
  | 'elimination';
export type Shot = (moment: Moment, p: Page) => Promise<void>;

const nameOf = (p: Page) => p.evaluate(() => localStorage.getItem('vt.playerName'));
/** Plays one turn for `p`, preferring the cards still to be exercised. */
export async function takeTurn(
  p: Page,
  players: Page[],
  edition: Edition,
  done: Exercised,
  shot?: Shot,
) {
  // A Chancellor draw opens the keep-one sheet straight away.
  if (await hint(p, /^Your turn: keep one card/).count()) {
    const keepSheet = p.getByRole('dialog', { name: 'Keep one card' });
    await expect(async () => {
      await dismissReveal(p);
      await expect(keepSheet).toBeVisible({ timeout: 1000 });
    }).toPass();
    await keepSheet
      .getByRole('list', { name: 'Cards to choose from' })
      .getByRole('button')
      .first()
      .click();
    await shot?.('chancellor', p);
    await keepSheet.getByRole('button', { name: /^Keep / }).click();
    await expect(keepSheet).toBeHidden();
    await expect(handRegion(p).getByRole('button', { name: /\(\d\)$/ })).toHaveCount(1);
    done.chancellor = true;
    return;
  }
  await shot?.('my-turn', p);
  const hand = await handOf(p);
  expect(hand).toHaveLength(2);
  const ranks = RANKS[edition];
  const forced = await hint(p, 'Your turn: you must play the Countess').count();
  const wanted = [
    !done.chancellor && edition === '2019' && 'Chancellor',
    !done.priest && 'Priest',
    done.baron === false && 'Baron',
    done.prince === false && 'Prince',
    !done.handmaid && 'Handmaid',
    !done.guard && 'Guard',
  ].filter((c): c is string => !!c);
  const playable = hand.filter((c) => c !== 'Princess');
  const card = forced
    ? 'Countess'
    : (wanted.find((c) => playable.includes(c)) ??
      [...playable].sort((a, b) => ranks[a]! - ranks[b]!)[0]!);

  const sheet = p.getByRole('dialog', { name: `${card} (${ranks[card]})` });
  // A private reveal can open just as the turn starts; close it and try again. On a slow machine
  // the sheet can open after the check gave up: then it's open, and clicking again can't land.
  await expect(async () => {
    if (await sheet.isVisible()) return;
    await dismissReveal(p);
    // A slow sheet may have opened after the last try gave up: don't click through it.
    if (!(await sheet.isVisible())) {
      await handRegion(p)
        .getByRole('button', { name: `${card} (${ranks[card]})` })
        .first()
        .click({ timeout: 1000 });
    }
    await expect(sheet).toBeVisible({ timeout: 1000 });
  }).toPass();
  const choose = sheet.getByRole('group', { name: 'Choose a player' });
  let target: string | null = null;
  if ((await choose.count()) > 0) {
    const options = choose.getByRole('button');
    if ((await options.count()) > 0) {
      // Prefer someone else (the Prince may also pick yourself).
      const others = choose.getByRole('button', { name: /^(?!Yourself$)/ });
      const pick = (await others.count()) > 0 ? others.first() : options.first();
      target = await pick.textContent();
      await pick.click();
      await shot?.('targeting', p);
    }
  }
  if (card === 'Guard' && target) {
    await sheet.getByRole('group', { name: 'Name a card' }).getByRole('button').first().click();
    await shot?.('guard-guess', p);
  }
  if (forced) await shot?.('countess', p);
  await sheet.getByRole('button', { name: `Play ${card}` }).click();
  await expect(sheet).toBeHidden();
  // Wait for the move to land, so the next turn isn't read from a stale screen.
  await expect(hint(p, /^Your turn: (tap|you must)/)).toHaveCount(0);

  if (card === 'Guard' && target) done.guard = true;
  if (card === 'Handmaid') {
    done.handmaid = true;
    // Everyone else sees the player as protected.
    const me = await nameOf(p);
    const others = players.filter((o) => o !== p);
    for (const other of others) {
      await expect(
        other
          .getByRole('list', { name: 'Players' })
          .getByRole('listitem', { name: me!, exact: true })
          .getByLabel('protected'),
      ).toBeVisible();
    }
    await shot?.('handmaid', others[0]!);
  }
  if (card === 'Baron' && target) {
    if (done.baron === false) done.baron = true;
    if (await reveal(p).isVisible()) await shot?.('baron-reveal', p);
  }
  if (card === 'Prince' && target) {
    if (done.prince === false) done.prince = true;
    // The log names who discarded, not just the card.
    await expect(p.getByText(/played \d?Prince on [^:]+: \S+ discarded/).first()).toBeAttached();
    // What the chosen player sees of it.
    for (const other of players) {
      if ((await nameOf(other)) === target || (target === 'Yourself' && other === p)) {
        await shot?.('prince', other);
      }
    }
  }
  if (shot) {
    for (const other of players) {
      if (await hint(other, /^You’re out this round/).count()) await shot('elimination', other);
    }
  }
  if (card === 'Priest' && target) {
    done.priest = true;
    // Only the player who looked sees the card.
    await expect(reveal(p)).toBeVisible();
    await expect(reveal(p)).toContainText(`You saw ${target}’s card:`);
    await shot?.('priest-reveal', p);
    for (const other of players.filter((o) => o !== p)) {
      // Once they have the move (in the latest line or the folded log)…
      await expect(other.getByText(/played \d?Priest and looked at/).first()).toBeAttached();
      // …they have no peek of their own (a Baron or King reveal from earlier may still be open).
      await expect(reveal(other).filter({ hasText: 'You saw' })).toBeHidden();
    }
    await dismissReveal(p);
  }
}

/**
 * Plays rounds until `stop` says so at a round's end (`gameOver` when the podium shows), starting
 * the next round or game otherwise.
 */
export async function playUntil(
  host: Page,
  players: Page[],
  edition: Edition,
  done: Exercised,
  stop: (gameOver: boolean) => boolean,
  shot?: Shot,
  onResult?: (gameOver: boolean) => Promise<void>,
) {
  for (let turns = 0; turns < 400; turns++) {
    const who = await whoseTurn(players, host);
    if (who === 'over') {
      // Everyone sees the result: survivors' final cards, or the final standings at the end.
      const gameOver = (await hint(host, /wins? the game|Nobody won/).count()) > 0;
      const result = host.getByLabel(gameOver ? 'Game result' : 'Round result', { exact: true });
      await expect(result).toBeVisible();
      for (const p of players) await dismissReveal(p);
      await onResult?.(gameOver);
      if (stop(gameOver)) return;
      // A reveal from the last move can still open over the result; close it and retry.
      await expect(async () => {
        if (await result.isHidden()) return; // an earlier click landed after all
        await dismissReveal(host);
        await host
          .getByRole('button', { name: gameOver ? 'Play again' : 'Next round' })
          .click({ timeout: 1000 });
        await expect(result).toBeHidden({ timeout: 1000 });
      }).toPass();
      continue;
    }
    await takeTurn(who, players, edition, done, shot);
  }
  throw new Error(`gave up: ${JSON.stringify(done)}`);
}
