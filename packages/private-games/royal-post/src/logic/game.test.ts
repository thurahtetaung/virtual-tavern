import { describe, expect, it } from 'vitest';
import { deckOf, royalPost, tokensToWin } from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  THREE,
  cardsEverywhere,
  current,
  hand,
  harness,
  isOut,
  leave,
  order,
  rig,
  startedGame,
} from './test-utils.ts';
import { EDITIONS, type Role, type RoyalPostState } from './types.ts';

const count = (cards: Role[]) =>
  cards.reduce<Record<string, number>>((m, c) => ({ ...m, [c]: (m[c] ?? 0) + 1 }), {});

/** A started three-player game with the turn order fixed as host, ana, ben. */
function table(edition: 'classic' | '2019' = 'classic', ids = THREE) {
  const h = startedGame(ids, edition);
  h.state = { ...h.state, round: { ...h.state.round!, order: [...ids], current: ids[0]! } };
  return h;
}

const lastLog = (s: RoyalPostState) => s.log.at(-1)!;
const logOf = (s: RoyalPostState, kind: string) => s.log.filter((e) => e.kind === kind);

describe('editions', () => {
  it('builds the classic 16-card deck and the 2019 21-card deck', () => {
    expect(deckOf(EDITIONS.classic)).toHaveLength(16);
    expect(count(deckOf(EDITIONS.classic))).toEqual({
      guard: 5,
      priest: 2,
      baron: 2,
      handmaid: 2,
      prince: 2,
      king: 1,
      countess: 1,
      princess: 1,
    });
    expect(deckOf(EDITIONS['2019'])).toHaveLength(21);
    expect(count(deckOf(EDITIONS['2019']))).toEqual({
      spy: 2,
      guard: 6,
      priest: 2,
      baron: 2,
      handmaid: 2,
      prince: 2,
      chancellor: 2,
      king: 1,
      countess: 1,
      princess: 1,
    });
  });

  it('ranks the King, Countess and Princess one higher in 2019', () => {
    const rank = (e: 'classic' | '2019', r: Role) =>
      EDITIONS[e].cards.find((c) => c.role === r)?.rank;
    expect([
      rank('classic', 'king'),
      rank('classic', 'countess'),
      rank('classic', 'princess'),
    ]).toEqual([6, 7, 8]);
    expect([rank('2019', 'spy'), rank('2019', 'chancellor'), rank('2019', 'princess')]).toEqual([
      0, 6, 9,
    ]);
  });

  it('sets the token target by edition and player count', () => {
    expect([2, 3, 4].map((n) => tokensToWin(EDITIONS.classic, n))).toEqual([7, 5, 4]);
    expect([2, 3, 4, 5, 6].map((n) => tokensToWin(EDITIONS['2019'], n))).toEqual([6, 5, 4, 3, 3]);
    expect(startedGame(FOUR, 'classic').state.target).toBe(4);
    expect(startedGame([HOST, 'ana'], '2019').state.target).toBe(6);
    const five = harness(['host', 'a', 'b', 'c', 'd']);
    five.act({ type: 'update-settings', edition: '2019' });
    five.act({ type: 'sit', playing: true }, 'd');
    five.act({ type: 'start' });
    expect(five.state.target).toBe(3);
  });

  it('shows the lobby the target for the players seated now', () => {
    const h = harness(FOUR);
    expect(royalPost.view(h.state, HOST).target).toBe(4);
    h.act({ type: 'update-settings', edition: '2019' });
    expect(royalPost.view(h.state, HOST).target).toBe(4);
    h.act({ type: 'sit', playing: false }, 'cy');
    expect(royalPost.view(h.state, HOST).target).toBe(5);
  });

  it('plays a short game to two tokens fewer, never below 2', () => {
    expect([2, 3, 4].map((n) => tokensToWin(EDITIONS.classic, n, true))).toEqual([5, 3, 2]);
    expect([2, 3, 4, 5, 6].map((n) => tokensToWin(EDITIONS['2019'], n, true))).toEqual([
      4, 3, 2, 2, 2,
    ]);
    const h = harness(THREE);
    expect(h.reject({ type: 'update-settings', short: true }, 'ana')).toBe('not-host');
    h.act({ type: 'update-settings', short: true });
    expect(royalPost.view(h.state, HOST).target).toBe(3);
    h.act({ type: 'start' });
    expect(h.state.target).toBe(3);
    expect(h.reject({ type: 'update-settings', short: false })).toBe('in-progress');
  });
});

describe('lobby', () => {
  it('seats 2 to 4 in Classic and 2 to 6 in 2019', () => {
    const six = ['host', 'a', 'b', 'c', 'd', 'e'];
    const h = harness(six);
    // Classic seats four; the rest watch.
    expect(Object.values(h.state.seats).filter((s) => s.playing)).toHaveLength(4);
    expect(h.reject({ type: 'sit', playing: true }, 'd')).toBe('full');
    h.act({ type: 'update-settings', edition: '2019' });
    h.act({ type: 'sit', playing: true }, 'd');
    h.act({ type: 'sit', playing: true }, 'e');
    // Back to Classic with six seated: too many to start.
    h.act({ type: 'update-settings', edition: 'classic' });
    expect(h.reject({ type: 'start' })).toBe('too-many');
    h.act({ type: 'update-settings', edition: '2019' });
    h.act({ type: 'start' });
    expect(h.state.round!.order).toHaveLength(6);
    expect(harness([HOST]).reject({ type: 'start' })).toBe('too-few');
  });

  it('lets only the host change settings or start, and not mid-game', () => {
    const h = harness();
    expect(h.reject({ type: 'update-settings', edition: '2019' }, 'ana')).toBe('not-host');
    expect(h.reject({ type: 'start' }, 'ana')).toBe('not-host');
    h.act({ type: 'update-settings', turnSeconds: 60, timerMode: 'strict' });
    expect(h.state.settings).toEqual({ edition: 'classic', turnSeconds: 60, timerMode: 'strict' });
    h.act({ type: 'start' });
    expect(h.reject({ type: 'update-settings', edition: '2019' })).toBe('in-progress');
    expect(h.reject({ type: 'start' })).toBe('in-progress');
  });
});

