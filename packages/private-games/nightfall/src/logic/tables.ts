import type { PlayerId, Rng } from '@vt/game-sdk';
import { ROLES, type RoleId } from './roles.ts';

/**
 * The Alien set's random tables: what the narrator tells the aliens, the Oracle, the Psychic, the
 * Rascal, the Exposer, the Mortician, the Body Snatcher and the Empath, and the ripples at the end
 * of the night. Each table has the narrator's default weights; the host may change them in the
 * lobby (`Settings.weights`). Every pick runs on the game's seeded rng, so a night replays the
 * same from the same seed.
 *
 * Players are named by their number (seat + 1, increasing to the left), as the narrator does.
 */

// ---- Player numbers and the sets the narrator names ----

/** A player's number: their seat plus one. Numbers increase to the left. */
export const numberOf = (order: readonly PlayerId[], p: PlayerId) => order.indexOf(p) + 1;
/** The player with a number, if any. */
export const playerNumbered = (order: readonly PlayerId[], n: number): PlayerId | undefined =>
  order[n - 1];

/**
 * A set of players (or the centre) the narrator names. Relative sets (neighbours, higher, two to
 * the left…) are read from the acting player's seat.
 */
export type PlayerSet =
  | { kind: 'everyone' }
  | { kind: 'any' }
  | { kind: 'even' }
  | { kind: 'odd' }
  | { kind: 'numbers'; numbers: number[] }
  | { kind: 'center' }
  | { kind: 'neighbours' }
  | { kind: 'both-neighbours' }
  | { kind: 'left' }
  | { kind: 'right' }
  | { kind: 'yourself' }
  | { kind: 'higher' }
  | { kind: 'lower' }
  | { kind: 'two-left' }
  | { kind: 'two-right' };

/**
 * The players in a set, seen from `self` (null for sets that name players outright: everyone,
 * even, odd, numbers). "Any player" and the even/odd and number sets leave `self` out; the
 * relative sets never include `self` but for "yourself". Higher and lower compare numbers
 * without wrapping round the table.
 */
export function playersIn(
  order: readonly PlayerId[],
  set: PlayerSet,
  self: PlayerId | null,
): PlayerId[] {
  const n = order.length;
  const i = self === null ? -1 : order.indexOf(self);
  const at = (k: number) => order[(((i + k) % n) + n) % n]!;
  const mine = i + 1;
  const others = order.filter((p) => p !== self);
  const num = (p: PlayerId) => order.indexOf(p) + 1;
  // In seat order, never twice, and never `self` (but for "yourself").
  const uniq = (ps: PlayerId[]) =>
    order.filter((p) => ps.includes(p) && (p !== self || set.kind === 'yourself'));
  switch (set.kind) {
    case 'everyone':
      return [...order];
    case 'any':
      return others;
    case 'even':
      return others.filter((p) => num(p) % 2 === 0);
    case 'odd':
      return others.filter((p) => num(p) % 2 === 1);
    case 'numbers':
      return others.filter((p) => set.numbers.includes(num(p)));
    case 'center':
      return [];
    case 'neighbours':
    case 'both-neighbours':
      return self === null ? [] : uniq([at(1), at(-1)]);
    case 'left':
      return self === null ? [] : uniq([at(1)]);
    case 'right':
      return self === null ? [] : uniq([at(-1)]);
    case 'yourself':
      return self === null ? [] : [self];
    case 'higher':
      return others.filter((p) => num(p) > mine);
    case 'lower':
      return others.filter((p) => num(p) < mine);
    case 'two-left':
      return self === null ? [] : uniq([at(1), at(2)]);
    case 'two-right':
      return self === null ? [] : uniq([at(-1), at(-2)]);
  }
}

/** Distinct random player numbers (1…n), none of `not`, at most `count`. */
export function randomNumbers(rng: Rng, n: number, count: number, not: number[] = []): number[] {
  const pool = Array.from({ length: n }, (_, i) => i + 1).filter((x) => !not.includes(x));
  return rng
    .shuffle(pool)
    .slice(0, count)
    .sort((a, b) => a - b);
}

