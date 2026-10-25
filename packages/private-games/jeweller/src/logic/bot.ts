import { type BotCtx, chance } from '@vt/game-sdk';
import { type CardDef, cardOf, nobleOf } from './cards.ts';
import {
  canAfford,
  canReserve,
  canTake,
  colorsIn,
  costAfter,
  differentToTake,
  noPieces,
  shortfall,
  totalOf,
} from './rules.ts';
import {
  DOUBLE_MIN,
  GEMS,
  type Gem,
  type JewellerAction,
  type JewellerView,
  LEVELS,
  MAX_RESERVED,
  type Pieces,
  type PlayerView,
  TOKEN_LIMIT,
  TOKENS,
  type Token,
} from './types.ts';

/**
 * Three greedy styles, each seat keeping one for the game: `points` chases points per piece,
 * `noble` steers its bonuses toward a noble, `engine` buys cheap cards early for discounts.
 */
export type BotStyle = 'points' | 'noble' | 'engine';
const STYLES: readonly BotStyle[] = ['points', 'noble', 'engine'];

export function styleOf(id: string): BotStyle {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return STYLES[h % STYLES.length]!;
}

const WEIGHTS: Record<BotStyle, { points: number; noble: number; engine: number }> = {
  points: { points: 3, noble: 0.6, engine: 0.3 },
  noble: { points: 1.5, noble: 2, engine: 0.6 },
  engine: { points: 1.2, noble: 0.8, engine: 1.5 },
};

/** How much a card's bonus helps toward the nobles still on the table. */
function nobleHelp(card: CardDef, nobles: readonly string[], bonuses: Record<Gem, number>) {
  return nobles.reduce((n, id) => {
    const need = nobleOf(id).requires[card.bonus] - bonuses[card.bonus];
    return n + (need > 0 ? 1 / Math.max(1, need) : 0);
  }, 0);
}

/** How much a card is worth to this seat: points, noble progress and the discount itself. */
function worth(card: CardDef, me: PlayerView, view: JewellerView, style: BotStyle) {
  const w = WEIGHTS[style];
  const g = view.game!;
  const pieces = totalOf(costAfter(card, me.bonuses));
  // Late in the game, points matter most.
  const late = me.points >= view.settings.target - 5 ? 2 : 1;
  return (
    (card.points * w.points * late) / Math.max(1, pieces / 3) +
    nobleHelp(card, g.nobles, me.bonuses) * w.noble +
    (card.level === 1 ? 1 : card.level === 2 ? 0.5 : 0) * w.engine
  );
}

/** Cards the seat could buy: face up, and its own reserved ones. */
function candidates(view: JewellerView, me: PlayerView): string[] {
  const g = view.game!;
  return [
    ...LEVELS.flatMap((l) => g.market[l].filter((c): c is string => c !== null)),
    ...me.reserved.flatMap((r) => (r.card ? [r.card] : [])),
  ];
}

/** Gems to take toward the colours a target still needs (gold covers some of them). */
function gemsToward(bank: Pieces, need: Record<Gem, number>): Gem[] {
  const short = GEMS.filter((gem) => need[gem] > 0).sort((a, b) => need[b] - need[a]);
  const n = differentToTake(bank);
  // Two of one colour when that is all it lacks.
  const double = short.find((gem) => need[gem] >= 2 && bank[gem] >= DOUBLE_MIN);
  const helpful = short.filter((gem) => bank[gem] > 0);
  if (double && helpful.length < 2) return [double, double];
  if (n === 0) return [];
  const rest = colorsIn(bank)
    .filter((gem) => !helpful.includes(gem))
    .sort((a, b) => bank[b] - bank[a]);
  return [...helpful, ...rest].slice(0, n);
}