describe('setup', () => {
  it('sets one card aside, deals one each and lets the first player draw', () => {
    const h = startedGame();
    const round = h.state.round!;
    expect(round.setAside).not.toBeNull();
    expect(round.faceUp).toEqual([]);
    expect(hand(h, round.current)).toHaveLength(2);
    for (const id of round.order) if (id !== round.current) expect(hand(h, id)).toHaveLength(1);
    expect(round.deck).toHaveLength(16 - 1 - 3 - 1);
    expect(count(cardsEverywhere(h))).toEqual(count(deckOf(EDITIONS.classic)));
  });

  it('sets three more cards aside face up with two players', () => {
    for (const edition of ['classic', '2019'] as const) {
      const h = startedGame([HOST, 'ana'], edition);
      const round = h.state.round!;
      expect(round.faceUp).toHaveLength(3);
      expect(round.deck).toHaveLength(
        EDITIONS[edition].cards.reduce((n, c) => n + c.count, 0) - 1 - 3 - 3,
      );
      expect(count(cardsEverywhere(h))).toEqual(count(deckOf(EDITIONS[edition])));
      // Everyone sees the face-up cards, never the face-down one.
      const v = royalPost.view(h.state, 'ana');
      expect(v.round!.faceUp).toEqual(round.faceUp);
      expect(v.round!.setAside).toBe(true);
    }
  });
});

describe('turns', () => {
  it('only lets the current player play a card they hold', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
    });
    expect(h.reject({ type: 'play', card: 'handmaid' }, 'ana')).toBe('not-your-turn');
    expect(h.reject({ type: 'play', card: 'king' })).toBe('not-in-hand');
    h.act({ type: 'play', card: 'handmaid' });
    expect(current(h)).toBe('ana');
    expect(hand(h, 'ana')).toEqual(['king', 'guard']);
    expect(h.state.round!.players.host!.discards).toEqual(['handmaid']);
  });

  it('skips players who are out', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['handmaid', 'priest'], ana: [], ben: ['baron'], cy: ['king'] },
      out: ['ana'],
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(current(h)).toBe('ben');
  });
});

describe('Guard', () => {
  it('knocks the target out when the guess is right, showing their hand', () => {
    const h = rig(table(), { hands: { host: ['guard', 'priest'], ana: ['king'], ben: ['baron'] } });
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'king' });
    expect(isOut(h, 'ana')).toBe(true);
    expect(h.state.round!.players.ana!.discards).toEqual(['king']);
    expect(logOf(h.state, 'play').at(-1)).toMatchObject({
      card: 'guard',
      hit: true,
      guess: 'king',
    });
    expect(lastLog(h.state)).toMatchObject({
      kind: 'out',
      player: 'ana',
      cause: 'guard',
      by: HOST,
      cards: ['king'],
    });
    expect(current(h)).toBe('ben');
  });

  it('does nothing on a wrong guess', () => {
    const h = rig(table(), { hands: { host: ['guard', 'priest'], ana: ['king'], ben: ['baron'] } });
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'baron' });
    expect(isOut(h, 'ana')).toBe(false);
    expect(lastLog(h.state)).toMatchObject({ kind: 'play', hit: false });
  });

  it('needs a target and a non-Guard guess from the edition', () => {
    const h = rig(table(), { hands: { host: ['guard', 'priest'], ana: ['king'], ben: ['baron'] } });
    expect(h.reject({ type: 'play', card: 'guard' })).toBe('no-target');
    expect(h.reject({ type: 'play', card: 'guard', target: 'ana' })).toBe('no-guess');
    expect(h.reject({ type: 'play', card: 'guard', target: 'ana', guess: 'guard' })).toBe(
      'bad-guess',
    );
    expect(h.reject({ type: 'play', card: 'guard', target: 'ana', guess: 'spy' })).toBe(
      'bad-guess',
    );
    expect(h.reject({ type: 'play', card: 'guard', target: HOST, guess: 'king' })).toBe(
      'bad-target',
    );
    expect(h.reject({ type: 'play', card: 'guard', target: 'nobody', guess: 'king' })).toBe(
      'bad-target',
    );
  });

  it('may name the Spy in 2019', () => {
    const h = rig(table('2019'), {
      hands: { host: ['guard', 'priest'], ana: ['spy'], ben: ['baron'] },
    });
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'spy' });
    expect(isOut(h, 'ana')).toBe(true);
  });
});

describe('Priest', () => {
  it('shows the target’s card to the player only', () => {
    const h = rig(table(), {
      hands: { host: ['priest', 'guard'], ana: ['countess'], ben: ['baron'] },
    });
    h.act({ type: 'play', card: 'priest', target: 'ana' });
    expect(royalPost.view(h.state, HOST).notes).toEqual([
      expect.objectContaining({ kind: 'peek', target: 'ana', card: 'countess' }),
    ]);
    for (const viewer of ['ana', 'ben', null]) {
      const json = JSON.stringify(royalPost.view(h.state, viewer));
      expect(json, String(viewer)).not.toContain('peek');
      if (viewer !== 'ana') expect(json, String(viewer)).not.toContain('countess');
    }
  });
});

