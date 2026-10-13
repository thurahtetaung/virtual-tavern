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
  mostBy,
  num,
  ph,
  str,
  strs,
  tally,
} from '@vt/game-sdk';

/**
 * Short Fuse's night-recap awards, read from its own insight events (see `insights.ts`). Cards go
 * out as `{card:<type>}` placeholders, which the browser names from the private manifest.
 */

const outcomeOf = (g: GameEvents): RecapEvent | undefined => g.of('outcome').at(-1);
const one = (id: string | undefined | null, value = 1, params?: AwardCandidate['params']) =>
  id ? [{ players: [id], value, ...(params ? { params } : {}) }] : [];

const firstToGo: AwardRule = {
  id: 'short-fuse.first-to-go',
  emoji: '💥',
  title: 'First to Go',
  valence: 'chaos',
  weight: 3,
  kind: 'award',
  family: 'boom',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} lit up the room first, on turn {n}', '{who} went boom first (turn {n})'],
    wholesome: ['{who} took one for the team on turn {n}', '{who} cleared the way, turn {n}'],
  },
  compute(g) {
    const first = g.of('explode')[0];
    return one(first?.playerId, num(first, 'turn') ?? 1);
  },
};

const bombSquad: AwardRule = {
  id: 'short-fuse.bomb-squad',
  emoji: '✂️',
  title: 'Bomb Squad',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'defuse',
  copy: {
    cheeky: ['{who} snipped {n} wires and lived', '{who} defused {n} bombs. Show-off'],
    wholesome: ['{who} kept calm and defused {n} times', '{who} stayed cool through {n} bombs'],
  },
  compute(g) {
    return mostBy(
      g.of('bomb').filter((e) => str(e, 'saved') === 'defuse'),
      undefined,
      { min: 2 },
    );
  },
};

const nopeMachine: AwardRule = {
  id: 'short-fuse.nope-machine',
  emoji: '🙅',
  title: 'Nope Machine',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'nope',
  copy: {
    cheeky: ['{who} said {card} {n} times. Rude', '{who} played {n} of {card}. Nobody was safe'],
    wholesome: ['{who} protected the table {n} times', '{who} stepped in {n} times with {card}'],
  },
  compute(g) {
    return mostBy(g.of('nope'), undefined, { min: 2 }).map((c) => ({
      ...c,
      params: { card: 'nope' },
    }));
  },
};

const nopeWar: AwardRule = {
  id: 'short-fuse.nope-war',
  emoji: '🔁',
  title: 'Nope War',
  valence: 'glory',
  weight: 4,
  kind: 'moment',
  family: 'nope',
  copy: {
    cheeky: ['{who} won a {n}-deep {card} war', '{who} survived {n} rounds of {card}'],
    wholesome: ['{who} saw a play through {n} counters', '{who} stood firm through {n} counters'],
  },
  compute(g) {
    const best = g
      .of('yup')
      .reduce<RecapEvent | undefined>(
        (b, e) => ((num(e, 'chain') ?? 0) > (num(b, 'chain') ?? 0) ? e : b),
        undefined,
      );
    const n = num(best, 'chain') ?? 0;
    return n >= 2 ? one(best?.playerId, n, { card: 'nope' }) : [];
  },
};

const returnToSender: AwardRule = {
  id: 'short-fuse.return-to-sender',
  emoji: '🎯',
  title: 'Return to Sender',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'placement',
  minPlayers: 3,
  copy: {
    cheeky: [
      '{who} gift-wrapped a bomb for someone ({n|time})',
      '{who} hid a bomb and it found a target',
    ],
    wholesome: ['{who} placed it perfectly ({n|time})', '{who} hid a bomb just right'],
  },
  compute(g) {
    return leaders(
      tally(g.of('explode'), (e) => str(e, 'placedBy') ?? null),
      { min: 1 },
    );
  },
};

