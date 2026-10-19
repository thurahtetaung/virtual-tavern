import { describe, expect, it } from 'vitest';
import { cardsNeeded, reverie } from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  cardsEverywhere,
  decoyIndexFor,
  hand,
  harness,
  leave,
  othersOf,
  playTurn,
  startedGame,
  storyIndex,
  storyteller,
  tellAndGive,
  voteAll,
} from './test-utils.ts';
import { CARD_SETS, MAX_TABLE_SIZE, type ReverieState, actionSchema, cardsIn } from './types.ts';

const THREE = [HOST, 'ana', 'ben'];
const score = (h: ReturnType<typeof harness>, id: string) => h.state.seats[id]!.score;

describe('card sets', () => {
  it('cover the 951 existing cards: eleven blocks skipping the unused numbers, then Starlight’s', () => {
    const all = CARD_SETS.flatMap(cardsIn);
    expect(all).toHaveLength(951);
    expect(new Set(all).size).toBe(951);
    expect(all).not.toContain(69);
    expect(all).not.toContain(139);
    expect(all).toContain(839);
    expect(CARD_SETS[10]?.cards[0]).toBe(851);
    expect(all).toContain(877);
    expect(CARD_SETS.slice(0, 10).every((s) => s.cards.length === 84)).toBe(true);
    expect(CARD_SETS[10]?.cards).toHaveLength(27);
    expect(CARD_SETS[0]?.cards[0]).toBe(0);
    expect(CARD_SETS[1]?.cards[0]).toBe(85);
    expect(CARD_SETS[11]).toMatchObject({ id: 'stellar' });
    expect(CARD_SETS[11]?.cards).toHaveLength(84);
    expect(CARD_SETS[11]?.cards[0]).toBe(878);
    expect(CARD_SETS[11]?.cards.at(-1)).toBe(961);
  });
});

