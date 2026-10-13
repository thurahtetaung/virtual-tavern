import { type BotCtx, type PlayerId, pickOne } from '@vt/game-sdk';
import { CARDS, symbolCount } from './cards.ts';
import type {
  CardDef,
  CardRef,
  ChoiceView,
  GameView,
  PlayerView,
  TavernBrawlAction,
  TavernBrawlView,
} from './types.ts';

/**
 * Playtest bots: simple, legal and view-only. They pick a hero, play the best-looking card and
 * answer their own questions sensibly; social prompts are always "done".
 */

const shieldLeft = (p: PlayerView) => p.shields.reduce((n, sh) => n + sh.left, 0);
const effective = (p: PlayerView) => p.hp + shieldLeft(p);

function scoreCard(def: CardDef, me: PlayerView, g: GameView, handDefs: CardDef[]): number {
  const opps = g.players.filter((p) => !p.out && p.id !== me.id);
  const reachable = opps.filter((p) => !p.disguised);
  const low = me.hp <= 4 && me.shields.length === 0;
  const atk = symbolCount(def, 'atk') + (def.attack ? g.turn.bonus : 0);
  let score = 0;
  if (atk > 0) {
    score += reachable.length > 0 ? atk * 2 : 0;
    if (reachable.some((p) => effective(p) <= atk)) score += 6;
  }
  score += symbolCount(def, 'heal') * (low ? 3 : me.hp >= 10 ? 0 : 1);
  score += symbolCount(def, 'shd') * (low ? 3 : 1.5);
  score += symbolCount(def, 'play') * 3;
  score += symbolCount(def, 'draw');
  const oppShields = reachable.flatMap((p) => p.shields);
  switch (def.effect) {
    case 'damageAll3': {
      const kills = reachable.filter((p) => effective(p) <= 3).length;
      // Never blow yourself up unless it wins.
      if (effective(me) <= 3 && kills < reachable.length) return -100;
      score += 4 + kills * 5;
      break;
    }
    case 'swapHpWithOpp': {
      const best = Math.max(0, ...reachable.map((p) => p.hp));
      score += (best - me.hp) * 2;
      break;
    }
    case 'stealShield':
      score += oppShields.length > 0 ? 4 + Math.max(...oppShields.map((s) => s.left)) : -1;
      break;
    case 'destroyOneShield':
      score += oppShields.length > 0 ? 3 : g.players.some((p) => p.shields.length) ? -3 : 0;
      break;
    case 'destroyAllShields':
      score += oppShields.reduce((n, s) => n + s.left, 0) - shieldLeft(me);
      break;
    case 'rotateHpRight': {
      const ring = g.order.filter((id) => {
        const p = g.players.find((q) => q.id === id)!;
        return !p.out && (p.id === me.id || !p.disguised);
      });
      const next = ring[(ring.indexOf(me.id) + 1) % ring.length];
      const gets = g.players.find((p) => p.id === next)?.hp ?? me.hp;
      score += (gets - me.hp) * 2;
      break;
    }
    case 'attackBonus':
      score += 2 + handDefs.filter((d) => d.attack).length;
      break;
    case 'disguise':
      score += low ? 6 : 2;
      break;
    case 'healPerOppThenHitEach':
    case 'howlThenHitEach':
      score += 2 + reachable.length * 2;
      break;
    case 'allDiscardDraw3':
    case 'playOpponentTop':
    case 'drawFromEachOpp':
    case 'takeFromDiscard':
    case 'formBear':
    case 'formWolf':
    case 'freeFormPlay':
      score += 3;
      break;
    case null:
      break;
  }
  return score;
}

function answerChoice(c: ChoiceView, g: GameView, me: PlayerView, ctx: BotCtx): string | null {
  const byId = (id: PlayerId) => g.players.find((p) => p.id === id);
  const shieldOf = (id: string) =>
    g.players
      .flatMap((p) => p.shields.map((sh) => ({ ...sh, holder: p.id })))
      .find((sh) => sh.id === id);
  const options = c.options;
  switch (c.kind) {
    case 'social':
      return 'done';
    case 'form':
      return options.find((o) => o !== 'skip') ?? 'skip';
    case 'target': {
      const players = options.filter((o) => byId(o));
      const sorted = players.sort((a, b) => effective(byId(a)!) - effective(byId(b)!));
      return sorted[0] ?? pickOne(ctx.rng, options) ?? null;
    }
    case 'shield': {
      const sorted = [...options].sort(
        (a, b) => (shieldOf(a)?.left ?? 0) - (shieldOf(b)?.left ?? 0),
      );
      return sorted[0] ?? null;
    }
    case 'destroy':
    case 'charm': {
      const theirs = options.filter((o) => shieldOf(o)?.holder !== me.id);
      const pool = theirs.length > 0 ? theirs : options;
      return (
        [...pool].sort((a, b) => (shieldOf(b)?.left ?? 0) - (shieldOf(a)?.left ?? 0))[0] ?? null
      );
    }
    case 'swap':
      return [...options].sort((a, b) => (byId(b)?.hp ?? 0) - (byId(a)?.hp ?? 0))[0] ?? null;
    case 'pickpocket':
      return (
        [...options].sort((a, b) => (byId(b)?.deckCount ?? 0) - (byId(a)?.deckCount ?? 0))[0] ??
        null
      );
    case 'recover': {
      const me2 = me.discard;
      const value = (id: string) => {
        const card = me2.find((r) => r.id === id);
        const def = card ? CARDS[card.card] : undefined;
        return def
          ? symbolCount(def, 'atk') * 2 + symbolCount(def, 'play') * 2 + (def.effect ? 3 : 0)
          : 0;
      };
      return [...options].sort((a, b) => value(b) - value(a))[0] ?? null;
    }
  }
}

export function tavernBrawlBot(view: TavernBrawlView, ctx: BotCtx): TavernBrawlAction | null {
  const seat = view.me;
  if (view.phase === 'lobby') {
    if (!seat) return null;
    if (!seat.playing) {
      if (seat.waiting) return null;
      return view.seats.filter((s) => s.playing).length < 4 ? { type: 'sit', playing: true } : null;
    }
    return seat.hero ? null : { type: 'pick-hero', hero: 'random' };
  }
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  const me = g.players.find((p) => p.id === ctx.me);
  if (!me || me.out) return null;
  const c = g.choice;
  if (c) {
    if (c.chooser !== ctx.me) return null;
    const pick = answerChoice(c, g, me, ctx);
    return pick === null ? null : { type: 'choose', choice: c.id, pick };
  }
  if (g.turn.player !== ctx.me || g.resolving.length > 0 || g.turn.debt <= 0) return null;
  const hand: CardRef[] = view.hand;
  if (hand.length === 0) return null;
  const defs = hand.map((r) => CARDS[r.card]!);
  let best: CardRef[] = [];
  let top = -Infinity;
  hand.forEach((r, i) => {
    const score = scoreCard(defs[i]!, me, g, defs);
    if (score > top) {
      top = score;
      best = [r];
    } else if (score === top) best.push(r);
  });
  const card = pickOne(ctx.rng, best) ?? hand[0]!;
  return { type: 'play', card: card.id };
}