// ---- Weights ----

/** The narrator's default weights, per table. The keys are the narration keys' last part. */
export const DEFAULT_WEIGHTS = {
  alien: {
    view: 30,
    'all-view': 30,
    stare: 15,
    show: 10,
    timer: 5,
    left: 5,
    right: 5,
    'new-alien': 0,
    'alien-helper': 0,
  },
  oracle: {
    'werewolf-team': 15,
    'vampire-team': 15,
    'alien-team': 15,
    'alien-exchange': 0,
    'view-center': 10,
    'center-exchange': 10,
    ripple: 5,
    'even-odd': 0,
    'view-player': 0,
    number: 30,
  },
  ripple: {
    'one-minute': 5,
    'vote-for-app': 0,
    'repeat-role': 0,
    'i-am-alien': 0,
    'face-away': 5,
    'two-hand-vote': 5,
    'no-speak': 5,
    'view-1': 5,
    'view-2': 5,
    'dual-view': 5,
    insomniac: 5,
    troublemaker: 5,
    steal: 5,
    drunk: 5,
    witch: 5,
    reveal: 5,
    shuffle: 5,
    // The narrator lists the time loop twice (double odds); here it has single odds.
    'repeat-night': 5,
    'repeat-observer': 5,
    none: 20,
  },
  'body-snatcher': { steal: 85, center: 15, pretend: 0 },
  psychic: { 'view-1': 100, 'view-2': 0 },
  // The narrator lists the Drunk twice (both at 0); here it is listed once.
  rascal: { troublemaker: 40, witch: 30, robber: 30, drunk: 0, idiot: 0 },
  exposer: { 'flip-1': 75, 'flip-2': 20, 'flip-3': 5 },
  mortician: { 'one-card': 70, 'both-cards': 25, pretend: 5 },
  empath: {
    think: 8,
    goodlooking: 8,
    suspicious: 7,
    smells: 7,
    sharp: 7,
    awesome: 7,
    everyoneelse: 7,
    smartest: 7,
    friendliest: 7,
    funniest: 7,
    winner: 7,
    like: 7,
    dontthink: 7,
    nicest: 7,
  },
} as const;

export type WeightTable = keyof typeof DEFAULT_WEIGHTS;
export const WEIGHT_TABLES = Object.keys(DEFAULT_WEIGHTS) as WeightTable[];
export type EntryOf<T extends WeightTable> = keyof (typeof DEFAULT_WEIGHTS)[T] & string;
export type AlienAction = EntryOf<'alien'>;
export type OracleQuestion = EntryOf<'oracle'>;
export type RippleKey = EntryOf<'ripple'>;
export type SnatchAction = EntryOf<'body-snatcher'>;
export type RascalAction = EntryOf<'rascal'>;
export type MorticianAction = EntryOf<'mortician'>;
export type EmpathPrompt = EntryOf<'empath'>;

/** The host's changes to the default weights (only the entries they changed need be there). */
export type Weights = Partial<Record<WeightTable, Record<string, number>>>;

export const MAX_WEIGHT = 100;

/** Each table's entries with the weights in force for this game. */
export function weightsOf<T extends WeightTable>(
  table: T,
  overrides: Weights | undefined,
): [EntryOf<T>, number][] {
  const base = DEFAULT_WEIGHTS[table] as Record<string, number>;
  const mine: Partial<Record<string, number>> = overrides?.[table] ?? {};
  return Object.keys(base).map((k) => {
    const w = mine[k];
    return [k as EntryOf<T>, typeof w === 'number' && w >= 0 ? w : base[k]!];
  });
}