const catBurglar: AwardRule = {
  id: 'short-fuse.cat-burglar',
  emoji: '🐈',
  title: 'Cat Burglar',
  valence: 'glory',
  weight: 3,
  kind: 'award',
  family: 'steal',
  copy: {
    cheeky: ['{who} pickpocketed {n} cards', '{who} lifted {n} cards from friends'],
    wholesome: ['{who} collected {n} cards with combos', '{who} found {n} cards in other hands'],
  },
  compute(g) {
    return mostBy(
      g.of('steal').filter((e) => str(e, 'how') !== 'favor' && bool(e, 'hit') === true),
      undefined,
      { min: 2 },
    );
  },
};

const targetPractice: AwardRule = {
  id: 'short-fuse.target-practice',
  emoji: '🧲',
  title: 'Target Practice',
  valence: 'chaos',
  weight: 3,
  kind: 'award',
  family: 'attack',
  copy: {
    cheeky: ['{who} owed {n} turns at once. Everyone noticed', '{who} got piled on: {n} turns'],
    wholesome: ['{who} faced a {n}-turn pile-on', '{who} shouldered {n} turns in a row'],
  },
  compute(g) {
    const o = outcomeOf(g);
    const n = num(o, 'maxOwed') ?? 0;
    return n >= 4 ? one(str(o, 'maxOwedBy'), n) : [];
  },
};

const fortuneTeller: AwardRule = {
  id: 'short-fuse.fortune-teller',
  emoji: '🔮',
  title: 'Fortune Teller',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'peek',
  copy: {
    cheeky: ['{who} read the future {n} times', '{who} peeked {n} times. Trust issues'],
    wholesome: ['{who} always knew what was coming ({n})', '{who} looked ahead {n} times'],
  },
  compute(g) {
    return mostBy(
      g.of('play').filter((e) => {
        const c = strs(e, 'cards');
        return str(e, 'kind') === 'card' && (c[0] === 'peek3' || c[0] === 'alter3');
      }),
      undefined,
      { min: 3 },
    );
  },
};

const cleanHands: AwardRule = {
  id: 'short-fuse.clean-hands',
  emoji: '😇',
  title: 'Clean Hands',
  valence: 'glory',
  weight: 4,
  kind: 'award',
  family: 'win',
  minPlayers: 3,
  copy: {
    cheeky: ['{who} never needed a {card}. Smug', '{who} won without a single {card}'],
    wholesome: ['{who} won it clean, no {card} needed', '{who} won with every {card} unused'],
  },
  compute(g) {
    const winner = g.winners[0];
    if (!winner) return [];
    const used = g.of('bomb').some((e) => e.playerId === winner && str(e, 'saved') === 'defuse');
    return used ? [] : one(winner, 1, { card: 'defuse' });
  },
};

const soClose: AwardRule = {
  id: 'short-fuse.so-close',
  emoji: '🫣',
  title: 'So Close',
  valence: 'chaos',
  weight: 3,
  kind: 'moment',
  family: 'boom',
  copy: {
    cheeky: ['{who} went boom with {n} cards to go', '{who} blew up {n} cards from the end'],
    wholesome: ['{who} nearly made it: {n} cards left', '{who} got within {n} cards of safety'],
  },
  compute(g) {
    const hits = g
      .of('explode')
      .filter((e) => (num(e, 'left') ?? 99) <= 3)
      .sort((a, b) => (num(a, 'left') ?? 0) - (num(b, 'left') ?? 0));
    const e = hits[0];
    return e ? one(e.playerId, num(e, 'left') ?? 0) : [];
  },
};

const eventHorizon: AwardRule = {
  id: 'short-fuse.event-horizon',
  emoji: '🕳️',
  title: 'Event Horizon',
  valence: 'chaos',
  weight: 3,
  kind: 'moment',
  family: 'boom',
  copy: {
    cheeky: [
      '{who} saw {card} coming and drew it on turn {n}',
      '{who} fell into {card} (turn {n})',
    ],
    wholesome: ['{who} braved {card} on turn {n}', '{who} met {card} head-on, turn {n}'],
  },
  compute(g) {
    const e = g.of('explode').find((x) => str(x, 'kind') === 'void');
    return e ? one(e.playerId, num(e, 'turn') ?? 1, { card: 'void' }) : [];
  },
};

