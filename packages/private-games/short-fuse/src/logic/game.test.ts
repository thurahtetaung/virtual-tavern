import { describe, expect, it } from 'vitest';
import { comboOf, shortFuse } from './game.ts';
import { HOST, everyCard, harness, ids, rigged } from './test-utils.ts';

const [A, B, C, D] = ids(4) as [string, string, string, string];

describe('lobby', () => {
  it('seats up to ten and starts with two or more', () => {
    const h = harness([HOST]);
    expect(h.reject({ type: 'start' })).toBe('too-few');
    const big = harness(ids(10));
    big.state = shortFuse.playerJoined(big.state, { id: 'x', name: 'X' });
    expect(big.view('x').me?.playing).toBe(false);
    expect(big.reject({ type: 'sit', playing: true }, 'x')).toBe('full');
  });

  it('only the host changes settings, and presets set the deck', () => {
    const h = harness();
    expect(h.reject({ type: 'update-settings', x1: true }, B)).toBe('not-host');
    h.act({ type: 'update-settings', preset: 'adult' });
    expect(h.view(A).preset).toBe('adult');
    expect(h.state.settings).toMatchObject({ core: 'classic', art: 'adult' });
    h.act({ type: 'update-settings', preset: 'party', x1: true });
    expect(h.view(A).preset).toBe('party');
    expect(h.view(A).readout.void).toBe(true);
  });

  it('refuses the test rig unless the server enables it', async () => {
    const { enableTestRig } = await import('./game.ts');
    enableTestRig(false);
    const h = harness();
    expect(h.reject({ type: 'rig', hands: [], top: [], first: 0 })).toBe('no-rig');
    enableTestRig(true);
  });
});

describe('turns and attacks', () => {
  it('drawing ends your turn and play passes in seat order', () => {
    const h = rigged([['skip'], ['skip'], ['skip']], ['cat1', 'cat2', 'cat3']);
    expect(h.game().turn.player).toBe(A);
    h.act({ type: 'draw' }, A);
    expect(h.game().turn.player).toBe(B);
    expect(h.hand(A)).toEqual(['skip', 'cat1']);
    expect(h.reject({ type: 'draw' }, A)).toBe('not-your-turn');
  });

  it('stacks attacks: 2, then 2 + 2, then 1 + 2', () => {
    const h = rigged(
      [['attack', 'attack'], ['attack'], ['attack', 'attack']],
      ['cat1', 'cat2', 'cat3', 'cat4', 'cat5'],
    );
    h.play(A, ['attack']);
    expect(h.game().turn).toMatchObject({ player: B, owed: 2, chained: true });
    h.play(B, ['attack']);
    expect(h.game().turn).toMatchObject({ player: C, owed: 4 });
    h.act({ type: 'draw' }, C);
    expect(h.game().turn).toMatchObject({ player: C, owed: 3 });
    h.play(C, ['attack']);
    expect(h.game().turn).toMatchObject({ player: A, owed: 5 });
  });

  it('legacy non-stacking attacks pass on just two', () => {
    const h = rigged([['attack'], ['attack']], [], {
      players: ids(3),
      settings: { nonStacking: true },
    });
    h.play(A, ['attack']);
    h.play(B, ['attack']);
    expect(h.game().turn).toMatchObject({ player: C, owed: 2 });
  });

  it('a targeted attack picks any other player and play goes on from them', () => {
    const h = rigged([['aim'], [], [], []], ['cat1', 'cat2', 'cat3'], { settings: { x1: true } });
    expect(h.reject({ type: 'play', cards: [h.card(A, 'aim')], target: A }, A)).toBe('self');
    h.play(A, ['aim'], { target: C });
    expect(h.game().turn).toMatchObject({ player: C, owed: 2 });
    h.act({ type: 'draw' }, C);
    h.act({ type: 'draw' }, C);
    expect(h.game().turn.player).toBe(D);
  });

  it('skip ends one owed turn, reverse flips the order and ends one', () => {
    const h = rigged([['attack'], ['skip', 'reverse'], []], ['cat1', 'cat2', 'cat3'], {
      settings: { x1: true },
    });
    h.play(A, ['attack']);
    h.play(B, ['skip']);
    expect(h.game().turn).toMatchObject({ player: B, owed: 1 });
    h.play(B, ['reverse']);
    expect(h.game().turn).toMatchObject({ player: A, owed: 1, dir: -1 });
  });

  it('reverse with two players is just a skip', () => {
    const h = rigged([['reverse'], []], [], { settings: { x1: true } });
    h.play(A, ['reverse']);
    expect(h.game().turn).toMatchObject({ player: B, dir: 1 });
  });

  it('draw from the bottom takes the bottom card and ends the turn', () => {
    const h = rigged([['bottom'], []], ['cat1'], { settings: { x1: true } });
    const bottom = h.game().pile.at(-1)!;
    h.play(A, ['bottom']);
    expect(h.game().hands[A]).toContain(bottom);
    expect(h.game().turn.player).toBe(B);
  });
});

