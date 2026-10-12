import type { PlayerId, Rng } from '@vt/game-sdk';
import { ROLES, loyaltyOf, seesOf, sortDeck } from './roles.ts';
import type { Game, Known, Loyalty, PresetId, Quest, RoleId, Settings } from './types.ts';
import { MAX_SEATS, MIN_PLAYERS } from './types.ts';

/** Evil players per table size. */
export const EVIL_COUNT: Record<number, number> = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 3, 10: 4 };

/** Team size per quest, per table size. */
export const TEAM_SIZE: Record<number, number[]> = {
  5: [2, 3, 2, 3, 3],
  6: [2, 3, 4, 3, 4],
  7: [2, 3, 3, 4, 4],
  8: [3, 4, 4, 5, 5],
  9: [3, 4, 4, 5, 5],
  10: [3, 4, 4, 5, 5],
};

/** The fourth quest (and only it) needs two Fail cards at seven or more players. */
export const failsNeeded = (players: number, slot: number) => (players >= 7 && slot === 3 ? 2 : 1);

/** Table sizes the rules cover, clamped (fewer than 5 can't start; the lobby still shows a deck). */
const clampSize = (n: number) => Math.min(MAX_SEATS, Math.max(MIN_PLAYERS, n));

export const evilCount = (n: number) => EVIL_COUNT[clampSize(n)]!;
export const goodCount = (n: number) => clampSize(n) - evilCount(n);

export function questsFor(n: number): Quest[] {
  return TEAM_SIZE[clampSize(n)]!.map((size, slot) => ({
    size,
    failsNeeded: failsNeeded(n, slot),
  }));
}

// ---- Presets ----

export interface Preset {
  id: PresetId;
  name: string;
  blurb: string;
  /** The special Good and Evil roles at this table size; plain cards fill the rest. */
  special: (n: number) => { good: RoleId[]; evil: RoleId[] };
  /** Whether picking it switches the Lady of the Lake on (from 7 players). */
  lady?: (n: number) => boolean;
}

/** Suggested line-ups (the rulebooks give guidance, not fixed line-ups). */
export const PRESETS: Preset[] = [
  {
    id: 'first',
    name: 'First game',
    blurb: 'Merlin and the Assassin, with loyal servants and minions.',
    special: () => ({ good: ['merlin'], evil: ['assassin'] }),
  },
  {
    id: 'percival-morgana',
    name: 'Percival & Morgana',
    blurb:
      'Percival protects Merlin; Morgana poses as Merlin. Mordred and Oberon join at 9 and 10.',
    special: (n) => ({
      good: ['merlin', 'percival'],
      evil:
        n >= 10
          ? ['assassin', 'morgana', 'mordred', 'oberon']
          : n >= 9
            ? ['assassin', 'morgana', 'mordred']
            : ['assassin', 'morgana'],
    }),
  },
  {
    id: 'classic-plus',
    name: 'Classic+',
    blurb: 'Percival, Morgana and Mordred, with the Lady of the Lake from 7 players.',
    special: (n) => ({
      good: ['merlin', 'percival'],
      evil:
        n >= 10
          ? ['assassin', 'morgana', 'mordred', 'oberon']
          : n >= 7
            ? ['assassin', 'morgana', 'mordred']
            : n === 6
              ? // Two Evil players: Morgana also acts as the Assassin (the designation rule).
                ['morgana', 'mordred']
              : ['assassin', 'morgana'],
    }),
    lady: (n) => n >= 7,
  },
];

export const presetById = (id: PresetId) => PRESETS.find((p) => p.id === id)!;

/** A preset's deck for `n` players (5–10; other sizes use the nearest). */
export function presetDeck(id: PresetId, n: number): RoleId[] {
  const size = clampSize(n);
  const { good, evil } = presetById(id).special(size);
  const deck: RoleId[] = [...good, ...evil];
  for (let i = good.length; i < goodCount(size); i++) deck.push('servant');
  for (let i = evil.length; i < evilCount(size); i++) deck.push('minion');
  return sortDeck(deck);
}

/** The deck the next game deals at a table of `n` (the host's own deck, fitted to the table). */
export const deckFor = (settings: Pick<Settings, 'preset' | 'roles'>, n: number): RoleId[] =>
  settings.preset ? presetDeck(settings.preset, n) : fitDeck(settings.roles, n);

/** Fits the host's own deck to a new table size: plain cards come and go, specials stay. */
export function fitDeck(roles: readonly RoleId[], n: number): RoleId[] {
  const size = clampSize(n);
  const deck = [...roles];
  const count = (l: Loyalty) => deck.filter((r) => loyaltyOf(r) === l).length;
  const drop = (plain: RoleId) => {
    const i = deck.lastIndexOf(plain);
    if (i >= 0) deck.splice(i, 1);
    return i >= 0;
  };
  while (count('good') > goodCount(size) && drop('servant'));
  while (count('evil') > evilCount(size) && drop('minion'));
  while (count('good') < goodCount(size)) deck.push('servant');
  while (count('evil') < evilCount(size)) deck.push('minion');
  return sortDeck(deck);
}

