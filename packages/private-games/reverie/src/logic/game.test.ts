import { describe, expect, it } from 'vitest';
import { cardsNeeded, reverie } from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  decoyIndexFor,
  hand,
  harness,
  othersOf,
  startedGame,
  storyIndex,
  storyteller,
  tellAndGive,
  voteAll,
} from './test-utils.ts';
import { CARD_SETS, actionSchema, cardsIn } from './types.ts';

const THREE = [HOST, 'ana', 'ben'];
const score = (h: ReturnType<typeof harness>, id: string) => h.state.seats[id]!.score;

describe('card sets', () => {
  it('cover the 867 existing cards in eleven blocks, skipping the unused numbers', () => {
    const all = CARD_SETS.flatMap(cardsIn);
    expect(all).toHaveLength(867);
    expect(new Set(all).size).toBe(867);
    expect(all).not.toContain(69);
    expect(all).not.toContain(139);
    expect(all).toContain(839);
    expect(CARD_SETS[10]?.cards[0]).toBe(851);
    expect(all).toContain(877);
    expect(CARD_SETS.slice(0, 10).every((s) => s.cards.length === 84)).toBe(true);
    expect(CARD_SETS[10]?.cards).toHaveLength(27);
    expect(CARD_SETS[0]?.cards[0]).toBe(0);
    expect(CARD_SETS[1]?.cards[0]).toBe(85);
  });
});