describe('the Nope window', () => {
  it('always runs its full length, even with no Nope at the table', () => {
    const h = rigged([['skip'], ['cat1'], ['cat2']], []);
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    expect(h.state.stage).toBe('window');
    expect(shortFuse.nextDeadline!(h.state)).toBe(h.now + 4000);
    h.tick(3999);
    expect(shortFuse.onDeadline!(h.state, h.now).stage).toBe('window');
    h.tick(1);
    h.state = shortFuse.onDeadline!(h.state, h.now);
    expect(h.game().turn.player).toBe(B);
  });

  it('a Nope cancels, a Nope on that makes it go ahead, and each restarts the clock', () => {
    const h = rigged([['attack', 'nope'], ['nope'], ['nope']], ['cat1', 'cat2', 'cat3']);
    h.act({ type: 'play', cards: [h.card(A, 'attack')] }, A);
    const w = h.game().window!.id;
    expect(h.view(B).game!.canNope).toBe(true);
    expect(h.view(A).game!.canNope).toBe(false);
    h.tick(1000);
    h.act({ type: 'nope', window: w }, B);
    expect(h.game().window!.endsAt).toBe(h.now + 4000);
    expect(h.view(C).game!.window!.cancelled).toBe(true);
    expect(h.reject({ type: 'nope', window: w }, B)).toBe('no-nope');
    h.tick(900);
    h.act({ type: 'nope', window: w }, A);
    expect(h.view(C).game!.window!.cancelled).toBe(false);
    h.settle();
    expect(h.game().turn).toMatchObject({ player: B, owed: 2 });
    expect(h.game().discard.map((id) => h.game().cards[id]!.t)).toEqual(['attack', 'nope', 'nope']);
  });

  it('a cancelled attack leaves the attacker still on their turn', () => {
    const h = rigged([['attack'], ['nope']], ['cat1']);
    h.act({ type: 'play', cards: [h.card(A, 'attack')] }, A);
    h.act({ type: 'nope', window: h.game().window!.id }, B);
    h.settle();
    expect(h.game().turn).toMatchObject({ player: A, owed: 1 });
    expect(h.state.stage).toBe('turn');
  });

  it('refuses a late Nope, a Nope inside the cooldown and your own play, keeping the card', () => {
    const h = rigged([['skip', 'nope'], ['nope'], ['nope']], []);
    expect(h.reject({ type: 'nope', window: 0 }, B)).toBe('too-late');
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    const w = h.game().window!.id;
    expect(h.reject({ type: 'nope', window: w }, A)).toBe('own');
    h.act({ type: 'nope', window: w }, B);
    h.tick(500);
    expect(h.reject({ type: 'nope', window: w }, C)).toBe('too-soon');
    expect(h.hand(C)).toEqual(['nope']);
    h.tick(4000);
    expect(h.reject({ type: 'nope', window: w }, C)).toBe('too-late');
    expect(h.reject({ type: 'nope', window: w + 1 }, C)).toBe('too-late');
    expect(h.hand(C)).toEqual(['nope']);
  });

  it('blocks every other move while it runs', () => {
    const h = rigged([['skip', 'favor'], ['cat1']], []);
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    expect(h.reject({ type: 'draw' }, A)).toBe('window');
    expect(h.reject({ type: 'play', cards: [h.card(A, 'favor')], target: B }, A)).toBe('window');
  });

  it('never opens for a draw, a Bomb or a Defuse', () => {
    const h = rigged([['defuse'], []], ['bomb']);
    h.act({ type: 'draw' }, A);
    expect(h.state.stage).toBe('bomb');
    h.act({ type: 'defuse' }, A);
    expect(h.state.stage).toBe('place');
    expect(shortFuse.nextDeadline!(h.state)).toBeNull();
  });

  it('uses the host’s window length', () => {
    const h = rigged([['skip'], []], [], { settings: { nopeSeconds: 7 } });
    h.act({ type: 'play', cards: [h.card(A, 'skip')] }, A);
    expect(h.view(B).game!.window).toMatchObject({ seconds: 7, endsAt: h.now + 7000 });
  });
});

