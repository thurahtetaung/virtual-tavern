import { describe, expect, it } from 'vitest';
import { CARD_SETS } from '@vt/private-reverie/cards';
import {
  cardsNeeded,
  poolOf,
  redHerring,
  roundsFor,
  scoreRound,
  setTestDeal,
  startProblem,
} from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  SIX,
  game,
  harness,
  leave,
  playAll,
  playFirst,
  playRound,
  round,
  setWord,
  startedGame,
  talkAll,
  voteAll,
} from './test-utils.ts';
import { HAND_SIZE, LEFT_BEAT_MS, OURS_BASE, OURS_SET_IDS, chosenSets, setById } from './types.ts';

const ten = Array.from({ length: 10 }, (_, i) => (i ? `p${i}` : HOST));

describe('setting up', () => {
  it('deals six cards each from the chosen decks and picks a random first word-picker', () => {
    const h = startedGame(SIX);
    const g = game(h);
    for (const id of SIX) expect(g.hands[id]).toHaveLength(HAND_SIZE);
    expect(g.deck).toHaveLength(252 - 36);
    expect(g.players).toEqual(SIX);
    expect(round(h).stage).toBe('card');
    expect(round(h).turn).toBe(round(h).picker);
    const pickers = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => round(startedGame(SIX, s)).picker));
    expect(pickers.size).toBeGreaterThan(1);
  });

  it('plays once around at 5+ players, twice under 5 or with Twice around', () => {
    expect(roundsFor(4, false)).toBe(8);
    expect(roundsFor(5, false)).toBe(5);
    expect(roundsFor(8, false)).toBe(8);
    expect(roundsFor(6, true)).toBe(12);
    expect(game(startedGame(FOUR)).rounds).toBe(8);
    expect(game(startedGame(SIX)).rounds).toBe(6);
    expect(game(startedGame(SIX, 3, { twice: true })).rounds).toBe(12);
  });

  it('every player picks the word in turn, clockwise from the first', () => {
    const h = startedGame(SIX);
    const first = SIX.indexOf(round(h).picker);
    const seen: string[] = [];
    while (h.state.phase === 'playing') {
      seen.push(round(h).picker);
      playRound(h);
      h.act({ type: 'next-round' });
    }
    expect(seen).toEqual(SIX.map((_, i) => SIX[(first + i) % 6]));
  });

  it('needs 4 to 10 players and a card for every play', () => {
    expect(harness(FOUR.slice(0, 3)).reject({ type: 'start' })).toBe('cannot-start');
    expect(startProblem(harness(ten).state)).toBeNull();
    // 10 players need 200 cards: the Classic deck alone has 168.
    const small = harness(ten, 3, { sets: ['base'] });
    expect(startProblem(small.state)).toMatch(/200 cards.*168.*add the Noir deck/);
    expect(small.reject({ type: 'start' })).toBe('cannot-start');
    // Twice around at 8 needs 256: more than both decks.
    const eight = harness(ten.slice(0, 8), 3, { twice: true });
    expect(startProblem(eight.state)).toMatch(/256 cards.*252.*add another picture set/);
    expect(
      harness(FOUR).reject({
        type: 'update-settings',
        sets: [],
      }),
    ).toBe('no-deck');
    expect(harness(FOUR).reject({ type: 'update-settings', sets: ['base', 'ours-nope'] })).toBe(
      'unknown-set',
    );
    // A small selection: one picture set (84 cards) is enough for 5 players once around (50).
    const five = harness(ten.slice(0, 5), 3, { sets: ['ours-set-2'] });
    expect(cardsNeeded(5, false)).toBe(50);
    expect(startProblem(five.state)).toBeNull();
    const twice = harness(ten.slice(0, 5), 3, { sets: ['ours-set-2'], twice: true });
    expect(startProblem(twice.state)).toMatch(
      /100 cards.*84.*add the Classic deck or play once around/,
    );
  });

  it('starts with the Classic and Noir decks and every picture set off', () => {
    const h = harness(FOUR);
    expect(h.state.settings.sets).toEqual(['base', 'noir']);
    expect(redHerring.view(h.state, HOST).settings.sets).toEqual(['base', 'noir']);
  });

  it('reads a room saved with the old deck switches as the matching sets', () => {
    expect(chosenSets({ decks: { base: true, noir: false, ours: false } })).toEqual(['base']);
    expect(chosenSets({ decks: { base: false, noir: true, ours: true } })).toEqual([
      'noir',
      ...OURS_SET_IDS,
    ]);
    expect(OURS_SET_IDS).toEqual(CARD_SETS.map((s) => `ours-${s.id}`));
    const h = harness(FOUR);
    const { sets: _s, ...old } = h.state.settings;
    const saved = {
      ...h.state,
      settings: { ...old, decks: { base: false, noir: true, ours: true } },
    };
    const v = redHerring.view(saved as typeof h.state, HOST);
    expect(v.settings.sets).toEqual(['noir', ...OURS_SET_IDS]);
    expect('decks' in v.settings).toBe(false);
    expect(poolOf(saved.settings as typeof h.state.settings)).toHaveLength(84 + 951);
    // Changing the sets drops the old switches.
    h.state = saved as typeof h.state;
    h.act({ type: 'update-settings', sets: ['base'] });
    expect(h.state.settings).toMatchObject({ sets: ['base'] });
    expect(h.state.settings.decks).toBeUndefined();
  });

  it('deals only the chosen sets’ cards', () => {
    const h = startedGame(FOUR, 3, { sets: ['noir', 'ours-stellar'] });
    const all = [...game(h).deck, ...Object.values(game(h).hands).flat()];
    const allowed = new Set([...setById('noir')!.cards, ...setById('ours-stellar')!.cards]);
    expect(all).toHaveLength(84 + 84);
    expect(all.every((c) => allowed.has(c))).toBe(true);
    expect(all.filter((c) => c >= OURS_BASE).every((c) => c >= OURS_BASE + 878)).toBe(true);
  });

  it('plays our picture cards when asked, numbered after the game’s own', () => {
    const h = startedGame(FOUR, 3, { sets: [...OURS_SET_IDS] });
    const all = [...game(h).deck, ...Object.values(game(h).hands).flat()];
    expect(all.every((c) => c >= OURS_BASE)).toBe(true);
    expect(all).toHaveLength(951);
  });

  it('only the host changes settings, and only between games (the sound at any time)', () => {
    const h = startedGame(FOUR);
    expect(h.reject({ type: 'update-settings', twice: true }, 'ana')).toBe('not-host');
    expect(h.reject({ type: 'update-settings', twice: true })).toBe('in-progress');
    h.act({ type: 'update-settings', sound: 'host' });
    expect(h.state.settings.sound).toBe('host');
  });
});

