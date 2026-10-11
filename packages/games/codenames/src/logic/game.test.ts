import { describe, expect, it } from 'vitest';
import { codenames, wordPool } from './game.ts';
import { HOST, NOW, OP, SPY, cardsOf, clue, content, harness, startedGame } from './test-utils.ts';
import { type Team, actionSchema } from './types.ts';

describe('create', () => {
  it('seats everyone as spectators and selects the first word list', () => {
    const { state } = harness(['a', 'b'], content({ first: [], second: [] }));
    expect(state.phase).toBe('lobby');
    expect(state.settings).toEqual({
      wordListIds: ['first'],
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    });
    expect(state.seats).toEqual({
      a: { name: 'A', team: null, role: 'operative' },
      b: { name: 'B', team: null, role: 'operative' },
    });
  });
});

describe('lobby', () => {
  it('lets players pick seats but only one spymaster per team', () => {
    const h = harness();
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, 'p2');
    expect(h.reject({ type: 'join-team', team: 'red', role: 'spymaster' }, 'p3')).toBe(
      'seat-taken',
    );
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, 'p2'); // re-selecting own seat is fine
    expect(h.state.seats.p2).toMatchObject({ team: 'red', role: 'spymaster' });
  });

  it('forces spectators to the operative role', () => {
    const h = harness();
    h.act({ type: 'join-team', team: null, role: 'spymaster' }, 'p2');
    expect(h.state.seats.p2).toMatchObject({ team: null, role: 'operative' });
  });

  it('restricts settings to the host and validates word lists', () => {
    const h = harness(undefined, content({ a: [], b: [] }));
    expect(h.reject({ type: 'update-settings', clueSeconds: 60 }, 'p2')).toBe('not-host');
    expect(h.reject({ type: 'update-settings', wordListIds: ['nope'] })).toBe('unknown-word-list');
    h.act({ type: 'update-settings', wordListIds: ['a', 'b', 'a'], clueSeconds: 60 });
    expect(h.state.settings).toEqual({
      wordListIds: ['a', 'b'],
      clueSeconds: 60,
      guessSeconds: null,
      timerMode: 'soft',
    });
    h.act({ type: 'update-settings', timerMode: 'strict' });
    expect(h.state.settings.timerMode).toBe('strict');
  });

  it('randomizes everyone into two balanced teams with one spymaster each', () => {
    const h = harness([HOST, 'a', 'b', 'c', 'd', 'e']);
    h.act({ type: 'randomize-teams' });
    const seats = Object.values(h.state.seats);
    for (const team of ['red', 'blue'] as const) {
      const members = seats.filter((s) => s.team === team);
      expect(members).toHaveLength(3);
      expect(members.filter((s) => s.role === 'spymaster')).toHaveLength(1);
    }
    expect(Object.keys(h.state.seats)).toEqual([HOST, 'a', 'b', 'c', 'd', 'e']);
  });

  it('keeps chosen Spymasters in their seats when shuffling', () => {
    const h = harness([HOST, 'a', 'b', 'c', 'd', 'e']);
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'c');
    h.act({ type: 'randomize-teams' });
    expect(h.state.seats.c).toMatchObject({ team: 'blue', role: 'spymaster' });
    const seats = Object.values(h.state.seats);
    for (const team of ['red', 'blue'] as const) {
      const members = seats.filter((s) => s.team === team);
      expect(members).toHaveLength(3);
      expect(members.filter((s) => s.role === 'spymaster')).toHaveLength(1);
    }
    for (const seed of [2, 3, 4]) {
      const again = harness([HOST, 'a', 'b', 'c'], undefined, seed);
      again.act({ type: 'join-team', team: 'red', role: 'spymaster' }, 'a');
      again.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'b');
      again.act({ type: 'randomize-teams' });
      expect(again.state.seats.a).toMatchObject({ team: 'red', role: 'spymaster' });
      expect(again.state.seats.b).toMatchObject({ team: 'blue', role: 'spymaster' });
      expect(again.state.seats[HOST]).toMatchObject({ role: 'operative' });
    }
  });

  it('still shuffles with fewer than four players, which leaves a team short', () => {
    const three = harness([HOST, 'a', 'b']);
    three.act({ type: 'randomize-teams' });
    const seats = Object.values(three.state.seats);
    expect(seats.filter((s) => s.role === 'spymaster')).toHaveLength(2);
    expect(seats.filter((s) => s.team === null)).toHaveLength(0);
    expect(three.reject({ type: 'start' })).toBe('missing-operative');

    const one = harness([HOST]);
    one.act({ type: 'randomize-teams' });
    expect(one.state.seats[HOST]).toMatchObject({ role: 'spymaster' });
    expect(one.reject({ type: 'start' })).toBe('missing-spymaster');
  });

  it('only lets the host start, and only with full teams', () => {
    const h = harness();
    expect(h.reject({ type: 'start' }, 'p2')).toBe('not-host');
    expect(h.reject({ type: 'start' })).toBe('missing-spymaster');
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, HOST);
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'p3');
    expect(h.reject({ type: 'start' })).toBe('missing-operative');
  });

  it('refuses to start without 25 unique words', () => {
    const words = [...Array.from({ length: 24 }, (_, i) => `w${i}`), 'W0', ' w1 '];
    const h = harness(undefined, content({ small: words }));
    h.act({ type: 'randomize-teams' });
    expect(h.reject({ type: 'start' })).toBe('not-enough-words');
  });
});