/** Pieces to hand back: those the target needs least, gold last. */
function returnFor(tokens: Pieces, need: Record<Gem, number>, over: number): Pieces {
  const left = { ...tokens };
  const back = noPieces();
  for (let i = 0; i < over; i++) {
    const spare = (t: Token) => left[t] - (t === 'gold' ? Infinity : need[t]);
    const t = [...TOKENS]
      .filter((x) => left[x] > 0)
      .sort((a, b) => spare(b) - spare(a) || left[b] - left[a])[0]!;
    left[t] -= 1;
    back[t] += 1;
  }
  return back;
}

/**
 * A playtest bot, from its own view only (others' reserved cards stay hidden to it): it buys the
 * best card it can afford, else takes gems toward the card nearest its reach, reserves a card
 * that would win a rival the game (or one it wants, for the gold) and passes only with no move.
 */
export function jewellerBot(view: JewellerView, ctx: BotCtx): JewellerAction | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g || g.current !== ctx.me) return null;
  const me = g.players.find((p) => p.id === ctx.me);
  if (!me) return null;
  const style = styleOf(ctx.me);
  const ids = candidates(view, me);
  const value = (id: string) => worth(cardOf(id), me, view, style);
  // The target: the most worth for the fewest pieces still missing.
  const missing = (id: string) =>
    Math.max(0, totalOf(shortfall(cardOf(id), me.bonuses, me.tokens)) - me.tokens.gold);
  const target = [...ids].sort(
    (a, b) => missing(a) - value(a) * 1.5 - (missing(b) - value(b) * 1.5),
  )[0];
  const need = target ? costAfter(cardOf(target), me.bonuses) : { ...noPieces() };

  if (g.stage === 'noble')
    return g.nobleChoice[0] ? { type: 'noble', noble: g.nobleChoice[0] } : null;
  if (g.stage === 'return') {
    const over = totalOf(me.tokens) - TOKEN_LIMIT;
    return { type: 'return', tokens: returnFor(me.tokens, need, over) };
  }

  const affordable = ids.filter((id) => canAfford(cardOf(id), me.bonuses, me.tokens));
  const best = [...affordable].sort((a, b) => value(b) - value(a))[0];
  if (best) {
    const c = cardOf(best);
    const worthIt =
      c.points > 0 || style === 'engine' || totalOf(me.tokens) >= 7 || chance(ctx.rng, 0.6);
    if (worthIt) return { type: 'buy', card: best };
  }

  const reserveOk = canReserve(me.reserved.length, g.market, g.decks);
  // Block a card a rival could buy now that would reach the target.
  if (reserveOk && me.reserved.length < MAX_RESERVED - 1) {
    const threat = LEVELS.flatMap((l) => g.market[l]).find(
      (id) =>
        id !== null &&
        g.players.some(
          (p) =>
            p.id !== me.id &&
            p.points + cardOf(id).points >= view.settings.target &&
            canAfford(cardOf(id), p.bonuses, p.tokens),
        ),
    );
    if (threat) return { type: 'reserve', card: threat };
  }

  const short = target ? shortfall(cardOf(target), me.bonuses, me.tokens) : noPieces();
  const gems = canTake(g.bank) ? gemsToward(g.bank, short) : [];
  const full = totalOf(me.tokens) >= TOKEN_LIMIT - 1;
  // Near the limit with a target in sight: reserve it for the gold instead of churning gems.
  if (
    reserveOk &&
    target &&
    (full || gems.length === 0) &&
    !me.reserved.some((r) => r.card === target)
  ) {
    if (g.market[cardOf(target).level].includes(target)) return { type: 'reserve', card: target };
  }
  if (gems.length) return { type: 'take', gems };
  if (reserveOk) {
    const level = LEVELS.find((l) => g.decks[l] > 0);
    if (level) return { type: 'reserve', level };
    const card = LEVELS.flatMap((l) => g.market[l]).find((c): c is string => c !== null);
    if (card) return { type: 'reserve', card };
  }
  if (best) return { type: 'buy', card: best };
  return { type: 'pass' };
}