describe('a round', () => {
  it('the word-picker plays a card first, then writes the word', () => {
    const h = startedGame(FOUR);
    const picker = round(h).picker;
    expect(h.reject({ type: 'word', word: 'Fog' }, picker)).toBe('wrong-stage');
    const other = FOUR.find((id) => id !== picker)!;
    expect(h.reject({ type: 'play', card: game(h).hands[other]![0]! }, other)).toBe(
      'not-your-turn',
    );
    playFirst(h);
    expect(round(h).stage).toBe('word');
    expect(round(h).plays).toHaveLength(1);
    expect(game(h).hands[picker]).toHaveLength(HAND_SIZE);
    expect(h.reject({ type: 'word', word: 'Fog' }, other)).toBe('not-picker');
    expect(h.reject({ type: 'word', word: '   ' }, picker)).toBe('no-word');
    expect(h.reject({ type: 'word', word: 'x'.repeat(31) }, picker)).toBe('word-long');
    h.act({ type: 'word', word: '  Old   harbour ' }, picker);
    expect(round(h).word).toBe('Old harbour');
    expect(round(h).stage).toBe('play');
    expect(round(h).turn).toBe(round(h).order[1]);
  });

  it('the Conspirator is anyone but the word-picker, at random', () => {
    const seen = new Set<string>();
    for (let s = 1; s <= 30; s++) {
      const h = startedGame(FOUR, s);
      setWord(h);
      expect(round(h).conspirator).not.toBe(round(h).picker);
      seen.add(round(h).order.indexOf(round(h).conspirator!).toString());
    }
    expect(seen).toEqual(new Set(['1', '2', '3']));
  });

  it('two laps: everyone in order from the word-picker’s left, then the word-picker again', () => {
    const h = startedGame(FOUR);
    setWord(h);
    playAll(h);
    const order = round(h).order;
    expect(round(h).plays.map((p) => p.by)).toEqual([...order, ...order]);
    expect(round(h).plays.map((p) => p.lap)).toEqual([1, 1, 1, 1, 2, 2, 2, 2]);
    for (const id of FOUR) expect(game(h).hands[id]).toHaveLength(HAND_SIZE);
    expect(round(h).stage).toBe('explain');
    expect(round(h).turn).toBe(round(h).picker);
  });

  it('explanations in order, then a discussion the host ends', () => {
    const h = startedGame(FOUR);
    setWord(h);
    playAll(h);
    const order = round(h).order;
    expect(h.reject({ type: 'done' }, order[1])).toBe('not-your-turn');
    h.act({ type: 'done' }, order[0]);
    expect(round(h).turn).toBe(order[1]);
    // The host may end someone's explanation.
    const hostIsNext = order[1] === HOST;
    h.act({ type: 'done' }, HOST);
    expect(round(h).skipped).toEqual(hostIsNext ? [] : [order[1]]);
    h.act({ type: 'done' }, order[2]);
    h.act({ type: 'done' }, order[3]);
    expect(round(h).stage).toBe('discuss');
    expect(h.reject({ type: 'end-discussion' }, 'ana')).toBe('not-host');
    h.act({ type: 'end-discussion' });
    expect(round(h).stage).toBe('vote');
  });

  it('No Discussion goes straight from the cards to the vote', () => {
    const h = startedGame(FOUR, 3, { noDiscussion: true });
    setWord(h);
    playAll(h);
    expect(round(h).stage).toBe('vote');
  });

  it('votes: never yourself, never the word-picker; the word-picker doesn’t vote', () => {
    const h = startedGame(FOUR);
    setWord(h);
    playAll(h);
    talkAll(h);
    const [picker, a, b] = round(h).order as [string, string, string];
    expect(h.reject({ type: 'vote', player: a }, picker)).toBe('picker');
    expect(h.reject({ type: 'vote', player: a }, a)).toBe('self');
    expect(h.reject({ type: 'vote', player: picker }, a)).toBe('picker-target');
    h.act({ type: 'vote', player: b }, a);
    expect(h.reject({ type: 'vote', player: b }, a)).toBe('voted');
  });

  it('open vote in turn: one at a time from the word-picker’s left', () => {
    const h = startedGame(FOUR, 3, { openVote: true });
    setWord(h);
    playAll(h);
    talkAll(h);
    const [, a, b] = round(h).order as [string, string, string];
    expect(round(h).turn).toBe(a);
    expect(h.reject({ type: 'vote', player: a }, b)).toBe('not-your-turn');
    h.act({ type: 'vote', player: b }, a);
    expect(round(h).turn).toBe(b);
  });

  it('the round is revealed once everyone has voted', () => {
    const h = startedGame(FOUR);
    playRound(h);
    expect(round(h).stage).toBe('reveal');
    expect(round(h).result?.conspirator).toBe(round(h).conspirator);
    expect(game(h).history).toHaveLength(1);
    expect(h.reject({ type: 'next-round' }, 'ana')).toBe('not-host');
    h.act({ type: 'next-round' });
    expect(round(h).no).toBe(2);
    expect(round(h).stage).toBe('card');
  });
});