describe('wordPool', () => {
  it('trims, drops blanks and de-duplicates case-insensitively keeping the first spelling', () => {
    expect(wordPool([' Apple', 'apple', 'APPLE ', '', '  ', 'Pear'])).toEqual(['Apple', 'Pear']);
  });
});

describe('start', () => {
  it('deals 9/8/7/1 with the starting team holding nine', () => {
    const { state } = startedGame();
    expect(state.phase).toBe('playing');
    expect(state.board).toHaveLength(25);
    expect(new Set(state.board.map((c) => c.word)).size).toBe(25);
    const count = (k: string) => state.board.filter((c) => c.kind === k).length;
    expect([count('red'), count('blue'), count('bystander'), count('assassin')]).toEqual([
      9, 8, 7, 1,
    ]);
    expect(state.turn).toEqual({
      team: 'red',
      stage: 'clue',
      clue: null,
      guessesMade: 0,
      deadline: null,
    });
    expect(state.gamesPlayed).toBe(1);
  });

  it('draws words from all selected lists', () => {
    const lists = {
      a: Array.from({ length: 13 }, (_, i) => `a${i}`),
      b: Array.from({ length: 13 }, (_, i) => `b${i}`),
    };
    const h = harness(undefined, content(lists));
    h.act({ type: 'update-settings', wordListIds: ['a', 'b'] });
    h.act({ type: 'randomize-teams' });
    h.act({ type: 'start' });
    const words = h.state.board.map((c) => c.word);
    expect(words.some((w) => w.startsWith('a'))).toBe(true);
    expect(words.some((w) => w.startsWith('b'))).toBe(true);
  });

  it('locks settings and seats while playing', () => {
    const h = startedGame();
    expect(h.reject({ type: 'update-settings', clueSeconds: 30 })).toBe('in-progress');
    expect(h.reject({ type: 'join-team', team: 'red', role: 'operative' }, SPY.red)).toBe(
      'team-locked',
    );
    expect(h.reject({ type: 'join-team', team: null, role: 'operative' }, SPY.red)).toBe(
      'team-locked',
    );
    expect(h.reject({ type: 'start' })).toBe('in-progress');
    expect(h.state.keyHolders).toEqual({ [SPY.red]: 'red', [SPY.blue]: 'blue' });
  });

  it('keeps operatives on their team mid-game, even via the spectator bench', () => {
    const h = startedGame();
    clue(h, 'red');
    expect(h.reject({ type: 'join-team', team: 'blue', role: 'operative' }, OP.red)).toBe(
      'team-locked',
    );
    expect(h.reject({ type: 'join-team', team: null, role: 'operative' }, OP.red)).toBe(
      'team-locked',
    );
    // Re-picking the seat you already have is a harmless no-op.
    expect(h.act({ type: 'join-team', team: 'red', role: 'operative' }, OP.red)).toBe(h.state);
    expect(h.state.seats[OP.red]).toMatchObject({ team: 'red', role: 'operative' });
  });

  it('lets newcomers join as operatives or take a vacant spymaster seat mid-game', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'late', name: 'Late' });
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, 'late');
    expect(h.reject({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'late')).toBe(
      'seat-taken',
    );
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'late');
    expect(h.state.seats.late).toMatchObject({ team: 'blue', role: 'spymaster' });
    expect(h.state.keyHolders).toMatchObject({ late: 'blue' });
  });

  it('lets an operative fill their own vacant spymaster seat, but not the other team’s', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'p5', name: 'P5' });
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, 'p5');
    clue(h, 'red', 2);
    const [i] = cardsOf(h.state, 'red');
    h.act({ type: 'toggle-suggestion', card: i! }, OP.red);
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    expect(h.reject({ type: 'join-team', team: 'blue', role: 'spymaster' }, OP.red)).toBe(
      'team-locked',
    );
    h.state = codenames.playerJoined(h.state, { id: 'p6', name: 'P6' });
    h.act({ type: 'join-team', team: 'red', role: 'operative' }, 'p6');
    // The clue is out, so Red guesses on without its Spymaster.
    h.state = codenames.playerLeft(h.state, SPY.red, NOW);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'guess' });
    h.state = { ...h.state, suggestions: { [i!]: [OP.red, 'p5'] } };
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, OP.red);
    expect(h.state.seats[OP.red]).toMatchObject({ team: 'red', role: 'spymaster' });
    expect(h.state.keyHolders).toMatchObject({ [OP.red]: 'red' });
    expect(h.state.suggestions).toEqual({ [i!]: ['p5'] });
  });

  it('only lets an ex-spymaster who rejoins resume their old seat', () => {
    const h = startedGame();
    clue(h, 'red');
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    h.state = codenames.playerJoined(h.state, { id: SPY.blue, name: 'Back' });
    expect(h.state.seats[SPY.blue]).toEqual({ name: 'Back', team: null, role: 'operative' });
    expect(h.reject({ type: 'join-team', team: 'red', role: 'operative' }, SPY.blue)).toBe(
      'team-locked',
    );
    expect(h.reject({ type: 'join-team', team: 'blue', role: 'operative' }, SPY.blue)).toBe(
      'team-locked',
    );
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, SPY.blue);
    expect(h.state.seats[SPY.blue]).toMatchObject({ team: 'blue', role: 'spymaster' });
  });

  it('frees every seat again once the game is over', () => {
    const h = startedGame();
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, SPY.red);
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, OP.red);
    expect(h.state.seats[SPY.red]).toMatchObject({ team: 'blue', role: 'operative' });
  });
});

