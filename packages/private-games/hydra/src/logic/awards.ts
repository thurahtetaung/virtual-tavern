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
  tally,
} from '@vt/game-sdk';

/**
 * Hydra's night-recap awards, read from its own insight events (see `insights.ts`). The teams and
 * the Leader go out as `{role:blue}` / `{role:red}` / `{role:leader}` placeholders, which the
 * browser names from the private manifest.
 */

const outcomeOf = (g: GameEvents): RecapEvent | undefined => g.of('outcome').at(-1);
const one = (id: string | undefined | null, value = 1, params?: AwardCandidate['params']) =>
  id ? [{ players: [id], value, ...(params ? { params } : {}) }] : [];
const listTally = (ids: readonly string[]) =>
  tally(ids.map((id) => ({ playerId: id }) as RecapEvent));

const sharpshooter: AwardRule = {
  id: 'hydra.sharpshooter',
  emoji: '🎯',
  title: 'Sharpshooter',
  valence: 'glory',
  weight: 5,
  kind: 'moment',
  family: 'power',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} found {role} and pulled the trigger', '{who} aimed true: {role} is gone'],
    wholesome: ['{who} found {role} and ended it', '{who} made the call that won the game'],
  },
  compute(g) {
    const o = outcomeOf(g);
    return str(o, 'how') === 'leader-executed'
      ? one(str(o, 'executor'), 1, { role: 'leader' })
      : [];
  },
};

const ascension: AwardRule = {
  id: 'hydra.ascension',
  emoji: '👑',
  title: 'The Ascension',
  valence: 'glory',
  weight: 5,
  kind: 'moment',
  family: 'leader',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} smiled all the way to the top', '{who} got elected. Oops, everyone'],
    wholesome: ['{who} played a perfect long game', '{who} won the top job, and the game'],
  },
  compute(g) {
    const o = outcomeOf(g);
    return str(o, 'how') === 'leader-elected' ? one(str(o, 'leader'), num(o, 'rounds') ?? 1) : [];
  },
};

const pinocchio: AwardRule = {
  id: 'hydra.pinocchio',
  emoji: '🤥',
  title: 'Pinocchio',
  wholesomeTitle: 'Storyteller',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'claims',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} told {n} fibs tonight. Impressive', '{who}’s nose grew {n} inches'],
    wholesome: ['{who} spun {n} great stories', '{who} bluffed {n} times with a straight face'],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'liars')), { min: 2 });
  },
};

const straightShooter: AwardRule = {
  id: 'hydra.straight-shooter',
  emoji: '😇',
  title: 'Straight Shooter',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'claims',
  minPlayers: 5,
  copy: {
    cheeky: ['{who}: boringly, heroically honest', '{who} told the truth {n} times. Wild'],
    wholesome: ['{who} told it straight every time', '{who} won without a single fib'],
  },
  compute(g) {
    const o = outcomeOf(g);
    const winners = new Set(g.winners);
    const claims = listTally(
      g
        .of('claim')
        .filter((c) => str(c, 'skipped') === undefined && c.playerId)
        .map((c) => c.playerId!),
    );
    const ids = strs(o, 'honest').filter((p) => winners.has(p) && (claims.get(p) ?? 0) >= 2);
    if (!ids.length || ids.length > 3) return [];
    return [{ players: ids.sort(), value: Math.max(...ids.map((p) => claims.get(p) ?? 0)) }];
  },
};

const cursedHands: AwardRule = {
  id: 'hydra.cursed-hands',
  emoji: '🃏',
  title: 'Cursed Hands',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'luck',
  minPlayers: 5,
  copy: {
    cheeky: ['The deck has a grudge against {who}', '{who} drew three red cards {n|time}'],
    wholesome: [
      '{who} kept cool through rotten luck',
      '{who} drew all red {n|time} and stayed calm',
    ],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'rrrBlue')));
  },
};

const snake: AwardRule = {
  id: 'hydra.snake',
  emoji: '🐍',
  title: 'Snake in the Grass',
  wholesomeTitle: 'Master of Disguise',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'bluff',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} passed blue {n|time} with a red heart',
      '{who} enacted blue {n|time} to look innocent',
    ],
    wholesome: ['{who}’s disguise was flawless', '{who} played the long con perfectly'],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'redBlue')));
  },
};

const firewall: AwardRule = {
  id: 'hydra.firewall',
  emoji: '🛡️',
  title: 'Firewall',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'session',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} wouldn’t be bullied by the deck',
      '{who} picked blue from a mixed hand {n|time}',
    ],
    wholesome: ['{who} held the line {n|time}', '{who} chose blue every time it counted'],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'firewall')), { min: 2 });
  },
};