describe('Baron', () => {
  it('knocks out the lower card and tells only the two players', () => {
    const h = rig(table(), { hands: { host: ['baron', 'king'], ana: ['priest'], ben: ['guard'] } });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    expect(isOut(h, 'ana')).toBe(true);
    expect(lastLog(h.state)).toMatchObject({
      kind: 'out',
      player: 'ana',
      cause: 'baron',
      by: HOST,
      cards: ['priest'],
    });
    expect(royalPost.view(h.state, HOST).notes.at(-1)).toMatchObject({
      kind: 'compare',
      other: 'ana',
      mine: 'king',
      theirs: 'priest',
      result: 'win',
    });
    expect(royalPost.view(h.state, 'ana').notes.at(-1)).toMatchObject({
      kind: 'compare',
      mine: 'priest',
      theirs: 'king',
      result: 'lose',
    });
    const benView = JSON.stringify(royalPost.view(h.state, 'ben'));
    expect(benView).not.toContain('compare');
    // The winner's card stays secret from everyone else.
    expect(benView).not.toContain('king');
  });

  it('knocks out the player who played it when theirs is lower', () => {
    const h = rig(table(), {
      hands: { host: ['baron', 'guard'], ana: ['priest'], ben: ['guard'] },
    });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    expect(isOut(h, HOST)).toBe(true);
    expect(isOut(h, 'ana')).toBe(false);
    expect(lastLog(h.state)).toMatchObject({ kind: 'out', player: HOST, by: 'ana' });
  });

  it('does nothing on a tie', () => {
    const h = rig(table(), {
      hands: { host: ['baron', 'priest'], ana: ['priest'], ben: ['guard'] },
    });
    h.act({ type: 'play', card: 'baron', target: 'ana' });
    expect(isOut(h, HOST)).toBe(false);
    expect(isOut(h, 'ana')).toBe(false);
    expect(logOf(h.state, 'play').at(-1)).toMatchObject({ tie: true });
    expect(royalPost.view(h.state, 'ana').notes.at(-1)).toMatchObject({ result: 'tie' });
  });
});

describe('Handmaid', () => {
  it('protects until the player’s next turn', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'guard'], ana: ['priest'], ben: ['baron'] },
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.state.round!.players.host!.protected).toBe(true);
    expect(
      royalPost.view(h.state, 'ben').round!.players.find((p) => p.id === HOST)!.protected,
    ).toBe(true);
    expect(h.reject({ type: 'play', card: 'guard', target: HOST, guess: 'king' }, 'ana')).toBe(
      'bad-target',
    );
    h.act({ type: 'play', card: 'priest', target: 'ben' }, 'ana');
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'king' }, 'ben');
    // The host's turn again: protection ends.
    expect(current(h)).toBe(HOST);
    expect(h.state.round!.players.host!.protected).toBe(false);
  });

  it('lets a targeted card be played with no effect when everyone else is protected or out', () => {
    const h = rig(table(), {
      hands: { host: ['guard', 'king'], ana: ['priest'], ben: [] },
      protected: ['ana'],
      out: ['ben'],
    });
    expect(h.reject({ type: 'play', card: 'guard', target: 'ana', guess: 'priest' })).toBe(
      'bad-target',
    );
    h.act({ type: 'play', card: 'guard' });
    expect(lastLog(h.state)).toMatchObject({
      kind: 'play',
      card: 'guard',
      target: null,
      noEffect: true,
    });
    expect(isOut(h, 'ana')).toBe(false);
  });

  it('still lets the Prince target yourself when everyone else is protected', () => {
    const h = rig(table(), {
      hands: { host: ['prince', 'guard'], ana: ['priest'], ben: ['baron'] },
      protected: ['ana', 'ben'],
      deck: ['king', 'guard'],
    });
    expect(h.reject({ type: 'play', card: 'prince', target: 'ana' })).toBe('bad-target');
    expect(h.reject({ type: 'play', card: 'prince' })).toBe('no-target');
    h.act({ type: 'play', card: 'prince', target: HOST });
    expect(hand(h, HOST)).toEqual(['king']);
    expect(h.state.round!.players.host!.discards).toEqual(['prince', 'guard']);
  });
});

describe('Prince', () => {
  it('makes the target discard and draw', () => {
    const h = rig(table(), {
      hands: { host: ['prince', 'guard'], ana: ['baron'], ben: ['priest'] },
      deck: ['king', 'guard'],
    });
    h.act({ type: 'play', card: 'prince', target: 'ana' });
    // Ana is next, so she draws again straight away.
    expect(hand(h, 'ana')).toEqual(['king', 'guard']);
    expect(h.state.round!.players.ana!.discards).toEqual(['baron']);
    expect(logOf(h.state, 'play').at(-1)).toMatchObject({ discarded: 'baron' });
  });

  it('knocks out a player who discards the Princess', () => {
    const h = rig(table(), {
      hands: { host: ['prince', 'guard'], ana: ['princess'], ben: ['priest'] },
    });
    h.act({ type: 'play', card: 'prince', target: 'ana' });
    expect(isOut(h, 'ana')).toBe(true);
    expect(h.state.round!.players.ana!.discards).toEqual(['princess']);
    expect(lastLog(h.state)).toMatchObject({
      kind: 'out',
      player: 'ana',
      cause: 'prince',
      cards: ['princess'],
    });
  });

  it('gives the set-aside card when the deck is empty', () => {
    const h = rig(table(), {
      hands: { host: ['prince', 'guard'], ana: ['baron'], ben: ['priest'] },
      deck: [],
      setAside: 'countess',
    });
    h.act({ type: 'play', card: 'prince', target: 'ana' });
    // The deck was empty, so the round ends and Ana's new Countess wins it.
    expect(h.state.round!.setAside).toBeNull();
    expect(h.state.round!.result).toMatchObject({ reason: 'deck-empty', winners: ['ana'] });
    expect(h.state.round!.result!.hands.ana).toBe('countess');
    expect(royalPost.view(h.state, 'ben').round!.setAside).toBe(false);
  });
});