/** Why a set of weight changes is refused, or null. */
export function weightsProblem(w: Weights): string | null {
  for (const [table, entries] of Object.entries(w)) {
    if (!(table in DEFAULT_WEIGHTS)) return `There is no ${table} table.`;
    const base = DEFAULT_WEIGHTS[table as WeightTable] as Record<string, number>;
    for (const [k, v] of Object.entries(entries ?? {})) {
      if (!(k in base)) return `The ${table} table has no ${k}.`;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > MAX_WEIGHT)
        return `Weights go from 0 to ${MAX_WEIGHT}.`;
    }
  }
  return null;
}

/**
 * A weighted pick among `entries` (only those `allowed`). With every allowed weight at zero, the
 * pick falls back to `fallback` when allowed, else to an even pick.
 */
export function weighted<K extends string>(
  rng: Rng,
  entries: readonly [K, number][],
  allowed: (k: K) => boolean = () => true,
  fallback?: K,
): K {
  const live = entries.filter(([k]) => allowed(k));
  const total = live.reduce((s, [, w]) => s + w, 0);
  if (total <= 0) {
    if (fallback && allowed(fallback)) return fallback;
    return live[rng.int(live.length)]![0];
  }
  let x = rng.next() * total;
  for (const [k, w] of live) {
    if (x < w) return k;
    x -= w;
  }
  return live.at(-1)![0];
}

/** An even pick among equally likely options. */
export const evenly = <T>(rng: Rng, options: readonly T[]): T => options[rng.int(options.length)]!;

// ---- What each step is told ----

/** The table each role's step draws from (a Doppelgänger copy draws its own pick). */
export const TABLE_OF: Partial<Record<RoleId, WeightTable>> = {
  alien: 'alien',
  oracle: 'oracle',
  'body-snatcher': 'body-snatcher',
  psychic: 'psychic',
  rascal: 'rascal',
  exposer: 'exposer',
  mortician: 'mortician',
  empath: 'empath',
};

/** Which tables a game with these cards uses (for the lobby's Alien options). */
export function tablesFor(roles: readonly RoleId[]): WeightTable[] {
  const s = new Set(roles);
  const aliens = roles.some((r) => ROLES[r].wakesWithAliens);
  return WEIGHT_TABLES.filter((t) =>
    t === 'alien'
      ? aliens
      : t === 'ripple'
        ? ripplesIn(roles)
        : roles.some((r) => TABLE_OF[r] === t && s.has(r)),
  );
}

/** Players are numbered (tokens on the table) when Alien-set or Bonus Pack 3 roles are in. */
export const numbersInPlay = (roles: readonly RoleId[]) =>
  roles.some((r) => ROLES[r].set === 'alien' || ROLES[r].set === 'bonus3');

/** Ripples come at the end of the night when the aliens' own cards are in the game. */
export const ripplesIn = (roles: readonly RoleId[]) =>
  roles.some((r) => ['alien', 'synthetic-alien', 'groob', 'zerb', 'body-snatcher'].includes(r));

/** The random part of a step, as the narrator says it. One pick per step, shared by its actors. */
export type StepPick =
  | {
      kind: 'alien';
      action: AlienAction;
      /** Whose cards the aliens may look at (view, all-view). */
      from?: PlayerSet;
      /** Who puts out a fist (new-alien, alien-helper). */
      fists?: PlayerSet;
      /** The Oracle made them swap cards. */
      forced?: boolean;
    }
  | { kind: 'oracle'; question: OracleQuestion }
  | { kind: 'body-snatcher'; action: SnatchAction; from?: PlayerSet }
  | { kind: 'psychic'; count: 1 | 2; from: PlayerSet }
  | { kind: 'rascal'; action: RascalAction; from?: PlayerSet }
  | { kind: 'exposer'; count: 1 | 2 | 3 }
  | { kind: 'mortician'; action: MorticianAction; from?: PlayerSet }
  | { kind: 'empath'; who: PlayerSet; prompt: EmpathPrompt };

