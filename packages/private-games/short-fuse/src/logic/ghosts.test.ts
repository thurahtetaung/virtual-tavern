import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARD_TYPES, X4_POOL } from './cards.ts';
import { deal, readout, saversFor } from './deck.ts';
import { DEFAULT_SETTINGS, presetOf, shortFuse } from './game.ts';
import { type Harness, everyCard, harness, ids, leaks, rigged } from './test-utils.ts';
import type { CardType } from './cards.ts';
import type { Settings } from './types.ts';

const [H, A, B] = ids(3) as [string, string, string];
const X4: Partial<Settings> = { x4: true };
const s = (o: Partial<Settings>): Settings => ({ ...DEFAULT_SETTINGS, ...o });

const count = (list: CardType[], t: CardType) => list.filter((x) => x === t).length;
const types = (h: Harness, list: string[]) => list.map((id) => h.game().cards[id]!.t);

/** Ana (seat 2) draws the Bomb on top with nothing to save her, and becomes a ghost. */
function withGhost(hands: CardType[][], top: CardType[], settings: Partial<Settings> = {}) {
  const h = rigged(hands, ['bomb', ...top], { settings: { ...X4, ...settings } });
  h.play(H, ['skip']);
  h.act({ type: 'draw' }, A);
  expect(h.state.stage).toBe('beat');
  h.fire();
  return h;
}

function expectSealed(h: Harness) {
  for (const viewer of [...h.game().players, null, 'watcher'])
    expect(leaks(h.state, viewer), `${viewer} at ${h.state.stage}`).toEqual([]);
}

describe('Expansion 4 deck', () => {
  it('deals a Second Life each up to five, then Defuses, with no spare Defuses in the pile', () => {
    for (let n = 2; n <= 10; n++) {
      const d = deal(s(X4), n, createRng(n));
      const hands = d.hands.map((hand) => hand.map((id) => d.cards[id]!.t));
      const savers = hands.map((hand) => hand[0]);
      expect(count(savers as CardType[], 'revive')).toBe(Math.min(n, 5));
      expect(count(savers as CardType[], 'defuse')).toBe(Math.max(0, n - 5));
      const pile = d.pile.map((id) => d.cards[id]!.t);
      expect(count(pile, 'defuse')).toBe(0);
      expect(count(pile, 'revive')).toBe(0);
      expect(saversFor(s(X4), n)).toEqual({ revive: Math.min(n, 5), defuse: Math.max(0, n - 5) });
    }
  });

  it('leaves Ghost Attack, Restless Spirits, Feed the Ghosts and its Super Skips out at two', () => {
    const all = (n: number) => {
      const d = deal(s(X4), n, createRng(1));
      return [...d.pile, ...d.hands.flat(), ...d.out].map((id) => d.cards[id]!.t);
    };
    const two = all(2);
    for (const t of ['ghostattack', 'robber', 'feed', 'superskip'] as CardType[])
      expect(count(two, t), t).toBe(0);
    expect(count(two, 'dig')).toBe(4);
    const three = all(3);
    expect(count(three, 'ghostattack')).toBe(3);
    expect(count(three, 'superskip')).toBe(2);
    expect(Object.values(X4_POOL).reduce((a, b) => a + (b ?? 0), 0)).toBe(17);
  });

  it('builds the Zombie preset’s piles (and the faster game’s printed sizes)', () => {
    const want = [42, 44, 38, 32, 26, 27, 31, 35, 39];
    const faster = [16, 22, 28, 32, 26, 27, 31, 35, 39];
    for (let n = 2; n <= 10; n++) {
      expect(deal(s(X4), n, createRng(n)).pile.length, `${n}p`).toBe(want[n - 2]);
      expect(readout(s(X4), n).pile).toBe(want[n - 2]);
      const f = s({ ...X4, faster: true });
      expect(deal(f, n, createRng(n)).pile.length, `${n}p faster`).toBe(faster[n - 2]);
      expect(readout(f, n).pile).toBe(faster[n - 2]);
    }
  });

  it('caps the Chaos pile at 12 cards a player before the bombs go in', () => {
    const chaos = s({ x1: true, x2: true, x3: true, x4: true });
    const piles: Record<number, number> = {};
    for (let n = 2; n <= 10; n++) {
      const d = deal(chaos, n, createRng(n));
      piles[n] = d.pile.length;
      expect(readout(chaos, n).pile, `${n}p`).toBe(d.pile.length);
      // The cap comes before the bombs: n bombs (one the Black Hole) on top of 12 a player.
      expect(d.pile.length).toBeLessThanOrEqual(12 * n + n);
      const all = [...d.pile, ...d.hands.flat(), ...d.out, ...d.stash];
      expect(new Set(all).size).toBe(Object.keys(d.cards).length);
    }
    expect(piles[2]).toBe(26);
    expect(piles[5]).toBe(65);
    expect(piles[10]).toBe(50);
  });

  it('has Chaos and Zombie presets; a plain deck turns their expansions off again', () => {
    const h = harness();
    h.act({ type: 'update-settings', preset: 'chaos' });
    expect(h.view(H).preset).toBe('chaos');
    expect(h.state.settings).toMatchObject({ x1: true, x2: true, x3: true, x4: true });
    h.act({ type: 'update-settings', preset: 'zombie' });
    expect(h.view(H).preset).toBe('zombie');
    expect(h.state.settings).toMatchObject({ x1: false, x2: false, x3: false, x4: true });
    h.act({ type: 'update-settings', preset: 'adult' });
    expect(h.state.settings).toMatchObject({ art: 'adult', x4: false });
    h.act({ type: 'update-settings', preset: 'zombie' });
    // Zombie keeps the deck's art.
    expect(h.state.settings.art).toBe('adult');
    expect(presetOf({ core: 'classic', art: 'classic', x1: true })).toBe('classic');
  });
});