describe('clues', () => {
  it("only accepts a single word from the current team's spymaster", () => {
    const h = startedGame();
    expect(h.reject({ type: 'give-clue', word: 'hint', count: 1 }, SPY.blue)).toBe('not-your-turn');
    expect(h.reject({ type: 'give-clue', word: 'hint', count: 1 }, OP.red)).toBe('not-your-turn');
    expect(h.reject({ type: 'give-clue', word: 'two words', count: 1 }, SPY.red)).toBe('bad-clue');
    h.act({ type: 'give-clue', word: "rock-n'roll", count: 2 }, SPY.red);
    expect(h.state.turn).toMatchObject({ stage: 'guess', clue: { word: "rock-n'roll", count: 2 } });
    expect(h.state.log.at(-1)).toEqual({
      type: 'clue',
      team: 'red',
      by: SPY.red,
      name: 'HOST',
      word: "rock-n'roll",
      count: 2,
    });
    expect(h.reject({ type: 'give-clue', word: 'again', count: 1 }, SPY.red)).toBe('wrong-stage');
  });

  it('rejects unrevealed board words, case-insensitively, but allows revealed ones', () => {
    const h = startedGame();
    const [i] = cardsOf(h.state, 'red');
    const word = h.state.board[i!]!.word;
    expect(h.reject({ type: 'give-clue', word: word.toUpperCase(), count: 1 }, SPY.red)).toBe(
      'bad-clue',
    );
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: i! }, OP.red);
    h.act({ type: 'end-turn' }, OP.red);
    h.act({ type: 'give-clue', word, count: 1 }, SPY.blue);
  });

  it('rejects clues that are just a number', () => {
    const h = startedGame();
    expect(h.reject({ type: 'give-clue', word: '42', count: 1 }, SPY.red)).toBe('clue-is-number');
    expect(h.reject({ type: 'give-clue', word: '٣', count: 1 }, SPY.red)).toBe('clue-is-number');
    h.act({ type: 'give-clue', word: 'catch-22', count: 1 }, SPY.red);
    expect(h.state.turn?.clue).toEqual({ word: 'catch-22', count: 1 });
  });

  it('caps the number at the agents the team still has to find', () => {
    const h = startedGame();
    const reds = cardsOf(h.state, 'red');
    h.state = {
      ...h.state,
      board: h.state.board.map((c, i) =>
        reds.slice(2).includes(i) ? { ...c, revealed: true } : c,
      ),
    };
    expect(h.reject({ type: 'give-clue', word: 'hint', count: 3 }, SPY.red)).toBe('count-too-high');
    clue(h, 'red', 2);
    expect(h.state.turn?.clue?.count).toBe(2);
  });
});

