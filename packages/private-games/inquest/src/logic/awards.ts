import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  type RecapEvent,
  bool,
  count,
  leaders,
  num,
  ph,
  str,
  strs,
} from '@vt/game-sdk';

/**
 * Inquest's night-recap awards, read from its own insight events (see `insights.ts`). Cards go
 * out as `{card:clue-17}` / `{card:means-4}` placeholders, which the browser names from the
 * private manifest, so card names never reach stats storage.
 */

const outcomeOf = (g: GameEvents): RecapEvent | undefined => g.of('outcome').at(-1);
const won = (o: RecapEvent | undefined, side: string) => str(o, 'winner') === side;
const one = (id: string | undefined | null, value = 1, params?: AwardCandidate['params']) =>
  id ? [{ players: [id], value, ...(params ? { params } : {}) }] : [];

/** Investigators won by naming the pair (straight, or the Reversal missed the Witness). */
const solved = (o: RecapEvent | undefined) =>
  !!o && won(o, 'investigators') && (str(o, 'how') === 'solved' || str(o, 'how') === 'reversal');

const sharpEye: AwardRule = {
  id: 'inquest.sharp-eye',
  emoji: '🔍',
  title: 'Sharp Eye',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'solving',
  minPlayers: 4,
  copy: {
    cheeky: ['{who} named the killer on the first try', '{who} needed one attempt. Just one'],
    wholesome: ['{who} cracked the case on their first attempt', '{who} saw it clearly, first try'],
  },
  compute(g) {
    const o = outcomeOf(g);
    const right = g.of('solve').find((s) => bool(s, 'correct'));
    if (!right?.playerId || bool(o, 'firstTry') !== true) return [];
    return one(right.playerId, num(right, 'round') ?? 1);
  },
};

const caseClosedEarly: AwardRule = {
  id: 'inquest.case-closed-early',
  emoji: '⚡',
  title: 'Case Closed Early',
  valence: 'glory',
  weight: 5,
  kind: 'moment',
  family: 'solving',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} solved it in round 1. The killer barely sat down',
      '{who} closed it in round 1',
    ],
    wholesome: ['{who} solved the case in round 1', '{who} cracked it in the very first round'],
  },
  compute(g) {
    const right = g.of('solve').find((s) => bool(s, 'correct'));
    return num(right, 'round') === 1 ? one(right?.playerId, 1) : [];
  },
};

const gotAwayWithIt: AwardRule = {
  id: 'inquest.got-away',
  emoji: '🩸',
  title: 'Got Away With It',
  wholesomeTitle: 'Perfect Alibi',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'bluff',
  minPlayers: 4,
  copy: {
    cheeky: ['{who} did it and walked out the front door', '{who} was the killer. Nobody noticed'],
    wholesome: ['{who} kept their secret all {n} rounds', '{who} played the Murderer perfectly'],
  },
  compute(g) {
    const o = outcomeOf(g);
    if (!won(o, 'murderer') || str(o, 'how') === 'reversal') return [];
    return one(str(o, 'murderer'), num(o, 'round') ?? 3);
  },
};

const silentPartner: AwardRule = {
  id: 'inquest.silent-partner',
  emoji: '🤝',
  title: 'Silent Partner',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'bluff',
  minPlayers: 6,
  copy: {
    cheeky: ['{who} helped the killer and kept a straight face', '{who} was in on it all along'],
    wholesome: ['{who} quietly helped the Murderer win', '{who} was a loyal Accomplice'],
  },
  compute(g) {
    const o = outcomeOf(g);
    return won(o, 'murderer') ? one(str(o, 'accomplice')) : [];
  },
};

const starWitness: AwardRule = {
  id: 'inquest.star-witness',
  emoji: '👁️',
  title: 'Star Witness',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'witness',
  minPlayers: 6,
  copy: {
    cheeky: ['{who} saw everything and lived to tell it', '{who} hid from the killers. Sneaky'],
    wholesome: ['{who} helped crack the case and stayed safe', '{who} was a brave Witness'],
  },
  compute(g) {
    const o = outcomeOf(g);
    return str(o, 'how') === 'reversal' && bool(o, 'witnessFound') === false
      ? one(str(o, 'witness'))
      : [];
  },
};