describe('cards', () => {
  it('favor: the target picks the card to give', () => {
    const h = rigged([['favor'], ['cat1', 'defuse'], []], []);
    expect(h.reject({ type: 'play', cards: [h.card(A, 'favor')] }, A)).toBe('need-target');
    h.play(A, ['favor'], { target: B });
    expect(h.state.stage).toBe('favor');
    expect(h.view(B).game!.prompt).toEqual({ kind: 'give', to: A });
    expect(h.reject({ type: 'give', card: h.card(B, 'cat1') }, C)).toBe('not-asked');
    h.act({ type: 'give', card: h.card(B, 'cat1') }, B);
    expect(h.hand(A)).toEqual(['cat1']);
    expect(h.game().memory[A]!.at(-1)).toMatchObject({ kind: 'got', other: B, how: 'favor' });
    expect(h.state.stage).toBe('turn');
  });

  it('nobody with an empty hand can be asked', () => {
    const h = rigged([['favor', 'cat1', 'cat1'], [], ['cat2']], []);
    expect(h.reject({ type: 'play', cards: [h.card(A, 'favor')], target: B }, A)).toBe(
      'empty-hand',
    );
    const cats = h.game().hands[A]!.filter((id) => h.game().cards[id]!.t === 'cat1');
    expect(h.reject({ type: 'play', cards: cats, target: B }, A)).toBe('empty-hand');
  });

  it('shuffle reorders the pile and marks old peeks stale', () => {
    const h = rigged([['peek3', 'shuffle'], []], ['cat1', 'cat2', 'cat3', 'cat4', 'cat5', 'skip']);
    h.play(A, ['peek3']);
    const seen = h.view(A).game!.memory.at(-1)!;
    expect(seen).toMatchObject({ kind: 'peek', version: 0 });
    expect(seen.kind === 'peek' && seen.cards.map((c) => c.t)).toEqual(['cat1', 'cat2', 'cat3']);
    expect(h.view(B).game!.memory).toEqual([]);
    h.play(A, ['shuffle']);
    expect(h.view(A).game!.pile.version).toBe(1);
  });

  it('rearrange shows the top three and puts them back in the chosen order', () => {
    const h = rigged([['alter3'], []], ['cat1', 'cat2', 'cat3', 'cat4'], {
      settings: { x1: true },
    });
    h.play(A, ['alter3']);
    const p = h.view(A).game!.prompt;
    expect(p?.kind === 'alter' && p.cards.map((c) => c.t)).toEqual(['cat1', 'cat2', 'cat3']);
    expect(h.reject({ type: 'order', order: [0, 0, 1] }, A)).toBe('bad-order');
    h.act({ type: 'order', order: [2, 0, 1] }, A);
    expect(
      h
        .game()
        .pile.slice(0, 4)
        .map((id) => h.game().cards[id]!.t),
    ).toEqual(['cat3', 'cat1', 'cat2', 'cat4']);
    expect(h.state.stage).toBe('turn');
  });

  it('lone cats, Nopes and Defuses can’t be played as actions', () => {
    const h = rigged([['cat1', 'nope', 'defuse'], []], []);
    expect(h.reject({ type: 'play', cards: [h.card(A, 'cat1')] }, A)).toBe('cat-alone');
    expect(h.reject({ type: 'play', cards: [h.card(A, 'nope')] }, A)).toBe('nothing-to-nope');
    expect(h.reject({ type: 'play', cards: [h.card(A, 'defuse')] }, A)).toBe('no-bomb');
  });
});