describe('guessing', () => {
  it('only lets operatives of the current team guess, after a clue', () => {
    const h = startedGame();
    const [i] = cardsOf(h.state, 'red');
    expect(h.reject({ type: 'guess', card: i! }, OP.red)).toBe('wrong-stage');
    clue(h, 'red');
    expect(h.reject({ type: 'guess', card: i! }, SPY.red)).toBe('not-your-turn');
    expect(h.reject({ type: 'guess', card: i! }, OP.blue)).toBe('not-your-turn');
    h.act({ type: 'guess', card: i! }, OP.red);
    expect(h.reject({ type: 'guess', card: i! }, OP.red)).toBe('already-revealed');
  });

  it('allows N + 1 guesses for a clue of N', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    const reds = cardsOf(h.state, 'red');
    h.act({ type: 'guess', card: reds[0]! }, OP.red);
    h.act({ type: 'guess', card: reds[1]! }, OP.red);
    expect(h.state.turn).toMatchObject({ team: 'red', guessesMade: 2 });
    h.act({ type: 'guess', card: reds[2]! }, OP.red);
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'out-of-guesses' });
  });

  it('ends the turn on a bystander', () => {
    const h = startedGame();
    clue(h, 'red', 3);
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.log.at(-1)).toMatchObject({ type: 'end-turn', reason: 'wrong-guess' });
  });

  it("ends the turn on an opponent's card, which counts for the opponent", () => {
    const h = startedGame();
    clue(h, 'red', 3);
    h.act({ type: 'guess', card: cardsOf(h.state, 'blue')[0]! }, OP.red);
    expect(h.state.turn?.team).toBe('blue');
    expect(codenames.view(h.state, null).remaining).toEqual({ red: 9, blue: 7 });
  });

  it('loses immediately on the assassin', () => {
    const h = startedGame();
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    expect(h.state).toMatchObject({
      phase: 'over',
      winner: 'blue',
      winReason: 'assassin',
      turn: null,
    });
    expect(h.state.log.at(-1)).toEqual({ type: 'game-over', winner: 'blue', reason: 'assassin' });
  });

  it('wins when the team finds all its agents', () => {
    const h = startedGame();
    clue(h, 'red', 9);
    for (const i of cardsOf(h.state, 'red')) h.act({ type: 'guess', card: i }, OP.red);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red', winReason: 'all-agents' });
  });

  it('hands the win to the opponent when their last agent is revealed by the guessing team', () => {
    const h = startedGame();
    const blues = cardsOf(h.state, 'blue');
    h.state = {
      ...h.state,
      board: h.state.board.map((c, i) =>
        blues.slice(1).includes(i) ? { ...c, revealed: true } : c,
      ),
    };
    clue(h, 'red');
    h.act({ type: 'guess', card: blues[0]! }, OP.red);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'blue', winReason: 'all-agents' });
  });

  it('lets operatives end their turn once they have guessed at least once', () => {
    const h = startedGame();
    expect(h.reject({ type: 'end-turn' }, OP.red)).toBe('wrong-stage');
    clue(h, 'red', 2);
    expect(h.reject({ type: 'end-turn' }, OP.blue)).toBe('not-your-turn');
    expect(h.reject({ type: 'end-turn' }, OP.red)).toBe('must-guess');
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    h.act({ type: 'end-turn' }, OP.red);
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'passed' });
  });

  it('lets the host end any turn at any stage, logged as an override', () => {
    const h = startedGame();
    h.act({ type: 'end-turn' }, HOST);
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'host' });
    clue(h, 'blue', 2);
    h.act({ type: 'end-turn' }, HOST);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'clue' });
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'blue', reason: 'host' });
    expect(h.state.suggestions).toEqual({});
  });

  it('plays a whole game through to an all-agents win', () => {
    const h = startedGame();
    const per: Record<Team, number> = { red: 3, blue: 2 };
    let turns = 0;
    while (h.state.phase === 'playing') {
      const team = h.state.turn!.team;
      const count = Math.min(per[team], cardsOf(h.state, team).length);
      clue(h, team, count);
      for (const i of cardsOf(h.state, team).slice(0, count))
        h.act({ type: 'guess', card: i }, OP[team]);
      if (h.state.phase === 'playing' && h.state.turn!.team === team) {
        h.act({ type: 'end-turn' }, OP[team]);
      }
      turns++;
    }
    expect(turns).toBe(5);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red', winReason: 'all-agents' });
    expect(codenames.view(h.state, null).remaining).toEqual({ red: 0, blue: 4 });
    expect(h.state.log.filter((e) => e.type === 'end-turn')).toHaveLength(4);
    expect(h.state.log.filter((e) => e.type === 'guess')).toHaveLength(13);
  });
});