const foundTheWitness: AwardRule = {
  id: 'inquest.found-the-witness',
  emoji: '🎯',
  title: 'Found the Witness',
  valence: 'glory',
  weight: 5,
  kind: 'moment',
  family: 'witness',
  minPlayers: 6,
  copy: {
    cheeky: [
      'Caught, then {who} found the Witness. Case reopened',
      '{who} turned it round at the end',
    ],
    wholesome: ['{who} named the Witness and snatched the win', '{who} pulled off the Reversal'],
  },
  compute(g) {
    const o = outcomeOf(g);
    return str(o, 'how') === 'reversal' && bool(o, 'witnessFound') === true
      ? one(str(o, 'murderer'))
      : [];
  },
};

const masterForensic: AwardRule = {
  id: 'inquest.master-forensic',
  emoji: '🧪',
  title: 'Master Forensic',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'forensic',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} only needed {n} bullets to get the point across',
      '{who} led them there in {n} bullets',
    ],
    wholesome: [
      '{who} guided the table to the answer in {n} bullets',
      '{who} was a clear, calm guide',
    ],
  },
  compute(g) {
    const o = outcomeOf(g);
    if (!solved(o)) return [];
    const bullets = num(o, 'bulletsBeforeSolve');
    if (!bullets) return [];
    return one(str(o, 'fs'), bullets);
  },
  computeNight(games) {
    // The night's fastest case (fewest bullets before the solve) gets it.
    const tally = new Map<string, number>();
    for (const g of games) {
      const o = outcomeOf(g);
      const fs = str(o, 'fs');
      const bullets = num(o, 'bulletsBeforeSolve');
      if (!solved(o) || !fs || !bullets) continue;
      tally.set(fs, Math.min(tally.get(fs) ?? Infinity, bullets));
    }
    return leaders(tally, { lowest: true });
  },
};

const hesitantHand: AwardRule = {
  id: 'inquest.hesitant-hand',
  emoji: '🐢',
  title: 'Hesitant Hand',
  wholesomeTitle: 'Careful Hand',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'forensic',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} held a bullet for {n} seconds. We all saw',
      '{who} paused {n} s over one bullet',
    ],
    wholesome: [
      '{who} took {n} seconds to place one perfect bullet',
      '{who} thought hard: {n} s on a bullet',
    ],
  },
  compute(g) {
    const o = outcomeOf(g);
    const gap = num(o, 'maxGapS') ?? 0;
    return gap >= 20 ? one(str(o, 'fs'), Math.round(gap)) : [];
  },
};

const boldBluffer: AwardRule = {
  id: 'inquest.bold-bluffer',
  emoji: '🎭',
  title: 'Bold Bluffer',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'bluff',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} "solved" the crime they committed. Cheeky',
      '{who} spent a badge to look innocent',
    ],
    wholesome: [
      '{who} made a daring bluff solve and won',
      '{who} bluffed with a solve, and it worked',
    ],
  },
  compute(g) {
    const o = outcomeOf(g);
    if (!won(o, 'murderer')) return [];
    const ids = strs(o, 'bluffers');
    return ids.length ? [{ players: ids.slice(0, 2), value: ids.length }] : [];
  },
};

const wrongTree: AwardRule = {
  id: 'inquest.wrong-tree',
  emoji: '🙈',
  title: 'Wrong Tree',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'solving',
  minPlayers: 4,
  copy: {
    cheeky: [
      '{who} had the right suspect, wrong pair of cards',
      '{who} was so close. Right suspect!',
    ],
    wholesome: ['{who} spotted the right suspect, nearly there', '{who} read the right suspect'],
  },
  compute(g) {
    const ids = [...new Set(strs(outcomeOf(g), 'nearMisses'))];
    return ids.length && ids.length <= 3 ? [{ players: ids, value: ids.length }] : [];
  },
};

const lastSecondSave: AwardRule = {
  id: 'inquest.last-second-save',
  emoji: '🧠',
  title: 'Last-Second Save',
  valence: 'glory',
  weight: 4,
  kind: 'moment',
  family: 'solving',
  minPlayers: 4,
  copy: {
    cheeky: ['{who} solved it in the last round. Nerves of steel', '{who} left it late, round {n}'],
    wholesome: ['{who} cracked it in the final round', '{who} saved the case in round {n}'],
  },
  compute(g) {
    const o = outcomeOf(g);
    const r = num(o, 'solvedRound');
    const last = num(o, 'finalRound');
    return r !== undefined && r !== null && last !== undefined && r === last && r > 1
      ? one(str(o, 'solvedBy'), r)
      : [];
  },
};

export const INQUEST_RULES: AwardRule[] = [
  sharpEye,
  caseClosedEarly,
  gotAwayWithIt,
  silentPartner,
  starWitness,
  foundTheWitness,
  masterForensic,
  hesitantHand,
  boldBluffer,
  wrongTree,
  lastSecondSave,
];