/** The Oracle's questions and when the narrator may ask them. */
const ORACLE_NEEDS: Partial<Record<OracleQuestion, RoleId[]>> = {
  'werewolf-team': ['alpha-wolf', 'dream-wolf', 'mystic-wolf', 'werewolf'],
  'vampire-team': ['renfield', 'the-count', 'the-master', 'vampire'],
  'alien-team': ['alien'],
  'alien-exchange': ['alien', 'groob', 'synthetic-alien', 'zerb'],
  ripple: ['alien', 'groob', 'synthetic-alien', 'zerb'],
};

export const oracleAsks = (q: OracleQuestion, roles: readonly RoleId[]) =>
  !ORACLE_NEEDS[q] || ORACLE_NEEDS[q].some((r) => roles.includes(r));

/** The set an alien may look at a card from: any, even, odd, or three numbers. */
function alienFrom(rng: Rng, n: number): PlayerSet {
  const k = rng.int(4);
  if (k === 0) return { kind: 'any' };
  if (k === 1) return { kind: 'even' };
  if (k === 2) return { kind: 'odd' };
  return { kind: 'numbers', numbers: randomNumbers(rng, n, 3) };
}

/** Who puts out a fist, or which players a ripple or the Empath names: everyone, even, odd, three. */
export function groupOfPlayers(rng: Rng, n: number, numbers = true): PlayerSet {
  const k = rng.int(numbers ? 4 : 3);
  if (k === 0) return { kind: 'everyone' };
  if (k === 1) return { kind: 'even' };
  if (k === 2) return { kind: 'odd' };
  return { kind: 'numbers', numbers: randomNumbers(rng, n, 3) };
}

/** The singular set for the Rascal's one-card actions (1/7 each). */
const RASCAL_ONE: PlayerSet['kind'][] = [
  'any',
  'even',
  'odd',
  'neighbours',
  'center',
  'left',
  'right',
];
/** The plural set for the Rascal's Troublemaker action (1/4 each). */
const RASCAL_TWO: PlayerSet['kind'][] = ['higher', 'lower', 'two-left', 'two-right'];
/** The Body Snatcher's sets (1/6 each). */
const SNATCH_FROM: PlayerSet['kind'][] = ['any', 'even', 'odd', 'neighbours', 'left', 'right'];
/** The Mortician's one-card sets (1/4 each). */
const MORTICIAN_ONE: PlayerSet['kind'][] = ['left', 'right', 'neighbours', 'yourself'];

const simple = (kind: PlayerSet['kind']) => ({ kind }) as PlayerSet;

/**
 * The step's random pick, from the role whose step it is. `oracleExchange` is the Oracle's yes to
 * "force the aliens to exchange cards".
 */