describe('scoring', () => {
  const r = (votes: Record<string, string>) => ({ picker: 'p', conspirator: 'c', votes });
  it('rulebook: each finder 3; fewer than 2 finders, Conspirator 5 and word-picker 4', () => {
    expect(scoreRound(r({ a: 'b', b: 'a', c: 'a' }), 'rulebook').points).toEqual({ c: 5, p: 4 });
    expect(scoreRound(r({ a: 'c', b: 'a', c: 'a' }), 'rulebook')).toMatchObject({
      against: 1,
      caught: false,
      points: { a: 3, c: 5, p: 4 },
    });
    expect(scoreRound(r({ a: 'c', b: 'c', c: 'a' }), 'rulebook')).toMatchObject({
      against: 2,
      caught: true,
      points: { a: 3, b: 3 },
    });
  });

  it('score only a catch: a lone finder scores nothing', () => {
    expect(scoreRound(r({ a: 'c', b: 'a', c: 'a' }), 'caught').points).toEqual({ c: 5, p: 4 });
    expect(scoreRound(r({ a: 'c', b: 'c', c: 'a' }), 'caught').points).toEqual({ a: 3, b: 3 });
  });

  it('just for fun: nobody scores, and nobody wins', () => {
    expect(scoreRound(r({ a: 'c', b: 'c', c: 'a' }), 'fun')).toMatchObject({
      caught: true,
      points: {},
    });
    const h = startedGame(FOUR, 3, { scoring: 'fun' });
    while (h.state.phase === 'playing') {
      playRound(h);
      h.act({ type: 'next-round' });
    }
    expect(h.state.winners).toEqual([]);
    expect(h.state.endReason).toBe('rounds');
  });

  it('most points wins; a tie goes to more scoring rounds, then is shared', () => {
    const h = startedGame(FOUR);
    while (h.state.phase === 'playing') {
      playRound(h);
      h.act({ type: 'next-round' });
    }
    const g = game(h);
    const total = (id: string) => g.tokens[id]!.reduce((a, b) => a + b, 0);
    const best = Math.max(...FOUR.map(total));
    const top = FOUR.filter((id) => total(id) === best);
    const most = Math.max(...top.map((id) => g.tokens[id]!.length));
    expect(h.state.winners).toEqual(top.filter((id) => g.tokens[id]!.length === most));
    expect(g.history).toHaveLength(8);
  });
});

