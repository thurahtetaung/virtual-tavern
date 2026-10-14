import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  count,
  leaders,
  mostBy,
  nums,
  num,
  ph,
  str,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Tavern Brawl, read from its `insights` events (`play`, `hit`,
 * `heal`, `shield`, `swap`, `social`, `steal`, `ko`, `outcome`). Heroes and cards are only ever
 * ids here: copy uses `{role}` and `{card}`, which the browser names from the private manifest.
 */

const outcome = (g: GameEvents) => g.of('outcome').at(-1);

/** A per-player number from the outcome's seat-ordered arrays. */
function perPlayer(g: GameEvents, key: string): Map<string, number> {
  const o = outcome(g);
  const players = strs(o, 'players');
  const values = nums(o, key);
  return new Map(players.map((p, i) => [p, values[i] ?? 0]));
}

const flagged = (players: string[], value = 1): AwardCandidate[] => {
  const ids = [...new Set(players)].sort();
  return ids.length && ids.length <= 3 ? [{ players: ids, value }] : [];
};

const kosBy = (g: GameEvents) =>
  g
    .of('ko')
    .filter((e) => bool(e, 'self') !== true && bool(e, 'removed') !== true)
    .map((e) => str(e, 'by'))
    .filter((p): p is string => !!p);

const rules: AwardRule[] = [
  {
    id: 'tb.last-standing',
    emoji: '🗡️',
    title: 'Last One Standing',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'wins',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} cleared the room, {n} heroes at a time', '{who} knocked out {n} and won'],
      wholesome: ['{who} won it by besting {n} heroes', '{who} stood tall after {n} knockouts'],
    },
    compute: (g) => {
      const kos = tally(kosBy(g).map((p) => ({ type: 'ko', ts: 0, playerId: p, props: {} })));
      return leaders(kos, { min: 2, among: g.winners });
    },
  },
  {
    id: 'tb.untouchable',
    emoji: '🛡️',
    title: 'Untouchable',
    valence: 'glory',
    weight: 5,
    kind: 'award',
    family: 'wins',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} won without losing a single hit point', '{who} won without a scratch'],
      wholesome: ['{who} never lost a hit point all game', '{who} kept every hit point and won'],
    },
    compute: (g) => {
      if (!outcome(g) || g.winners.length !== 1) return [];
      const w = g.winners[0]!;
      const hurt = g.of('hit').some((e) => str(e, 'target') === w && (num(e, 'hp') ?? 0) > 0);
      return hurt ? [] : [{ players: [w], value: 1 }];
    },
  },
  {
    id: 'tb.own-goal',
    emoji: '💥',
    title: 'Own Goal',
    wholesomeTitle: 'Blaze of Glory',
    valence: 'chaos',
    weight: 4,
    kind: 'moment',
    family: 'knockout',
    minPlayers: 2,
    copy: {
      cheeky: [
        '{who} knocked themselves out. Bold',
        '{who} knocked themselves out with their own card',
      ],
      wholesome: [
        '{who} went out in a blaze of glory',
        '{who} gave it everything, even themselves',
      ],
    },
    compute: (g) =>
      flagged(
        g
          .of('ko')
          .filter((e) => bool(e, 'self') === true && e.playerId)
          .map((e) => e.playerId!),
      ),
  },
  {
    id: 'tb.bad-trade',
    emoji: '🔄',
    title: 'Bad Trade',
    wholesomeTitle: 'Brave Gamble',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'swap',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} swapped hit points and regretted it', '{who} traded down by {n} hit points'],
      wholesome: ['{who} took a brave gamble on a swap', '{who} rolled the dice on a swap'],
    },
    compute: (g) => {
      const losses = new Map<string, number>();
      for (const e of g.of('swap')) {
        const p = e.playerId;
        const lost = (num(e, 'before') ?? 0) - (num(e, 'after') ?? 0);
        if (p && lost > 0 && !g.winners.includes(p)) losses.set(p, (losses.get(p) ?? 0) + lost);
      }
      return leaders(losses, { min: 2 });
    },
  },
  {
    id: 'tb.healer',
    emoji: '❤️',
    title: 'The Healer',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'heal',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} healed {n} hit points. Unkillable vibes', '{who} kept patching: {n} healed'],
      wholesome: ['{who} patched up {n} hit points', '{who} healed {n} hit points with care'],
    },
    compute: (g) =>
      leaders(
        tally(g.of('heal'), undefined, (e) => num(e, 'amount') ?? 0),
        { min: 6 },
      ),
  },
  {
    id: 'tb.shield-wall',
    emoji: '🧱',
    title: 'Shield Wall',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'shield',
    minPlayers: 2,
    copy: {
      cheeky: ['{who}’s shields soaked {n} damage', '{who} hid behind {n} points of shield'],
      wholesome: ['{who} built a wall worth {n}', '{who}’s shields took {n} damage for them'],
    },
    compute: (g) =>
      leaders(
        tally(
          g.of('hit'),
          (e) => str(e, 'target'),
          (e) => num(e, 'shield') ?? 0,
        ),
        { min: 6 },
      ),
  },
  {
    id: 'tb.chain',
    emoji: '⚡',
    title: 'Chain Reaction',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'chain',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} played {n} cards in one turn', '{who} would not stop: {n} cards in a turn'],
      wholesome: ['{who} pulled off a {n}-card combo', '{who} chained {n} cards together'],
    },
    compute: (g) => leaders(perPlayer(g, 'longestChain'), { min: 4 }),
  },
  {
    id: 'tb.big-hit',
    emoji: '🎯',
    title: 'Big Hit',
    valence: 'glory',
    weight: 3,
    kind: 'moment',
    family: 'hit',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} landed a {n}-damage hit', '{who} hit for {n} in one go. Ouch'],
      wholesome: ['{who} struck for {n} in one go', '{who} landed a mighty {n}-point blow'],
    },
    compute: (g) => leaders(perPlayer(g, 'biggestHit'), { min: 5 }),
  },
  {
    id: 'tb.good-sport',
    emoji: '🐺',
    title: 'Good Sport',
    valence: 'gentle',
    weight: 1,
    kind: 'award',
    family: 'social',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} howled on cue {n|time}', '{who} made the noise {n|time}. Neighbours?'],
      wholesome: ['{who} played along {n|time}', '{who} joined in the fun {n|time}'],
    },
    compute: (g) =>
      mostBy(g.of('social').filter((e) => bool(e, 'done') === true && bool(e, 'auto') !== true)),
  },
  {
    id: 'tb.sticky-fingers',
    emoji: '🥷',
    title: 'Sticky Fingers',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'steal',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} borrowed {n} cards. Never returned', '{who} lifted {n} cards from others'],
      wholesome: ['{who} made good use of {n} borrowed cards', '{who} shared {n} of others’ cards'],
    },
    compute: (g) =>
      leaders(
        tally(g.of('steal'), undefined, (e) => num(e, 'count') ?? 0),
        { min: 2 },
      ),
  },
  {
    id: 'tb.haunting',
    emoji: '👻',
    title: 'Haunting',
    valence: 'gentle',
    weight: 3,
    kind: 'award',
    family: 'ghost',
    minPlayers: 5,
    copy: {
      cheeky: ['{who} haunted the table for {n} damage', '{who} kept swinging after the end: {n}'],
      wholesome: [
        '{who} kept fighting as a ghost: {n} damage',
        '{who} never really left: {n} damage',
      ],
    },
    compute: (g) =>
      leaders(
        tally(
          g.of('hit').filter((e) => bool(e, 'ghost') === true),
          undefined,
          (e) => (num(e, 'hp') ?? 0) + (num(e, 'shield') ?? 0),
        ),
        { min: 2 },
      ),
  },
  {
    id: 'tb.puppet-master',
    emoji: '🕹️',
    title: 'Puppet Master',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'control',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} steered {n} attacks somewhere else', '{who} pulled the strings {n|time}'],
      wholesome: ['{who} redirected {n} attacks with flair', '{who} called the shots {n|time}'],
    },
    compute: (g) => mostBy(g.of('redirect'), undefined, { min: 2 }),
  },
  {
    id: 'tb.shield-breaker',
    emoji: '🔨',
    title: 'Shield Breaker',
    valence: 'glory',
    weight: 2,
    kind: 'award',
    family: 'shield',
    minPlayers: 2,
    copy: {
      cheeky: ['{who} smashed {n} shields to bits', '{who} broke {n} shields. Nothing was safe'],
      wholesome: ['{who} broke through {n} shields', '{who} cleared the way through {n} shields'],
    },
    compute: (g) =>
      mostBy(
        g.of('shield').filter((e) => str(e, 'owner') !== e.playerId),
        undefined,
        { min: 3 },
      ),
  },
];

