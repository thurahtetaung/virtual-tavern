import { type Card, type DeckOptions, type Suit, copiesOf, nextRank, played } from './cards.ts';
import { type Knowledge, type Possibility, learn, noKnowledge, possibilities } from './clues.ts';
import type { GameView, SkyfireView } from './types.ts';

/**
 * Reading a player's own view: what they can see and what their cards may be. Shared by the UI
 * (marks and full help) and the bot, so both only ever know what the viewer knows.
 */

export const optionsOfView = (view: SkyfireView): DeckOptions => ({
  multi: view.settings.multi,
  black: view.settings.black,
});

/** The cards on the fireworks, as faces. */
export function fireworkCards(g: GameView): Card[] {
  return g.suits.flatMap((suit) => {
    const h = g.fireworks[suit] ?? 0;
    return Array.from({ length: h }, (_, i) => ({
      suit,
      rank: (suit === 'black' ? 5 - i : i + 1) as Card['rank'],
    }));
  });
}

/** Every card face this viewer can see: discards, fireworks and the other hands. */
export function seenCards(g: GameView): Card[] {
  return [
    ...g.discards.map((d) => d.card),
    ...fireworkCards(g),
    ...g.order.flatMap((id) => (g.hands[id] ?? []).flatMap((s) => (s.card ? [s.card] : []))),
  ];
}

/**
 * What the clues said about a card. When the room plays from memory the view carries no marks,
 * so this rebuilds what the clues still in the viewer's log said (touched cards only).
 */
export function knowledgeOf(view: SkyfireView, holder: string, id: string): Knowledge {
  const slot = view.game?.hands[holder]?.find((s) => s.id === id);
  if (slot?.know) return slot.know;
  const k = noKnowledge();
  for (const e of view.log) {
    if (e.kind !== 'clue' || e.to !== holder || !e.touched.includes(id)) continue;
    learn(k, e.rank !== undefined ? { rank: e.rank } : { colour: e.colour! }, true);
  }
  return k;
}

/** Whether a card would go on its firework now. */
export const playable = (c: Card, g: GameView) =>
  nextRank(c.suit, g.fireworks[c.suit] ?? 0) === c.rank;

/**
 * A card nobody needs any more: its number is on the firework already, or a card it needs first
 * has lost every copy.
 */
export function dead(c: Card, g: GameView, o: DeckOptions): boolean {
  const h = g.fireworks[c.suit] ?? 0;
  if (played(c.suit, c.rank, h)) return true;
  const gone = (suit: Suit, rank: Card['rank']) =>
    g.discards.filter((d) => d.card.suit === suit && d.card.rank === rank).length >=
    copiesOf(suit, rank, o);
  let r = nextRank(c.suit, h);
  while (r !== null && r !== c.rank) {
    if (gone(c.suit, r)) return true;
    r = (c.suit === 'black' ? r - 1 : r + 1) as Card['rank'];
  }
  return false;
}

/** The last copy of a card still needed: losing it caps that firework for good. */
export function critical(c: Card, g: GameView, o: DeckOptions): boolean {
  if (dead(c, g, o)) return false;
  const gone = g.discards.filter((d) => d.card.suit === c.suit && d.card.rank === c.rank).length;
  return gone >= copiesOf(c.suit, c.rank, o) - 1;
}

/** What one of the viewer's own cards may be, counting every card they can see. */
export function ownPossibilities(view: SkyfireView, me: string, id: string): Possibility[] {
  const g = view.game!;
  return possibilities(knowledgeOf(view, me, id), optionsOfView(view), seenCards(g));
}

/** What a card's holder could know from the clues alone (and the public table). */
export function holderPossibilities(
  view: SkyfireView,
  holder: string,
  id: string,
  k: Knowledge = knowledgeOf(view, holder, id),
): Possibility[] {
  const g = view.game!;
  const pub = [...g.discards.map((d) => d.card), ...fireworkCards(g)];
  return possibilities(k, optionsOfView(view), pub);
}