/** Ballots per player from the elections (only counted votes). */
function ballots(g: GameEvents) {
  const yes = new Map<string, number>();
  const no = new Map<string, number>();
  for (const e of g.of('election')) {
    for (const p of strs(e, 'yes')) yes.set(p, (yes.get(p) ?? 0) + 1);
    for (const p of strs(e, 'no')) no.set(p, (no.get(p) ?? 0) + 1);
  }
  return { yes, no };
}

const rubberStamp: AwardRule = {
  id: 'hydra.rubber-stamp',
  emoji: '🗳️',
  title: 'Rubber Stamp',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'votes',
  minPlayers: 5,
  copy: {
    cheeky: [
      '{who} never met a government they disliked',
      '{who} voted yes on all {n} governments',
    ],
    wholesome: ['{who} believed in everyone', '{who} gave all {n} governments a chance'],
  },
  compute(g) {
    const { yes, no } = ballots(g);
    const all = new Map([...yes].filter(([p, n]) => n >= 4 && !no.get(p)));
    return leaders(all, { min: 4 });
  },
};

const noSayer: AwardRule = {
  id: 'hydra.no-sayer',
  emoji: '🙅',
  title: 'No-Sayer',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'votes',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} said no {n} times. Fun at parties', '{who} turned down {n} governments'],
    wholesome: ['{who} trusted no one, wisely', '{who} voted no {n} times, staying careful'],
  },
  compute(g) {
    return leaders(ballots(g).no, { min: 3 });
  },
};

const chaosAgent: AwardRule = {
  id: 'hydra.chaos-agent',
  emoji: '💥',
  title: 'Chaos Agent',
  wholesomeTitle: 'Voice of the People',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'chaos',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} broke democracy', '{who}’s government sent us into chaos'],
    wholesome: [
      '{who}’s government let the people decide',
      '{who} handed the choice to the people',
    ],
  },
  compute(g) {
    const hits = g
      .of('election')
      .filter((e) => bool(e, 'passed') === false && num(e, 'tracker') === 3)
      .map((e) => str(e, 'president'))
      .filter((p): p is string => !!p);
    return leaders(listTally(hits));
  },
};

const vetoRoyale: AwardRule = {
  id: 'hydra.veto-royale',
  emoji: '✂️',
  title: 'Veto Royale',
  valence: 'glory',
  weight: 3,
  kind: 'pair',
  family: 'session',
  minPlayers: 5,
  copy: {
    cheeky: ['{a} and {b} tore it all up', '{a} and {b} vetoed the whole agenda'],
    wholesome: ['{a} and {b} used every tool they had', '{a} and {b} agreed to start fresh'],
  },
  compute(g) {
    const v = g.of('session').find((s) => bool(s, 'vetoed') === true);
    const a = str(v, 'president');
    const b = str(v, 'chancellor');
    return a && b ? [{ players: [a, b], value: 1 }] : [];
  },
};

const bloodhound: AwardRule = {
  id: 'hydra.bloodhound',
  emoji: '🔍',
  title: 'Bloodhound',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'power',
  minPlayers: 7,
  copy: {
    cheeky: ['{who} sniffed out a red card', '{who} caught one and told the truth'],
    wholesome: ['{who} found a red card and said so', '{who} investigated well and honestly'],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'bloodhound')));
  },
};

const friendlyFire: AwardRule = {
  id: 'hydra.friendly-fire',
  emoji: '💔',
  title: 'Friendly Fire',
  wholesomeTitle: 'Bold Call',
  valence: 'chaos',
  weight: 2,
  kind: 'award',
  family: 'power',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} executed a teammate. Oops', '{who} picked the wrong target'],
    wholesome: ['{who} made a brave call that missed', '{who} took a bold shot for the team'],
  },
  compute(g) {
    return leaders(listTally(strs(outcomeOf(g), 'friendlyFire')));
  },
};

const ghost: AwardRule = {
  id: 'hydra.ghost',
  emoji: '🕵️',
  title: 'Ghost',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'leader',
  minPlayers: 5,
  copy: {
    cheeky: ['Nobody even looked at {who}', '{who} hid in plain sight all game'],
    wholesome: ['{who} stayed perfectly hidden', '{who} was never suspected'],
  },
  compute(g) {
    const o = outcomeOf(g);
    if (str(o, 'how') === 'leader-elected') return [];
    return one(str(o, 'ghost'), num(o, 'rounds') ?? 1);
  },
};

const notHimClub: AwardRule = {
  id: 'hydra.not-him',
  emoji: '✅',
  title: 'Not-Him Club',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'leader',
  minPlayers: 5,
  copy: {
    cheeky: ['{who} is officially not {role}, {n|time}', '{who} got cleared {n|time}. Suspicious?'],
    wholesome: [
      '{who} earned the table’s trust {n|time}',
      '{who} was cleared {n|time} as Chancellor',
    ],
  },
  compute(g) {
    return leaders(tally(g.of('cleared')), { min: 2 }).map((c) => ({
      ...c,
      params: { role: 'leader' },
    }));
  },
};