describe('ghosts', () => {
  it('a player who explodes stays as a ghost: hand kept, no turns, the bomb in front', () => {
    const h = withGhost([['skip'], ['cat1', 'nope', 'shufflenow'], ['cat2']], ['cat3', 'cat4']);
    const g = h.game();
    expect(g.ghosts).toEqual([A]);
    expect(h.hand(A)).toEqual(['cat1', 'nope', 'shufflenow']);
    expect(types(h, g.front[A]!)).toEqual(['bomb']);
    expect(g.turn.player).toBe(B);
    const v = h.view(A).game!;
    expect(v.hand?.map((x) => x.t)).toEqual(['cat1', 'nope', 'shufflenow']);
    expect(v.players.find((p) => p.id === A)).toMatchObject({ dead: true, ghost: true, hand: 3 });
    expect(h.reject({ type: 'draw' }, A)).toBe('ghost');
    expect(h.reject({ type: 'play', cards: [h.card(A, 'cat1')] }, A)).toBe('ghost');
    expectSealed(h);
  });

  it('ghosts can Nope and play NOW cards, even off turn', () => {
    const h = withGhost(
      [
        ['skip', 'cat5'],
        ['nope', 'shufflenow'],
        ['favor', 'cat2'],
      ],
      ['cat3', 'cat4'],
    );
    h.act({ type: 'play', cards: [h.card(B, 'favor')], target: H }, B);
    expect(h.view(A).game!.canNope).toBe(true);
    h.tick(1000);
    h.act({ type: 'nope', window: h.game().window!.id }, A);
    h.settle();
    expect(h.game().log.some((e) => e.kind === 'cancelled')).toBe(true);
    expect(h.view(A).game!.canNow).toBe(true);
    const v = h.game().pileVersion;
    h.play(A, ['shufflenow']);
    expect(h.game().pileVersion).toBeGreaterThan(v);
    expect(h.game().turn.player).toBe(B);
  });

  it('ghosts can’t be picked for a Favor or a pair, and never get a turn', () => {
    const h = withGhost([['skip'], ['cat1'], ['favor', 'cat2', 'cat2']], ['cat3', 'cat4']);
    expect(h.reject({ type: 'play', cards: [h.card(B, 'favor')], target: A }, B)).toBe(
      'bad-target',
    );
    const pair = h.game().hands[B]!.filter((id) => h.game().cards[id]!.t === 'cat2');
    expect(h.reject({ type: 'play', cards: pair, target: A }, B)).toBe('empty-hand');
    h.act({ type: 'draw' }, B);
    expect(h.game().turn.player).toBe(H);
    h.act({ type: 'draw' }, H);
    expect(h.game().turn.player).toBe(B);
  });

  it('the last living player wins; ghosts never do', () => {
    const h = rigged([['skip'], [], []], ['bomb', 'bomb'], { settings: X4 });
    h.play(H, ['skip']);
    h.act({ type: 'draw' }, A);
    h.fire();
    expect(h.state.phase).toBe('playing');
    h.act({ type: 'draw' }, B);
    expect(h.state.phase).toBe('over');
    expect(h.game().winner).toBe(H);
    expect(h.game().ghosts.sort()).toEqual([A, B].sort());
  });

  it('a ghost keeps the Vault and its Stash; other face-up cards are discarded', () => {
    const h = rigged([['vault', 'mine'], ['skip'], ['cat1']], ['cat2', 'cat3', 'bomb'], {
      settings: { ...X4, x3: true },
    });
    h.play(H, ['vault']);
    h.play(H, ['mine'], { target: B });
    h.act({ type: 'draw' }, H);
    h.play(A, ['skip']);
    // Ben draws with the Mine! in front: the host takes it. Then the host draws the bomb… for us.
    h.act({ type: 'draw' }, B);
    expect(h.game().mine[B]).toBeNull();
    const stash = h.game().stash.length;
    expect(stash).toBe(6);
    // Host draws the bomb and becomes a ghost wearing the Vault.
    h.act({ type: 'draw' }, H);
    expect(h.state.stage).toBe('beat');
    expect(h.game().ghosts).toEqual([H]);
    expect(h.game().vaultBy).toBe(H);
    expect(h.game().stash.length).toBe(6);
    expect(h.view(A).game!.players.find((p) => p.id === H)!.stash).toBe(6);
  });
});

