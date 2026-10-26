import type { BotCtx, PlayerId } from '@vt/game-sdk';
import { RANKS, type Rank, type Suit } from './cards.ts';
import { type Clue, clued, colourChoices, learn, touches } from './clues.ts';
import {
  critical,
  dead,
  holderPossibilities,
  knowledgeOf,
  optionsOfView,
  ownPossibilities,
  playable,
} from './knowledge.ts';
import { CLUE_TOKENS, MAX_PLAYERS, type SkyfireAction, type SkyfireView } from './types.ts';

/**
 * A simple rule bot for playtests, from its own view only: play a card it knows is playable;
 * else clue a teammate so a playable card becomes certain, or save a teammate's last copy about
 * to be discarded; else discard a card nobody needs, or its oldest unclued card. It never
 * reorders its hand and never reacts.
 */
export function skyfireBot(view: SkyfireView, ctx: BotCtx): SkyfireAction | null {
  const me = ctx.me;
  if (view.phase === 'lobby') {
    const seated = view.seats.filter((s) => s.playing).length;
    return view.me && !view.me.playing && !view.me.waiting && seated < MAX_PLAYERS
      ? { type: 'sit', playing: true }
      : null;
  }
  const g = view.game;
  if (view.phase !== 'playing' || !g || g.current !== me || !g.hands[me]) return null;
  const o = optionsOfView(view);
  const mine = g.hands[me];

  // 1. A card every possibility of which is playable.
  for (const s of mine) {
    const poss = ownPossibilities(view, me, s.id);
    if (poss.length && poss.every((p) => playable(p, g))) return { type: 'play', card: s.id };
  }

  const clueList = (to: PlayerId) =>
    [
      ...colourChoices(view.settings.multi).map((colour): Clue => ({ colour })),
      ...RANKS.map((rank): Clue => ({ rank })),
    ].map((clue) => ({
      clue,
      touched: g.hands[to]!.filter((s) => s.card && touches(clue, s.card, o.multi)),
    }));
  const send = (to: PlayerId, clue: Clue): SkyfireAction => ({ type: 'clue', to, ...clue });
  const teammates = [1, 2, 3, 4]
    .map((i) => g.order[(g.order.indexOf(me) + i) % g.order.length]!)
    .filter((id, i, xs) => id !== me && xs.indexOf(id) === i);

  const sure = (poss: readonly { suit: Suit; rank: Rank }[]) =>
    poss.length > 0 && poss.every((p) => playable(p, g));
  // Cards some teammate already knows are playable: no need to point at that identity again.
  const known = new Set(
    teammates.flatMap((to) =>
      g.hands[to]!.flatMap((s) =>
        s.card && sure(holderPossibilities(view, to, s.id)) ? [`${s.card.suit}${s.card.rank}`] : [],
      ),
    ),
  );
  /**
   * What a clue is worth: 10 for each playable card it makes certain, 2 for one it narrows down,
   * 1 for touching a last copy nobody had pointed at (a save); −2 for each other card it newly
   * touches (noise the holder might misread). Sooner teammates win ties.
   */
  const worth = (to: PlayerId, clue: Clue, touched: typeof mine) => {
    let value = 0;
    const lit = new Set<string>();
    for (const s of touched) {
      if (!s.card) continue;
      const k0 = knowledgeOf(view, to, s.id);
      const k = structuredClone(k0);
      learn(k, clue, true);
      const before = holderPossibilities(view, to, s.id, k0);
      const after = holderPossibilities(view, to, s.id, k);
      const id = `${s.card.suit}${s.card.rank}`;
      if (playable(s.card, g) && !known.has(id) && !lit.has(id)) {
        if (sure(after) && !sure(before)) {
          value += 10;
          lit.add(id);
        } else if (after.length < before.length) value += 2;
      } else if (!clued(k0)) value += critical(s.card, g, o) ? 1 : -2;
    }
    return value;
  };
  const ranked = teammates
    .flatMap((to, seat) =>
      clueList(to).map(({ clue, touched }) => ({
        to,
        clue,
        n: touched.length,
        value: touched.length ? worth(to, clue, touched) - seat * 0.1 : -99,
      })),
    )
    .sort((a, b) => b.value - a.value);
  const best = ranked[0];

  if (g.clues > 0) {
    // 2. A clue after which the holder knows a card is playable (and it is).
    if (best && best.value >= 9) return send(best.to, best.clue);

    // 3. Save the next player's oldest unclued card when it is a last copy (or a 5).
    const next = teammates[0];
    if (next) {
      const hand = g.hands[next]!;
      const chop = [...hand].reverse().find((s) => !clued(knowledgeOf(view, next, s.id)));
      if (chop?.card && critical(chop.card, g, o) && g.clues < CLUE_TOKENS)
        return send(next, { rank: chop.card.rank });
    }

    // 3b. With tokens to spare, a clue that narrows down a playable card.
    if (best && best.value >= 1.5 && g.clues >= 3) return send(best.to, best.clue);
  }

  // 4. Discard: a card it knows is dead, else its oldest unclued card, else its oldest.
  if (g.clues < CLUE_TOKENS) {
    const deadCard = mine.find((s) => {
      const poss = ownPossibilities(view, me, s.id);
      return poss.length > 0 && poss.every((p) => dead(p, g, o));
    });
    if (deadCard) return { type: 'discard', card: deadCard.id };
    const unclued = [...mine].reverse().find((s) => !clued(knowledgeOf(view, me, s.id)));
    return { type: 'discard', card: (unclued ?? mine[mine.length - 1]!).id };
  }

  // 5. All 8 tokens: the best clue there is (one that touches a card if any does).
  const legal = ranked.filter((c) => c.n > 0 || view.settings.zeroClues);
  if (legal.length) return send(legal[0]!.to, legal[0]!.clue);
  // Nothing else is legal: play the likeliest card.
  const odds = mine.map((s) => {
    const poss = ownPossibilities(view, me, s.id);
    const total = poss.reduce((n, p) => n + p.left, 0) || 1;
    return {
      id: s.id,
      p: poss.filter((p) => playable(p, g)).reduce((n, p) => n + p.left, 0) / total,
    };
  });
  odds.sort((a, b) => b.p - a.p);
  return odds[0] ? { type: 'play', card: odds[0].id } : null;
}
