import {
  type AwardCandidate,
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type NuggetRule,
  bool,
  leaders,
  mostBy,
  num,
  ph,
  str,
} from '@vt/game-sdk';

/**
 * Tavern night recap awards for Going Once, read from its `insights` events (`sale`, `unsold`,
 * `bid`, `screw`, `loan`, `outcome`). Text only: no titles, no drawings.
 */

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`;
const sales = (g: GameEvents) => g.of('sale');

/** The player with the best (or worst) single sale, with the amount as `amt`. */
function bestSale(g: GameEvents, score: (profit: number) => number, min: number): AwardCandidate[] {
  const best = new Map<string, number>();
  for (const e of sales(g)) {
    const profit = num(e, 'profit');
    if (!e.playerId || profit === undefined) continue;
    const v = score(profit);
    if (v >= min) best.set(e.playerId, Math.max(best.get(e.playerId) ?? 0, v));
  }
  return leaders(best, { min }).map((c) => ({ ...c, params: { amt: usd(c.value) } }));
}

const rules: AwardRule[] = [
  {
    id: 'go.flip',
    emoji: '💰',
    title: 'Best Flip',
    wholesomeTitle: 'Eye for Art',
    valence: 'glory',
    weight: 5,
    kind: 'moment',
    family: 'profit',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} bought a doodle and made {amt} on it. Thief',
        '{who} turned one sketch into {amt} of profit',
      ],
      wholesome: [
        '{who} spotted a bargain worth {amt} more than paid',
        '{who} saw the value nobody else did: {amt} profit',
      ],
    },
    compute: (g) => bestSale(g, (p) => p, 500),
  },
  {
    id: 'go.overpaid',
    emoji: '🧾',
    title: 'Overpaid',
    wholesomeTitle: 'Patron of the Arts',
    valence: 'chaos',
    weight: 4,
    kind: 'award',
    family: 'blunder',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} paid {amt} over the odds for one drawing',
        '{who} lost {amt} on a single scribble. Collector',
      ],
      wholesome: [
        '{who} paid {amt} extra to support the artist',
        '{who} gave {amt} more than it was worth. Generous',
      ],
    },
    compute: (g) => bestSale(g, (p) => -p, 500),
  },
  {
    id: 'go.loan-shark',
    emoji: '🦈',
    title: 'Loan Shark’s Favourite',
    wholesomeTitle: 'Friend of the Bank',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'money',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} took {n|time} the bank’s money. They’re thrilled',
        '{who} borrowed {n|time}. The bank sends love',
      ],
      wholesome: ['{who} trusted the bank {n|time}', '{who} kept the bank busy: {n} loans'],
    },
    compute: (g) => mostBy(g.of('loan'), undefined, { min: 2 }),
  },
  {
    id: 'go.own-art',
    emoji: '🪞',
    title: 'Bought Own Art',
    wholesomeTitle: 'Self-Collector',
    valence: 'chaos',
    weight: 3,
    kind: 'award',
    family: 'blunder',
    minPlayers: 3,
    copy: {
      cheeky: [
        '{who} bought their own drawing {n|time}. Fan club of one',
        '{who} won their own art {n|time}',
      ],
      wholesome: [
        '{who} believed in their own art {n|time}',
        '{who} took their own drawing home {n|time}',
      ],
    },
    compute: (g) => mostBy(sales(g).filter((e) => bool(e, 'own') === true)),
  },
  {
    id: 'go.screwed-in',
    emoji: '🔩',
    title: 'Screwed Over',
    wholesomeTitle: 'Good Sport',
    valence: 'chaos',
    weight: 2,
    kind: 'award',
    family: 'screw',
    minPlayers: 3,
    copy: {
      cheeky: ['{who} got screwed into buying {n|time}', '{who} was forced to buy {n|time}. Ouch'],
      wholesome: [
        '{who} took a forced buy {n|time} with a smile',
        '{who} was a good sport about {n} forced buys',
      ],
    },
    compute: (g) => mostBy(sales(g).filter((e) => str(e, 'screwedBy') !== undefined)),
  },
];

const nuggets: NuggetRule[] = [
  {
    id: 'go.top-price',
    emoji: '🔨',
    interest: 3,
    record: 'max',
    compute: (games) => {
      const best = Math.max(0, ...games.flatMap((g) => sales(g).map((e) => num(e, 'price') ?? 0)));
      return best > 0
        ? { value: best, text: `Highest price paid for a drawing: ${usd(best)}` }
        : null;
    },
  },
  {
    id: 'go.unsold',
    emoji: '🪧',
    interest: 1,
    compute: (games) => {
      const n = games.reduce((sum, g) => sum + g.of('unsold').length, 0);
      return n >= 2 ? { value: n, text: `${n} drawings went unsold` } : null;
    },
  },
];

/** One line per lot, in order. */
function history(g: GameEvents): string[] {
  return g.events.flatMap((e) => {
    if (e.type === 'unsold') return [`A drawing worth ${usd(num(e, 'value') ?? 0)} went unsold`];
    if (e.type !== 'sale' || !e.playerId) return [];
    const price = num(e, 'price') ?? 0;
    const value = num(e, 'value') ?? 0;
    return [`${ph.p(e.playerId)} paid ${usd(price)} for a drawing worth ${usd(value)}`];
  });
}

export const goingOnceAwards: AwardModule = { rules, nuggets, history };