describe('combos', () => {
  it('matches by name, with the wild cat for any cat', () => {
    expect(comboOf(['cat1', 'cat1'], false)).toEqual({ kind: 'pair', t: 'cat1' });
    expect(comboOf(['cat1', 'wild'], false)).toEqual({ kind: 'pair', t: 'cat1' });
    expect(comboOf(['wild', 'wild'], false)).toEqual({ kind: 'pair', t: 'wild' });
    expect(comboOf(['skip', 'skip', 'skip'], false)).toEqual({ kind: 'triple', t: 'skip' });
    expect('error' in comboOf(['skip', 'wild'], false)).toBe(true);
    expect('error' in comboOf(['cat1', 'cat2'], false)).toBe(true);
    expect('error' in comboOf(['cat1', 'cat2', 'cat3', 'cat4', 'cat5'], false)).toBe(true);
    expect(comboOf(['cat1', 'cat2', 'cat3', 'cat4', 'cat5'], true)).toEqual({
      kind: 'five',
      t: null,
    });
    expect('error' in comboOf(['cat1', 'cat1', 'cat3', 'cat4', 'cat5'], true)).toBe(true);
  });

  it('a pair steals a random card; both players learn which', () => {
    const h = rigged([['cat1', 'wild'], ['skip']], [], { settings: { x1: true } });
    h.play(A, ['cat1', 'wild'], { target: B });
    expect(h.hand(A)).toEqual(['skip']);
    expect(h.game().memory[B]!.at(-1)).toMatchObject({ kind: 'gave', other: A, how: 'pair' });
    expect(h.view(C ?? A).game!.log.at(-1)).toMatchObject({ kind: 'steal', by: A, target: B });
  });

  it('three of a kind takes the named card if they have it', () => {
    const h = rigged(
      [
        ['skip', 'skip', 'skip', 'cat1', 'cat1', 'cat1'],
        ['defuse', 'favor'],
      ],
      [],
    );
    expect(h.reject({ type: 'play', cards: h.game().hands[A]!.slice(0, 3), target: B }, A)).toBe(
      'need-name',
    );
    h.play(A, ['skip', 'skip', 'skip'], { target: B, named: 'defuse' });
    expect(h.hand(A)).toContain('defuse');
    expect(h.game().log.at(-1)).toMatchObject({ kind: 'ask', named: 'defuse', hit: true });
    h.play(A, ['cat1', 'cat1', 'cat1'], { target: B, named: 'nope' });
    expect(h.game().log.at(-1)).toMatchObject({ kind: 'ask', named: 'nope', hit: false });
    expect(h.hand(B)).toEqual(['favor']);
  });

  it('five different (legacy) takes any card from the discard pile', () => {
    const h = rigged([['skip', 'favor', 'cat1', 'cat2', 'cat3', 'shuffle'], []], [], {
      settings: { fiveCombo: true },
    });
    h.play(A, ['shuffle']);
    h.play(A, ['skip', 'favor', 'cat1', 'cat2', 'cat3']);
    expect(h.state.stage).toBe('salvage');
    const p = h.view(A).game!.prompt;
    expect(p?.kind).toBe('salvage');
    const shuffle = h.game().discard.find((id) => h.game().cards[id]!.t === 'shuffle')!;
    h.act({ type: 'salvage', card: shuffle }, A);
    expect(h.hand(A)).toEqual(['shuffle']);
  });
});