// ---- Checking a deck ----

export interface SetupCheck {
  /** Reasons the game can't start. */
  errors: string[];
  /** Advice that doesn't stop it. */
  notes: string[];
}

/** Whether a deck works for `n` players, in words players read. */
export function validateSetup(
  roles: readonly RoleId[],
  n: number,
  opts: { lady?: boolean } = {},
): SetupCheck {
  const errors: string[] = [];
  const notes: string[] = [];
  if (n < MIN_PLAYERS) errors.push(`${MIN_PLAYERS} players are needed (${n} so far).`);
  if (n > MAX_SEATS) errors.push(`At most ${MAX_SEATS} can play.`);
  const has = (r: RoleId) => roles.includes(r);
  const size = clampSize(n);
  const good = roles.filter((r) => loyaltyOf(r) === 'good').length;
  const evil = roles.length - good;
  if (n >= MIN_PLAYERS && n <= MAX_SEATS) {
    if (roles.length !== n)
      errors.push(
        `The deck has ${roles.length} ${roles.length === 1 ? 'card' : 'cards'} for ${n} players.`,
      );
    else if (evil > evilCount(size))
      errors.push(
        `Too much Evil: ${n} players need ${goodCount(size)} Good and ${evilCount(size)} Evil.`,
      );
    else if (evil < evilCount(size))
      errors.push(
        `Too little Evil: ${n} players need ${goodCount(size)} Good and ${evilCount(size)} Evil.`,
      );
  }
  for (const r of new Set(roles))
    if (ROLES[r].unique && roles.filter((x) => x === r).length > 1)
      errors.push(`Only one ${ROLES[r].name} can play.`);
  if (has('morgana') && !has('percival'))
    notes.push('Morgana needs Percival: without him she plays as a plain Minion.');
  if (has('percival') && !has('merlin'))
    notes.push('Percival without Merlin only sees Morgana (or nobody).');
  if (n === 5 && has('percival') && !has('morgana') && !has('mordred'))
    notes.push('With 5 players and Percival, add Morgana or Mordred to keep Evil in the game.');
  if (!has('merlin'))
    notes.push('No Merlin: there’s no assassination, so Good wins on three successful quests.');
  else if (!has('assassin')) {
    const designable = roles.some((r) => loyaltyOf(r) === 'evil' && !ROLES[r].neverDesignated);
    notes.push(
      designable
        ? 'No Assassin card: one Evil player (never Oberon) is told privately that they name Merlin.'
        : 'No Assassin card: an Evil player is told privately that they name Merlin.',
    );
  }
  if (has('assassin') && !has('merlin'))
    notes.push('The Assassin has no Merlin to hunt: Good wins on three successful quests.');
  if (opts.lady && n < 7) notes.push('The Lady of the Lake is best from 7 players.');
  return { errors, notes };
}

// ---- Dealing ----

export interface Deal {
  players: PlayerId[];
  roles: Record<PlayerId, RoleId>;
  leader: PlayerId;
  /** The Lady's first holder: the player on the first leader's right (just before them). */
  ladyHolder: PlayerId;
  assassin: PlayerId | null;
  designated: boolean;
}

/**
 * Deals the deck: a random role each, a random first leader, the Lady to the leader's right, and
 * the assassin. Without an Assassin card but with Merlin, a random Evil player other than Oberon
 * (any Evil player, if there's no other) acts as one and is told privately.
 */
export function deal(players: readonly PlayerId[], deck: readonly RoleId[], rng: Rng): Deal {
  const shuffled = rng.shuffle([...deck]);
  const roles = Object.fromEntries(players.map((p, i) => [p, shuffled[i]!])) as Record<
    PlayerId,
    RoleId
  >;
  const leaderIdx = rng.int(players.length);
  const n = players.length;
  const holders = players.filter((p) => ROLES[roles[p]!].assassin);
  let assassin: PlayerId | null = holders[0] ?? null;
  let designated = false;
  if (!assassin && deck.includes('merlin')) {
    const evil = players.filter((p) => loyaltyOf(roles[p]!) === 'evil');
    const pool = evil.filter((p) => !ROLES[roles[p]!].neverDesignated);
    const from = pool.length ? pool : evil;
    if (from.length) {
      assassin = from[rng.int(from.length)]!;
      designated = true;
    }
  }
  return {
    players: [...players],
    roles,
    leader: players[leaderIdx]!,
    ladyHolder: players[(leaderIdx - 1 + n) % n]!,
    assassin,
    designated,
  };
}

/** What `viewer` learnt at the start (never role names), in seat order. */
export function knowledgeFor(
  game: Pick<Game, 'players' | 'roles' | 'oberonHidden'>,
  viewer: PlayerId,
): Known[] {
  const mine = game.roles[viewer];
  if (!mine) return [];
  const me = ROLES[mine];
  const opts = { oberonHidden: game.oberonHidden };
  const out: Known[] = [];
  for (const p of game.players) {
    if (p === viewer) continue;
    const as = seesOf(me, ROLES[game.roles[p]!], opts);
    if (as) out.push({ id: p, as });
  }
  return out;
}