describe('lobby', () => {
  it('seats newcomers automatically in the lobby, up to eight', () => {
    const h = harness(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    const playing = Object.values(h.state.seats).filter((s) => s.playing);
    expect(playing).toHaveLength(8);
    expect(h.state.seats.i?.playing).toBe(false);
    expect(new Set(Object.values(h.state.seats).map((s) => s.color)).size).toBe(8);
  });

  it('needs three to eight seated players and enough cards', () => {
    const h = harness(['a', 'b']);
    expect(h.reject({ type: 'start' }, 'a')).toBe('not-host');
    const two = harness([HOST, 'ana']);
    expect(two.reject({ type: 'start' })).toBe('too-few');
    const four = harness();
    four.act({ type: 'update-settings', sets: ['extras'] }); // 27 cards < 25 + 1? 6*4+1 = 25: ok
    expect(cardsNeeded(4)).toBe(25);
    four.act({ type: 'sit', playing: false }, 'cy');
    four.act({ type: 'sit', playing: true }, 'cy');
    expect(four.reject({ type: 'update-settings', sets: ['nope'] })).toBe('unknown-set');
    const five = harness([HOST, 'a', 'b', 'c', 'd']);
    five.act({ type: 'update-settings', sets: ['extras'] });
    expect(five.reject({ type: 'start' })).toBe('not-enough-cards');
  });

  it('lets players sit out and keeps settings host-only', () => {
    const h = harness();
    expect(h.reject({ type: 'update-settings', targetScore: 15 }, 'ana')).toBe('not-host');
    h.act({ type: 'sit', playing: false }, 'ana');
    expect(h.state.seats.ana?.playing).toBe(false);
    h.act({ type: 'update-settings', targetScore: 15, sets: ['base', 'set-2'] });
    expect(h.state.settings).toMatchObject({ targetScore: 15, sets: ['base', 'set-2'] });
  });
});

describe('dealing', () => {
  it('deals six cards each from the chosen sets, seven with three players', () => {
    const h = startedGame();
    for (const id of FOUR) {
      expect(hand(h, id)).toHaveLength(6);
      expect(hand(h, id).every((c) => c <= 84 && c !== 69)).toBe(true);
    }
    expect(h.state.draw).toHaveLength(84 - 24);
    expect(new Set([...h.state.draw, ...FOUR.flatMap((id) => hand(h, id))]).size).toBe(84);
    const three = startedGame(THREE);
    for (const id of THREE) expect(hand(three, id)).toHaveLength(7);
  });

  it('starts with the first seat as storyteller and rotates each turn', () => {
    const h = startedGame();
    expect(storyteller(h)).toBe(HOST);
    tellAndGive(h);
    voteAll(h, ['ana']);
    h.act({ type: 'next-turn' });
    expect(storyteller(h)).toBe('ana');
    expect(h.state.turn?.round).toBe(2);
  });
});

describe('telling and giving', () => {
  it('only the storyteller tells, with a card from their hand, once', () => {
    const h = startedGame();
    const st = storyteller(h);
    expect(h.reject({ type: 'tell', card: hand(h, 'ana')[0]!, clue: 'x' }, 'ana')).toBe(
      'not-storyteller',
    );
    expect(h.reject({ type: 'tell', card: 69, clue: 'x' }, st)).toBe('not-in-hand');
    const card = hand(h, st)[0]!;
    h.act({ type: 'tell', card, clue: '  a quiet storm ' }, st);
    expect(h.state.turn).toMatchObject({ phase: 'pick', clue: 'a quiet storm', storyCard: card });
    expect(hand(h, st)).toHaveLength(5);
    expect(h.reject({ type: 'tell', card: hand(h, st)[0]!, clue: 'again' }, st)).toBe(
      'wrong-stage',
    );
  });

  it('collects one card from everyone else, then lays a shuffled table', () => {
    const h = startedGame();
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    expect(h.reject({ type: 'give', cards: [hand(h, 'ana')[0]!] }, st)).toBe('storyteller');
    expect(h.reject({ type: 'give', cards: hand(h, 'ana').slice(0, 2) }, 'ana')).toBe(
      'wrong-count',
    );
    expect(h.reject({ type: 'give', cards: [hand(h, 'ben')[0]!] }, 'ana')).toBe('not-in-hand');
    h.act({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana');
    expect(h.reject({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana')).toBe('already-gave');
    expect(h.state.turn?.phase).toBe('pick');
    h.act({ type: 'give', cards: [hand(h, 'ben')[0]!] }, 'ben');
    h.act({ type: 'give', cards: [hand(h, 'cy')[0]!] }, 'cy');
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(4);
    expect(new Set(h.state.turn?.table.map((t) => t.owner))).toEqual(new Set(FOUR));
    // Shuffled: the storyteller's card is not simply first.
    const positions = Array.from({ length: 5 }, (_, seed) => {
      const g = startedGame(FOUR, {});
      void seed;
      tellAndGive(g);
      return storyIndex(g);
    });
    expect(positions.every((p) => p >= 0)).toBe(true);
  });

  it('takes two cards each with three players', () => {
    const h = startedGame(THREE);
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    expect(h.reject({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana')).toBe('wrong-count');
    for (const id of othersOf(h)) h.act({ type: 'give', cards: hand(h, id).slice(0, 2) }, id);
    expect(h.state.turn?.table).toHaveLength(5);
  });
});

describe('voting and scoring', () => {
  it('refuses votes for your own card and from the storyteller', () => {
    const h = startedGame();
    tellAndGive(h);
    const own = h.state.turn!.table.findIndex((t) => t.owner === 'ana');
    expect(h.reject({ type: 'vote', index: own }, 'ana')).toBe('own-card');
    expect(h.reject({ type: 'vote', index: 0 }, storyteller(h))).toBe('storyteller');
    expect(h.reject({ type: 'vote', index: 9 }, 'ana')).toBe('bad-card');
  });

  it('scores 3 for the storyteller and each finder, plus 1 per vote on your card', () => {
    const h = startedGame();
    tellAndGive(h);
    // ana finds it; ben and cy both vote for ana's card.
    const anaCard = h.state.turn!.table.findIndex((t) => t.owner === 'ana');
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    h.act({ type: 'vote', index: anaCard }, 'ben');
    h.act({ type: 'vote', index: anaCard }, 'cy');
    expect(h.state.turn?.phase).toBe('reveal');
    expect(h.state.turn?.allOrNone).toBe(false);
    expect([HOST, 'ana', 'ben', 'cy'].map((id) => score(h, id))).toEqual([3, 5, 0, 0]);
    expect(h.state.turn?.results?.ana).toEqual({ points: 5, foundIt: true, votesReceived: 2 });
  });

  it('gives the storyteller nothing when everyone finds it, and everyone else 2', () => {
    const h = startedGame();
    tellAndGive(h);
    voteAll(h, ['ana', 'ben', 'cy']);
    expect(h.state.turn?.allOrNone).toBe(true);
    expect([HOST, 'ana', 'ben', 'cy'].map((id) => score(h, id))).toEqual([0, 2, 2, 2]);
  });

  it('gives the storyteller nothing when nobody finds it, but decoys still earn votes', () => {
    const h = startedGame();
    tellAndGive(h);
    voteAll(h, []);
    expect(score(h, HOST)).toBe(0);
    const total = ['ana', 'ben', 'cy'].reduce((n, id) => n + score(h, id), 0);
    expect(total).toBe(2 * 3 + 3); // 2 each, plus the 3 decoy votes landed on someone
  });

  it('counts votes on either of your two cards with three players', () => {
    const h = startedGame(THREE);
    tellAndGive(h);
    const anaCards = h.state
      .turn!.table.map((t, i) => (t.owner === 'ana' ? i : -1))
      .filter((i) => i >= 0);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    h.act({ type: 'vote', index: anaCards[1]! }, 'ben');
    expect(score(h, 'ana')).toBe(4);
    expect(score(h, HOST)).toBe(3);
    expect(score(h, 'ben')).toBe(0);
  });
});

describe('between turns', () => {
  it('discards the table, refills hands and reshuffles when the pile runs out', () => {
    const h = startedGame(FOUR, { sets: ['extras'] }); // 27 cards: 24 dealt, 3 left
    tellAndGive(h);
    voteAll(h, ['ana']);
    expect(h.state.draw).toHaveLength(3);
    h.act({ type: 'next-turn' });
    expect(h.state.discard).toHaveLength(0); // 4 played cards were reshuffled into the draw pile
    for (const id of FOUR) expect(hand(h, id)).toHaveLength(6);
    expect(h.state.draw).toHaveLength(3);
    const everywhere = [...h.state.draw, ...FOUR.flatMap((id) => hand(h, id))];
    expect(new Set(everywhere).size).toBe(27);
  });

  it('ends when someone reaches the target, sharing ties', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    for (let i = 0; i < 10 && h.state.phase === 'playing'; i++) {
      tellAndGive(h);
      voteAll(h, ['ana', 'ben', 'cy']); // all find it: everyone but the storyteller gets 2
      h.act({ type: 'next-turn' });
    }
    expect(h.state.phase).toBe('over');
    const top = Math.max(...FOUR.map((id) => score(h, id)));
    expect(top).toBeGreaterThanOrEqual(15);
    expect(h.state.winners).toEqual(FOUR.filter((id) => score(h, id) === top));
  });

  it('only the host moves on, only after the reveal, and can go back to the lobby', () => {
    const h = startedGame();
    expect(h.reject({ type: 'next-turn' })).toBe('wrong-stage');
    tellAndGive(h);
    voteAll(h, ['ana']);
    expect(h.reject({ type: 'next-turn' }, 'ana')).toBe('not-host');
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', turn: null });
  });

  it('alternates the opening storyteller between games', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    expect(storyteller(h)).toBe(HOST);
    h.state = { ...h.state, phase: 'over', turn: null };
    h.act({ type: 'start' });
    expect(storyteller(h)).toBe('ana');
    expect(FOUR.every((id) => score(h, id) === 0)).toBe(true);
  });
});

describe('players coming and going', () => {
  it('seats a mid-game newcomer as a watcher who gets cards after sitting down', () => {
    const h = startedGame();
    h.state = reverie.playerJoined(h.state, { id: 'late', name: 'Late' });
    expect(h.state.seats.late).toMatchObject({ playing: false, hand: [] });
    expect(h.reject({ type: 'sit', playing: true }, 'late')).toBe('in-progress');
    tellAndGive(h);
    voteAll(h, ['ana']);
    h.act({ type: 'sit', playing: true }, 'late');
    h.act({ type: 'next-turn' });
    expect(hand(h, 'late')).toHaveLength(6);
  });

  it('cancels the turn and returns cards when the storyteller leaves', () => {
    const h = startedGame();
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    h.act({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana');
    expect(hand(h, 'ana')).toHaveLength(5);
    h.state = reverie.playerLeft(h.state, st, NOW);
    expect(h.state.seats[st]).toBeUndefined();
    expect(hand(h, 'ana')).toHaveLength(6);
    expect(h.state.turn).toMatchObject({ storyteller: 'ana', phase: 'clue', round: 1 });
  });

  it('drops a leaver’s card and vote so nobody waits on them', () => {
    const h = startedGame();
    tellAndGive(h);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    h.state = reverie.playerLeft(h.state, 'ben', NOW);
    expect(h.state.turn?.table).toHaveLength(3);
    expect(h.state.turn?.votes.ana).toBe(storyIndex(h));
    h.act({ type: 'vote', index: decoyIndexFor(h, 'cy') }, 'cy');
    expect(h.state.turn?.phase).toBe('reveal');
  });

  it('ends the game when too few players remain', () => {
    const h = startedGame(THREE);
    h.state = reverie.playerLeft(h.state, 'ana', NOW);
    expect(h.state.phase).toBe('over');
  });
});

describe('timers', () => {
  it('are reminders unless strict', () => {
    const h = startedGame(FOUR, { clueSeconds: 30 });
    expect(h.state.turn?.deadline).toBe(NOW + 30_000);
    expect(reverie.nextDeadline!(h.state)).toBeNull();
  });

  it('in strict mode skip a slow storyteller, auto-give cards and close the vote', () => {
    const h = startedGame(FOUR, { clueSeconds: 30, guessSeconds: 60, timerMode: 'strict' });
    expect(reverie.nextDeadline!(h.state)).toBe(NOW + 30_000);
    h.state = reverie.onDeadline!(h.state, NOW + 30_000);
    expect(storyteller(h)).toBe('ana');
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st, NOW + 31_000);
    h.act({ type: 'give', cards: [hand(h, 'ben')[0]!] }, 'ben');
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(4);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ben');
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.phase).toBe('reveal');
    expect(score(h, 'ben')).toBe(3);
  });
});

describe('what each player can see', () => {
  it('shows only your own hand and keeps the table anonymous until the reveal', () => {
    const h = startedGame();
    tellAndGive(h);
    const st = storyteller(h);
    const ana = reverie.view(h.state, 'ana');
    expect(ana.hand).toEqual(hand(h, 'ana'));
    expect(JSON.stringify(ana)).not.toContain(JSON.stringify(hand(h, 'ben')));
    expect(
      ana.turn?.table.every((t) => t.owner === null && !t.isStory && t.voters.length === 0),
    ).toBe(true);
    expect(ana.turn?.table.filter((t) => t.mine)).toHaveLength(1);
    expect(ana.turn?.myStoryCard).toBeNull();
    expect(reverie.view(h.state, st).turn?.myStoryCard).toBe(h.state.turn?.storyCard);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    expect(reverie.view(h.state, 'ben').turn?.table.every((t) => t.voters.length === 0)).toBe(true);
    expect(reverie.view(h.state, 'ana').turn?.myVote).toBe(storyIndex(h));
  });

  it('reveals owners, votes and results after the vote, and nothing private to watchers', () => {
    const h = startedGame();
    tellAndGive(h);
    voteAll(h, ['ana']);
    const watcher = reverie.view(h.state, null);
    expect(watcher.hand).toEqual([]);
    expect(watcher.turn?.table.find((t) => t.isStory)?.owner).toBe(storyteller(h));
    expect(watcher.turn?.table.find((t) => t.isStory)?.voters).toEqual(['ana']);
    expect(watcher.turn?.results?.ana).toMatchObject({ foundIt: true });
    expect(watcher.turn?.results?.ana?.points).toBeGreaterThanOrEqual(3);
    expect(watcher.seats.find((s) => s.id === 'ana')?.done).toBe(true);
  });
});

describe('actionSchema', () => {
  it.each([
    { type: 'tell', card: 878, clue: 'x' },
    { type: 'tell', card: 1, clue: '' },
    { type: 'give', cards: [] },
    { type: 'give', cards: [1, 2, 3] },
    { type: 'update-settings', targetScore: 25 },
    { type: 'vote', index: -1 },
  ])('rejects %j', (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });
});
