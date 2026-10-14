import { describe, expect, it } from 'vitest';
import { shortFuse } from './game.ts';
import { everyCard, ids, leaks, rigged } from './test-utils.ts';

const [A, B, C] = ids(3) as [string, string, string];
const X2 = { settings: { x2: true } };
const X3 = { settings: { x3: true } };
const types = (h: ReturnType<typeof rigged>, list: string[]) =>
  list.map((id) => h.game().cards[id]!.t);

describe('expansion 2', () => {
  it('a Bomb Shelter keeps one drawn Bomb secretly in hand', () => {
    const h = rigged([['shelter'], [], []], ['bomb', 'bomb'], X2);
    h.act({ type: 'draw' }, A);
    expect(h.hand(A).sort()).toEqual(['bomb', 'shelter']);
    expect(h.game().held[A]).toBeTruthy();
    expect(h.game().turn.player).toBe(B);
    // Nobody else learns it: the log says a card was drawn.
    expect(h.view(B).game!.log.at(-1)).toMatchObject({ kind: 'draw', by: A });
    expect(h.view(A).game!.memory.at(-1)).toMatchObject({ kind: 'held' });
    // B has nothing to shelter with and no Defuse: B explodes on the next Bomb.
    h.act({ type: 'draw' }, B);
    expect(h.game().dead.map((d) => d.id)).toEqual([B]);
  });

  it('only one Bomb at a time: a second one must be defused', () => {
    const h = rigged([['shelter', 'defuse'], []], ['bomb', 'cat1', 'bomb'], X2);
    h.act({ type: 'draw' }, A);
    h.act({ type: 'draw' }, B);
    h.act({ type: 'draw' }, A);
    expect(h.state.stage).toBe('bomb');
  });

  it('a pair that takes the held Bomb makes the thief face it; taking the Shelter exposes the holder', () => {
    for (let seed = 1; seed < 12; seed++) {
      const h = rigged(
        [['cat1', 'cat1', 'defuse'], ['shelter', 'defuse'], []],
        ['cat2', 'bomb', 'cat3'],
        {
          ...X2,
          seed,
          first: 0,
        },
      );
      h.act({ type: 'draw' }, A);
      h.act({ type: 'draw' }, B); // B holds the Bomb with the Shelter
      expect(h.game().held[B]).toBeTruthy();
      h.act({ type: 'draw' }, C);
      h.play(A, ['cat1', 'cat1'], { target: B });
      const took = h.view(A).game!.memory.findLast((m) => m.kind === 'got');
      const t = took && 'card' in took ? took.card.t : null;
      if (t === 'bomb') {
        expect(h.state.stage).toBe('bomb');
        expect(h.game().drawn?.by).toBe(A);
        expect(h.view(C).game!.log.at(-1)).toMatchObject({ kind: 'received-bomb', by: A });
      } else if (t === 'shelter') {
        expect(h.state.stage).toBe('bomb');
        expect(h.game().drawn?.by).toBe(B);
        expect(h.view(C).game!.log.at(-1)).toMatchObject({ kind: 'unprotected', by: B });
        h.act({ type: 'defuse' }, B);
        h.act({ type: 'place', position: 0 }, B);
        expect(h.game().turn.player).toBe(A);
        expect(h.state.stage).toBe('turn');
      } else {
        expect(h.state.stage).toBe('turn');
      }
      expect(everyCard(h.game()).length).toBe(Object.keys(h.game().cards).length);
    }
  });

  it('super skip ends every owed turn; peek and rearrange 5', () => {
    const h = rigged(
      [['attack'], ['superskip', 'peek5', 'alter5'], []],
      ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'skip'],
      X2,
    );
    h.play(A, ['attack']);
    h.play(B, ['peek5']);
    const seen = h.view(B).game!.memory.at(-1)!;
    expect(seen.kind === 'peek' && seen.cards.length).toBe(5);
    h.play(B, ['alter5']);
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'alter' });
    h.act({ type: 'order', order: [4, 3, 2, 1, 0] }, B);
    h.play(B, ['superskip']);
    expect(h.game().turn).toMatchObject({ player: C, owed: 1 });
  });

  it('swap top and bottom', () => {
    const h = rigged([['swap'], []], ['cat1'], X2);
    const top = h.game().pile[0];
    const bottom = h.game().pile.at(-1);
    h.play(A, ['swap']);
    expect(h.game().pile[0]).toBe(bottom);
    expect(h.game().pile.at(-1)).toBe(top);
  });

  it('the Bomb Stack moves only Bombs to the top, in plain view, and ends the turn', () => {
    const h = rigged([['stack'], [], []], ['cat1', 'void', 'cat2'], {
      settings: { x1: true, x2: true },
    });
    const rest = h.game().pile.filter((id) => h.game().cards[id]!.t !== 'bomb');
    const bombs = h.game().pile.length - rest.length;
    h.play(A, ['stack']);
    expect(types(h, h.game().pile.slice(0, bombs)).every((t) => t === 'bomb')).toBe(true);
    // Everything else keeps its order below them, the face-up Black Hole included.
    expect(h.game().pile.slice(bombs)).toEqual(rest);
    expect(h.view(B).game!.pile.knownTop).toBe(bombs);
    expect(h.game().turn.player).toBe(B);
  });

  it('mark shows a card to everyone until it leaves the hand', () => {
    const h = rigged([['mark', 'favor'], ['cat3']], [], X2);
    h.play(A, ['mark'], { target: B });
    expect(h.view(A).game!.players[1]!.marked).toMatchObject({ t: 'cat3' });
    expect(JSON.stringify(h.view(A).game!.players[1]!.marked)).not.toContain(
      h.game().hands[B]![0]!,
    );
    h.play(A, ['favor'], { target: B });
    h.act({ type: 'give', card: h.card(B, 'cat3') }, B);
    expect(h.view(A).game!.players[1]!.marked).toBeNull();
  });

  it('a blindfold hides your hand; blind plays are random, unplayable ones are lost; a safe draw cures', () => {
    const h = rigged([['blind'], ['cat1', 'cat2', 'skip'], []], ['cat3', 'cat4'], X2);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'draw' }, A);
    const v = h.view(B).game!;
    expect(v.hand).toBeNull();
    expect(v.blindCount).toBe(3);
    expect(v.prompt).toEqual({ kind: 'turn', blind: true });
    expect(leaks(h.state, B)).toEqual([]);
    expect(h.reject({ type: 'play', cards: [h.game().hands[B]![0]!] }, B)).toBe('blind');
    // Whatever turns up: a lone cat is lost; a Skip goes into the Nope window.
    const slot = h.game().hands[B]!.findIndex((id) => h.game().cards[id]!.t === 'cat1');
    h.act({ type: 'play-blind', slot }, B);
    expect(h.game().log.at(-1)).toMatchObject({ kind: 'lost', by: B, cards: ['cat1'] });
    expect(h.hand(B).length).toBe(2);
    h.act({ type: 'draw' }, B);
    expect(h.game().blind[B]).toBe(false);
    expect(h.view(B).game!.hand).not.toBeNull();
  });

  it('blind with a Bomb: turn cards over until a Defuse turns up', () => {
    const h = rigged([['blind'], ['cat1', 'defuse', 'cat2'], []], ['cat3', 'bomb'], X2);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'draw' }, A);
    h.act({ type: 'draw' }, B);
    expect(h.state.stage).toBe('search');
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'search', slots: 3 });
    let guard = 0;
    while (h.state.stage === 'search' && guard++ < 5) h.act({ type: 'search', slot: 0 }, B);
    expect(h.state.stage).toBe('place');
    expect(h.hand(B).includes('defuse')).toBe(false);
    h.act({ type: 'place', position: 0 }, B);
    // Drawing the Bomb wasn't a safe draw: still blind.
    expect(h.game().blind[B]).toBe(true);
  });

  it('a blind targeted card waits for its target', () => {
    const h = rigged([['blind'], ['favor'], ['cat1']], ['cat3', 'cat4'], X2);
    h.play(A, ['blind'], { target: B });
    h.act({ type: 'draw' }, A);
    h.act({ type: 'play-blind', slot: 0 }, B);
    expect(h.state.stage).toBe('target');
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'target', options: [A, C] });
    h.act({ type: 'target', player: C }, B);
    expect(h.state.stage).toBe('window');
    h.settle();
    expect(h.state.stage).toBe('favor');
  });

  it('recycle: everyone with cards puts one in secretly, then it’s shuffled', () => {
    const h = rigged([['recycle', 'cat1'], ['cat2'], ['cat3']], [], X2);
    const before = h.game().pile.length;
    h.play(A, ['recycle']);
    expect(h.state.stage).toBe('each');
    expect(h.view(C).game!.each?.waiting).toEqual([A, B, C]);
    h.act({ type: 'choose', card: h.card(B, 'cat2') }, B);
    expect(h.reject({ type: 'choose', card: h.card(A, 'cat1') }, B)).toBe('not-asked');
    h.act({ type: 'choose', card: h.card(C, 'cat3') }, C);
    h.act({ type: 'choose', card: h.card(A, 'cat1') }, A);
    expect(h.game().pile.length).toBe(before + 3);
    expect(h.state.stage).toBe('turn');
    expect(h.view(B).game!.memory.at(-1)).toMatchObject({ kind: 'pooled', card: { t: 'cat2' } });
  });
});