describe('lobby', () => {
  it('seats newcomers automatically in the lobby, up to eight', () => {
    const h = harness(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']);
    const playing = Object.values(h.state.seats).filter((s) => s.playing);
    expect(playing).toHaveLength(8);
    expect(h.state.seats.i?.playing).toBe(false);
    expect(new Set(Object.values(h.state.seats).map((s) => s.color)).size).toBe(9);
  });

  it("takes each seat's colour from the player's room colour", () => {
    const h = startedGame();
    const joined = reverie.playerJoined(h.state, { id: 'zed', name: 'Zed', color: 'lime' });
    expect(joined.seats.zed?.color).toBe('lime');
    const recoloured = reverie.playerJoined(joined, { id: HOST, name: 'Host', color: 'brown' });
    expect(recoloured.seats[HOST]).toMatchObject({ color: 'brown', name: 'Host' });
    expect(recoloured.turn).toEqual(h.state.turn);
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

  it('freezes the settings while a game is running', () => {
    const h = startedGame();
    expect(h.reject({ type: 'update-settings', targetScore: 15 })).toBe('in-progress');
    expect(h.reject({ type: 'update-settings', sets: ['set-2'] })).toBe('in-progress');
    expect(h.state.settings).toMatchObject({ targetScore: 30, sets: ['base'] });
  });

  it('renames a player who rejoins without touching their seat', () => {
    const h = startedGame();
    const before = h.state.seats.ana!;
    h.state = reverie.playerJoined(h.state, { id: 'ana', name: 'Anna' });
    expect(h.state.seats.ana).toEqual({ ...before, name: 'Anna' });
    expect(Object.keys(h.state.seats)).toEqual(FOUR);
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
  });

  it('shuffles the table with the rng, so the same deal lands in a different order', () => {
    // Same deal (seed 3), but a different rng for the shuffle.
    const a = startedGame(FOUR, {}, 3);
    const b = harness(FOUR, 99);
    b.state = a.state;
    tellAndGive(a);
    tellAndGive(b);
    const cards = (g: typeof a) => g.state.turn!.table.map((t) => t.card);
    expect(new Set(cards(a))).toEqual(new Set(cards(b)));
    expect(cards(a)).not.toEqual(cards(b));
    // Different seeds also deal different hands.
    expect(startedGame(FOUR, {}, 4).state.draw).not.toEqual(a.state.draw);
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

  it('with three players scores 0/2/2 when both find it, and decoy votes when neither does', () => {
    const both = startedGame(THREE);
    playTurn(both, ['ana', 'ben']);
    expect(both.state.turn?.allOrNone).toBe(true);
    expect(THREE.map((id) => score(both, id))).toEqual([0, 2, 2]);
    const neither = startedGame(THREE);
    playTurn(neither, []); // ana votes for one of ben's cards and ben for one of ana's
    expect(neither.state.turn?.allOrNone).toBe(true);
    expect(THREE.map((id) => score(neither, id))).toEqual([0, 3, 3]);
  });

  it('lets a vote change until the last vote is in', () => {
    const h = startedGame();
    tellAndGive(h);
    h.act({ type: 'vote', index: decoyIndexFor(h, 'ana') }, 'ana');
    expect(reverie.view(h.state, 'ana').turn?.myVote).toBe(decoyIndexFor(h, 'ana'));
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    expect(h.state.turn?.votes.ana).toBe(storyIndex(h));
    h.act({ type: 'vote', index: decoyIndexFor(h, 'ben') }, 'ben');
    h.act({ type: 'vote', index: decoyIndexFor(h, 'cy') }, 'cy');
    expect(h.state.turn?.phase).toBe('reveal');
    expect(h.state.turn?.results?.ana?.foundIt).toBe(true);
    expect(h.reject({ type: 'vote', index: storyIndex(h) }, 'ben')).toBe('wrong-stage');
  });

  it('refuses cards and votes from watchers and from ids without a seat', () => {
    const h = startedGame();
    h.state = reverie.playerJoined(h.state, { id: 'late', name: 'Late' });
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    expect(h.reject({ type: 'give', cards: [1] }, 'late')).toBe('watching');
    expect(h.reject({ type: 'give', cards: [1] }, 'ghost')).toBe('not-seated');
    for (const id of othersOf(h)) h.act({ type: 'give', cards: [hand(h, id)[0]!] }, id);
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.reject({ type: 'vote', index: 0 }, 'late')).toBe('watching');
    expect(h.reject({ type: 'vote', index: 0 }, 'ghost')).toBe('not-seated');
    expect(h.state.turn?.votes).toEqual({});
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
    expect(reverie.view(h.state, 'ana').turn?.reshuffled).toBe(true);
    // The note stays up for the whole turn; a turn that didn't reshuffle has none.
    tellAndGive(h);
    voteAll(h, ['ana']);
    expect(reverie.view(h.state, 'ana').turn?.reshuffled).toBe(true);
    const fresh = startedGame(FOUR);
    // Everyone is told who tells next, and it follows the table round.
    const next = reverie.view(fresh.state, null).turn!.nextStoryteller;
    expect(next).toBe(fresh.state.turn!.nextStoryteller);
    expect(next).not.toBe(storyteller(fresh));
    tellAndGive(fresh);
    voteAll(fresh, ['ana']);
    fresh.act({ type: 'next-turn' });
    expect(reverie.view(fresh.state, 'ana').turn?.reshuffled).toBe(false);
    expect(storyteller(fresh)).toBe(next);
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
    expect(h.state.endReason).toBe('target');
    // The last reveal stays on screen, and no timer is pending.
    expect(h.state.turn?.phase).toBe('reveal');
    expect(h.state.turn?.table.length).toBeGreaterThan(0);
    expect(reverie.view(h.state, null)).toMatchObject({ phase: 'over', endReason: 'target' });
    expect(reverie.view(h.state, null).turn?.table.every((t) => t.owner !== null)).toBe(true);
    const strict = { ...h.state, settings: { ...h.state.settings, timerMode: 'strict' as const } };
    expect(reverie.nextDeadline!(strict)).toBeNull();
    expect(h.reject({ type: 'next-turn' })).toBe('wrong-stage');
  });

  it('ends with the top scorers winning when players stand up and too few are left', () => {
    const h = startedGame(THREE);
    playTurn(h, ['ana', 'ben']); // both found it: host 0, ana 2, ben 2
    h.act({ type: 'sit', playing: false }, 'ben');
    h.act({ type: 'next-turn' });
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few' });
    expect(h.state.winners).toEqual(['ana']); // scores compared among those still playing
    expect(h.state.turn?.phase).toBe('reveal');
    expect(h.state.seats.ben?.hand).toEqual([]);
  });

  it('never starts a turn without a storyteller, even if everyone stands up', () => {
    const h = startedGame(THREE);
    playTurn(h, ['ana', 'ben']);
    for (const id of THREE) h.act({ type: 'sit', playing: false }, id);
    h.act({ type: 'next-turn' });
    expect(h.state.phase).toBe('over');
    expect(h.state.winners).toEqual(['ana', 'ben']); // nobody playing: everyone at the table counts
  });

  it('only the host moves on, only after the reveal, and can go back to the lobby', () => {
    const h = startedGame();
    expect(h.reject({ type: 'next-turn' })).toBe('wrong-stage');
    tellAndGive(h);
    voteAll(h, ['ana']);
    expect(h.reject({ type: 'next-turn' }, 'ana')).toBe('not-host');
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', turn: null, endReason: null });
    expect(Object.values(h.state.seats).every((s) => s.hand.length === 0)).toBe(true);
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

  it('gives a player who leaves and comes back during the game their score again', () => {
    const h = startedGame();
    playTurn(h, ['ana', 'ben']);
    const before = score(h, 'ben');
    expect(before).toBeGreaterThan(0);
    leave(h, 'ben');
    expect(h.state.seats.ben).toBeUndefined();
    h.state = reverie.playerJoined(h.state, { id: 'ben', name: 'Ben' });
    expect(h.state.seats.ben).toMatchObject({ score: before, playing: false });
    expect(h.state.departed?.ben).toBeUndefined();
    // A fresh game starts everyone, returners included, from zero.
    leave(h, 'ben');
    h.state = { ...h.state, phase: 'over', turn: null };
    h.act({ type: 'start' });
    h.state = reverie.playerJoined(h.state, { id: 'ben', name: 'Ben' });
    expect(score(h, 'ben')).toBe(0);
  });

  it('seats a newcomer straight away once the game is over', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    while (h.state.phase === 'playing') {
      playTurn(h, ['ana', 'ben', 'cy']);
      h.act({ type: 'next-turn' });
    }
    h.state = reverie.playerJoined(h.state, { id: 'late', name: 'Late' });
    expect(h.state.seats.late?.playing).toBe(true);
    h.act({ type: 'start' });
    expect(hand(h, 'late')).toHaveLength(6);
  });

  it('refuses a seat mid-game when the cards would not stretch to another hand', () => {
    const h = startedGame(THREE, { sets: ['extras'] }); // 27 cards: 21 dealt, 6 left
    for (const id of ['late', 'later']) {
      h.state = reverie.playerJoined(h.state, { id, name: id });
    }
    playTurn(h, ['ana']);
    h.act({ type: 'sit', playing: true }, 'late'); // 4 players need 25 of the 27
    expect(h.reject({ type: 'sit', playing: true }, 'later')).toBe('not-enough-cards'); // 5: 31
    h.act({ type: 'next-turn' });
    expect(Object.values(h.state.seats).filter((s) => s.playing)).toHaveLength(4);
    expect(hand(h, 'late')).toHaveLength(6);
    expect(h.state.turn?.give).toBe(1);
    expect(new Set(cardsEverywhere(h)).size).toBe(27);
  });

  it('cancels the turn and returns cards when the storyteller leaves', () => {
    const h = startedGame();
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    h.act({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana');
    expect(hand(h, 'ana')).toHaveLength(5);
    leave(h, st);
    expect(h.state.seats[st]).toBeUndefined();
    expect(hand(h, 'ana')).toHaveLength(6);
    expect(h.state.turn).toMatchObject({ storyteller: 'ana', phase: 'clue', round: 1 });
    expect(new Set(cardsEverywhere(h)).size).toBe(84);
  });

  it('cancels the vote and returns cards when the storyteller leaves during it', () => {
    const h = startedGame();
    tellAndGive(h);
    const story = h.state.turn!.storyCard!;
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    leave(h, HOST);
    expect(h.state.turn).toMatchObject({ storyteller: 'ana', phase: 'clue', table: [], votes: {} });
    for (const id of ['ana', 'ben', 'cy']) expect(hand(h, id)).toHaveLength(6);
    expect(h.state.discard).toContain(story);
    expect(new Set(cardsEverywhere(h)).size).toBe(84);
  });

  it('keeps going with one card each when four players drop to three mid-pick', () => {
    const h = startedGame();
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    h.act({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana');
    leave(h, 'cy');
    expect(h.state.turn?.give).toBe(1);
    expect(reverie.view(h.state, 'ben').cardsToGive).toBe(1);
    expect(h.reject({ type: 'give', cards: hand(h, 'ben').slice(0, 2) }, 'ben')).toBe(
      'wrong-count',
    );
    h.act({ type: 'give', cards: [hand(h, 'ben')[0]!] }, 'ben');
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(3);
    voteAll(h, ['ana']);
    h.act({ type: 'next-turn' });
    // From here on it is a three-player game: seven cards each, two to give.
    expect(h.state.turn?.give).toBe(2);
    for (const id of [HOST, 'ana', 'ben']) expect(hand(h, id)).toHaveLength(7);
  });

  it('leaves the reveal as scored when someone leaves during it, and discards their cards', () => {
    const h = startedGame();
    playTurn(h, ['ana']);
    const table = h.state.turn!.table;
    const votes = h.state.turn!.votes;
    leave(h, 'ben');
    expect(h.state.turn).toMatchObject({ phase: 'reveal', table, votes });
    expect(h.state.seats.ben).toBeUndefined();
    expect(h.state.turn?.results?.ben).toBeDefined();
    h.act({ type: 'next-turn' });
    expect(storyteller(h)).toBe('ana');
    expect(new Set(cardsEverywhere(h)).size).toBe(84);
  });

  it('keeps the rotation and the story card when the storyteller leaves at the reveal', () => {
    const h = startedGame();
    playTurn(h, ['ana']);
    h.act({ type: 'next-turn' });
    expect(storyteller(h)).toBe('ana');
    playTurn(h, ['ben']);
    const story = h.state.turn!.storyCard!;
    leave(h, 'ana');
    expect(h.state.turn?.phase).toBe('reveal');
    expect(h.state.turn?.table.some((t) => t.card === story)).toBe(true);
    h.act({ type: 'next-turn' });
    expect(storyteller(h)).toBe('ben'); // not back to the host
    expect([...h.state.draw, ...h.state.discard]).toContain(story);
    expect(new Set(cardsEverywhere(h)).size).toBe(84);
  });

  it('passes the story to the next player along when the one due up leaves', () => {
    const h = startedGame();
    playTurn(h, ['ana']);
    leave(h, 'ana'); // ana was next
    h.act({ type: 'next-turn' });
    expect(storyteller(h)).toBe('ben');
  });

  it('ignores a watcher leaving mid-turn, and a leaver once the game is over', () => {
    const h = startedGame();
    h.state = reverie.playerJoined(h.state, { id: 'late', name: 'Late' });
    tellAndGive(h);
    const turn = h.state.turn;
    leave(h, 'late');
    expect(h.state.turn).toBe(turn);
    h.state = { ...h.state, phase: 'over' };
    leave(h, 'ana');
    expect(h.state.turn).toBe(turn);
    expect(h.state.phase).toBe('over');
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

  it('ends the game with the top scorers winning when too few players remain', () => {
    const h = startedGame(THREE);
    playTurn(h, ['ana']);
    h.act({ type: 'next-turn' });
    leave(h, 'ana');
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few', turn: null });
    expect(h.state.winners).toEqual([HOST]);
    expect(reverie.view(h.state, null).endReason).toBe('too-few');
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
    expect(reverie.view(h.state, 'ben').turn?.skipped).toBe(HOST);
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st, NOW + 31_000);
    h.act({ type: 'give', cards: [hand(h, 'ben')[0]!] }, 'ben');
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(4);
    expect(reverie.view(h.state, 'ben').turn?.autoGiven).toEqual([HOST, 'cy']);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ben');
    expect(reverie.view(h.state, 'ben').turn?.missedVote).toEqual([]);
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.phase).toBe('reveal');
    expect(reverie.view(h.state, null).turn?.missedVote).toEqual([HOST, 'cy']);
    // ben was the only voter and found it; the two who missed the vote count as not finding it,
    // so some found it: the storyteller (ana) and ben score 3.
    expect(h.state.turn?.allOrNone).toBe(false);
    expect([HOST, 'ana', 'ben', 'cy'].map((id) => score(h, id))).toEqual([0, 3, 3, 0]);
  });

  it('in strict mode count a missed vote as not finding the card', () => {
    const strict = { guessSeconds: 60, timerMode: 'strict' as const };
    // Everyone who voted missed it, and one didn't vote: still "nobody found it".
    const h = startedGame(FOUR, strict);
    tellAndGive(h);
    const st = storyteller(h);
    const [a, b, c] = othersOf(h) as [string, string, string];
    const cardOf = (owner: string) => h.state.turn!.table.findIndex((t) => t.owner === owner);
    h.act({ type: 'vote', index: cardOf(a) }, b);
    h.act({ type: 'vote', index: cardOf(b) }, a);
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.allOrNone).toBe(true);
    expect(score(h, st)).toBe(0);
    expect([a, b, c].map((id) => score(h, id))).toEqual([3, 3, 0]);
  });

  it('in strict mode score only those who voted, plus votes received, when time runs out', () => {
    const strict = { guessSeconds: 60, timerMode: 'strict' as const };
    const h = startedGame(FOUR, strict);
    tellAndGive(h);
    const cyCard = h.state.turn!.table.findIndex((t) => t.owner === 'cy');
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    h.act({ type: 'vote', index: cyCard }, 'ben');
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.allOrNone).toBe(false);
    expect(FOUR.map((id) => score(h, id))).toEqual([3, 3, 0, 1]);
    expect(h.state.turn?.results?.cy).toEqual({ points: 1, foundIt: false, votesReceived: 1 });
    // Nobody voted at all: nobody scores.
    const quiet = startedGame(FOUR, strict);
    tellAndGive(quiet);
    quiet.state = reverie.onDeadline!(quiet.state, reverie.nextDeadline!(quiet.state)!);
    expect(quiet.state.turn?.phase).toBe('reveal');
    expect(FOUR.map((id) => score(quiet, id))).toEqual([0, 0, 0, 0]);
  });

  it('in strict mode give two cards each for late players with three at the table', () => {
    const h = startedGame(THREE, { guessSeconds: 60, timerMode: 'strict' });
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    h.act({ type: 'give', cards: hand(h, 'ana').slice(0, 2) }, 'ana');
    h.state = reverie.onDeadline!(h.state, reverie.nextDeadline!(h.state)!);
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(5);
    expect(hand(h, 'ben')).toHaveLength(5);
    expect(new Set(cardsEverywhere(h)).size).toBe(84);
  });

  it('in strict mode lay the table when four drop to three mid-pick', () => {
    const h = startedGame(FOUR, { guessSeconds: 60, timerMode: 'strict' });
    const st = storyteller(h);
    h.act({ type: 'tell', card: hand(h, st)[0]!, clue: 'x' }, st);
    h.act({ type: 'give', cards: [hand(h, 'ana')[0]!] }, 'ana');
    leave(h, 'cy');
    const due = reverie.nextDeadline!(h.state)!;
    h.state = reverie.onDeadline!(h.state, due);
    expect(h.state.turn?.phase).toBe('vote');
    expect(h.state.turn?.table).toHaveLength(3);
    expect(reverie.nextDeadline!(h.state)).toBe(due + 60_000);
  });

  it('always make progress: a due deadline changes the state or clears the timer', () => {
    const settings = { clueSeconds: 30, guessSeconds: 60, timerMode: 'strict' as const };
    const check = (state: ReverieState) => {
      const due = reverie.nextDeadline!(state)!;
      expect(due).not.toBeNull();
      const after = reverie.onDeadline!(state, due + 1);
      expect(after).not.toBe(state);
      const next = reverie.nextDeadline!(after);
      expect(next === null || next > due).toBe(true);
      return after;
    };
    // clue -> (skipped storyteller) clue -> pick -> vote -> reveal, for three and four players.
    for (const ids of [THREE, FOUR]) {
      let state = startedGame(ids, settings).state;
      expect(state.turn?.phase).toBe('clue');
      state = check(state);
      expect(state.turn?.phase).toBe('clue');
      expect(state.turn?.storyteller).toBe('ana');
      const h = harness(ids);
      h.state = state;
      h.act({ type: 'tell', card: hand(h, 'ana')[0]!, clue: 'x' }, 'ana');
      state = check(h.state);
      expect(state.turn?.phase).toBe('vote');
      state = check(state);
      expect(state.turn?.phase).toBe('reveal');
      expect(reverie.nextDeadline!(state)).toBeNull();
    }
    // A stray deadline on a reveal is cleared rather than left to fire again.
    const h = startedGame(FOUR, settings);
    playTurn(h, ['ana']);
    const stray = { ...h.state, turn: { ...h.state.turn!, deadline: NOW } };
    expect(reverie.onDeadline!(stray, NOW).turn?.deadline).toBeNull();
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

  it('never leaks the hidden seed', () => {
    const h = startedGame();
    expect(h.state.seed).toBeGreaterThan(0);
    for (const viewer of [null, HOST, 'ana']) {
      expect(JSON.stringify(reverie.view(h.state, viewer))).not.toContain('seed');
    }
    tellAndGive(h);
    expect(JSON.stringify(reverie.view(h.state, 'ana'))).not.toContain('seed');
  });
});

describe('actionSchema', () => {
  it.each([
    { type: 'tell', card: 962, clue: 'x' },
    { type: 'tell', card: 1, clue: '' },
    { type: 'give', cards: [] },
    { type: 'give', cards: [1, 2, 3] },
    { type: 'update-settings', targetScore: 25 },
    { type: 'update-settings', sets: ['base', 'base'] },
    { type: 'vote', index: -1 },
    { type: 'vote', index: MAX_TABLE_SIZE },
  ])('rejects %j', (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });

  it('accepts the last seat at the largest table', () => {
    expect(MAX_TABLE_SIZE).toBe(8); // one card from each of 8 players; 5 with three
    expect(actionSchema.safeParse({ type: 'vote', index: MAX_TABLE_SIZE - 1 }).success).toBe(true);
  });
});