describe('King', () => {
  it('trades hands and tells both players what they swapped', () => {
    const h = rig(table(), {
      hands: { host: ['king', 'guard'], ana: ['princess'], ben: ['priest'] },
    });
    h.act({ type: 'play', card: 'king', target: 'ana' });
    expect(hand(h, HOST)).toEqual(['princess']);
    expect(hand(h, 'ana')).toEqual(['guard', 'guard']);
    expect(royalPost.view(h.state, HOST).notes.at(-1)).toMatchObject({
      kind: 'trade',
      gave: 'guard',
      got: 'princess',
    });
    expect(royalPost.view(h.state, 'ana').notes.at(-1)).toMatchObject({
      kind: 'trade',
      gave: 'princess',
      got: 'guard',
    });
    expect(JSON.stringify(royalPost.view(h.state, 'ben'))).not.toContain('trade');
  });
});

describe('Countess', () => {
  it('must be played alongside the King or a Prince', () => {
    for (const other of ['king', 'prince'] as const) {
      const h = rig(table(), {
        hands: { host: ['countess', other], ana: ['priest'], ben: ['baron'] },
      });
      expect(h.reject({ type: 'play', card: other, target: 'ana' })).toBe('countess');
      h.act({ type: 'play', card: 'countess' });
      expect(hand(h, HOST)).toEqual([other]);
    }
  });

  it('is a free choice otherwise, and the 2019 Countess follows the same rule', () => {
    const h = rig(table(), {
      hands: { host: ['countess', 'handmaid'], ana: ['priest'], ben: ['baron'] },
    });
    h.act({ type: 'play', card: 'handmaid' });
    const g = rig(table('2019'), {
      hands: { host: ['countess', 'king'], ana: ['priest'], ben: ['baron'] },
    });
    expect(g.reject({ type: 'play', card: 'king', target: 'ana' })).toBe('countess');
  });
});

describe('Princess', () => {
  it('knocks out whoever plays her', () => {
    const h = rig(table(), {
      hands: { host: ['princess', 'guard'], ana: ['priest'], ben: ['baron'] },
    });
    h.act({ type: 'play', card: 'princess' });
    expect(isOut(h, HOST)).toBe(true);
    expect(h.state.round!.players.host!.discards).toEqual(['princess', 'guard']);
    expect(lastLog(h.state)).toMatchObject({ kind: 'out', cause: 'princess', by: HOST });
  });
});