describe('expansion 3', () => {
  it('twin bombs: one barks at whoever holds the other, who must defuse (reinserting nothing)', () => {
    const h = rigged([['twin'], ['twin', 'defuse'], []], [], X3);
    const pile = h.game().pile.length;
    h.act({ type: 'play', cards: [h.card(A, 'twin')] }, A);
    expect(h.state.stage).toBe('bomb');
    expect(h.game().drawn).toMatchObject({ by: B, twin: true });
    h.act({ type: 'defuse' }, B);
    expect(h.state.stage).toBe('turn');
    expect(h.game().turn.player).toBe(A);
    expect(h.game().pile.length).toBe(pile);
    expect(types(h, h.game().discard)).toEqual(['twin', 'defuse', 'twin']);
  });

  it('a twin with nobody to bark at waits face up, and is the target when the other turns up', () => {
    const h = rigged([['twin'], [], []], ['cat1', 'cat2'], X3);
    const other = Object.keys(h.game().cards).find(
      (id) => h.game().cards[id]!.t === 'twin' && !h.game().hands[A]!.includes(id),
    )!;
    h.act({ type: 'play', cards: [h.card(A, 'twin')] }, A);
    expect(types(h, h.game().front[A]!)).toEqual(['twin']);
    expect(h.state.stage).toBe('turn');
    // The other twin reaches C, who plays it: A has no Defuse and explodes.
    h.game().pile.splice(h.game().pile.indexOf(other), 1);
    h.game().hands[C]!.push(other);
    h.act({ type: 'draw' }, A);
    h.act({ type: 'draw' }, B);
    h.act({ type: 'play', cards: [other] }, C);
    expect(h.game().dead.map((d) => d.id)).toEqual([A]);
  });

  it('both twins together bark at anyone', () => {
    const h = rigged([['twin', 'twin'], [], ['defuse']], [], X3);
    const twins = h.game().hands[A]!;
    expect(h.reject({ type: 'play', cards: twins }, A)).toBe('need-target');
    h.act({ type: 'play', cards: twins, target: C }, A);
    expect(h.game().drawn).toMatchObject({ by: C, twin: true });
  });

  it('the Vault: steals hit the Stash first, and nobody sees it', () => {
    const h = rigged([['vault', 'cat1'], ['favor', 'cat2', 'cat2'], []], [], X3);
    h.play(A, ['vault']);
    expect(h.game().vaultBy).toBe(A);
    const stash = [...h.game().stash];
    expect(stash).toHaveLength(6);
    expect(h.view(A).game!.players[0]!.stash).toBe(6);
    for (const v of [A, B, C, null]) expect(leaks(h.state, v)).toEqual([]);
    h.act({ type: 'draw' }, A);
    h.play(B, ['favor'], { target: A });
    expect(h.state.stage).toBe('turn');
    expect(h.game().stash).toHaveLength(5);
    expect(h.hand(A)).toContain('cat1');
    h.play(B, ['cat2', 'cat2'], { target: A });
    expect(h.game().stash).toHaveLength(4);
    expect(h.view(C).game!.log.at(-1)).toMatchObject({ kind: 'steal', from: 'stash' });
  });

  it('mine!: the next draw goes to the placer; bury is blocked meanwhile', () => {
    const h = rigged([['mine'], ['bury'], []], ['cat3', 'cat4'], X3);
    const top = h.game().pile[0]!;
    h.play(A, ['mine'], { target: B });
    expect(h.view(C).game!.players[1]!.mine).toBe(A);
    h.act({ type: 'draw' }, A);
    expect(h.reject({ type: 'play', cards: [h.card(B, 'bury')] }, B)).toBe('mine');
    const second = h.game().pile[0]!;
    h.act({ type: 'draw' }, B);
    expect(h.game().hands[A]).toContain(second);
    expect(h.game().hands[A]).toContain(top);
    expect(h.game().turn.player).toBe(C);
    expect(h.view(C).game!.players[1]!.mine).toBeNull();
  });

  it('mine! on a Bomb: the placer must defuse it', () => {
    const h = rigged([['mine', 'defuse'], [], []], ['cat3', 'bomb'], X3);
    h.play(A, ['mine'], { target: B });
    h.act({ type: 'draw' }, A);
    h.act({ type: 'draw' }, B);
    expect(h.game().drawn?.by).toBe(A);
    h.act({ type: 'defuse' }, A);
    h.act({ type: 'place', position: 3 }, A);
    expect(h.game().turn.player).toBe(C);
  });

  it('bury: draw, look, put back anywhere; a Bomb just goes back', () => {
    const h = rigged([['bury'], []], ['bomb', 'cat1'], X3);
    h.play(A, ['bury']);
    expect(h.view(A).game!.prompt).toMatchObject({
      kind: 'place',
      bury: true,
      card: { t: 'bomb' },
    });
    expect(h.view(B).game!.drawnKind).toBe('bury');
    h.act({ type: 'place', position: 1 }, A);
    expect(types(h, h.game().pile.slice(0, 2))).toEqual(['cat1', 'bomb']);
    expect(h.game().turn.player).toBe(B);
    expect(h.game().dead).toEqual([]);
  });

  it('self attack: three turns of your own, stacking', () => {
    const h = rigged([['self3', 'attack'], []], ['cat1', 'cat2', 'cat3'], X3);
    h.play(A, ['self3']);
    expect(h.game().turn).toMatchObject({ player: A, owed: 3, chained: true });
    h.act({ type: 'draw' }, A);
    h.play(A, ['attack']);
    expect(h.game().turn).toMatchObject({ player: B, owed: 4 });
  });

  it('potluck: everyone’s card goes on top in turn order (the last on top)', () => {
    const h = rigged([['potluck', 'cat1'], ['cat2'], ['cat3']], [], X3);
    h.play(A, ['potluck']);
    h.act({ type: 'choose', card: h.card(C, 'cat3') }, C);
    h.act({ type: 'choose', card: h.card(A, 'cat1') }, A);
    h.act({ type: 'choose', card: h.card(B, 'cat2') }, B);
    expect(types(h, h.game().pile.slice(0, 3))).toEqual(['cat3', 'cat2', 'cat1']);
  });

  it('share: the next player sees the rearranged top too', () => {
    const h = rigged([['share3'], [], []], ['cat1', 'cat2', 'cat3'], X3);
    h.play(A, ['share3']);
    expect(h.view(A).game!.prompt).toMatchObject({ kind: 'alter', share: B });
    h.act({ type: 'order', order: [2, 1, 0] }, A);
    expect(h.view(B).game!.memory.at(-1)).toMatchObject({ kind: 'shared', other: A });
    expect(h.view(C).game!.memory).toEqual([]);
  });

  it('NOW: anyone may rearrange between actions, even off turn', () => {
    const h = rigged([['skip'], ['alter3now'], ['nope']], ['cat1', 'cat2', 'cat3'], X3);
    expect(h.view(B).game!.canNow).toBe(true);
    expect(h.view(C).game!.canNow).toBe(false);
    h.play(B, ['alter3now']);
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'alter' });
    h.act({ type: 'order', order: [0, 1, 2] }, B);
    expect(h.state.stage).toBe('turn');
    expect(h.game().turn.player).toBe(A);
    // Other cards off turn are still refused.
    expect(h.reject({ type: 'play', cards: [h.card(C, 'nope')] }, C)).toBe('not-your-turn');
  });
});

describe('setup with expansions 2 and 3', () => {
  it('one more Bomb with expansion 2; a Stash of 6 with expansion 3; all extras with 3 alone', () => {
    const h = rigged([[], [], []], [], { settings: { x2: true, x3: true } });
    expect(h.game().bombsOut).toBe(3);
    expect(h.game().stash).toHaveLength(6);
    const v = shortFuse.view(h.state, A);
    expect(v.game!.stash).toBe(6);
  });
});