describe('Second Life', () => {
  it('saves you like a Defuse when nobody is a ghost (no Nope, one hiding)', () => {
    const h = rigged([['revive', 'cat1'], ['nope'], ['cat2']], ['bomb', 'cat3'], { settings: X4 });
    h.act({ type: 'draw' }, H);
    const p = h.view(H).game!.prompt;
    expect(p).toMatchObject({ kind: 'bomb', canDefuse: false, revive: { card: true, ghosts: [] } });
    expect(h.reject({ type: 'revive', ghost: A }, H)).toBe('no-ghost');
    h.act({ type: 'revive' }, H);
    expect(h.state.stage).toBe('window');
    expect(h.view(A).game!.canNope).toBe(false);
    h.tick(1000);
    expect(h.reject({ type: 'nope', window: h.game().window!.id }, A)).toBe('not-nopeable');
    h.settle();
    expect(h.state.stage).toBe('place');
    h.act({ type: 'place', position: 0 }, H);
    expect(h.game().pile[0] && h.game().cards[h.game().pile[0]!]!.t).toBe('bomb');
    expect(h.game().turn.player).toBe(A);
    expect(h.hand(A)).toContain('nope');
  });

  it('must bring back a ghost, then hides both bombs, one after the other', () => {
    const h = withGhost([['skip'], ['cat1'], ['revive']], ['bomb', 'cat3', 'cat4']);
    const out = h.game().bombsOut;
    h.act({ type: 'draw' }, B);
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'bomb', revive: { ghosts: [A] } });
    expect(h.reject({ type: 'revive' }, B)).toBe('need-ghost');
    h.act({ type: 'revive', ghost: A }, B);
    h.settle();
    expect(h.game().ghosts).toEqual([]);
    expect(h.game().dead).toEqual([]);
    expect(h.game().front[A]).toEqual([]);
    expect(h.state.stage).toBe('place');
    expectSealed(h);
    h.act({ type: 'place', position: 0 }, B);
    expect(h.state.stage).toBe('place');
    expect(h.game().placing?.by).toBe(B);
    expectSealed(h);
    h.act({ type: 'place', position: 0 }, B);
    expect(h.state.stage).toBe('turn');
    expect(types(h, h.game().pile.slice(0, 2))).toEqual(['bomb', 'bomb']);
    expect(h.game().bombsOut).toBe(out + 1);
    // Ben's turn ended; Ana is back in the turn order.
    expect(h.game().turn.player).toBe(H);
    h.act({ type: 'draw' }, H);
    expect(h.state.stage).toBe('beat');
    expect(h.game().ghosts).toEqual([H]);
    h.fire();
    expect(h.game().turn.player).toBe(A);
    const memory = h.view(B).game!.memory.filter((m) => m.kind === 'placed');
    expect(memory).toHaveLength(2);
    expect(h.game().stats.revives).toBe(1);
    expect(h.game().log.some((e) => e.kind === 'revive' && e.target === A)).toBe(true);
  });

  it('two Second Life cards played together are just a pair (no revival)', () => {
    const h = withGhost([['skip', 'cat5'], ['cat1'], ['revive', 'revive']], ['cat2', 'cat3']);
    const pair = h.game().hands[B]!;
    h.act({ type: 'play', cards: [...pair], target: H }, B);
    expect(h.game().pending).toMatchObject({ kind: 'pair', t: 'revive' });
    h.settle();
    expect(h.state.stage).toBe('turn');
    expect(h.game().ghosts).toEqual([A]);
  });

  it('you may explode anyway, with only a Second Life (never with a Defuse)', () => {
    const h = rigged([['revive'], ['cat1'], []], ['bomb'], { settings: X4 });
    h.act({ type: 'draw' }, H);
    h.act({ type: 'die' }, H);
    expect(h.game().ghosts).toEqual([H]);
    expect(h.hand(H)).toEqual(['revive']);
    const d = rigged([['revive', 'defuse'], ['cat1']], ['bomb'], { settings: X4 });
    d.act({ type: 'draw' }, H);
    expect(d.reject({ type: 'die' }, H)).toBe('has-defuse');
  });

  it('never answers a face-up Black Hole, and a revived player’s Black Hole goes back face up', () => {
    const h = rigged([['skip', 'revive'], ['revive'], ['cat1']], ['void', 'cat2', 'cat3'], {
      settings: { ...X4, x1: true },
    });
    h.act({ type: 'draw' }, H);
    h.act({ type: 'place', position: 1 }, H);
    expect(h.game().voidUp).toBe(true);
    h.act({ type: 'draw' }, A);
    // Ana drew cat2; Ben draws the face-up Black Hole: no Second Life helps.
    h.act({ type: 'draw' }, B);
    expect(h.game().ghosts).toEqual([B]);
    h.fire();
    // Host draws a bomb later? Rig one in: put a bomb on top and draw it.
    const g = h.game();
    const bomb = Object.keys(g.cards).find(
      (id) => g.cards[id]!.t === 'bomb' && g.pile.includes(id),
    )!;
    g.pile.splice(g.pile.indexOf(bomb), 1);
    g.pile.unshift(bomb);
    h.act({ type: 'draw' }, H);
    h.act({ type: 'revive', ghost: B }, H);
    h.settle();
    h.act({ type: 'place', position: 0 }, H);
    expect(h.view(H).game!.prompt).toMatchObject({ kind: 'place', void: true });
    h.act({ type: 'place', position: 3 }, H);
    expect(h.game().voidUp).toBe(true);
    expect(types(h, [h.game().pile[3]!])).toEqual(['void']);
  });

  it('a revived Twin Bomb victim has both twins shuffled back into the pile', () => {
    const h = rigged([['twin', 'cat1'], ['twin'], ['revive']], ['cat2', 'bomb', 'cat3'], {
      settings: { ...X4, x3: true },
    });
    h.act({ type: 'play', cards: [h.card(H, 'twin')] }, H);
    expect(h.game().ghosts).toEqual([A]);
    expect(types(h, h.game().front[A]!)).toEqual(['twin', 'twin']);
    h.fire();
    h.act({ type: 'draw' }, H);
    h.act({ type: 'draw' }, B);
    h.act({ type: 'revive', ghost: A }, B);
    h.settle();
    // Only Ben's own bomb is hidden: the twins went into the pile.
    h.act({ type: 'place', position: 0 }, B);
    expect(h.state.stage).toBe('turn');
    expect(count(types(h, h.game().pile), 'twin')).toBe(2);
    expect(h.game().log.some((e) => e.kind === 'revive' && e.cards?.length === 2)).toBe(true);
  });

  it('a ghost holding the other Twin Bomb stays silent', () => {
    const h = withGhost([['skip', 'twin'], ['twin'], ['cat1']], ['cat2', 'cat3'], { x3: true });
    h.act({ type: 'draw' }, B);
    h.act({ type: 'play', cards: [h.card(H, 'twin')] }, H);
    expect(h.game().log.at(-1)?.kind).toBe('twin-wait');
    expect(h.hand(A)).toContain('twin');
  });

  it('answers a Twin Bomb’s bark off turn, hiding only the ghost’s bomb', () => {
    const h = withGhost([['skip', 'twin', 'twin'], ['cat1'], ['revive']], ['cat3', 'cat4'], {
      x3: true,
    });
    h.act({ type: 'draw' }, B);
    const twins = h.game().hands[H]!.filter((id) => h.game().cards[id]!.t === 'twin');
    h.act({ type: 'play', cards: twins, target: B }, H);
    expect(h.view(B).game!.prompt).toMatchObject({ kind: 'bomb', twin: true });
    h.act({ type: 'revive', ghost: A }, B);
    h.settle();
    expect(h.game().placing?.kind).toBe('bomb');
    h.act({ type: 'place', position: 0 }, B);
    expect(h.state.stage).toBe('turn');
    // Off turn: the host's turn goes on.
    expect(h.game().turn.player).toBe(H);
  });

  it('blindfolded, a search that turns over a Second Life saves you', () => {
    const h = rigged([['blind'], ['cat1', 'revive'], []], ['cat3', 'bomb'], {
      settings: { ...X4, x2: true },
    });
    h.play(H, ['blind'], { target: A });
    h.act({ type: 'draw' }, H);
    h.act({ type: 'draw' }, A);
    expect(h.state.stage).toBe('search');
    const hand = h.game().hands[A]!;
    const slot = hand.findIndex((id) => h.game().cards[id]!.t === 'revive');
    h.act({ type: 'search', slot }, A);
    expect(h.view(A).game!.prompt).toMatchObject({ kind: 'bomb', revive: { card: true } });
    h.act({ type: 'revive' }, A);
    h.settle();
    h.act({ type: 'place', position: 2 }, A);
    expect(h.game().blind[A]).toBe(true);
    expect(h.state.stage).toBe('turn');
  });

  it('a ghost who lost their Shelter while hiding a bomb blows up again on revival', () => {
    // Ana holds a Bomb with her Shelter, then dies to another bomb; Restless Spirits takes cards.
    const h = rigged(
      [['skip', 'skip'], ['shelter'], ['revive', 'robber']],
      ['bomb', 'bomb', 'bomb'],
      { settings: { ...X4, x2: true } },
    );
    h.play(H, ['skip']);
    h.act({ type: 'draw' }, A);
    expect(h.game().held[A]).not.toBeNull();
    h.act({ type: 'draw' }, B);
    // Ben revives nobody (no ghost yet).
    h.act({ type: 'revive' }, B);
    h.settle();
    h.act({ type: 'place', position: 40 }, B);
    h.play(H, ['skip']);
    // Ana draws the second bomb: the Shelter already holds one, so she explodes.
    h.act({ type: 'draw' }, A);
    expect(h.game().ghosts).toEqual([A]);
    h.fire();
    expect(h.hand(A).sort()).toEqual(['bomb', 'shelter']);
    // Restless Spirits: Ana (blind? no) gives up her Shelter.
    expect(h.game().turn.player).toBe(B);
    h.play(B, ['robber']);
    h.act({ type: 'choose', card: h.card(A, 'shelter') }, A);
    expect(h.hand(A)).toEqual(['bomb']);
    expect(h.game().held[A]).toBeNull();
  });
});