describe('Chancellor (2019)', () => {
  it('draws two, keeps one and puts two on the bottom in the chosen order', () => {
    const h = rig(table('2019'), {
      hands: { host: ['chancellor', 'guard'], ana: ['priest'], ben: ['baron'] },
      deck: ['king', 'princess', 'spy', 'handmaid'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    expect(h.state.round!.stage).toBe('chancellor');
    expect(current(h)).toBe(HOST);
    expect(hand(h, HOST)).toEqual(['guard', 'king', 'princess']);
    expect(royalPost.view(h.state, 'ana').round!.deckCount).toBe(2);
    expect(h.reject({ type: 'play', card: 'guard', target: 'ana', guess: 'king' })).toBe(
      'wrong-stage',
    );
    expect(
      h.reject({ type: 'chancellor-keep', keep: 'baron', bottomOrder: ['king', 'princess'] }),
    ).toBe('not-in-hand');
    expect(h.reject({ type: 'chancellor-keep', keep: 'guard', bottomOrder: ['king'] })).toBe(
      'wrong-count',
    );
    expect(
      h.reject({ type: 'chancellor-keep', keep: 'king', bottomOrder: ['king', 'guard'] }),
    ).toBe('not-in-hand');
    expect(
      h.reject(
        { type: 'chancellor-keep', keep: 'king', bottomOrder: ['princess', 'guard'] },
        'ana',
      ),
    ).toBe('not-your-turn');
    h.act({ type: 'chancellor-keep', keep: 'princess', bottomOrder: ['guard', 'king'] });
    expect(hand(h, HOST)).toEqual(['princess']);
    expect(current(h)).toBe('ana');
    // Ana drew the spy; the two returned cards are at the bottom in order.
    expect(hand(h, 'ana')).toEqual(['priest', 'spy']);
    expect(h.state.round!.deck).toEqual(['handmaid', 'guard', 'king']);
    expect(logOf(h.state, 'play').at(-1)).toMatchObject({ card: 'chancellor', drew: 2 });
    // Only the Chancellor gets a note of the cards put underneath.
    expect(h.state.notes[HOST]!.at(-1)).toMatchObject({ kind: 'bottom', cards: ['guard', 'king'] });
    expect(h.state.notes.ana ?? []).toEqual([]);
    expect(royalPost.view(h.state, HOST).knownDeck).toEqual(['guard', 'king']);
    expect(royalPost.view(h.state, 'ana').knownDeck).toEqual([]);
  });

  it('keeps the bottom cards known until they are drawn, even under later Chancellors', () => {
    const h = rig(table('2019'), {
      hands: { host: ['chancellor', 'guard'], ana: ['chancellor'], ben: ['baron'] },
      deck: ['king', 'princess', 'spy', 'handmaid', 'priest', 'guard'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    h.act({ type: 'chancellor-keep', keep: 'princess', bottomOrder: ['guard', 'king'] });
    // Ana drew the spy off the top.
    expect(h.state.round!.deck).toEqual(['handmaid', 'priest', 'guard', 'guard', 'king']);
    const known = () => royalPost.view(h.state, HOST).knownDeck;
    expect(known()).toEqual(['guard', 'king']);
    // Ana's Chancellor draws two off the top and puts two more underneath: still both there.
    h.act({ type: 'play', card: 'chancellor' }, 'ana');
    h.act({ type: 'chancellor-keep', keep: 'spy', bottomOrder: ['handmaid', 'priest'] }, 'ana');
    expect(h.state.round!.deck).toEqual(['guard', 'king', 'handmaid', 'priest']);
    expect(known()).toEqual(['guard', 'king']);
    expect(royalPost.view(h.state, 'ana').knownDeck).toEqual(['handmaid', 'priest']);
    // Once a card is drawn it drops out of what the host knows is in the deck.
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'princess' }, 'ben');
    expect(hand(h, HOST)).toEqual(['princess', 'guard']);
    expect(known()).toEqual(['king']);
  });

  it('draws what is left when the deck runs low, or does nothing when it is empty', () => {
    const h = rig(table('2019'), {
      hands: { host: ['chancellor', 'guard'], ana: ['priest'], ben: ['baron'] },
      deck: ['king'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    expect(hand(h, HOST)).toEqual(['guard', 'king']);
    h.act({ type: 'chancellor-keep', keep: 'king', bottomOrder: ['guard'] });
    expect(current(h)).toBe('ana');
    expect(hand(h, 'ana')).toEqual(['priest', 'guard']);

    const empty = rig(table('2019'), {
      hands: { host: ['chancellor', 'guard'], ana: ['priest'], ben: ['baron'] },
      deck: [],
    });
    empty.act({ type: 'play', card: 'chancellor' });
    expect(empty.state.round!.stage).toBe('over');
    expect(lastLog(empty.state)).toMatchObject({ kind: 'round-end' });
    expect(logOf(empty.state, 'play').at(-1)).toMatchObject({ drew: 0 });
  });
});

describe('round end', () => {
  it('gives the last player standing a token', () => {
    const h = rig(table(), {
      hands: { host: ['guard', 'priest'], ana: ['king'], ben: [] },
      out: ['ben'],
    });
    h.act({ type: 'play', card: 'guard', target: 'ana', guess: 'king' });
    expect(h.state.round!.result).toMatchObject({
      reason: 'last-standing',
      winners: [HOST],
      hands: { host: 'priest' },
    });
    expect(h.state.seats.host!.tokens).toBe(1);
    expect(h.reject({ type: 'play', card: 'priest', target: 'ana' })).toBe('round-over');
  });

  it('compares hands when the deck runs out', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.state.round!.result).toMatchObject({
      reason: 'deck-empty',
      winners: ['ana'],
      hands: { host: 'priest', ana: 'king', ben: 'baron' },
    });
    expect(h.state.seats.ana!.tokens).toBe(1);
  });

  it('breaks a classic tie on the total of discards, and nobody wins a double tie', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'king'], ana: ['king'], ben: ['baron'] },
      discards: { ana: ['guard', 'guard'], host: [] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    // Two Kings can't happen in Classic, but the totals decide: the host's Handmaid (4) beats 2.
    expect(h.state.round!.result).toMatchObject({
      winners: [HOST],
      discardTotals: { host: 4, ana: 2 },
    });

    const tied = rig(table(), {
      hands: { host: ['handmaid', 'baron'], ana: ['baron'], ben: ['guard'] },
      discards: { ana: ['priest', 'priest'] },
      deck: [],
    });
    tied.act({ type: 'play', card: 'handmaid' });
    expect(tied.state.round!.result).toMatchObject({
      winners: [],
      discardTotals: { host: 4, ana: 4 },
    });
    expect(Object.values(tied.state.seats).map((s) => s.tokens)).toEqual([0, 0, 0]);
  });

  it('gives every tied player a token in 2019', () => {
    const h = rig(table('2019'), {
      hands: { host: ['handmaid', 'baron'], ana: ['baron'], ben: ['guard'] },
      discards: { ana: ['priest', 'priest'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.state.round!.result).toMatchObject({ winners: [HOST, 'ana'], discardTotals: null });
    expect(h.state.seats.host!.tokens).toBe(1);
    expect(h.state.seats.ana!.tokens).toBe(1);
  });

  it('lets the round winner start the next round, when the host says', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.reject({ type: 'next-round' }, 'ana')).toBe('not-host');
    h.act({ type: 'next-round' });
    expect(h.state.round!.number).toBe(2);
    expect(current(h)).toBe('ana');
    expect(order(h)).toEqual(['ana', 'ben', HOST]);
    expect(h.state.round!.result).toBeNull();
    expect(h.reject({ type: 'next-round' })).toBe('wrong-stage');
  });

  it('ends the game when someone reaches the target', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      deck: [],
    });
    h.state = {
      ...h.state,
      seats: { ...h.state.seats, ana: { ...h.state.seats.ana!, tokens: 4 } },
    };
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.state.phase).toBe('over');
    expect(h.state.winners).toEqual(['ana']);
    expect(h.state.endReason).toBe('target');
    // Play again from the podium resets the tokens.
    h.act({ type: 'start' });
    expect(Object.values(h.state.seats).map((s) => s.tokens)).toEqual([0, 0, 0]);
    expect(h.state.log).toEqual([]);
  });

  it('goes back to the lobby on the host’s say-so', () => {
    const h = startedGame();
    expect(h.reject({ type: 'back-to-lobby' }, 'ana')).toBe('not-host');
    h.act({ type: 'back-to-lobby' });
    expect(h.state.phase).toBe('lobby');
    expect(h.state.round).toBeNull();
  });
});

