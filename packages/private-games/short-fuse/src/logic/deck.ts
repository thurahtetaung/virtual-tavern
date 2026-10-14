import type { Rng } from '@vt/game-sdk';
import {
  CORE_POOL,
  type CardType,
  PARTY_DEFUSES,
  PARTY_POOL,
  REVIVES,
  STASH_SIZE,
  X1_POOL,
  X2_POOL,
  X3_POOL,
  X4_POOL,
  X4_TWO_PLAYER_OUT,
} from './cards.ts';
import { type Card, type CardId, HAND_SIZE, type Readout, type Settings } from './types.ts';

type Counts = Partial<Record<CardType, number>>;

const add = (a: Counts, b: Counts): Counts => {
  const out: Counts = { ...a };
  for (const [t, n] of Object.entries(b) as [CardType, number][]) out[t] = (out[t] ?? 0) + n;
  return out;
};
const total = (c: Counts) => Object.values(c).reduce((s, n) => s + (n ?? 0), 0);

/** Which party cards play at this table size: paw cards for 2–3, the rest for 4–7, all for 8+. */
export function partyMarks(players: number): ('paw' | 'plain')[] {
  return players <= 3 ? ['paw'] : players <= 7 ? ['plain'] : ['paw', 'plain'];
}

type Sets = Pick<Settings, 'x1' | 'x2' | 'x3'> & { x4?: boolean };
/** Any expansion on (the base extra-Defuse rule changes then). */
const anyExpansion = (s: Sets) => s.x1 || s.x2 || s.x3 || !!s.x4;
/** Every expansion at once (the Chaos deck), whose pile is capped so games stay party-length. */
export const isChaos = (s: Sets) => s.x1 && s.x2 && s.x3 && !!s.x4;
/** Most cards a player the Chaos pile keeps before the bombs go in. */
export const CHAOS_PER_PLAYER = 12;
/** The faster game's pile with the fourth expansion alone, as printed (6+ players: 35). */
export const ZOMBIE_FASTER = [0, 0, 15, 20, 25, 30, 35] as const;
const zombieFaster = (players: number) => ZOMBIE_FASTER[Math.min(players, 6)]!;

/** The cards each player starts with to save themselves: Second Life cards up to five, then Defuses. */
export function saversFor(s: Sets, players: number): { revive: number; defuse: number } {
  if (!s.x4) return { revive: 0, defuse: players };
  const revive = Math.min(players, REVIVES);
  return { revive, defuse: players - revive };
}

/**
 * The cards that go into the pile besides Bombs and Defuses: the core deck (or the party subset
 * for this table), every expansion that's on, and above five players a top-up from more copies of
 * the core deck to ten cards a player, round-robin by type so the mix stays the same.
 */
export function poolFor(s: Settings, players: number, rng?: Rng): Counts {
  let pool: Counts =
    s.core === 'party'
      ? partyMarks(players).reduce<Counts>((acc, m) => add(acc, PARTY_POOL[m]), {})
      : { ...CORE_POOL };
  if (s.x1) pool = add(pool, X1_POOL);
  if (s.x2) pool = add(pool, X2_POOL);
  if (s.x3) pool = add(pool, X3_POOL);
  if (s.x4) {
    pool = add(pool, X4_POOL);
    if (players === 2)
      for (const [t, n] of Object.entries(X4_TWO_PLAYER_OUT) as [CardType, number][])
        pool[t] = Math.max(0, (pool[t] ?? 0) - n);
  }
  // The Stash comes out of the pool, so a big table tops up for it too.
  const target = 10 * players + (s.x3 ? STASH_SIZE : 0);
  if (s.core === 'classic' && players >= 6 && total(pool) < target) {
    const want = target - total(pool);
    const kinds = Object.keys(CORE_POOL) as CardType[];
    const order = rng ? rng.shuffle(kinds) : kinds;
    const extra: Counts = {};
    // A second core deck, then a third if a big table still needs more.
    let spare: Counts = { ...CORE_POOL };
    let got = 0;
    while (got < want) {
      if (total(spare) === 0) spare = { ...CORE_POOL };
      for (const t of order) {
        if (got >= want) break;
        if ((spare[t] ?? 0) <= 0) continue;
        spare[t] = spare[t]! - 1;
        extra[t] = (extra[t] ?? 0) + 1;
        got += 1;
      }
    }
    pool = add(pool, extra);
  }
  return pool;
}

/** Extra Defuses shuffled into the pile after the deal. */
export function extraDefuses(s: Settings, players: number): number {
  // Second Life cards replace the spare Defuses.
  if (s.x4) return 0;
  // Expansion 3 on its own puts every spare Defuse back (6 in the box, one dealt each).
  if (s.x3 && !s.x1 && !s.x2 && s.core === 'classic') return players <= 5 ? 6 - players : 2;
  if (anyExpansion(s)) return 2;
  if (s.core === 'party') {
    const have = partyMarks(players).reduce((n, m) => n + PARTY_DEFUSES[m], 0);
    return Math.max(0, have - players);
  }
  return players === 5 ? 1 : 2;
}