const secretSanta: AwardRule = {
  id: 'short-fuse.secret-santa',
  emoji: '🎁',
  title: 'Secret Santa',
  valence: 'gentle',
  weight: 2,
  kind: 'award',
  family: 'steal',
  copy: {
    cheeky: ['{who} gave away {n} cards. Generous or naive?', '{who} handed over {n} cards'],
    wholesome: ['{who} shared {n} cards tonight', '{who} was generous {n|time}'],
  },
  compute(g) {
    return mostBy(
      g.of('steal').filter((e) => str(e, 'how') === 'favor'),
      (e) => str(e, 'victim') ?? null,
      { min: 2 },
    );
  },
};

const sleepwalker: AwardRule = {
  id: 'short-fuse.sleepwalker',
  emoji: '😴',
  title: 'Sleepwalker',
  valence: 'gentle',
  weight: 1,
  kind: 'award',
  family: 'timeout',
  stripOnly: true,
  copy: {
    cheeky: ['{who} let the clock play {n} moves', '{who} napped through {n} decisions'],
    wholesome: ['{who} took it slow ({n} moves made for them)', '{who} let fate decide {n|time}'],
  },
  compute(g) {
    return mostBy(g.of('timeout'), undefined, { min: 2 });
  },
};

const outcomes = (games: readonly GameEvents[]) =>
  games.flatMap((g) => (outcomeOf(g) ? [outcomeOf(g)!] : []));

const nuggets: NuggetRule[] = [
  {
    id: 'short-fuse.booms',
    emoji: '💥',
    interest: 3,
    compute(games) {
      const n = games.reduce((s, g) => s + g.of('explode').length, 0);
      return n ? { value: n, text: `${count(n, 'explosion')} tonight` } : null;
    },
  },
  {
    id: 'short-fuse.longest-chain',
    emoji: '🙅',
    interest: 3,
    record: 'max',
    compute(games) {
      const best = Math.max(0, ...outcomes(games).map((o) => num(o, 'longestChain') ?? 0));
      return best >= 2 ? { value: best, text: `Longest ${ph.card('nope')} chain: ${best}` } : null;
    },
  },
  {
    id: 'short-fuse.pile-on',
    emoji: '🧲',
    interest: 2,
    record: 'max',
    compute(games) {
      const best = Math.max(0, ...outcomes(games).map((o) => num(o, 'maxOwed') ?? 0));
      return best >= 3 ? { value: best, text: `Most turns owed at once: ${best}` } : null;
    },
  },
  {
    id: 'short-fuse.quickest',
    emoji: '⏱️',
    interest: 2,
    record: 'min',
    compute(games) {
      const turns = outcomes(games)
        .map((o) => num(o, 'turns'))
        .filter((n): n is number => n !== undefined && n > 0);
      if (!turns.length) return null;
      const best = Math.min(...turns);
      return { value: best, text: `Quickest game: ${best} turns` };
    },
  },
  {
    id: 'short-fuse.defuses',
    emoji: '✂️',
    interest: 1,
    compute(games) {
      const n = games.reduce(
        (s, g) => s + g.of('bomb').filter((e) => str(e, 'saved') === 'defuse').length,
        0,
      );
      return n ? { value: n, text: `${ph.card('defuse')} used: ${n}` } : null;
    },
  },
];

export const shortFuseAwards: AwardModule = {
  rules: [
    firstToGo,
    bombSquad,
    nopeMachine,
    nopeWar,
    returnToSender,
    catBurglar,
    targetPractice,
    fortuneTeller,
    cleanHands,
    soClose,
    eventHorizon,
    secretSanta,
    sleepwalker,
  ],
  nuggets,
  history(g) {
    const o = outcomeOf(g);
    if (!o) return [];
    const booms = g.of('explode').length;
    return [`${booms} 💥 · ${count(num(o, 'turns') ?? 0, 'turn')}`];
  },
};