describe('Spy bonus (2019)', () => {
  const spyRound = (discards: Record<string, Role[]>, out: string[] = []) => {
    const h = rig(table('2019'), {
      hands: {
        host: ['handmaid', 'priest'],
        ana: out.includes('ana') ? [] : ['king'],
        ben: ['baron'],
      },
      discards,
      out,
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    return h;
  };

  it('gives a token to the only surviving player who played or discarded a Spy', () => {
    const h = spyRound({ ben: ['spy'] });
    expect(h.state.round!.result).toMatchObject({ winners: ['ana'], spy: 'ben' });
    expect(h.state.seats.ben!.tokens).toBe(1);
    expect(h.state.seats.ana!.tokens).toBe(1);
  });

  it('stacks with winning the round', () => {
    const h = spyRound({ ana: ['spy'] });
    expect(h.state.seats.ana!.tokens).toBe(2);
  });

  it('gives nothing when two survivors used a Spy', () => {
    const h = spyRound({ ana: ['spy'], ben: ['spy'] });
    expect(h.state.round!.result!.spy).toBeNull();
    // The result names who played one, so the screen can say why nobody got the bonus.
    expect(h.state.round!.result!.spies).toEqual(['ana', 'ben']);
    expect(h.state.seats.ben!.tokens).toBe(0);
  });

  it('ignores a Spy played by someone knocked out', () => {
    const h = spyRound({ ana: ['spy', 'king'], ben: ['spy'] }, ['ana']);
    expect(h.state.round!.result).toMatchObject({ spy: 'ben' });
  });

  it('counts a Spy discarded to a Prince', () => {
    const h = rig(table('2019'), {
      hands: { host: ['prince', 'priest'], ana: ['spy'], ben: ['baron'] },
      deck: ['guard'],
    });
    h.act({ type: 'play', card: 'prince', target: 'ana' });
    expect(h.state.round!.players.ana!.discards).toEqual(['spy']);
    expect(h.state.round!.result).toMatchObject({ reason: 'deck-empty', spy: 'ana' });
  });
});

describe('leavers and late joiners', () => {
  it('knocks out a player who leaves mid-round and shows their hand', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'], cy: ['guard'] },
    });
    leave(h, 'ben');
    expect(isOut(h, 'ben')).toBe(true);
    expect(lastLog(h.state)).toMatchObject({
      kind: 'out',
      player: 'ben',
      cause: 'left',
      cards: ['baron'],
    });
    expect(h.state.seats.ben).toBeUndefined();
    expect(royalPost.view(h.state, HOST).round!.players.find((p) => p.id === 'ben')).toMatchObject({
      name: 'BEN',
      left: true,
      out: true,
    });
    expect(current(h)).toBe(HOST);
  });

  it('moves play on when the current player leaves, even mid-Chancellor', () => {
    const h = rig(table('2019', FOUR), {
      hands: { host: ['chancellor', 'priest'], ana: ['king'], ben: ['baron'], cy: ['guard'] },
      deck: ['guard', 'guard', 'guard'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    leave(h, HOST);
    expect(current(h)).toBe('ana');
    expect(hand(h, 'ana')).toHaveLength(2);
    expect(h.state.round!.stage).toBe('play');
  });

  it('puts a Chancellor’s drawn cards back under the deck, unseen, when they leave mid-choice', () => {
    const h = rig(table('2019', FOUR), {
      hands: { host: ['chancellor', 'priest'], ana: ['king'], ben: ['baron'], cy: ['guard'] },
      deck: ['princess', 'countess', 'guard', 'handmaid'],
    });
    h.act({ type: 'play', card: 'chancellor' });
    leave(h, HOST);
    const out = logOf(h.state, 'out').at(-1)!;
    expect(out).toMatchObject({ player: HOST, cause: 'left', cards: ['priest'] });
    expect(h.state.round!.players[HOST]!.discards).toEqual(['chancellor', 'priest']);
    // Ana drew the guard; the two drawn cards are at the bottom, in the order drawn.
    expect(hand(h, 'ana')).toEqual(['king', 'guard']);
    expect(h.state.round!.deck).toEqual(['handmaid', 'princess', 'countess']);
  });

  it('ends the round when only one player is left in it', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: [], cy: [] },
      out: ['ben', 'cy'],
    });
    leave(h, 'ana');
    expect(h.state.round!.result).toMatchObject({ reason: 'last-standing', winners: [HOST] });
  });

  it('ends the game when fewer than two players are seated', () => {
    const h = startedGame([HOST, 'ana']);
    h.state = {
      ...h.state,
      seats: { ...h.state.seats, host: { ...h.state.seats.host!, tokens: 2 } },
    };
    leave(h, 'ana');
    expect(h.state.phase).toBe('over');
    expect(h.state.endReason).toBe('too-few');
    expect(h.state.winners).toEqual([HOST]);
    expect(royalPost.nextDeadline!(h.state)).toBeNull();
  });

  it('just drops a player who leaves between rounds or in the lobby', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'], cy: ['guard'] },
      deck: [],
    });
    h.act({ type: 'play', card: 'handmaid' });
    leave(h, 'cy');
    expect(h.state.round!.stage).toBe('over');
    expect(h.state.phase).toBe('playing');
    h.act({ type: 'next-round' });
    expect(order(h)).not.toContain('cy');
    const lobby = harness();
    leave(lobby, 'ana');
    expect(Object.keys(lobby.state.seats)).toEqual([HOST, 'ben']);
  });

  it('lets late joiners watch until the next game', () => {
    const h = startedGame();
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    expect(h.state.seats.dee).toMatchObject({ playing: false });
    expect(h.reject({ type: 'sit', playing: true }, 'dee')).toBe('in-progress');
    const v = royalPost.view(h.state, 'dee');
    expect(v.hand).toEqual([]);
    expect(v.me).toMatchObject({ playing: false });
    h.act({ type: 'back-to-lobby' });
    h.act({ type: 'sit', playing: true }, 'dee');
    // Rejoining keeps the seat and only updates the name.
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Deedee' });
    expect(h.state.seats.dee).toMatchObject({ name: 'Deedee', playing: true });
  });
});

