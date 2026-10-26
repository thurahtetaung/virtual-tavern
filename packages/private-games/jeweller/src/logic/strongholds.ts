import type { PlayerId } from '@vt/game-sdk';
import { type Hold, LEVELS, type Level, STRONGHOLDS } from './types.ts';

/**
 * The Strongholds module's pure rules, shared by the engine, the bot and the UI: whose cards are
 * occupied, how many strongholds a player still has, which placements are legal and when a
 * Conquest is possible.
 */

type Holds = Readonly<Record<string, Hold>> | undefined;
type Market = Readonly<Record<Level, readonly (string | null)[]>>;

/** A stronghold move: placed from the supply (no `from`) or moved, or an opponent's sent back. */
export type HoldMove =
  { type: 'stronghold'; card: string; from?: string } | { type: 'evict'; card: string };

/** Strongholds a player has in their supply. */
export const supplyOf = (holds: Holds, id: PlayerId) =>
  STRONGHOLDS - Object.values(holds ?? {}).reduce((n, h) => n + (h.by === id ? h.n : 0), 0);

/** Whether someone else's strongholds sit on the card (only their owner may buy or reserve it). */
export const occupiedFor = (holds: Holds, card: string, id: PlayerId) => {
  const h = holds?.[card];
  return !!h && h.by !== id;
};

/** The market as a player may use it: cards occupied by others left out. */
export function openMarket(
  market: Market,
  holds: Holds,
  id: PlayerId,
): Record<Level, (string | null)[]> {
  const out = {} as Record<Level, (string | null)[]>;
  for (const l of LEVELS)
    out[l] = market[l].map((c) => (c && !occupiedFor(holds, c, id) ? c : null));
  return out;
}

/** The cards a player's strongholds sit on, with how many. */
export const holdsOf = (holds: Holds, id: PlayerId) =>
  Object.entries(holds ?? {}).flatMap(([card, h]) => (h.by === id ? [{ card, n: h.n }] : []));

/** The card all three of a player's strongholds sit on, if any: they may conquer it. */
export const conquestCard = (holds: Holds, id: PlayerId): string | null =>
  holdsOf(holds, id).find((h) => h.n >= STRONGHOLDS)?.card ?? null;

/**
 * Every legal stronghold move after a purchase: place one from the supply (or move one of the
 * player's own) onto a face-up card without an opponent's, up to 3 of theirs on it; or send back
 * an opponent's stronghold from a card that has exactly one.
 */
export function holdMoves(market: Market, holds: Holds, id: PlayerId): HoldMove[] {
  const out: HoldMove[] = [];
  const supply = supplyOf(holds, id);
  const mine = holdsOf(holds, id);
  for (const l of LEVELS)
    for (const card of market[l]) {
      if (!card) continue;
      const h = holds?.[card];
      if (h && h.by !== id) {
        if (h.n === 1) out.push({ type: 'evict', card });
        continue;
      }
      if ((h?.n ?? 0) >= STRONGHOLDS) continue;
      if (supply > 0) out.push({ type: 'stronghold', card });
      for (const m of mine)
        if (m.card !== card) out.push({ type: 'stronghold', card, from: m.card });
    }
  return out;
}

/** Why a stronghold move isn't legal, or null when it is. */
export function holdProblem(
  market: Market,
  holds: Holds,
  id: PlayerId,
  move: HoldMove,
): string | null {
  const faceUp = LEVELS.some((l) => market[l].includes(move.card));
  if (!faceUp) return 'Pick a face-up card on the table.';
  const h = holds?.[move.card];
  if (move.type === 'evict') {
    if (!h || h.by === id) return 'Pick a card with an opponent’s stronghold.';
    return h.n === 1 ? null : 'Only a lone stronghold can be sent back.';
  }
  if (h && h.by !== id) return 'Another player’s stronghold is on that card.';
  if ((h?.n ?? 0) >= STRONGHOLDS) return 'That card already has all three.';
  if (move.from !== undefined) {
    if (move.from === move.card) return 'Pick a different card to move it to.';
    if (holds?.[move.from]?.by !== id) return 'You have no stronghold on that card.';
    return null;
  }
  return supplyOf(holds, id) > 0 ? null : 'All your strongholds are out: move one instead.';
}

/** Applies a legal stronghold move. */
export function applyHold(holds: Record<string, Hold>, id: PlayerId, move: HoldMove) {
  if (move.type === 'evict') {
    delete holds[move.card];
    return;
  }
  if (move.from !== undefined) {
    const from = holds[move.from]!;
    from.n -= 1;
    if (from.n <= 0) delete holds[move.from];
  }
  const to = holds[move.card];
  if (to) to.n += 1;
  else holds[move.card] = { by: id, n: 1 };
}