describe('suggestions', () => {
  it('toggles marks, shows them only to the guessing team, and clears them on turn end', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'p5', name: 'P5' });
    h.act({ type: 'join-team', team: 'red', role: 'operative' }, 'p5');
    clue(h, 'red', 2);
    const [a, b] = cardsOf(h.state, 'red');
    h.act({ type: 'toggle-suggestion', card: a! }, OP.red);
    h.act({ type: 'toggle-suggestion', card: a! }, 'p5');
    h.act({ type: 'toggle-suggestion', card: b! }, 'p5');
    h.act({ type: 'toggle-suggestion', card: b! }, 'p5');
    expect(h.state.suggestions).toEqual({ [a!]: [OP.red, 'p5'] });
    expect(codenames.view(h.state, OP.red).board[a!]!.suggestedBy).toEqual([OP.red, 'p5']);
    expect(codenames.view(h.state, OP.blue).board[a!]!.suggestedBy).toEqual([]);
    expect(codenames.view(h.state, null).board[a!]!.suggestedBy).toEqual([]);
    expect(h.reject({ type: 'toggle-suggestion', card: a! }, OP.blue)).toBe('not-your-turn');

    h.act({ type: 'guess', card: a! }, OP.red);
    expect(h.state.suggestions).toEqual({});
    h.act({ type: 'toggle-suggestion', card: b! }, OP.red);
    h.act({ type: 'end-turn' }, OP.red);
    expect(h.state.suggestions).toEqual({});
  });
});

describe('turn timer', () => {
  it('is off by default', () => {
    const h = startedGame();
    expect(codenames.nextDeadline!(h.state)).toBeNull();
  });

  it('only shows soft timers: the deadline is visible but the turn never passes', () => {
    const h = startedGame({ clueSeconds: 60, timerMode: 'soft' });
    expect(h.state.turn?.deadline).toBe(NOW + 60_000);
    expect(codenames.view(h.state, OP.red).turn?.deadline).toBe(NOW + 60_000);
    expect(codenames.nextDeadline!(h.state)).toBeNull();
    expect(codenames.onDeadline!(h.state, NOW + 3_600_000)).toBe(h.state);
  });

  it('treats rooms saved before timer modes existed as soft', () => {
    const h = startedGame({ clueSeconds: 60 });
    const { timerMode: _, ...legacy } = h.state.settings;
    expect(codenames.nextDeadline!({ ...h.state, settings: legacy })).toBeNull();
  });

  it('passes the turn when the clue timer runs out', () => {
    const h = startedGame({ clueSeconds: 60, guessSeconds: 90 });
    expect(codenames.nextDeadline!(h.state)).toBe(NOW + 60_000);
    expect(codenames.onDeadline!(h.state, NOW + 59_999)).toBe(h.state);
    const after = codenames.onDeadline!(h.state, NOW + 60_000);
    expect(after.turn).toEqual({
      team: 'blue',
      stage: 'clue',
      clue: null,
      guessesMade: 0,
      deadline: NOW + 120_000,
    });
    expect(after.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'timeout' });
  });

  it('restarts with the guess timer after a clue and ends the turn when it runs out', () => {
    const h = startedGame({ clueSeconds: 60, guessSeconds: 90 });
    h.act({ type: 'give-clue', word: 'hint', count: 1 }, SPY.red, { now: NOW + 5_000 });
    expect(codenames.nextDeadline!(h.state)).toBe(NOW + 95_000);
    // Early wake-ups are a no-op, even with no guesses made.
    expect(codenames.onDeadline!(h.state, NOW + 94_999)).toBe(h.state);
    const after = codenames.onDeadline!(h.state, NOW + 95_000);
    expect(after.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(after.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'timeout' });
  });

  it('can time only one stage', () => {
    const h = startedGame({ guessSeconds: 30 });
    expect(codenames.nextDeadline!(h.state)).toBeNull();
    clue(h, 'red');
    expect(codenames.nextDeadline!(h.state)).toBe(NOW + 30_000);
  });

  it('has no deadline once the game is over', () => {
    const h = startedGame({ clueSeconds: 60, guessSeconds: 60 });
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    expect(codenames.nextDeadline!(h.state)).toBeNull();
    expect(codenames.onDeadline!(h.state, NOW * 2)).toBe(h.state);
  });
});

