import { describe, expect, it } from 'vitest';
import { ids, leaks, rigged } from './test-utils.ts';

const [A, B, C] = ids(3) as [string, string, string];
const BOTH = { settings: { x2: true, x3: true } };

/** Blindfold `who` with A's card, then A draws (ending A's turn). */
function blindfold(h: ReturnType<typeof rigged>, who: string) {
  h.play(A, ['blind'], { target: who });
  h.act({ type: 'draw' }, A);
}

describe('blindfolded hands', () => {
  it('a marked card stays visible to everyone else and hidden from its blind owner', () => {
    const h = rigged([['mark', 'blind'], ['cat1', 'cat2'], ['cat3']], ['cat4', 'cat5'], BOTH);
    h.play(A, ['mark'], { target: B });
    h.play(A, ['blind'], { target: B });
    expect(h.view(B).game!.players[1]!.marked).toBeNull();
    expect(h.view(A).game!.players[1]!.marked).not.toBeNull();
    expect(h.view(C).game!.players[1]!.marked).not.toBeNull();
    expect(leaks(h.state, B)).toEqual([]);
  });

  it('a blind Favor target gives by slot and then sees what they gave', () => {
    const h = rigged([['blind', 'favor'], ['cat1', 'cat2'], ['cat3']], ['cat4', 'cat5'], BOTH);
    h.play(A, ['blind'], { target: B });
    h.play(A, ['favor'], { target: B });
    expect(h.view(B).game!.prompt).toEqual({ kind: 'give', to: A, blind: true });
    expect(h.reject({ type: 'give', card: h.game().hands[B]![0]! }, B)).toBe('not-in-hand');
    h.act({ type: 'give', slot: 1 }, B);
    const gave = h.view(B).game!.memory.findLast((m) => m.kind === 'gave');
    expect(gave).toBeTruthy();
    expect(h.hand(A)).toContain(gave && 'card' in gave ? gave.card.t : 'none');
    expect(h.view(B).game!.blindCount).toBe(1);
  });

  it('a Stash card stolen by a blind player joins the face-down hand', () => {
    const h = rigged([['blind', 'cat1'], ['favor'], ['vault']], ['cat4', 'cat5', 'skip'], {
      ...BOTH,
      first: 2,
    });
    h.play(C, ['vault']);
    h.act({ type: 'draw' }, C);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'draw' }, A);
    // B's only card is the Favor: played blind it needs a target, and C pays from the Stash.
    h.act({ type: 'play-blind', slot: 0 }, B);
    expect(h.state.stage).toBe('target');
    h.act({ type: 'target', player: C }, B);
    h.settle();
    expect(h.game().stash.length).toBe(5);
    const v = h.view(B).game!;
    expect(v.hand).toBeNull();
    expect(v.blindCount).toBe(1);
    expect(v.memory.findLast((m) => m.kind === 'got')).toMatchObject({ how: 'stash' });
    expect(leaks(h.state, B)).toEqual([]);
  });

  it('no Nope button while blind', () => {
    const h = rigged([['blind', 'skip'], ['nope', 'cat1'], []], ['cat4', 'cat5'], BOTH);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    expect(h.state.stage).toBe('window');
    expect(h.view(B).game!.canNope).toBe(false);
    expect(h.reject({ type: 'nope', window: h.game().window!.id }, B)).toBe('blind');
  });

  it('a Twin Bomb barking at a blind player starts a search; a Defuse found reinserts nothing', () => {
    const h = rigged([['blind', 'twin'], ['twin', 'defuse'], []], ['cat4', 'cat5'], BOTH);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'play', cards: [h.card(A, 'twin')] }, A);
    expect(h.state.stage).toBe('search');
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'search', twin: true, slots: 1 });
    h.act({ type: 'search', slot: 0 }, B);
    expect(h.state.stage).toBe('turn');
    expect(h.game().turn.player).toBe(A);
    expect(h.game().pile.length).toBeGreaterThan(0);
    expect(h.game().pile.some((id) => h.game().cards[id]!.t === 'twin')).toBe(false);
  });

  it('a blind search that turns up the Bomb Shelter holds the Bomb', () => {
    const h = rigged([['blind'], ['shelter'], []], ['cat4', 'bomb'], BOTH);
    blindfold(h, B);
    h.act({ type: 'draw' }, B);
    expect(h.state.stage).toBe('search');
    h.act({ type: 'search', slot: 0 }, B);
    expect(h.game().held[B]).toBeTruthy();
    expect(h.hand(B).sort()).toEqual(['bomb', 'shelter']);
    expect(h.game().turn.player).not.toBe(B);
    // Still blind: drawing a Bomb is never a safe draw.
    expect(h.game().blind[B]).toBe(true);
  });

  it('a Mine! draw counts as a safe draw for a blind drawer', () => {
    const h = rigged([['blind', 'mine'], ['cat1'], []], ['cat4', 'cat5'], BOTH);
    h.play(A, ['blind'], { target: B });
    h.play(A, ['mine'], { target: B });
    h.act({ type: 'draw' }, A);
    h.act({ type: 'draw' }, B);
    expect(h.game().blind[B]).toBe(false);
    expect(h.game().log.some((e) => e.kind === 'mine-took' && e.by === A)).toBe(true);
  });

  it('Recycle and Potluck take a blind player’s card by slot', () => {
    const h = rigged([['blind', 'potluck', 'cat1'], ['cat2', 'cat3'], ['cat4']], ['cat5'], BOTH);
    h.play(A, ['blind'], { target: B });
    h.play(A, ['potluck']);
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'each', blind: true, done: false });
    h.act({ type: 'choose', card: h.card(A, 'cat1') }, A);
    expect(h.reject({ type: 'choose', card: h.game().hands[B]![0]! }, B)).toBe('not-in-hand');
    h.act({ type: 'choose', slot: 0 }, B);
    h.act({ type: 'choose', card: h.card(C, 'cat4') }, C);
    expect(h.state.stage).toBe('turn');
    // The last in turn order ends up on top.
    expect(h.game().cards[h.game().pile[0]!]!.t).toBe('cat4');
    expect(h.view(B).game!.memory.findLast((m) => m.kind === 'pooled')).toBeTruthy();
  });
});