/**
 * Bombs that go in: one fewer than the players, one more with Expansion 2. With Expansion 1 one
 * of them is the Black Hole (at two players without Expansion 2, the official variant: the Black
 * Hole and one Bomb).
 */
export function bombsFor(s: Sets, players: number): { bombs: number; void: boolean } {
  const total = players - 1 + (s.x2 ? 1 : 0);
  if (!s.x1) return { bombs: total, void: false };
  if (players === 2 && !s.x2) return { bombs: 1, void: true };
  return { bombs: total - 1, void: true };
}

export interface Dealt {
  cards: Record<CardId, Card>;
  pile: CardId[];
  hands: CardId[][];
  out: CardId[];
  /** The Vault's Stash (Expansion 3), dealt face down before the hands. */
  stash: CardId[];
  bombs: number;
}

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';

/** Builds and deals a game for `players` seats. Every card gets a random id. */
export function deal(s: Settings, players: number, rng: Rng): Dealt {
  const cards: Record<CardId, Card> = {};
  const faces: Partial<Record<CardType, number>> = {};
  const make = (t: CardType): CardId => {
    let id: string;
    do {
      id = Array.from({ length: 8 }, () => ID_CHARS[rng.int(ID_CHARS.length)]).join('');
    } while (cards[id]);
    const face = faces[t] ?? 0;
    faces[t] = face + 1;
    cards[id] = { t, face };
    return id;
  };
  const many = (counts: Counts) =>
    (Object.entries(counts) as [CardType, number][]).flatMap(([t, n]) =>
      Array.from({ length: n }, () => make(t)),
    );

  // Savers first: one Defuse each (with Expansion 4, Second Life cards for the first five).
  const sv = saversFor(s, players);
  // Shuffled, so nobody knows which seats got a Defuse rather than a Second Life.
  const savers = rng.shuffle(
    Array.from({ length: players }, (_, i) => make(i < sv.revive ? 'revive' : 'defuse')),
  );
  let pile = rng.shuffle(many(poolFor(s, players, rng)));
  // Expansion 3: the Stash comes off the shuffled pool, then the Vault card goes in.
  const stash = s.x3 ? pile.splice(0, STASH_SIZE) : [];
  if (s.x3) pile = rng.shuffle([...pile, make('vault')]);
  const hands: CardId[][] = savers.map((d) => [d]);
  for (let r = 0; r < HAND_SIZE; r++)
    for (let p = 0; p < players && pile.length; p++) hands[p]!.push(pile.shift()!);
  for (let i = extraDefuses(s, players); i > 0; i--) pile.push(make('defuse'));
  pile = rng.shuffle(pile);
  const out: CardId[] = [];
  const keep = keptPile(s, players, pile.length);
  if (keep < pile.length) out.push(...pile.splice(0, pile.length - keep));
  const k = bombsFor(s, players);
  for (let i = 0; i < k.bombs; i++) pile.push(make('bomb'));
  if (k.void) pile.push(make('void'));
  pile = rng.shuffle(pile);
  return { cards, pile, hands, out, stash, bombs: k.bombs };
}

/**
 * How many cards of the dealt pile stay in before the bombs go in: the Chaos cap (12 a player),
 * then the faster game (the printed targets with the fourth expansion alone, otherwise a third
 * out). Removed cards are out of the game and nobody learns which.
 */
export function keptPile(s: Settings, players: number, pile: number): number {
  let keep = pile;
  if (isChaos(s)) keep = Math.min(keep, CHAOS_PER_PLAYER * players);
  if (s.faster) {
    const zombieOnly = s.x4 && !s.x1 && !s.x2 && !s.x3;
    keep = zombieOnly ? Math.min(keep, zombieFaster(players)) : keep - Math.floor(keep / 3);
  }
  return keep;
}

/** What the lobby says a game at this table would look like. */
export function readout(s: Settings, players: number): Readout {
  const n = Math.max(2, players);
  const pool = total(poolFor(s, n)) + (s.x3 ? 1 - STASH_SIZE : 0);
  const dealt = Math.min(pool, HAND_SIZE * n);
  let pile = keptPile(s, n, pool - dealt + extraDefuses(s, n));
  const k = bombsFor(s, n);
  pile += k.bombs + (k.void ? 1 : 0);
  return {
    players: n,
    pile,
    bombs: k.bombs,
    defuses: extraDefuses(s, n),
    hand: HAND_SIZE + 1,
    turnsEach: Math.max(1, Math.round(pile / n)),
    void: k.void,
    revives: saversFor(s, n).revive,
  };
}
