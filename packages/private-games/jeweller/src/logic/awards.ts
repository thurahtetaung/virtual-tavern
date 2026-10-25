import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  num,
  nums,
  ph,
  strs,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Jeweller, read from its `insights` events (`take`, `reserve`,
 * `buy`, `return`, `noble`, `final`, `outcome`). Nothing here names a card or a noble.
 */

const buys = (g: GameEvents) => g.of('buy');
const outcome = (g: GameEvents) => g.of('outcome').at(-1);

const rules: AwardRule[] = [
  {
    id: 'jw.noble-magnet',
    emoji: '👑',
    title: 'Noble Magnet',
    wholesomeTitle: 'Court Favourite',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'nobles',
    copy: {
      cheeky: [
        '{who} had {n} nobles calling. Popular much?',
        '{n} nobles dropped by for {who}. Name-dropper',
      ],
      wholesome: ['{who} won over {n} nobles', '{n} nobles came to visit {who}'],
    },
    compute: (g) => mostBy(g.of('noble'), undefined, { min: 2 }),
  },
  {
    id: 'jw.lean-win',
    emoji: '🪶',
    title: 'Travelling Light',
    valence: 'glory',
    weight: 4,
    kind: 'award',
    family: 'result',
    copy: {
      cheeky: ['{who} won with just {n} cards. Minimalist', 'Only {n} cards, and {who} still won'],
      wholesome: ['{who} won with only {n} cards', '{who} needed just {n} cards to win'],
    },
    compute: (g) => {
      const out = outcome(g);
      const ranking = strs(out, 'ranking');
      const cards = nums(out, 'cards');
      const winners = strs(out, 'winners');
      if (winners.length !== 1 || cards.length !== ranking.length) return [];
      const at = ranking.indexOf(winners[0]!);
      const mine = cards[at];
      // Fewer cards than everyone else at the table.
      if (mine === undefined || cards.some((c, i) => i !== at && c <= mine)) return [];
      return [{ players: [winners[0]!], value: mine }];
    },
  },
  {
    id: 'jw.big-buy',
    emoji: '💰',
    title: 'Big Spender',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'buy',
    copy: {
      cheeky: ['{who} paid {n} pieces for one card. Splurge', '{who} dropped {n} pieces in one go'],
      wholesome: ['{who} saved up {n} pieces for one card', '{who} made a {n}-piece purchase'],
    },
    compute: (g) => {
      const best = new Map<string, number>();
      for (const e of buys(g)) {
        const paid = num(e, 'paid');
        if (!e.playerId || paid === undefined) continue;
        best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, paid));
      }
      return leaders(best, { min: 6 });
    },
  },
  {
    id: 'jw.free-lunch',
    emoji: '🎁',
    title: 'Free Lunch',
    wholesomeTitle: 'Clever Discounts',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    family: 'buy',
    copy: {
      cheeky: ['{who} got {n} cards for free. Shameless', '{who} paid nothing, {n|time}'],
      wholesome: [
        '{who} bought {n} cards with discounts alone',
        'Discounts paid {n|time} for {who}',
      ],
    },
    compute: (g) =>
      mostBy(
        buys(g).filter((e) => bool(e, 'free') === true),
        undefined,
        { min: 2 },
      ),
  },
  {
    id: 'jw.gold-hoarder',
    emoji: '🪙',
    title: 'Gold Hoarder',
    valence: 'gentle',
    weight: 2,
    kind: 'award',
    family: 'reserve',
    copy: {
      cheeky: ['{who} reserved {n} cards. All for the gold?', '{who} kept {n} cards up a sleeve'],
      wholesome: ['{who} planned ahead with {n} reserves', '{who} set aside {n} cards for later'],
    },
    compute: (g) =>
      mostBy(
        g.of('reserve').filter((e) => bool(e, 'auto') !== true),
        undefined,
        { min: 3 },
      ),
  },
  {
    id: 'jw.overflow',
    emoji: '🫗',
    title: 'Pockets Overflowing',
    wholesomeTitle: 'Generous Returns',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'blunder',
    copy: {
      cheeky: [
        '{who} handed back {n} pieces. Butterfingers',
        '{who} took too much and gave {n} back',
      ],
      wholesome: [
        '{who} shared {n} pieces back with the bank',
        '{who} kept the bank stocked: {n} back',
      ],
    },
    compute: (g) => {
      const back = new Map<string, number>();
      for (const e of g.of('return')) {
        const n = num(e, 'count');
        if (!e.playerId || n === undefined || bool(e, 'auto') === true) continue;
        back.set(e.playerId, (back.get(e.playerId) ?? 0) + n);
      }
      return leaders(back, { min: 3 });
    },
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'jw.top-score',
    emoji: '💎',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(0, ...games.flatMap((g) => nums(outcome(g), 'scores')));
      return best > 0 ? { value: best, text: `Highest score: ${best} points` } : null;
    },
  },
  {
    id: 'jw.cards-bought',
    emoji: '🃏',
    interest: 2,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + buys(g).length, 0);
      return n >= 10 ? { value: n, text: `${n} cards bought` } : null;
    },
  },
];

/** One line per noble visit, then who triggered the final round. */
function history(g: GameEvents): string[] {
  const lines = g
    .of('noble')
    .map((e) => (e.playerId ? `A noble visited ${ph.p(e.playerId)}` : 'A noble visited'));
  const final = g.of('final')[0];
  if (final?.playerId)
    lines.push(`${ph.p(final.playerId)} reached ${num(final, 'points') ?? 0} points`);
  return lines;
}

export const jewellerAwards: AwardModule = { rules, nuggets, history };