describe('bombs', () => {
  it('a Defuse saves you; you hide the Bomb in secret and your turn ends', () => {
    const h = rigged([['defuse'], [], []], ['bomb', 'cat1', 'cat2']);
    h.act({ type: 'draw' }, A);
    expect(h.view(B).game!.busy).toEqual({ who: A, what: 'bomb' });
    expect(h.view(B).game!.drawnKind).toBe('bomb');
    h.act({ type: 'defuse' }, A);
    const count = h.game().pile.length;
    expect(h.view(A).game!.prompt).toMatchObject({ kind: 'place', count });
    expect(h.reject({ type: 'place', position: count + 1 }, A)).toBe('bad-position');
    h.act({ type: 'place', position: 1 }, A);
    expect(
      h
        .game()
        .pile.slice(0, 3)
        .map((id) => h.game().cards[id]!.t),
    ).toEqual(['cat1', 'bomb', 'cat2']);
    expect(h.game().turn.player).toBe(B);
    expect(h.view(A).game!.memory.at(-1)).toMatchObject({
      kind: 'placed',
      position: 1,
      of: count + 1,
    });
    expect(h.view(B).game!.memory).toEqual([]);
    expect(h.view(B).game!.pile.bombsOut).toBe(2);
  });

  it('defusing under attack ends only one turn', () => {
    const h = rigged([['attack'], ['defuse'], []], ['bomb', 'cat1', 'cat2']);
    h.play(A, ['attack']);
    h.act({ type: 'draw' }, B);
    h.act({ type: 'defuse' }, B);
    h.act({ type: 'place', position: 2 }, B);
    expect(h.game().turn).toMatchObject({ player: B, owed: 1 });
  });

  it('without a Defuse you explode: hand out, Bomb in front, owed turns gone', () => {
    const h = rigged([['attack'], ['cat1'], []], ['bomb', 'cat1', 'cat2']);
    h.play(A, ['attack']);
    h.act({ type: 'draw' }, B);
    const g = h.game();
    expect(g.dead).toEqual([{ id: B, turn: 2 }]);
    expect(g.hands[B]).toEqual([]);
    expect(g.front[B]!.map((id) => g.cards[id]!.t)).toEqual(['bomb']);
    expect(h.state.stage).toBe('beat');
    expect(h.view(B).game!.hand).toBeNull();
    expect(h.view(B).game!.pile.bombsOut).toBe(1);
    h.fire();
    expect(h.game().turn).toMatchObject({ player: C, owed: 1 });
    expect(h.reject({ type: 'draw' }, B)).toBe('out');
    expect(everyCard(h.game()).length).toBe(Object.keys(h.game().cards).length);
  });

  it('the last player standing wins', () => {
    const h = rigged([[], []], ['bomb']);
    h.act({ type: 'draw' }, A);
    expect(h.state.phase).toBe('over');
    expect(h.game().winner).toBe(B);
    expect(h.view(B).game!.end?.winner).toBe(B);
    h.act({ type: 'play-again' });
    expect(h.state.phase).toBe('playing');
    expect(h.game().winner).toBeNull();
  });

  it('the Black Hole goes back face up; drawn face up it can’t be stopped', () => {
    const h = rigged([['defuse'], ['defuse'], []], ['void', 'cat1', 'cat2', 'cat3'], {
      settings: { x1: true },
    });
    expect(h.view(B).game!.pile.void).toBe('hidden');
    h.act({ type: 'draw' }, A);
    expect(h.view(A).game!.prompt).toMatchObject({ kind: 'place', void: true });
    expect(h.view(B).game!.drawnKind).toBe('void');
    h.act({ type: 'place', position: 0 }, A);
    expect(h.view(C).game!.pile).toMatchObject({ void: 'up', voidEdge: 0, voidTop: true });
    h.act({ type: 'draw' }, B);
    expect(h.game().dead.map((d) => d.id)).toEqual([B]);
    expect(h.game().hands[B]).toEqual([]);
  });

  it('shows the face-up Black Hole roughly in a tall pile', () => {
    const h = rigged([['defuse'], []], ['void'], { settings: { x1: true } });
    h.act({ type: 'draw' }, A);
    const count = h.game().pile.length;
    h.act({ type: 'place', position: count }, A);
    const pile = h.view(B).game!.pile;
    expect(count).toBeGreaterThan(24);
    expect(pile).toMatchObject({ void: 'up', edges: 24, voidEdge: 23, voidTop: false });
  });
});