describe('balanced deal', () => {
  it('everyone is the Conspirator about equally', () => {
    const h = startedGame(SIX, 5, { balanced: true, twice: true });
    while (h.state.phase === 'playing') {
      playRound(h);
      h.act({ type: 'next-round' });
    }
    // A word-picker can't be the Conspirator, so the counts may drift by one more.
    const counts = Object.values(game(h).conspired);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(12);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2);
  });
});

describe('timers', () => {
  it('soft timers never act; strict ones play a card, end explanations and the discussion, and vote', () => {
    const soft = startedGame(FOUR, 3, { turnSeconds: 30 });
    expect(redHerring.nextDeadline!(soft.state)).toBeNull();
    const h = startedGame(FOUR, 3, {
      turnSeconds: 30,
      talkSeconds: 30,
      discussSeconds: 60,
      timerMode: 'strict',
    });
    expect(redHerring.nextDeadline!(h.state)).toBe(NOW + 30_000);
    h.tick(30_000);
    expect(round(h).stage).toBe('word');
    expect(round(h).plays[0]?.auto).toBe(true);
    // The word is never written for anyone.
    expect(redHerring.nextDeadline!(h.state)).toBeNull();
    h.act({ type: 'word', word: 'Fog' }, round(h).picker);
    for (let i = 0; i < 7; i++) h.tick(30_000);
    expect(round(h).stage).toBe('explain');
    for (let i = 0; i < 4; i++) h.tick(30_000);
    expect(round(h).skipped).toHaveLength(4);
    expect(round(h).stage).toBe('discuss');
    h.tick(60_000);
    expect(round(h).stage).toBe('vote');
    h.tick(30_000);
    expect(round(h).stage).toBe('reveal');
    expect(round(h).autoVotes).toHaveLength(3);
  });

  it('the host may Act for a player the table waits on, never write the word', () => {
    const h = startedGame(FOUR);
    const picker = round(h).picker;
    h.act({ type: 'act-for', player: picker });
    expect(round(h).stage).toBe('word');
    expect(h.reject({ type: 'act-for', player: picker })).toBe('not-waiting');
    expect(h.reject({ type: 'act-for', player: picker }, 'ana')).toBe('not-host');
  });
});