describe('Foresight', () => {
  function reviveWindow() {
    const h = withGhost(
      [['skip', 'seer', 'nope'], ['seer'], ['revive', 'nope']],
      ['bomb', 'cat3', 'cat4'],
    );
    h.act({ type: 'draw' }, B);
    h.act({ type: 'revive', ghost: A }, B);
    return h;
  }

  it('lets its holders watch where the bombs go (ghosts included, not the reviver)', () => {
    const h = reviveWindow();
    expect(h.view(H).game!.canSeer).toBe(true);
    expect(h.view(A).game!.canSeer).toBe(true);
    expect(h.view(B).game!.canSeer).toBe(false);
    h.tick(500);
    h.act({ type: 'seer', window: h.game().window!.id }, H);
    expect(h.reject({ type: 'seer', window: h.game().window!.id }, H)).toBe('no-seer');
    expect(h.view(H).game!.window!.seers).toEqual([{ by: H, chain: [], cancelled: false }]);
    expectSealed(h);
    h.settle();
    h.act({ type: 'place', position: 0 }, B);
    h.act({ type: 'place', position: 2 }, B);
    const watched = h.view(H).game!.memory.filter((m) => m.kind === 'watched');
    expect(watched.map((m) => m.kind === 'watched' && m.position)).toEqual([0, 2]);
    expect(h.view(A).game!.memory.some((m) => m.kind === 'watched')).toBe(false);
    expectSealed(h);
  });

  it('can be Noped (and Noped back); a cancelled one watches nothing', () => {
    const h = reviveWindow();
    h.tick(500);
    const w = () => h.game().window!.id;
    h.act({ type: 'seer', window: w() }, H);
    expect(h.view(B).game!.canNope).toBe(true);
    expect(h.view(H).game!.canNope).toBe(false);
    h.tick(1000);
    h.act({ type: 'nope', window: w() }, B);
    expect(h.view(H).game!.window!.seers[0]).toMatchObject({ cancelled: true, chain: [B] });
    h.tick(1000);
    h.act({ type: 'nope', window: w() }, H);
    expect(h.view(H).game!.window!.seers[0]).toMatchObject({ cancelled: false });
    h.settle();
    h.act({ type: 'place', position: 0 }, B);
    h.act({ type: 'place', position: 0 }, B);
    expect(h.view(H).game!.memory.filter((m) => m.kind === 'watched')).toHaveLength(2);

    const k = reviveWindow();
    k.tick(500);
    k.act({ type: 'seer', window: k.game().window!.id }, H);
    k.tick(1000);
    k.act({ type: 'nope', window: k.game().window!.id }, B);
    k.settle();
    k.act({ type: 'place', position: 0 }, B);
    k.act({ type: 'place', position: 0 }, B);
    expect(k.view(H).game!.memory.some((m) => m.kind === 'watched')).toBe(false);
  });

  it('is refused outside a Second Life’s window and after it closes (the card is kept)', () => {
    const h = reviveWindow();
    const id = h.game().window!.id;
    h.settle();
    expect(h.reject({ type: 'seer', window: id }, H)).toBe('too-late');
    expect(h.hand(H)).toContain('seer');
    const f = rigged([['favor', 'seer'], ['seer'], ['cat1']], [], { settings: X4 });
    f.act({ type: 'play', cards: [f.card(H, 'favor')], target: A }, H);
    expect(f.reject({ type: 'seer', window: f.game().window!.id }, A)).toBe('no-revive');
    expect(f.reject({ type: 'play', cards: [f.card(H, 'seer')] }, H)).toBe('window');
  });
});