const allGames = (games: readonly GameEvents[], type: string) => games.flatMap((g) => g.of(type));

const best = (games: readonly GameEvents[], key: string) =>
  Math.max(0, ...games.flatMap((g) => nums(outcome(g), key)));

const nuggets: NuggetRule[] = [
  {
    id: 'tb.biggest-hit',
    emoji: '🎯',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const n = best(games, 'biggestHit');
      return n >= 3 ? { value: n, text: `Biggest single hit: ${n} damage` } : null;
    },
  },
  {
    id: 'tb.longest-chain',
    emoji: '⚡',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const n = best(games, 'longestChain');
      return n >= 3 ? { value: n, text: `Longest chain: ${n} cards in one turn` } : null;
    },
  },
  {
    id: 'tb.fastest-win',
    emoji: '⏱️',
    interest: 2,
    record: 'min',
    compute: (games) => {
      const turns = games
        .map((g) => outcome(g))
        .filter((o) => o && strs(o, 'players').length > 0 && bool(o, 'tie') !== true)
        .map((o) => num(o, 'turns') ?? 0)
        .filter((n) => n > 0);
      if (!turns.length) return null;
      const n = Math.min(...turns);
      return { value: n, text: `Fastest win: ${count(n, 'turn')}` };
    },
  },
  {
    id: 'tb.healed',
    emoji: '❤️',
    interest: 1,
    compute: (games) => {
      const n = allGames(games, 'heal').reduce((t, e) => t + (num(e, 'amount') ?? 0), 0);
      return n >= 5 ? { value: n, text: `${n} hit points healed` } : null;
    },
  },
  {
    id: 'tb.absorbed',
    emoji: '🛡️',
    interest: 1,
    compute: (games) => {
      const n = allGames(games, 'hit').reduce((t, e) => t + (num(e, 'shield') ?? 0), 0);
      return n >= 5 ? { value: n, text: `Shields soaked ${n} damage` } : null;
    },
  },
];

/** "{p:x} won with {role:mage} · 3 KOs · 14 turns". */
function history(g: GameEvents): string[] {
  const o = outcome(g);
  if (!o) return [];
  const players = strs(o, 'players');
  const heroes = strs(o, 'heroes');
  const turns = num(o, 'turns') ?? 0;
  if (!g.winners.length) return [`Everyone was knocked out: a tie after ${count(turns, 'turn')}`];
  const w = g.winners[0]!;
  const hero = heroes[players.indexOf(w)];
  const kos = kosBy(g).filter((p) => p === w).length;
  return [
    `${ph.p(w)} won${hero ? ` with ${ph.role(hero)}` : ''} · ${count(kos, 'KO')} · ${count(turns, 'turn')}`,
  ];
}

export const tavernBrawlAwards: AwardModule = { rules, nuggets, stripSize: 2, history };