describe('seats between games', () => {
  const seated = (h: { state: RoyalPostState }) =>
    Object.entries(h.state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));

  it('seats the watchers who were waiting when the host picks an edition with more seats', () => {
    const h = harness(['host', 'a', 'b', 'c', 'd', 'e']);
    expect(seated(h)).toEqual(['host', 'a', 'b', 'c']);
    h.act({ type: 'update-settings', edition: '2019' });
    expect(seated(h)).toEqual(['host', 'a', 'b', 'c', 'd', 'e']);
    expect(h.state.seats.d!.waiting).toBeUndefined();
  });

  it('leaves players who chose to watch alone', () => {
    const h = harness(['host', 'a', 'b', 'c', 'd', 'e']);
    h.act({ type: 'sit', playing: false }, 'a');
    h.act({ type: 'update-settings', edition: '2019' });
    expect(seated(h)).toEqual(['host', 'b', 'c', 'd', 'e']);
    expect(h.state.seats.a).toMatchObject({ playing: false });
  });

  it('seats only as many as the edition has room for, in join order', () => {
    const h = harness(['host', 'a', 'b', 'c', 'd', 'e', 'f']);
    h.act({ type: 'update-settings', edition: '2019' });
    expect(seated(h)).toEqual(['host', 'a', 'b', 'c', 'd', 'e']);
    expect(h.state.seats.f).toMatchObject({ playing: false, waiting: true });
  });

  it('deals late joiners into the next game, and lets watchers sit down on the podium', () => {
    const h = startedGame(THREE, '2019');
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    h.state = royalPost.playerJoined(h.state, { id: 'eve', name: 'Eve' });
    expect(h.state.seats.dee).toMatchObject({ playing: false, waiting: true });
    // The game ends: Dee stands by her choice to watch, Eve waits for a seat.
    h.state = { ...h.state, phase: 'over', round: null };
    h.act({ type: 'sit', playing: false }, 'dee');
    expect(h.state.seats.dee).toEqual({ name: 'Dee', playing: false, tokens: 0 });
    // Play again: Eve is dealt in; Dee keeps watching until she taps Take a seat.
    h.act({ type: 'start' });
    expect(h.state.round!.order).toContain('eve');
    expect(h.state.round!.order).not.toContain('dee');
    h.state = { ...h.state, phase: 'over', round: null };
    h.act({ type: 'sit', playing: true }, 'dee');
    h.act({ type: 'start' });
    expect(h.state.round!.order).toHaveLength(5);
    expect(h.state.round!.order).toContain('dee');
  });

  it('seats waiting players when the host goes back to the lobby', () => {
    const h = startedGame(THREE);
    h.state = royalPost.playerJoined(h.state, { id: 'dee', name: 'Dee' });
    h.act({ type: 'back-to-lobby' });
    expect(h.state.seats.dee).toEqual({ name: 'Dee', playing: true, tokens: 0 });
  });
});

