import { describe, expect, it } from 'vitest';
import { type Harness, ids, leaks, rigged } from './test-utils.ts';

const viewers = (h: Harness) => [...h.game().players, null, 'watcher'];

function expectSealed(h: Harness) {
  for (const viewer of viewers(h))
    expect(leaks(h.state, viewer), `${viewer} at ${h.state.stage}`).toEqual([]);
}

describe('view()', () => {
  it('hides every hand, the pile and the drawn Bomb at every stage', () => {
    const [A, B, C] = ids(3) as [string, string, string];
    const h = rigged(
      [
        ['favor', 'peek3', 'alter3', 'attack', 'cat1', 'cat1', 'defuse'],
        ['nope', 'cat2', 'skip'],
        ['nope', 'cat3'],
      ],
      ['cat4', 'bomb', 'cat5', 'skip'],
      { settings: { x1: true } },
    );
    expectSealed(h);
    h.act({ type: 'play', cards: [h.card(A, 'favor')], target: B }, A);
    expectSealed(h);
    h.settle();
    expectSealed(h); // favor
    h.act({ type: 'give', card: h.card(B, 'cat2') }, B);
    h.play(A, ['peek3']);
    expectSealed(h);
    expect(h.view(B).game!.memory.some((m) => m.kind === 'peek')).toBe(false);
    h.play(A, ['alter3']);
    expectSealed(h); // alter
    h.act({ type: 'order', order: [1, 0, 2] }, A);
    h.play(A, ['cat1', 'cat1'], { target: C });
    expectSealed(h);
    h.act({ type: 'draw' }, A);
    expectSealed(h); // bomb
    h.act({ type: 'defuse' }, A);
    expectSealed(h); // place
    h.act({ type: 'place', position: 0 }, A);
    expectSealed(h);
    // B draws the Bomb A hid on top, with no Defuse: explodes.
    h.act({ type: 'draw' }, B);
    expectSealed(h); // beat
    expect(h.view(B).game!.hand).toBeNull();
    h.fire();
    expectSealed(h);
  });

  it('shows the whole story once the game is over', () => {
    const h = rigged([['defuse'], []], ['bomb', 'cat1']);
    h.act({ type: 'draw' }, ids(2)[0]);
    h.act({ type: 'defuse' }, ids(2)[0]);
    h.act({ type: 'place', position: 0 }, ids(2)[0]);
    h.act({ type: 'draw' }, ids(2)[1]);
    expect(h.state.phase).toBe('over');
    const end = h.view(null).game!.end!;
    expect(end.truth).toHaveLength(1);
    expect(end.pile.length).toBe(h.game().pile.length);
    expect(Object.keys(end.hands)).toEqual(ids(2));
  });

  it('only a Nope holder (who isn’t the last to act) sees the button', () => {
    const [A, B, C] = ids(3) as [string, string, string];
    const h = rigged([['skip', 'nope'], ['nope'], ['cat1']], []);
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    expect([A, B, C, null].map((v) => h.view(v).game!.canNope)).toEqual([
      false,
      true,
      false,
      false,
    ]);
    h.act({ type: 'nope', window: h.game().window!.id }, B);
    h.tick(1000);
    expect([A, B, C, null].map((v) => h.view(v).game!.canNope)).toEqual([
      true,
      false,
      false,
      false,
    ]);
    // Everyone sees the same window either way.
    const w = h.view(C).game!.window;
    expect(h.view(A).game!.window).toEqual(w);
    expect(h.view(null).game!.window).toEqual(w);
  });
});