describe('Look Twice', () => {
  it('keeps the top card, or puts it back and draws the next', () => {
    const h = rigged([['dig', 'dig'], ['cat1']], ['bomb', 'cat2', 'cat3'], { settings: X4 });
    h.play(H, ['dig']);
    expect(h.view(H).game!.prompt).toMatchObject({ kind: 'dig', card: { t: 'bomb' } });
    expect(h.view(A).game!.prompt).toBeNull();
    expectSealed(h);
    h.act({ type: 'dig', keep: false }, H);
    expect(h.hand(H)).toContain('cat2');
    expect(types(h, [h.game().pile[0]!])).toEqual(['bomb']);
    expect(h.game().turn.player).toBe(A);
  });

  it('with one card left is a plain draw', () => {
    const h = rigged([['dig'], ['cat1']], ['cat2'], { settings: X4 });
    h.game().pile.splice(1);
    h.play(H, ['dig']);
    expect(h.hand(H)).toEqual(['cat2']);
    expect(h.game().turn.player).toBe(A);
  });

  it('sends the kept card to a Mine! placer', () => {
    const h = rigged([['mine'], ['dig']], ['cat5', 'cat2', 'cat3'], {
      settings: { ...X4, x3: true },
    });
    h.play(H, ['mine'], { target: A });
    h.act({ type: 'draw' }, H);
    h.play(A, ['dig']);
    h.act({ type: 'dig', keep: true }, A);
    expect(h.hand(H)).toContain('cat2');
    expect(h.hand(A)).toEqual([]);
  });
});