describe('players who leave', () => {
  it('a player who left has their moves made after a short beat, and is never the Conspirator', () => {
    for (let s = 1; s <= 10; s++) {
      const h = startedGame(SIX, s);
      const gone = round(h).order[2]!;
      leave(h, gone);
      setWord(h);
      expect(round(h).conspirator).not.toBe(gone);
      while (round(h).stage === 'play') {
        if (round(h).turn === gone) {
          expect(redHerring.nextDeadline!(h.state)).toBe(h.now + LEFT_BEAT_MS);
          h.tick(LEFT_BEAT_MS);
        } else playFirst(h);
      }
      expect(round(h).plays.filter((p) => p.by === gone && p.auto)).toHaveLength(2);
    }
  });

  it('their turn as word-picker is skipped: the game is a round shorter', () => {
    const h = startedGame(SIX);
    const next = round(h).order[1]!;
    const after = round(h).order[2]!;
    leave(h, next);
    playRound(h, undefined);
    h.act({ type: 'next-round' });
    expect(round(h).picker).toBe(after);
    expect(game(h).rounds).toBe(5);
  });

  it('a word-picker leaving before the word drops the round', () => {
    const h = startedGame(SIX);
    const picker = round(h).picker;
    playFirst(h);
    leave(h, picker);
    expect(round(h).picker).toBe(round(h).order[0]);
    expect(round(h).picker).not.toBe(picker);
    expect(round(h).no).toBe(1);
    expect(game(h).rounds).toBe(5);
  });

  it('with fewer than 4 left, the game ends after the round', () => {
    const h = startedGame(FOUR);
    const gone = round(h).order[3]!;
    setWord(h);
    leave(h, gone);
    while (round(h).stage === 'play')
      if (round(h).turn === gone) h.tick(LEFT_BEAT_MS);
      else playFirst(h);
    talkAll(h);
    voteAll(h);
    h.tick(LEFT_BEAT_MS);
    expect(round(h).stage).toBe('reveal');
    h.act({ type: 'next-round' });
    expect(h.state.phase).toBe('over');
    expect(h.state.endReason).toBe('too-few');
  });

  it('the host can take out a player who dropped out; a returning player plays on', () => {
    const h = startedGame(SIX);
    const id = round(h).order[3]!;
    expect(h.reject({ type: 'remove', player: id })).toBe('not-away');
    h.act({ type: 'remove', player: id }, HOST, { connected: (p) => p !== id });
    expect(game(h).left[id]).toBe(h.now);
    h.state = redHerring.playerJoined(h.state, { id, name: 'Back' });
    expect(game(h).left[id]).toBeUndefined();
  });

  it('newcomers mid-game watch', () => {
    const h = startedGame(FOUR);
    h.state = redHerring.playerJoined(h.state, { id: 'new', name: 'New' });
    expect(h.state.seats.new?.playing).toBe(false);
    expect(h.reject({ type: 'play', card: 1 }, 'new')).toBe('watching');
  });
});

describe('the browser-test rig', () => {
  it('deals in card order, the first seat picks first, and fixes the Conspirator', () => {
    setTestDeal(2);
    try {
      const h = startedGame(FOUR);
      expect(game(h).hands[HOST]).toEqual([1, 2, 3, 4, 5, 6]);
      expect(game(h).hands.ana).toEqual([7, 8, 9, 10, 11, 12]);
      expect(round(h).picker).toBe(HOST);
      setWord(h);
      expect(round(h).conspirator).toBe('ben');
    } finally {
      setTestDeal(null);
    }
  });
});