export function pickFor(
  role: RoleId,
  ctx: {
    rng: Rng;
    n: number;
    weights: Weights | undefined;
    roles: readonly RoleId[];
    oracleExchange?: boolean;
  },
): StepPick | null {
  const { rng, n, weights } = ctx;
  switch (role) {
    case 'alien': {
      if (ctx.oracleExchange)
        return { kind: 'alien', action: rng.int(2) === 0 ? 'left' : 'right', forced: true };
      const action = weighted(rng, weightsOf('alien', weights), undefined, 'stare');
      if (action === 'view' || action === 'all-view')
        return { kind: 'alien', action, from: alienFrom(rng, n) };
      if (action === 'new-alien' || action === 'alien-helper')
        return { kind: 'alien', action, fists: groupOfPlayers(rng, n, false) };
      return { kind: 'alien', action };
    }
    case 'oracle':
      return {
        kind: 'oracle',
        question: weighted(
          rng,
          weightsOf('oracle', weights),
          (q) => oracleAsks(q, ctx.roles),
          'number',
        ),
      };
    case 'body-snatcher': {
      const action = weighted(rng, weightsOf('body-snatcher', weights), undefined, 'steal');
      return action === 'steal'
        ? { kind: 'body-snatcher', action, from: simple(evenly(rng, SNATCH_FROM)) }
        : { kind: 'body-snatcher', action };
    }
    case 'psychic': {
      const count =
        weighted(rng, weightsOf('psychic', weights), undefined, 'view-1') === 'view-2' ? 2 : 1;
      return { kind: 'psychic', count, from: simple(rng.int(2) === 0 ? 'even' : 'odd') };
    }
    case 'rascal': {
      const action = weighted(rng, weightsOf('rascal', weights), undefined, 'troublemaker');
      if (action === 'idiot') return { kind: 'rascal', action };
      const from = simple(evenly(rng, action === 'troublemaker' ? RASCAL_TWO : RASCAL_ONE));
      return { kind: 'rascal', action, from };
    }
    case 'exposer': {
      const k = weighted(rng, weightsOf('exposer', weights), undefined, 'flip-1');
      return { kind: 'exposer', count: k === 'flip-3' ? 3 : k === 'flip-2' ? 2 : 1 };
    }
    case 'mortician': {
      const action = weighted(rng, weightsOf('mortician', weights), undefined, 'one-card');
      if (action === 'one-card')
        return { kind: 'mortician', action, from: simple(evenly(rng, MORTICIAN_ONE)) };
      if (action === 'both-cards')
        return { kind: 'mortician', action, from: { kind: 'both-neighbours' } };
      return { kind: 'mortician', action };
    }
    case 'empath':
      return {
        kind: 'empath',
        who: groupOfPlayers(rng, n),
        prompt: weighted(rng, weightsOf('empath', weights), undefined, 'think'),
      };
    default:
      return null;
  }
}

// ---- The Blob ----

/** The Blob's members, as the narrator names them: how many on each side of the Blob card. */
export interface BlobShape {
  left: number;
  right: number;
}

/**
 * The Blob's options by table size (ruling 4: 3–4 players → 1, 5–6 → 2, 7–8 → 3, 9+ → 4), each
 * equally likely within its band.
 */
export function blobOptions(players: number): BlobShape[] {
  if (players <= 4)
    return [
      { left: 1, right: 0 },
      { left: 0, right: 1 },
    ];
  if (players <= 6)
    return [
      { left: 0, right: 2 },
      { left: 2, right: 0 },
      { left: 1, right: 1 },
    ];
  if (players <= 8)
    return [
      { left: 0, right: 3 },
      { left: 3, right: 0 },
    ];
  return [
    { left: 0, right: 4 },
    { left: 4, right: 0 },
    { left: 2, right: 2 },
  ];
}

/** The players in a Blob centred on `blob`'s seat (the Blob itself included). */
export function blobMembers(order: readonly PlayerId[], blob: PlayerId, shape: BlobShape) {
  const n = order.length;
  const i = order.indexOf(blob);
  const out = new Set<PlayerId>([blob]);
  for (let k = 1; k <= shape.left; k++) out.add(order[(i + k) % n]!);
  for (let k = 1; k <= shape.right; k++) out.add(order[(((i - k) % n) + n) % n]!);
  return [...out];
}

/** The narration key for a Blob shape ("blob:members:2-left"). */
export const blobKey = (s: BlobShape) =>
  s.left && s.right ? `${s.left}-each-side` : s.left ? `${s.left}-left` : `${s.right}-right`;

// ---- Ripples ----

/** Roles a "repeat your night action" ripple may name (the Copycat and The Master never). */
export const REPEAT_ROLES: RoleId[] = [
  'seer',
  'robber',
  'troublemaker',
  'drunk',
  'village-idiot',
  'mystic-wolf',
  'witch',
  // The narrator lists the Witch twice.
  'witch',
  'revealer',
  'apprentice-seer',
  'paranormal-investigator',
  'curator',
  'the-count',
  'renfield',
  'diseased',
  'cupid',
  'instigator',
  'marksman',
  'priest',
  'pickpocket',
  'gremlin',
  'alien',
  'psychic',
  'rascal',
  'exposer',
];

/** Where a ripple Revealer may turn a card: either neighbour, or their own. */
export type RevealTarget = 'left' | 'right' | 'yourself';