describe('Ghost Attack, Feed the Ghosts, Restless Spirits', () => {
  it('Ghost Attack needs a ghost and sends 3 turns a ghost (stacking)', () => {
    const r = rigged([['ghostattack'], ['cat1']], [], { settings: X4 });
    expect(r.reject({ type: 'play', cards: [r.card(H, 'ghostattack')] }, H)).toBe('no-ghosts');
    const h = withGhost([['skip'], ['cat1'], ['ghostattack']], ['cat2', 'cat3']);
    h.play(B, ['ghostattack']);
    expect(h.game().turn).toMatchObject({ player: H, owed: 3, chained: true });
  });

  it('Feed the Ghosts: every living player but the feeder gives a card, never a bomb', () => {
    const h = withGhost([['skip', 'cat5'], ['feed'], ['cat1', 'defuse']], ['cat2', 'cat3']);
    // Ana, a ghost, feeds herself off turn.
    expect(h.view(A).game!.canNow).toBe(true);
    h.play(A, ['feed'], { target: A });
    expect(h.state.stage).toBe('each');
    expect(h.game().each?.order.sort()).toEqual([H, B].sort());
    h.act({ type: 'choose', card: h.card(H, 'cat5') }, H);
    h.act({ type: 'choose', card: h.card(B, 'cat1') }, B);
    expect(h.hand(A).sort()).toEqual(['cat1', 'cat5']);
    expect(h.view(B).game!.memory.some((m) => m.kind === 'gave' && m.how === 'feed')).toBe(true);
    expect(h.game().turn.player).toBe(B);
  });

  it('Feed the Ghosts refuses a bomb and skips players holding only bombs', () => {
    const h = withGhost(
      [['skip', 'shelter', 'feed'], ['cat1'], ['cat2']],
      ['cat3', 'bomb', 'cat4'],
      { x2: true },
    );
    // The host draws a bomb and keeps it with the Shelter; then feeds Ana.
    h.act({ type: 'draw' }, B);
    h.act({ type: 'draw' }, H);
    expect(h.game().held[H]).not.toBeNull();
    h.play(H, ['feed'], { target: A });
    expect(h.game().each?.order).toEqual([B]);
    expect(h.reject({ type: 'choose', card: h.card(H, 'bomb') }, H)).toBe('not-asked');
    // A giver holding a bomb (moved there for the test) can't hand it over.
    const g = h.game();
    const bomb = g.pile.find((id) => g.cards[id]!.t === 'bomb')!;
    g.pile.splice(g.pile.indexOf(bomb), 1);
    g.hands[B]!.push(bomb);
    expect(h.reject({ type: 'choose', card: bomb }, B)).toBe('no-bomb');
    g.hands[B]!.pop();
    g.pile.push(bomb);
    h.act({ type: 'choose', card: h.card(B, 'cat3') }, B);
    expect(h.hand(A)).toContain('cat3');
    // The host's held bomb can't go to the ghost.
    expect(h.hand(H)).toContain('bomb');
  });

  it('Restless Spirits: every ghost with cards puts one in, then the pile is shuffled', () => {
    const r = rigged([['robber'], ['cat1']], [], { settings: X4 });
    expect(r.reject({ type: 'play', cards: [r.card(H, 'robber')] }, H)).toBe('no-ghosts');
    const h = withGhost([['skip'], ['cat1', 'nope'], ['robber']], ['cat2', 'cat3']);
    const n = h.game().pile.length;
    h.play(B, ['robber']);
    expect(h.game().each?.order).toEqual([A]);
    expect(h.view(A).game!.prompt).toMatchObject({ kind: 'each', what: 'robber' });
    h.act({ type: 'choose', card: h.card(A, 'cat1') }, A);
    expect(h.game().pile.length).toBe(n + 1);
    expect(h.hand(A)).toEqual(['nope']);
    expect(h.game().turn.player).toBe(B);
  });

  it('Shuffle NOW works off turn; Recycle skips ghosts; Share still shows a ghost next seat', () => {
    const h = withGhost(
      [['skip', 'share3', 'cat5'], ['cat1'], ['shufflenow', 'recycle', 'cat2']],
      ['cat2', 'cat3', 'cat4', 'cat5'],
      { x2: true, x3: true },
    );
    h.play(B, ['recycle']);
    expect(h.game().each?.order.sort()).toEqual([H, B].sort());
    h.act({ type: 'choose', card: h.card(B, 'cat2') }, B);
    h.act({ type: 'choose', card: h.card(H, 'cat5') }, H);
    h.act({ type: 'draw' }, B);
    h.play(H, ['share3']);
    expect(h.game().alter?.share).toBe(A);
    h.act({ type: 'order', order: [0, 1, 2] }, H);
    expect(h.view(A).game!.memory.some((m) => m.kind === 'shared')).toBe(true);
  });
});