describe('timers, act for and leaving', () => {
  it('the soft clock never acts; strict timing makes the safe move', () => {
    const h = rigged([[], []], ['cat1', 'cat2']);
    expect(h.view(A).game!.decisionEnds).toBe(h.now + 45_000);
    expect(shortFuse.nextDeadline!(h.state)).toBeNull();
    const s = rigged([[], []], ['cat1', 'cat2'], {
      settings: { strict: true, decisionSeconds: 20 },
    });
    expect(shortFuse.nextDeadline!(s.state)).toBe(s.now + 20_000);
    s.fire();
    expect(s.hand(A)).toEqual(['cat1']);
    expect(s.game().log.at(-1)).toMatchObject({ kind: 'timeout', by: A, did: 'drew a card' });
  });

  it('strict timing defuses and hides a Bomb at random', () => {
    const h = rigged([['defuse'], []], ['bomb', 'cat1'], {
      settings: { strict: true, decisionSeconds: 20 },
    });
    const count = h.game().pile.length;
    h.act({ type: 'draw' }, A);
    h.fire();
    expect(h.state.stage).toBe('place');
    h.fire();
    expect(h.game().turn.player).toBe(B);
    expect(h.game().pile.length).toBe(count);
  });

  it('the host acts for a player the table waits on, and nobody else can', () => {
    const h = rigged([['favor'], ['cat1', 'cat2'], []], []);
    h.play(A, ['favor'], { target: B });
    expect(h.reject({ type: 'act-for', player: B }, C)).toBe('not-host');
    expect(h.reject({ type: 'act-for', player: C })).toBe('not-waiting');
    h.act({ type: 'act-for', player: B });
    expect(h.hand(A).length).toBe(1);
    expect(h.game().log.at(-1)).toMatchObject({ kind: 'act-for', target: B });
  });

  it('nudges whoever the table waits on, not too often', () => {
    const h = rigged([[], [], []], []);
    h.act({ type: 'nudge', player: A }, B);
    expect(h.reject({ type: 'nudge', player: A }, C)).toBe('too-soon');
    expect(h.reject({ type: 'nudge', player: B }, C)).toBe('not-waiting');
  });

  it('a player who leaves mid-turn is out and play moves on', () => {
    const h = rigged([['skip'], [], []], ['bomb']);
    h.state = shortFuse.playerLeft(h.state, A, h.now);
    expect(h.game().left).toEqual([A]);
    expect(h.game().turn.player).toBe(B);
    expect(h.game().hands[A]).toEqual([]);
    h.state = shortFuse.playerLeft(h.state, C, h.now);
    expect(h.state.phase).toBe('over');
    expect(h.game().winner).toBe(B);
  });

  it('a Favor target who leaves just gives nothing', () => {
    const h = rigged([['favor'], ['cat1'], []], []);
    h.play(A, ['favor'], { target: B });
    h.state = shortFuse.playerLeft(h.state, B, h.now);
    expect(h.state.stage).toBe('turn');
    expect(h.game().turn.player).toBe(A);
  });

  it('a drawer who leaves while hiding a Bomb puts it back somewhere', () => {
    const h = rigged([['defuse'], [], []], ['bomb', 'cat1']);
    const count = h.game().pile.length;
    h.act({ type: 'draw' }, A);
    h.act({ type: 'defuse' }, A);
    h.state = shortFuse.playerLeft(h.state, A, h.now);
    expect(h.game().limbo).toBeNull();
    expect(h.game().pile.length).toBe(count);
    expect(h.game().turn.player).toBe(B);
    expect(h.state.stage).toBe('turn');
  });
});