const outcomes = (games: readonly GameEvents[]) =>
  games.flatMap((g) => {
    const o = outcomeOf(g);
    return o ? [o] : [];
  });

/** The most frequent value of a prop, at least twice. */
function topOf(list: readonly RecapEvent[], key: string): [string, number] | null {
  const counts = new Map<string, number>();
  for (const o of list) {
    const v = str(o, key);
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  const [top] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return top && top[1] >= 2 ? top : null;
}

const span = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`);

const nuggets: NuggetRule[] = [
  {
    id: 'inquest.solved',
    emoji: '🗂️',
    interest: 3,
    compute(games) {
      const list = outcomes(games);
      if (!list.length) return null;
      const n = list.filter(solved).length;
      return { value: n, text: `Cases solved: ${n} of ${list.length}` };
    },
  },
  {
    // Lower is better: the round first, then the time (round × 100000 + seconds).
    id: 'inquest.fastest',
    emoji: '⚡',
    interest: 3,
    record: 'min',
    compute(games) {
      const best = outcomes(games)
        .filter(solved)
        .map((o) => ({ round: num(o, 'solvedRound'), s: num(o, 'solveS') }))
        .filter(
          (x): x is { round: number; s: number } => x.round !== undefined && x.s !== undefined,
        )
        .sort((a, b) => a.round - b.round || a.s - b.s)[0];
      if (!best) return null;
      return {
        value: best.round * 100000 + best.s,
        text: `Fastest solve: round ${best.round}, ${span(best.s)} in`,
      };
    },
  },
  {
    id: 'inquest.wrong-before',
    emoji: '❌',
    interest: 2,
    compute(games) {
      const list = outcomes(games).filter(solved);
      if (!list.length) return null;
      const n = list.reduce((sum, o) => sum + (num(o, 'wrongBeforeSolve') ?? 0), 0);
      return { value: n, text: `${count(n, 'wrong guess', 'wrong guesses')} before a solve` };
    },
  },
  {
    id: 'inquest.badges',
    emoji: '🪪',
    interest: 1,
    compute(games) {
      const n = outcomes(games).reduce((sum, o) => sum + (num(o, 'wrong') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'badge')} spent on wrong guesses` } : null;
    },
  },
  {
    id: 'inquest.top-means',
    emoji: '🔪',
    interest: 2,
    compute(games) {
      const top = topOf(outcomes(games), 'means');
      return top ? { value: top[1], text: `${ph.card(top[0])} killed ${top[1]} times` } : null;
    },
  },
  {
    id: 'inquest.top-clue',
    emoji: '🧾',
    interest: 2,
    compute(games) {
      const top = topOf(outcomes(games), 'clue');
      return top ? { value: top[1], text: `${ph.card(top[0])} was the key ${top[1]} times` } : null;
    },
  },
  {
    id: 'inquest.events',
    emoji: '🃏',
    interest: 1,
    compute(games) {
      const n = games.reduce((sum, g) => sum + g.of('event').length, 0);
      return n ? { value: n, text: `${count(n, 'event')} turned up` } : null;
    },
  },
  {
    id: 'inquest.longest-pause',
    emoji: '🐢',
    interest: 2,
    record: 'max',
    compute(games) {
      const gaps = outcomes(games).map((o) => num(o, 'maxGapS') ?? 0);
      const best = gaps.length ? Math.max(...gaps) : 0;
      return best >= 5
        ? { value: best, text: `Longest pause between bullets: ${Math.round(best)} s` }
        : null;
    },
  },
];

/** "Solved in round 2 by Ana", "The Murderer got away", "The Witness was found". */
function history(g: GameEvents): string[] {
  const o = outcomeOf(g);
  if (!o) return [];
  const by = str(o, 'solvedBy');
  const round = num(o, 'solvedRound');
  const solvedLine = `Solved in round ${round ?? '?'}${by ? ` by ${ph.p(by)}` : ''}`;
  switch (str(o, 'how')) {
    case 'solved':
      return [solvedLine];
    case 'reversal':
      return bool(o, 'witnessFound')
        ? [`${solvedLine}, but the Witness was found`]
        : [`${solvedLine}, and the Witness stayed safe`];
    case 'badges':
      return ['Every badge was spent: the Murderer got away'];
    default:
      return ['The Murderer got away'];
  }
}

export const inquestAwards: AwardModule = { rules: INQUEST_RULES, nuggets, history, stripSize: 3 };