describe('view', () => {
  it('hides unrevealed card kinds from operatives and spectators', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'spec', name: 'Spec' });
    clue(h, 'red');
    const revealed = cardsOf(h.state, 'red')[0]!;
    h.act({ type: 'guess', card: revealed }, OP.red);
    for (const viewer of [OP.red, OP.blue, 'spec', null]) {
      const board = codenames.view(h.state, viewer).board;
      expect(board.filter((c) => c.kind !== null)).toEqual([board[revealed]]);
      expect(board[revealed]).toMatchObject({ kind: 'red', revealed: true });
    }
  });

  it('shows the key to spymasters and to everyone once the game is over', () => {
    const h = startedGame();
    expect(codenames.view(h.state, SPY.blue).board.every((c) => c.kind !== null)).toBe(true);
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    expect(codenames.view(h.state, null).board.every((c) => c.kind !== null)).toBe(true);
  });

  it('describes the viewer, every seat and who has seen the key', () => {
    const h = startedGame();
    const v = codenames.view(h.state, OP.red);
    expect(v.me).toEqual({ id: OP.red, name: 'P2', team: 'red', role: 'operative' });
    expect(v.seats.map((s) => s.id)).toEqual([HOST, 'p2', 'p3', 'p4']);
    expect(v.keyHolders).toEqual({ [SPY.red]: 'red', [SPY.blue]: 'blue' });
    expect(codenames.view(h.state, 'stranger').me).toBeNull();
    const { keyHolders: _, ...legacy } = h.state;
    expect(codenames.view(legacy, null).keyHolders).toEqual({});
  });
});

describe('players coming and going', () => {
  it('upserts names on rejoin without changing seats', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: OP.red, name: 'Renamed' });
    expect(h.state.seats[OP.red]).toEqual({ name: 'Renamed', team: 'red', role: 'operative' });
  });

  it('removes the seat and their suggestions when a player leaves', () => {
    const h = startedGame();
    clue(h, 'red');
    const [i] = cardsOf(h.state, 'red');
    h.act({ type: 'toggle-suggestion', card: i! }, OP.red);
    h.state = codenames.playerLeft(h.state, OP.blue, NOW);
    expect(h.state.seats[OP.blue]).toBeUndefined();
    expect(h.state.suggestions).toEqual({ [i!]: [OP.red] });
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'guess' });
    expect(codenames.playerLeft(h.state, 'nobody', NOW)).toBe(h.state);
  });

  it('forfeits the turn when the acting spymaster leaves before giving a clue', () => {
    const h = startedGame({ clueSeconds: 60, timerMode: 'soft' });
    h.state = codenames.playerLeft(h.state, SPY.red, NOW + 1_000);
    expect(h.state.turn).toEqual({
      team: 'blue',
      stage: 'clue',
      clue: null,
      guessesMade: 0,
      deadline: NOW + 61_000,
    });
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'forfeit' });
    expect(h.state.keyHolders).toMatchObject({ [SPY.red]: 'red' });
  });

  it('forfeits the turn when the last operative leaves during the guess stage', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    const [i] = cardsOf(h.state, 'red');
    h.act({ type: 'toggle-suggestion', card: i! }, OP.red);
    h.state = codenames.playerLeft(h.state, OP.red, NOW);
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.suggestions).toEqual({});
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'forfeit' });
  });

  it('keeps the turn when a team still has another operative', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'p5', name: 'P5' });
    h.act({ type: 'join-team', team: 'red', role: 'operative' }, 'p5');
    clue(h, 'red');
    h.state = codenames.playerLeft(h.state, OP.red, NOW);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'guess' });
  });

  it('skips a turn that begins with no spymaster, and waits if neither team can play', () => {
    const h = startedGame();
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'clue' });
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    // Blue's turn came and went straight back to red.
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'clue' });
    expect(h.state.log.slice(-2)).toEqual([
      { type: 'end-turn', team: 'red', reason: 'wrong-guess' },
      { type: 'end-turn', team: 'blue', reason: 'forfeit' },
    ]);
    // With both spymasters gone the turn stays put, until a seat is filled or the host steps in.
    h.state = codenames.playerLeft(h.state, SPY.red, NOW);
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.log.at(-1)).toEqual({ type: 'end-turn', team: 'red', reason: 'forfeit' });
    expect(h.reject({ type: 'give-clue', word: 'hint', count: 1 }, OP.blue)).toBe('not-your-turn');
  });
});