describe('Copy', () => {
  it('becomes the top card of the discard pile, Nope window and all', () => {
    const h = rigged([['favor', 'copy'], ['cat1', 'cat2'], ['cat3']], [], { settings: X4 });
    h.play(H, ['favor'], { target: A });
    h.act({ type: 'give', card: h.card(A, 'cat1') }, A);
    expect(h.view(H).game!.copyAs).toBe('favor');
    h.act({ type: 'play', cards: [h.card(H, 'copy')], target: A }, H);
    expect(h.game().pending).toMatchObject({ t: 'favor', copied: true });
    h.settle();
    expect(h.state.stage).toBe('favor');
  });

  it('is refused on another Copy, a cat someone else played and off your turn', () => {
    const h = rigged(
      [
        ['copy', 'copy', 'cat1', 'cat1'],
        ['cat2', 'cat2', 'copy', 'copy'],
      ],
      [],
      {
        settings: X4,
      },
    );
    expect(h.view(H).game!.copyAs).toBeNull();
    expect(h.reject({ type: 'play', cards: [h.card(H, 'copy')] }, H)).toBe('copy');
    // A pair of cats, then a Copy pairs with the matching cat in hand.
    const cats = h.game().hands[H]!.filter((id) => h.game().cards[id]!.t === 'cat1');
    h.act({ type: 'play', cards: cats, target: A }, H);
    h.settle();
    expect(h.view(H).game!.copyAs).toBe('cat1');
    expect(h.reject({ type: 'play', cards: [h.card(H, 'copy')] }, H)).toBe('cat-alone');
    h.act({ type: 'draw' }, H);
    // Ana: the cat on top was played by the host.
    expect(h.view(A).game!.copyAs).toBeNull();
    expect(
      h.reject({ type: 'play', cards: [h.card(A, 'copy'), h.card(A, 'cat2')], target: H }, A),
    ).toBe('copy');
  });

  it('pairs with the cat you just played', () => {
    const h = rigged(
      [
        ['cat1', 'cat1', 'copy', 'cat1'],
        ['cat2', 'cat3'],
      ],
      [],
      { settings: X4 },
    );
    const two = h
      .game()
      .hands[H]!.filter((id) => h.game().cards[id]!.t === 'cat1')
      .slice(0, 2);
    h.act({ type: 'play', cards: two, target: A }, H);
    h.settle();
    h.act({ type: 'play', cards: [h.card(H, 'copy'), h.card(H, 'cat1')], target: A }, H);
    expect(h.game().pending).toMatchObject({ kind: 'pair', t: 'cat1', copied: true });
    h.settle();
    expect(h.hand(A)).toHaveLength(0);
  });

  it('copies a Second Life on the discard pile to save you, on your own turn only', () => {
    const h = rigged([['revive', 'cat1'], ['copy']], ['bomb', 'bomb'], { settings: X4 });
    h.act({ type: 'draw' }, H);
    h.act({ type: 'revive' }, H);
    h.settle();
    h.act({ type: 'place', position: 5 }, H);
    expect(types(h, [h.game().discard.at(-1)!])).toEqual(['revive']);
    h.act({ type: 'draw' }, A);
    expect(h.view(A).game!.prompt).toMatchObject({
      kind: 'bomb',
      revive: { card: false, copy: true },
    });
    h.act({ type: 'revive', copy: true }, A);
    expect(h.game().pending).toMatchObject({ t: 'revive', copied: true });
    h.settle();
    h.act({ type: 'place', position: 0 }, A);
    expect(h.hand(A)).toEqual([]);
  });
});

