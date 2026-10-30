import { playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { hostMove } from './bot.ts';
import { cliffhanger } from './definition.ts';
import { teamOf } from './game.ts';
import { content, gettable, ids, keepAndPlace, pair, started, winFaceOff } from './test-utils.ts';
import { type CliffhangerState, other } from './types.ts';

/**
 * Every title a viewer must not see in this state: the deck, the discards, other players' hands,
 * and the unguessed cards on the squares they may not see (before the round's end).
 */
function secretsFor(state: CliffhangerState, viewer: string | null): string[] {
  const round = state.round;
  const onBoard = new Set(
    Object.values(round?.board ?? {}).flatMap((slots) => slots.map((x) => x.card.id)),
  );
  const out = [...state.deck, ...state.discard]
    .filter((c) => !onBoard.has(c.id))
    .map((c) => c.title);
  if (state.phase !== 'playing' || !round) return out;
  for (const [id, hand] of Object.entries(round.hands)) {
    if (id !== viewer) out.push(...hand!.offered.map((c) => c.title));
  }
  if (round.stage === 'steal') return out;
  const team = teamOf(state, viewer);
  for (const owner of ['a', 'b'] as const) {
    for (const slot of round.board[owner] ?? []) {
      if (slot.got) continue;
      const turn = round.stage === 'turn' ? round.turn : null;
      const played = round.order.indexOf(owner) < round.turnNo;
      const visible =
        round.pair[owner] === viewer ||
        (team === owner && played) ||
        (turn !== null && turn?.team !== owner && turn?.describer === viewer && turn.stealOpen);
      const hidden = !visible;
      if (hidden) out.push(slot.card.title);
    }
  }
  return out;
}

function checkViews(state: CliffhangerState): void {
  const viewers = [null, ...Object.keys(state.seats)];
  for (const viewer of viewers) {
    const json = JSON.stringify(cliffhanger.view(state, viewer));
    expect(json).not.toContain('"seed"');
    expect(json).not.toContain('"usedCardIds"');
    for (const title of secretsFor(state, viewer)) {
      if (json.includes(`"${title}"`)) {
        throw new Error(`${viewer ?? 'table'} sees ${title} at ${state.round?.stage}`);
      }
    }
  }
}

describe('view', () => {
  // `view()` never knows who hosts, so a host on the other team sees no more than its teammates.
  it('only the describer sees the cards being described: not their team, the other team or the table', () => {
    const h = started(6);
    const [a] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const mine = h.state.round!.board.a!.map((s) => s.card.title);
    const guesser = cliffhanger.view(h.state, 'p3');
    const rival = cliffhanger.view(h.state, 'p4');
    const describer = cliffhanger.view(h.state, a);
    const table = cliffhanger.view(h.state, null);
    for (const t of mine) {
      expect(JSON.stringify(guesser)).not.toContain(t);
      expect(JSON.stringify(table)).not.toContain(t);
      expect(JSON.stringify(rival)).not.toContain(t);
      expect(JSON.stringify(describer)).toContain(t);
    }
    checkViews(h.state);
  });

  it('the loser’s cards reach only the loser while placing, and the describer once stealing opens', () => {
    const h = started(4);
    const [a, b] = pair(h);
    winFaceOff(h, a);
    keepAndPlace(h);
    const hand = h.state.round!.hands[b]!.offered.map((c) => c.title);
    for (const id of ['p1', 'p3', 'p4']) {
      for (const t of hand) expect(JSON.stringify(cliffhanger.view(h.state, id))).not.toContain(t);
    }
    expect(cliffhanger.view(h.state, b).round!.myHand!.offered).toHaveLength(3);
    for (const card of gettable(h)) h.act(a, { type: 'got', card });
    expect(h.state.round!.turn!.stealOpen).toBe(true);
    const seen = cliffhanger.view(h.state, a).round!.board.b!.map((s) => s.card?.title);
    expect(seen).toEqual(h.state.round!.board.b!.map((s) => s.card.title));
    // b's teammate (p4) guesses later: their own cards stay hidden from them.
    for (const s of h.state.round!.board.b!) {
      expect(JSON.stringify(cliffhanger.view(h.state, 'p4'))).not.toContain(s.card.title);
    }
    checkViews(h.state);
  });

  it('a comeback pick’s categories reach only the picker', () => {
    const h = started(4, { settings: { comebackPick: true } });
    h.state = {
      ...h.state,
      collections: { a: [{ id: 'x:1', title: 'T', genre: 'action' }], b: [] },
    };
    winFaceOff(h, pair(h)[0]);
    while (h.state.round!.number === 1) h.tick();
    const r = h.state.round!;
    expect(r.stage).toBe('pick-category');
    expect(r.pick!.by).toBe(r.pair.b);
    for (const id of ids(4)) {
      const options = cliffhanger.view(h.state, id).round!.pick!.options;
      if (id === r.pick!.by) expect(options).toHaveLength(2);
      else expect(options).toBeNull();
    }
    h.act(r.pair.b, { type: 'pick-category', id: r.pick!.options[1]!.id });
    expect(h.state.round!.category!.id).toBe(r.pick!.options[1]!.id);
  });

  it('no viewer sees what they must not, over 500 seeded bot games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const n = 4 + (seed % 7);
      const settings = {
        noAdvantage: seed % 3 === 0,
        comebackPick: seed % 4 === 0,
        suddenDeath: seed % 5 === 0,
        openingClock: seed % 6 === 0,
        deck: seed % 7 === 0 ? ('tv' as const) : ('films' as const),
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
      };
      let changes = 0;
      const result = playWithBots(
        cliffhanger,
        ids(n).map((id) => ({ id, name: id.toUpperCase() })),
        {
          seed,
          content: content(),
          maxSteps: 4000,
          host: (view) =>
            view.phase === 'lobby' && !view.settings.suddenDeath && settings.suddenDeath
              ? { type: 'update-settings', ...settings }
              : view.phase === 'lobby' && view.settings.deck !== settings.deck
                ? { type: 'update-settings', ...settings }
                : hostMove(view),
          onChange: (state) => {
            // Every change for the first games, then a sample (it's the same code each time).
            changes += 1;
            if (seed <= 50 || changes % 5 === 0) checkViews(state);
          },
        },
      );
      if (result.over) finished += 1;
      const s = result.state;
      if (s.phase === 'over' && s.endReason === 'won') {
        expect(s.winner).not.toBeNull();
        expect(other(s.winner!)).not.toBe(s.winner);
      }
    }
    expect(finished).toBeGreaterThan(450);
  }, 240_000);
});