describe('after the game', () => {
  function finished() {
    const h = startedGame();
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    return h;
  }

  it('starts a rematch with the same seats and the other team going first', () => {
    const h = finished();
    const seats = h.state.seats;
    h.act({ type: 'start' });
    expect(h.state).toMatchObject({
      phase: 'playing',
      winner: null,
      log: [],
      gamesPlayed: 2,
      seats,
    });
    expect(h.state.turn?.team).toBe('blue');
    expect(h.state.board.filter((c) => c.kind === 'blue')).toHaveLength(9);
  });

  it('allows settings changes and returning to the lobby', () => {
    const h = finished();
    h.act({ type: 'update-settings', clueSeconds: 45 });
    expect(h.reject({ type: 'back-to-lobby' }, OP.red)).toBe('not-host');
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', board: [], turn: null, winner: null });
  });

  it('abandons a running game on back-to-lobby, log included, and unlocks the seats', () => {
    const h = startedGame();
    clue(h, 'red');
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    expect(h.state.log).toHaveLength(2);
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', log: [], keyHolders: {}, suggestions: {} });
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, SPY.red);
    expect(h.state.seats[SPY.red]).toMatchObject({ team: 'blue', role: 'operative' });
  });
});

describe('actionSchema', () => {
  it.each([
    { type: 'give-clue', word: '', count: 1 },
    { type: 'give-clue', word: 'x', count: 10 },
    { type: 'guess', card: 25 },
    { type: 'update-settings', clueSeconds: 5 },
    { type: 'update-settings', wordListIds: [] },
    { type: 'join-team', team: 'green', role: 'operative' },
    { type: 'explode' },
  ])('rejects %j', (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });

  it('accepts disabling timers and rejects 0 or unlimited clues', () => {
    expect(actionSchema.safeParse({ type: 'update-settings', clueSeconds: null }).success).toBe(
      true,
    );
    expect(actionSchema.safeParse({ type: 'give-clue', word: 'x', count: 0 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'give-clue', word: 'x', count: null }).success).toBe(
      false,
    );
  });
});