describe('strict timing, Act for and leaving with ghosts', () => {
  it('strict: a Second Life brings back a random ghost and the bombs are hidden at random', () => {
    const k = withGhost([['skip'], ['cat1'], ['revive']], ['bomb', 'cat2', 'cat3'], {
      strict: true,
      decisionSeconds: 20,
    });
    k.act({ type: 'draw' }, B);
    k.fire();
    expect(k.state.stage).toBe('window');
    expect(k.game().pending?.target).toBe(A);
    k.fire();
    k.fire();
    k.fire();
    expect(k.state.stage).toBe('turn');
    expect(k.game().ghosts).toEqual([]);
  });

  it('strict: Look Twice keeps the card, Feed gives a card that isn’t a bomb', () => {
    const h = withGhost([['skip', 'cat4'], ['cat1'], ['dig', 'feed', 'cat5']], ['cat2', 'cat3'], {
      strict: true,
      decisionSeconds: 20,
    });
    h.play(B, ['dig']);
    h.fire();
    expect(h.hand(B)).toContain('cat2');
    expect(h.game().turn.player).toBe(H);
    h.play(B, ['feed'], { target: A });
    expect(h.game().each?.order).toEqual([H]);
    h.fire();
    expect(h.hand(A)).toHaveLength(2);
    expect(h.game().cards[h.game().hands[A]!.at(-1)!]!.t).not.toBe('bomb');
  });

  it('a ghost who leaves mid-rearrange doesn’t leave the table waiting', () => {
    const h = withGhost([['skip', 'cat5'], ['alter3now'], ['cat1']], ['cat2', 'cat3', 'cat4'], {
      x3: true,
    });
    h.play(A, ['alter3now']);
    expect(h.state.stage).toBe('alter');
    h.state = shortFuse.playerLeft(h.state, A, h.now);
    expect(h.state.stage).toBe('turn');
    expect(h.game().ghosts).toEqual([]);
  });

  it('a player who explodes while leaving is not counted as a ghost', () => {
    const h = rigged([['blind', 'ghostattack'], ['cat1'], ['cat2']], ['cat3', 'bomb'], {
      settings: { ...X4, x2: true },
    });
    h.play(H, ['blind'], { target: A });
    h.act({ type: 'draw' }, H);
    h.act({ type: 'draw' }, A);
    expect(h.state.stage).toBe('search');
    h.state = shortFuse.playerLeft(h.state, A, h.now);
    expect(h.game().ghosts).toEqual([]);
    expect(h.game().left).toEqual([A]);
  });

  it('a ghost who leaves takes their hand and Vault out of the game', () => {
    const h = withGhost([['skip'], ['cat1', 'nope'], ['cat2']], ['cat3']);
    const before = everyCard(h.game()).length;
    h.state = shortFuse.playerLeft(h.state, A, h.now);
    expect(h.game().ghosts).toEqual([]);
    expect(h.game().left).toEqual([A]);
    expect(h.hand(A)).toEqual([]);
    expect(everyCard(h.game()).length).toBe(before);
  });
});

describe('the card table', () => {
  it('lists every fourth-expansion card once', () => {
    for (const t of [
      'revive',
      'dig',
      'ghostattack',
      'feed',
      'copy',
      'seer',
      'robber',
      'shufflenow',
    ])
      expect(CARD_TYPES).toContain(t);
  });
});