export const HYDRA_RULES: AwardRule[] = [
  sharpshooter,
  ascension,
  pinocchio,
  straightShooter,
  cursedHands,
  snake,
  firewall,
  rubberStamp,
  noSayer,
  chaosAgent,
  vetoRoyale,
  bloodhound,
  friendlyFire,
  ghost,
  notHimClub,
];

const outcomes = (games: readonly GameEvents[]) =>
  games.flatMap((g) => {
    const o = outcomeOf(g);
    return o ? [o] : [];
  });

const nuggets: NuggetRule[] = [
  {
    id: 'hydra.sides',
    emoji: '⚖️',
    interest: 3,
    compute(games) {
      const list = outcomes(games);
      if (!list.length) return null;
      const blue = list.filter((o) => str(o, 'winner') === 'blue').length;
      return {
        value: blue,
        text: `${ph.role('blue')} wins: ${blue} · ${ph.role('red')} wins: ${list.length - blue}`,
      };
    },
  },
  {
    id: 'hydra.lies',
    emoji: '🤥',
    interest: 3,
    record: 'max',
    compute(games) {
      const best = Math.max(0, ...outcomes(games).map((o) => num(o, 'lies') ?? 0));
      return best ? { value: best, text: `Most lies in one game: ${best}` } : null;
    },
  },
  {
    id: 'hydra.fastest-ascension',
    emoji: '👑',
    interest: 3,
    record: 'min',
    compute(games) {
      const rounds = outcomes(games)
        .filter((o) => str(o, 'how') === 'leader-elected')
        .map((o) => num(o, 'rounds'))
        .filter((n): n is number => n !== undefined);
      if (!rounds.length) return null;
      const best = Math.min(...rounds);
      return { value: best, text: `Fastest ${ph.role('leader')} win: round ${best}` };
    },
  },
  {
    id: 'hydra.longest',
    emoji: '⏳',
    interest: 2,
    record: 'max',
    compute(games) {
      const best = Math.max(0, ...outcomes(games).map((o) => num(o, 'rounds') ?? 0));
      return best ? { value: best, text: `Longest game: ${best} rounds` } : null;
    },
  },
  {
    id: 'hydra.shutouts',
    emoji: '🧹',
    interest: 3,
    record: 'max',
    compute(games) {
      const n = outcomes(games).filter(
        (o) => str(o, 'winner') === 'blue' && num(o, 'redEnacted') === 0,
      ).length;
      return n ? { value: n, text: `${ph.role('blue')} clean sweeps (5–0): ${n}` } : null;
    },
  },
  {
    id: 'hydra.chaos',
    emoji: '🌪️',
    interest: 2,
    compute(games) {
      const n = outcomes(games).reduce((s, o) => s + (num(o, 'chaos') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'chaos top-deck', 'chaos top-decks')}` } : null;
    },
  },
  {
    id: 'hydra.vetoes',
    emoji: '✂️',
    interest: 1,
    compute(games) {
      const n = outcomes(games).reduce((s, o) => s + (num(o, 'vetoes') ?? 0), 0);
      return n ? { value: n, text: `${count(n, 'agenda')} vetoed` } : null;
    },
  },
  {
    id: 'hydra.rrr',
    emoji: '🃏',
    interest: 1,
    compute(games) {
      const n = outcomes(games).reduce((s, o) => s + strs(o, 'rrrBlue').length, 0);
      return n ? { value: n, text: `${count(n, 'all-red draw')} for a ${ph.role('blue')}` } : null;
    },
  },
];

/** "Loyalist policies, 5–3", "the Usurper elected in round 7". */
function history(g: GameEvents): string[] {
  const o = outcomeOf(g);
  if (!o) return [];
  const b = num(o, 'blueEnacted') ?? 0;
  const r = num(o, 'redEnacted') ?? 0;
  const rounds = num(o, 'rounds') ?? 0;
  switch (str(o, 'how')) {
    case 'blue-policies':
      return [`${ph.role('blue')} policies, ${b}–${r}`];
    case 'red-policies':
      return [`${ph.role('red')} policies, ${r}–${b}`];
    case 'leader-executed':
      return [`${ph.role('leader')} executed in round ${rounds}`];
    case 'leader-elected':
      return [`${ph.role('leader')} elected in round ${rounds}`];
    default:
      return [];
  }
}

export const hydraAwards: AwardModule = { rules: HYDRA_RULES, nuggets, history, stripSize: 3 };