describe('timers', () => {
  it('only runs a deadline in strict mode with a turn time', () => {
    expect(royalPost.nextDeadline!(startedGame().state)).toBeNull();
    expect(
      royalPost.nextDeadline!(startedGame(THREE, 'classic', { turnSeconds: 30 }).state),
    ).toBeNull();
    const h = startedGame(THREE, 'classic', { turnSeconds: 30, timerMode: 'strict' });
    expect(royalPost.nextDeadline!(h.state)).toBe(NOW + 30_000);
    expect(royalPost.onDeadline!(h.state, NOW + 1)).toBe(h.state);
  });

  it('plays the lower card at a random player when time runs out', () => {
    const h = startedGame(THREE, 'classic', { turnSeconds: 30, timerMode: 'strict' });
    rig(h, { hands: { host: ['king', 'guard'], ana: ['priest'], ben: ['baron'] } });
    const next = royalPost.onDeadline!(h.state, NOW + 30_000);
    const play = next.log.find((e) => e.kind === 'play')!;
    expect(play).toMatchObject({ by: HOST, card: 'guard', timedOut: true });
    expect(['ana', 'ben']).toContain((play as { target: string }).target);
    expect((play as { guess: string }).guess).not.toBe('guard');
    expect(next.round!.current).toBe('ana');
    expect(royalPost.nextDeadline!(next)).toBe(NOW + 60_000);
  });

  it('plays the Countess when it must, and keeps a card for a slow Chancellor', () => {
    const h = startedGame(THREE, '2019', { turnSeconds: 30, timerMode: 'strict' });
    rig(h, { hands: { host: ['prince', 'countess'], ana: ['priest'], ben: ['baron'] } });
    const forced = royalPost.onDeadline!(h.state, NOW + 30_000);
    expect(forced.log.find((e) => e.kind === 'play')).toMatchObject({ card: 'countess' });

    rig(h, {
      hands: { host: ['chancellor', 'princess'], ana: ['priest'], ben: ['baron'] },
      deck: ['guard', 'king', 'spy'],
    });
    h.act({ type: 'play', card: 'chancellor' }, HOST, NOW + 1000);
    expect(royalPost.nextDeadline!(h.state)).toBe(NOW + 31_000);
    const kept = royalPost.onDeadline!(h.state, NOW + 31_000);
    expect(kept.round!.players.host!.hand).toHaveLength(1);
    expect(kept.round!.current).toBe('ana');
    expect(kept.round!.deck).toHaveLength(2);
    expect(kept.log.findLast((e) => e.kind === 'play')).toMatchObject({
      card: 'chancellor',
      autoKept: true,
    });
    expect(h.state.log.findLast((e) => e.kind === 'play')).not.toHaveProperty('timedOut');
  });

  it('always makes progress: a game left to the timer runs to the end', () => {
    for (const edition of ['classic', '2019'] as const) {
      for (const ids of [[HOST, 'ana'], THREE, FOUR]) {
        const h = startedGame(ids, edition, { turnSeconds: 10, timerMode: 'strict' });
        let state = h.state;
        let now = NOW;
        let rounds = 0;
        for (let step = 0; step < 2000 && state.phase === 'playing'; step++) {
          const due = royalPost.nextDeadline!(state);
          if (due === null) {
            // Between rounds: the host moves on.
            expect(state.round!.stage).toBe('over');
            h.state = state;
            h.act({ type: 'next-round' }, HOST, now);
            state = h.state;
            rounds++;
            continue;
          }
          expect(due).toBeGreaterThan(now);
          now = due;
          state = royalPost.onDeadline!(state, now);
          const r = state.round!;
          const live = Object.values(r.players).flatMap((p) => [...p.hand, ...p.discards]);
          expect(live.length + r.deck.length + r.faceUp.length + (r.setAside ? 1 : 0)).toBe(
            deckOf(EDITIONS[edition]).length,
          );
        }
        expect(state.phase, `${edition} ${ids.length}`).toBe('over');
        expect(rounds).toBeGreaterThan(0);
      }
    }
  });
});

describe('view', () => {
  it('shows each player only their own hand, never the deck or the set-aside card', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['handmaid', 'guard'], ana: ['princess'], ben: ['countess'], cy: ['king'] },
      deck: ['baron', 'baron', 'prince', 'prince'],
      setAside: 'priest',
    });
    const secret: Record<string, Role[]> = {
      host: ['handmaid', 'guard'],
      ana: ['princess'],
      ben: ['countess'],
      cy: ['king'],
    };
    for (const viewer of [...FOUR, null]) {
      const v = royalPost.view(h.state, viewer);
      const json = JSON.stringify(v);
      expect(v.hand).toEqual(viewer ? secret[viewer] : []);
      for (const [id, cards] of Object.entries(secret)) {
        if (id === viewer) continue;
        for (const c of cards)
          if (!(viewer && secret[viewer]!.includes(c)))
            expect(json, `${viewer} sees ${id}`).not.toContain(`"${c}"`);
      }
      expect(json).not.toContain('"baron"');
      expect(json).not.toContain('"prince"');
      expect(json).not.toContain('"priest"');
      expect(json).not.toContain('seed');
      expect(v.round).not.toHaveProperty('deck');
      expect(v.round!.deckCount).toBe(4);
      expect(v.round!.players.map((p) => p.handCount)).toEqual([2, 1, 1, 1]);
    }
  });

  it('keeps everyone’s private notes to themselves', () => {
    const h = rig(table('classic', FOUR), {
      hands: { host: ['priest', 'guard'], ana: ['baron'], ben: ['handmaid'], cy: ['prince'] },
    });
    h.act({ type: 'play', card: 'priest', target: 'cy' });
    h.act({ type: 'play', card: 'baron', target: 'ben' }, 'ana');
    const notes = (id: string | null) => royalPost.view(h.state, id).notes.map((n) => n.kind);
    expect(notes(HOST)).toEqual(['peek']);
    expect(notes('ana')).toEqual(['compare']);
    expect(notes('ben')).toEqual(['compare']);
    // The Priest's target is told someone knows their card.
    expect(notes('cy')).toEqual(['seen']);
    expect(royalPost.view(h.state, 'cy').notes[0]).toMatchObject({ by: HOST, card: 'prince' });
    expect(notes(null)).toEqual([]);
  });

  it('shows the face-down set-aside card only once the round is over', () => {
    const h = rig(table('classic'), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      deck: [],
      setAside: 'countess',
    });
    expect(royalPost.view(h.state, 'ana').round!.setAsideCard).toBeNull();
    h.act({ type: 'play', card: 'handmaid' });
    expect(h.state.round!.stage).toBe('over');
    expect(royalPost.view(h.state, 'ana').round!.setAsideCard).toBe('countess');
  });

  it('caps the log', () => {
    const h = startedGame(THREE, 'classic', { turnSeconds: 10, timerMode: 'strict' });
    let state = h.state;
    let now = NOW;
    for (let i = 0; i < 200 && state.phase === 'playing'; i++) {
      const due = royalPost.nextDeadline!(state);
      if (due === null) {
        h.state = state;
        h.act({ type: 'next-round' }, HOST, now);
        state = h.state;
        continue;
      }
      state = royalPost.onDeadline!(state, (now = due));
    }
    expect(state.log.length).toBeLessThanOrEqual(60);
  });
});