describe('round 2 rule fixes', () => {
  const words = (h: ReturnType<typeof startedGame>, kind: 'red' | 'blue' | 'bystander') =>
    cardsOf(h.state, kind).map((i) => h.state.board[i]!.word);

  it('lets the Operatives finish the turn when their Spymaster leaves after the clue', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.state = codenames.playerLeft(h.state, SPY.red, NOW);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'guess', guessesMade: 0 });
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    h.act({ type: 'end-turn' }, OP.red);
    clue(h, 'blue');
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.blue);
    // Red's next turn starts without a Spymaster, so it is forfeited.
    expect(h.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
    expect(h.state.log.at(-1)).toMatchObject({ type: 'end-turn', team: 'red', reason: 'forfeit' });
    // The Spymaster comes back and resumes their seat.
    h.state = codenames.playerJoined(h.state, { id: SPY.red, name: 'Back' });
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, SPY.red);
    clue(h, 'blue');
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.blue);
    expect(h.state.turn).toMatchObject({ team: 'red', stage: 'clue' });
  });

  it('forfeits when the Spymaster leaves before the clue, or the last Operative during guessing', () => {
    const before = startedGame();
    before.state = codenames.playerLeft(before.state, SPY.red, NOW);
    expect(before.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });

    const during = startedGame();
    clue(during, 'red', 2);
    during.state = codenames.playerLeft(during.state, OP.red, NOW);
    expect(during.state.turn).toMatchObject({ team: 'blue', stage: 'clue' });
  });

  it("doesn't let a team's only Operative take the empty Spymaster seat", () => {
    const h = startedGame();
    h.state = codenames.playerLeft(h.state, SPY.blue, NOW);
    expect(h.reject({ type: 'join-team', team: 'blue', role: 'spymaster' }, OP.blue)).toBe(
      'last-operative',
    );
    h.state = codenames.playerJoined(h.state, { id: 'p5', name: 'P5' });
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, 'p5');
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, OP.blue);
    expect(h.state.seats[OP.blue]).toMatchObject({ team: 'blue', role: 'spymaster' });
  });

  it('refuses punctuation-only clues and board words joined by a hyphen or apostrophe', () => {
    const h = startedGame();
    const [a, b] = words(h, 'red');
    const give = (word: string) => h.reject({ type: 'give-clue', word, count: 1 }, SPY.red);
    expect(give('-')).toBe('bad-clue');
    expect(give("'")).toBe('bad-clue');
    expect(give("-'-")).toBe('bad-clue');
    expect(give(`${a}-${b}`)).toBe('bad-clue');
    expect(give(`${a}'s`)).toBe('bad-clue');
    expect(give(`x-${a!.toUpperCase()}`)).toBe('bad-clue');
    h.act({ type: 'give-clue', word: 'sea-salt', count: 1 }, SPY.red);
  });

  it('refuses a guess that raced a turn-ending one as too late', () => {
    const h = startedGame();
    h.state = codenames.playerJoined(h.state, { id: 'p5', name: 'Ana' });
    h.act({ type: 'join-team', team: 'red', role: 'operative' }, 'p5');
    clue(h, 'red', 2);
    const seen = h.state.log.length;
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]!, seen }, 'p5');
    const late = codenames.reduce(
      h.state,
      { type: 'guess', card: cardsOf(h.state, 'red')[0]!, seen },
      { by: OP.red, isHost: false, now: NOW, rng: undefined as never, content: undefined as never },
    );
    expect(late).toMatchObject({
      code: 'too-late',
      message: 'Too late: Ana’s guess ended your turn.',
    });
  });

  it('keeps the names of players who left in the log', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    expect(h.state.log.slice(-2)).toMatchObject([
      { type: 'clue', name: 'HOST' },
      { type: 'guess', name: 'P2' },
    ]);
  });

  it('gives an odd extra player to the team that does not start', () => {
    const h = harness([HOST, 'a', 'b', 'c', 'd']);
    h.state = { ...h.state, startingTeam: 'red' };
    h.act({ type: 'randomize-teams' });
    const size = (t: Team) => Object.values(h.state.seats).filter((s) => s.team === t).length;
    expect([size('red'), size('blue')]).toEqual([2, 3]);
  });

  it("applies the normal end-turn rule to a host guessing on their own team's turn", () => {
    const h = harness();
    h.state = { ...h.state, startingTeam: 'red' };
    h.act({ type: 'join-team', team: 'red', role: 'operative' }, HOST);
    h.act({ type: 'join-team', team: 'red', role: 'spymaster' }, 'p2');
    h.act({ type: 'join-team', team: 'blue', role: 'spymaster' }, 'p3');
    h.act({ type: 'join-team', team: 'blue', role: 'operative' }, 'p4');
    h.act({ type: 'start' });
    h.act({ type: 'give-clue', word: 'hint', count: 1 }, 'p2');
    expect(h.reject({ type: 'end-turn' }, HOST)).toBe('must-guess');
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, HOST);
    h.act({ type: 'end-turn' }, HOST);
    // On the other team's turn the host can still skip a stuck turn.
    h.act({ type: 'end-turn' }, HOST);
    expect(h.state.log.at(-1)).toMatchObject({ type: 'end-turn', team: 'blue', reason: 'host' });
  });
});