/** A ripple, as announced. Players are named by number, as the narrator does. */
export type Ripple =
  | { key: 'none' | 'one-minute' | 'vote-for-app' | 'repeat-night' }
  | { key: 'repeat-role'; role: RoleId }
  | { key: 'i-am-alien' | 'face-away' | 'two-hand-vote' | 'no-speak'; who: PlayerSet }
  | { key: 'view-1' | 'view-2'; actor: number; from: PlayerSet }
  | { key: 'dual-view'; actors: number[]; from: PlayerSet }
  | { key: 'insomniac'; actors: number[] }
  | { key: 'troublemaker'; actor: number; between: number[] }
  | { key: 'steal' | 'drunk' | 'witch'; actor: number; from: PlayerSet }
  | { key: 'reveal'; actor: number; target: RevealTarget }
  | { key: 'shuffle'; players: number[]; giver: number }
  | { key: 'repeat-observer'; observer: number };

/** "Any player", "any even player", "any odd player", three numbers, or (when allowed) the centre. */
function robSet(rng: Rng, n: number, not: number[], centre: boolean): PlayerSet {
  const k = rng.int(centre ? 5 : 4);
  if (k === 0) return { kind: 'odd' };
  if (k === 1) return { kind: 'even' };
  if (k === 2) return { kind: 'any' };
  if (k === 3) return { kind: 'numbers', numbers: randomNumbers(rng, n, 3, not) };
  return { kind: 'center' };
}

/**
 * The night's ripple. `present` are the numbers of the players still at the table (ripples only
 * ever name them); `guaranteed` (the Oracle's yes) rules out "no ripple".
 */
export function pickRipple(ctx: {
  rng: Rng;
  n: number;
  present: number[];
  weights: Weights | undefined;
  roles: readonly RoleId[];
  guaranteed: boolean;
}): Ripple {
  const { rng, n, present } = ctx;
  const repeatable = REPEAT_ROLES.filter((r) => ctx.roles.includes(r));
  const allowed = (k: RippleKey) =>
    (k !== 'none' || !ctx.guaranteed) &&
    (k !== 'repeat-role' || repeatable.length > 0) &&
    (k !== 'dual-view' && k !== 'shuffle' ? true : present.length >= 2) &&
    (k !== 'troublemaker' || present.length >= 3);
  const key = weighted(
    rng,
    weightsOf('ripple', ctx.weights),
    allowed,
    ctx.guaranteed ? 'one-minute' : 'none',
  );
  // Players named in one ripple are never named twice.
  const named = rng.shuffle(present);
  const one = named[0]!;
  switch (key) {
    case 'none':
    case 'one-minute':
    case 'vote-for-app':
    case 'repeat-night':
      return { key };
    case 'repeat-role':
      return { key, role: evenly(rng, repeatable) };
    case 'i-am-alien':
    case 'face-away':
    case 'two-hand-vote':
    case 'no-speak':
      return { key, who: groupOfPlayers(rng, n) };
    case 'view-1':
    case 'view-2':
      return { key, actor: one, from: robSet(rng, n, [one], true) };
    case 'dual-view': {
      const actors = named.slice(0, 2).sort((a, b) => a - b);
      return { key, actors, from: robSet(rng, n, actors, true) };
    }
    case 'insomniac':
      return { key, actors: named.slice(0, 3).sort((a, b) => a - b) };
    case 'troublemaker':
      return { key, actor: one, between: named.slice(1, 3).sort((a, b) => a - b) };
    case 'steal':
    case 'drunk':
    case 'witch':
      return { key, actor: one, from: robSet(rng, n, [one], false) };
    case 'reveal':
      return { key, actor: one, target: evenly(rng, ['left', 'right', 'yourself'] as const) };
    case 'shuffle': {
      const players = named.slice(0, 2).sort((a, b) => a - b);
      return { key, players, giver: evenly(rng, players) };
    }
    case 'repeat-observer':
      return { key, observer: one };
  }
}
