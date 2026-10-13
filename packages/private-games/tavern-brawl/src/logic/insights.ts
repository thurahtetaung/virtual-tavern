import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import { CARDS } from './cards.ts';
import type { TavernBrawlAction, TavernBrawlState } from './types.ts';

/**
 * Stats only: cards played, damage, heals, shields broken, hit-point swaps, social prompts,
 * stolen cards, knockouts and the result. Read from the public log entries this change added, so
 * nothing private (hands, decks, cards taken in secret) is ever reported. Cards and heroes are
 * ids; the stats page and the recap name them from the private manifest.
 */
export function insights(
  before: TavernBrawlState,
  after: TavernBrawlState,
  _action: TavernBrawlAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const g = after.game;
  if (!g) return [];
  const heroOf = (p: PlayerId) => g.players[p]?.hero ?? null;
  const events: InsightEvent[] = [];
  for (const entry of after.log) {
    if (entry.id <= before.seq) continue;
    switch (entry.kind) {
      case 'play':
        events.push({
          type: 'play',
          playerId: entry.by,
          props: {
            card: entry.card,
            hero: CARDS[entry.card]?.hero ?? null,
            stolen: entry.stolen === true || entry.owner !== entry.by,
            free: entry.free === true,
            auto: entry.auto !== undefined || by === null,
            turn: entry.turn,
          },
        });
        break;
      case 'damage':
        if (entry.hp + entry.shield === 0) break;
        events.push({
          type: 'hit',
          playerId: entry.by,
          props: {
            target: entry.target,
            hp: entry.hp,
            shield: entry.shield,
            power: entry.power,
            self: entry.target === entry.by,
          },
        });
        break;
      case 'heal':
        if (entry.amount > 0)
          events.push({ type: 'heal', playerId: entry.player, props: { amount: entry.amount } });
        break;
      case 'destroy':
        events.push({
          type: 'shield',
          playerId: entry.by,
          props: { card: entry.card, holder: entry.holder, owner: entry.owner },
        });
        break;
      case 'swap':
        events.push({
          type: 'swap',
          playerId: entry.a,
          props: { with: entry.b, before: entry.hpB, after: entry.hpA },
        });
        break;
      case 'rotate':
        events.push({
          type: 'rotate',
          playerId: null,
          props: { players: entry.players, before: entry.before, after: entry.after },
        });
        break;
      case 'social':
        events.push({
          type: 'social',
          playerId: entry.player,
          props: { done: entry.done, auto: entry.auto === true },
        });
        break;
      case 'scout':
        if (entry.count > 0)
          events.push({ type: 'steal', playerId: entry.by, props: { count: entry.count } });
        break;
      case 'pickpocket':
        if (entry.card) events.push({ type: 'steal', playerId: entry.by, props: { count: 1 } });
        break;
      case 'ko':
        events.push({
          type: 'ko',
          playerId: entry.player,
          props: {
            by: entry.by,
            card: entry.card,
            hero: heroOf(entry.player),
            self: entry.by === entry.player && !entry.removed,
            removed: entry.removed === true,
            turn: entry.turn,
          },
        });
        break;
    }
  }
  if (before.phase !== 'over' && after.phase === 'over') {
    const order = g.order;
    events.push({
      type: 'outcome',
      winners: [...g.winners],
      props: {
        players: [...order],
        heroes: order.map((p) => g.players[p]!.hero),
        winnerHeroes: g.winners.map((p) => g.players[p]!.hero),
        seats: g.winners.map((p) => order.indexOf(p)),
        count: order.length,
        turns: g.turn.number,
        reason: g.endReason,
        tie: g.winners.length === 0,
        firstWon: g.winners.includes(g.first),
        knockouts: g.knockouts.map((k) => k.player),
        dealt: order.map((p) => g.tally[p]?.dealt ?? 0),
        healed: order.map((p) => g.tally[p]?.healed ?? 0),
        absorbed: order.map((p) => g.tally[p]?.absorbed ?? 0),
        biggestHit: order.map((p) => g.tally[p]?.biggestHit ?? 0),
        longestChain: order.map((p) => g.tally[p]?.longestChain ?? 0),
        finalHp: order.map((p) => g.players[p]!.hp),
      },
    });
  }
  return events;
}
