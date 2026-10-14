import { describe, expect, it } from 'vitest';
import { echo, guessMatches, playingIds, rating } from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  THREE,
  content,
  givers,
  harness,
  secret,
  startedGame,
  toGuess,
  turn,
  words,
} from './test-utils.ts';
import { CARD_SIZE, type EchoState, MAX_PLAYERS, actionSchema } from './types.ts';

const join = (h: { state: EchoState }, id: string) => {
  h.state = echo.playerJoined(h.state, { id, name: id.toUpperCase() });
};
const leave = (h: { state: EchoState }, id: string, now = NOW) => {
  h.state = echo.playerLeft(h.state, id, now);
};

describe('lobby', () => {
  it('seats up to seven players and lets the rest watch', () => {
    const ids = Array.from({ length: 9 }, (_, i) => (i === 0 ? HOST : `p${i + 1}`));
    const h = harness(ids);
    expect(playingIds(h.state)).toHaveLength(MAX_PLAYERS);
    expect(h.state.seats.p8!.playing).toBe(false);
    expect(h.reject({ type: 'sit', playing: true }, 'p8')).toBe('table-full');
    h.act({ type: 'sit', playing: false }, 'p2');
    h.act({ type: 'sit', playing: true }, 'p8');
    expect(h.state.seats.p8!.playing).toBe(true);
    join(h, 'late');
    expect(h.state.seats.late!.playing).toBe(false);
  });

  it('only lets the host change settings, and only between games', () => {
    const h = harness(FOUR);
    expect(h.reject({ type: 'update-settings', deckSize: 20 }, 'p2')).toBe('not-host');
    expect(h.reject({ type: 'update-settings', wordListIds: ['nope'] })).toBe('unknown-word-list');
    h.act({ type: 'update-settings', deckSize: 20, clueSeconds: 60, timerMode: 'strict' });
    expect(h.state.settings).toMatchObject({ deckSize: 20, clueSeconds: 60, timerMode: 'strict' });
    h.act({ type: 'start' });
    expect(h.reject({ type: 'update-settings', deckSize: 8 })).toBe('in-progress');
  });

  it('renames on rejoin without changing the seat', () => {
    const h = harness(FOUR);
    h.act({ type: 'sit', playing: false }, 'p2');
    h.state = echo.playerJoined(h.state, { id: 'p2', name: 'Renamed' });
    expect(h.state.seats.p2).toEqual({ name: 'Renamed', playing: false });
  });
});

describe('starting', () => {
  it('needs the host and three to seven players', () => {
    const h = harness([HOST, 'p2']);
    expect(h.reject({ type: 'start' }, 'p2')).toBe('not-host');
    expect(h.reject({ type: 'start' })).toBe('too-few-players');
    join(h, 'p3');
    h.act({ type: 'start' });
    expect(h.state.phase).toBe('playing');
    expect(h.reject({ type: 'start' })).toBe('in-progress');
  });

  it.each([8, 13, 20] as const)('deals a deck of %i cards of five distinct words', (size) => {
    const h = startedGame(FOUR, { deckSize: size });
    expect(h.state.cardsLeft).toBe(size);
    const cards = [turn(h).card, ...h.state.deck];
    expect(cards).toHaveLength(size);
    expect(cards.every((c) => c.length === CARD_SIZE)).toBe(true);
    expect(new Set(cards.flat()).size).toBe(size * CARD_SIZE);
    expect(turn(h)).toMatchObject({ guesser: HOST, stage: 'pick', pick: null });
  });

  it('refuses when the lists are too short for the deck', () => {
    const short = harness(FOUR, content([...words(38), 'BOAK', 'boak', '  ']));
    short.act({ type: 'update-settings', deckSize: 8 });
    expect(short.reject({ type: 'start' })).toBe('not-enough-words');
    const enough = harness(FOUR, content(words(40)));
    enough.act({ type: 'update-settings', deckSize: 8 });
    enough.act({ type: 'start' });
    expect(enough.reject({ type: 'back-to-lobby' }, 'p2')).toBe('not-host');
    enough.act({ type: 'back-to-lobby' });
    enough.act({ type: 'update-settings', deckSize: 13 });
    expect(enough.reject({ type: 'start' })).toBe('not-enough-words');
  });

  it('starts each new game with the next player as guesser', () => {
    const h = startedGame();
    expect(turn(h).guesser).toBe(HOST);
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', turn: null, deck: [], history: [] });
    h.act({ type: 'start' });
    expect(turn(h).guesser).toBe('p2');
  });
});

describe('a card', () => {
  it('runs pick → clues → guess → reveal', () => {
    const h = startedGame();
    expect(h.reject({ type: 'pick', index: 0 }, 'p2')).toBe('not-guesser');
    expect(h.reject({ type: 'give-clues', clues: ['x'] }, 'p2')).toBe('wrong-stage');
    h.act({ type: 'pick', index: 2 });
    expect(turn(h)).toMatchObject({
      stage: 'clues',
      pick: 2,
      givers: ['p2', 'p3', 'p4'],
      perGiver: 1,
    });
    expect(h.reject({ type: 'pick', index: 1 })).toBe('wrong-stage');
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['pear'] }, 'p3');
    // A giver may change their clues until the last one is in.
    h.act({ type: 'give-clues', clues: ['plum'] }, 'p3');
    expect(turn(h).stage).toBe('clues');
    h.act({ type: 'give-clues', clues: ['grape'] }, 'p4');
    expect(turn(h)).toMatchObject({ stage: 'guess', cancelled: {} });
    expect(turn(h).clues.p3).toEqual(['plum']);
    expect(h.reject({ type: 'give-clues', clues: ['late'] }, 'p2')).toBe('wrong-stage');
    expect(h.reject({ type: 'guess', word: 'x' }, 'p2')).toBe('not-guesser');
    expect(h.reject({ type: 'pass' }, 'p2')).toBe('not-guesser');
    h.act({ type: 'guess', word: secret(h) });
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'right' });
    expect(h.state).toMatchObject({ score: 1, cardsLeft: 7 });
    expect(h.state.history).toHaveLength(1);
    expect(h.state.history[0]).toMatchObject({
      word: secret(h),
      guesser: HOST,
      guesserName: 'HOST',
      outcome: 'right',
      clues: [
        { by: 'p2', name: 'P2', text: 'apple', cancelled: false },
        { by: 'p3', name: 'P3', text: 'plum', cancelled: false },
        { by: 'p4', name: 'P4', text: 'grape', cancelled: false },
      ],
    });
  });

  it('gives each of two clue writers two clues with three players', () => {
    const h = startedGame(THREE);
    h.act({ type: 'pick', index: 0 });
    expect(turn(h)).toMatchObject({ givers: ['p2', 'p3'], perGiver: 2 });
    expect(h.reject({ type: 'give-clues', clues: ['one'] }, 'p2')).toBe('clue-count');
    expect(h.reject({ type: 'give-clues', clues: ['Moon', 'moons'] }, 'p2')).toBe(
      'same-clue-twice',
    );
    h.act({ type: 'give-clues', clues: ['Moon', 'star'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['moons', 'STARS'] }, 'p3');
    // Both of one player's clues cancel against the other's.
    expect(Object.keys(turn(h).cancelled).sort()).toEqual(['p2:0', 'p2:1', 'p3:0', 'p3:1']);
  });

  it('asks four or more players for one clue each', () => {
    const h = startedGame(FOUR);
    h.act({ type: 'pick', index: 0 });
    expect(turn(h).perGiver).toBe(1);
    expect(h.reject({ type: 'give-clues', clues: ['one', 'two'] }, 'p2')).toBe('clue-count');
  });

  it('rejects clues that are not one word, are numbers, or give the word away', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    const word = secret(h);
    const code = (clue: string) => h.reject({ type: 'give-clues', clues: [clue] }, 'p2');
    expect(code('two words')).toBe('not-one-word');
    expect(code('hi!')).toBe('not-one-word');
    expect(code("'-'")).toBe('not-one-word');
    expect(code('42')).toBe('number-only');
    expect(code(word)).toBe('is-the-word');
    expect(code(word.toUpperCase())).toBe('is-the-word');
    expect(code(`${word}s`)).toBe('is-the-word');
    expect(code(`${word}ing`)).toBe('is-the-word');
    expect(code(`super${word}y`)).toBe('is-the-word');
    expect(h.reject({ type: 'give-clues', clues: ['fine'] }, HOST)).toBe('not-giver');
    expect(h.reject({ type: 'give-clues', clues: ['fine'] }, 'stranger')).toBe('not-giver');
    h.act({ type: 'give-clues', clues: ["dog's"] }, 'p2');
    h.act({ type: 'give-clues', clues: ['ice-cream'] }, 'p3');
  });

  it.each([
    ['case and plurals', ['Cat', 'cats', 'dog']],
    ['accents', ['Café', 'cafe', 'dog']],
    ['verb endings', ['running', 'run', 'dog']],
    ['spellings', ['colour', 'color', 'dog']],
    ['irregular plurals', ['mice', 'mouse', 'dog']],
    ['hyphens', ['ice-cream', 'icecream', 'dog']],
    ['possessives', ["Bird's", 'birds', 'dog']],
  ])('cancels matching clues across %s', (_label, clues) => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    givers(h).forEach((g, i) => h.act({ type: 'give-clues', clues: [clues[i]!] }, g));
    expect(turn(h).cancelled).toEqual({ 'p2:0': 'duplicate', 'p3:0': 'duplicate' });
  });

  it('accepts a right guess in any form of the word', () => {
    const h = startedGame();
    toGuess(h);
    h.act({ type: 'guess', word: `${secret(h).toUpperCase()}S` });
    expect(turn(h).outcome).toBe('right');
  });

  it('passes: the card is set aside without a point', () => {
    const h = startedGame();
    toGuess(h);
    h.act({ type: 'pass' }, turn(h).guesser);
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'pass' });
    expect(h.state).toMatchObject({ score: 0, cardsLeft: 7 });
    expect(h.state.deck).toHaveLength(7);
  });

  it('a wrong guess is decided at once: this card and the next are lost', () => {
    const h = startedGame();
    toGuess(h);
    h.act({ type: 'guess', word: 'nothing' });
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'wrong', guess: 'nothing' });
    expect(h.state).toMatchObject({ score: 0, cardsLeft: 6 });
    expect(h.state.deck).toHaveLength(6);
    expect(h.state.history.at(-1)!.burned).toBe(true);
  });

  it('close enough counts on its own, but a typo is a miss', () => {
    const h = startedGame();
    toGuess(h);
    const word = secret(h);
    // Capitals and spacing never matter; nobody is asked to judge.
    h.act({ type: 'guess', word: ` ${word.toUpperCase()} ` });
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'right' });
    expect(h.state.score).toBe(1);
    h.act({ type: 'next-card' });
    toGuess(h);
    // One letter swapped is another word as far as the game knows.
    const other = secret(h);
    h.act({ type: 'guess', word: other[1]! + other[0]! + other.slice(2) }, turn(h).guesser);
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'wrong' });
  });

  it('next card: anyone at the table deals, and it rotates the guesser', () => {
    const h = startedGame();
    expect(h.reject({ type: 'next-card' })).toBe('wrong-stage');
    toGuess(h);
    h.act({ type: 'pass' }, turn(h).guesser);
    expect(h.reject({ type: 'next-card' }, 'stranger')).toBe('not-at-table');
    const { cardsLeft } = h.state;
    h.act({ type: 'next-card', cardsLeft }, 'p3');
    expect(turn(h)).toMatchObject({ guesser: 'p2', stage: 'pick', pick: null, clues: {} });
    expect(h.state.deck).toHaveLength(6);
    // A second tap from someone else who saw the same reveal does nothing.
    h.act({ type: 'next-card', cardsLeft }, 'p2');
    expect(turn(h)).toMatchObject({ guesser: 'p2', stage: 'pick' });
    expect(h.state.deck).toHaveLength(6);
  });

  function playTo(cardsLeft: number) {
    const h = startedGame();
    while (h.state.cardsLeft > cardsLeft) {
      toGuess(h);
      h.act({ type: 'pass' }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    return h;
  }

  it('a wrong guess with two cards left ends the deck', () => {
    const h = playTo(2);
    toGuess(h);
    h.act({ type: 'guess', word: 'nope' }, turn(h).guesser);
    expect(h.state.cardsLeft).toBe(0);
    expect(h.state.deck).toHaveLength(0);
    expect(h.state.history.at(-1)!.burned).toBe(true);
    h.act({ type: 'next-card' });
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'finished', turn: null });
  });

  it('a wrong guess on the last card with nothing won clamps at zero', () => {
    const h = playTo(1);
    expect(h.state.deck).toHaveLength(0);
    toGuess(h);
    h.act({ type: 'guess', word: 'nope' }, turn(h).guesser);
    expect(h.state).toMatchObject({ cardsLeft: 0, score: 0 });
    // There was no next card to lose, and no won card to give back.
    expect(h.state.history.at(-1)!.burned).toBeUndefined();
    expect(h.state.history.at(-1)!.forfeit).toBeUndefined();
    h.act({ type: 'next-card' });
    expect(h.state.phase).toBe('over');
    expect(h.state.history).toHaveLength(8);
  });

  it('a wrong guess on the last card gives back a card already won', () => {
    const h = startedGame();
    while (h.state.cardsLeft > 1) {
      toGuess(h);
      h.act({ type: 'guess', word: secret(h) }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    expect(h.state.score).toBe(7);
    toGuess(h);
    h.act({ type: 'guess', word: 'nope' }, turn(h).guesser);
    expect(h.state).toMatchObject({ cardsLeft: 0, score: 6 });
    expect(h.state.history.at(-1)).toMatchObject({ outcome: 'wrong', forfeit: true });
    expect(h.state.history.at(-1)!.burned).toBeUndefined();
    h.act({ type: 'next-card' });
    expect(h.state).toMatchObject({ phase: 'over', score: 6 });
  });

  it('plays a whole game, then a rematch', () => {
    const h = startedGame();
    const seen: string[] = [];
    while (h.state.phase === 'playing') {
      seen.push(turn(h).guesser);
      toGuess(h);
      h.act({ type: 'guess', word: secret(h) }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    expect(seen).toEqual([HOST, 'p2', 'p3', 'p4', HOST, 'p2', 'p3', 'p4']);
    expect(h.state).toMatchObject({ phase: 'over', score: 8, cardsLeft: 0 });
    expect(JSON.parse(JSON.stringify(h.state))).toEqual(h.state);
    h.act({ type: 'start' });
    expect(h.state).toMatchObject({ phase: 'playing', score: 0, cardsLeft: 8, history: [] });
  });
});

describe('players leaving', () => {
  it('guesser leaves before picking: the card goes to the next player untouched', () => {
    const h = startedGame();
    const card = turn(h).card;
    leave(h, HOST);
    expect(turn(h)).toMatchObject({ guesser: 'p2', stage: 'pick', card });
    expect(h.state.cardsLeft).toBe(8);
  });

  it.each(['clues', 'guess'] as const)(
    'guesser leaves during %s: the card returns without the picked word',
    (stage) => {
      const h = startedGame();
      h.act({ type: 'pick', index: 1 });
      const card = turn(h).card;
      const picked = secret(h);
      if (stage !== 'clues') toGuess2(h);
      expect(turn(h).stage).toBe(stage);
      leave(h, HOST);
      expect(turn(h)).toMatchObject({ guesser: 'p2', stage: 'pick', pick: null, clues: {} });
      expect(turn(h).card).toEqual(card.filter((w) => w !== picked));
      expect(h.state.cardsLeft).toBe(8);
      expect(h.reject({ type: 'pick', index: 4 }, 'p2')).toBe('bad-pick');
      h.act({ type: 'pick', index: 3 }, 'p2');
    },
  );

  it('a card with every word struck is set aside', () => {
    const h = startedGame();
    for (let i = 0; i < CARD_SIZE; i++) {
      expect(turn(h).card).toHaveLength(CARD_SIZE - i);
      const guesser = turn(h).guesser;
      h.act({ type: 'pick', index: 0 }, guesser);
      join(h, `new${i}`);
      leave(h, guesser);
    }
    expect(h.state.cardsLeft).toBe(7);
    expect(h.state.deck).toHaveLength(6);
    expect(turn(h).card).toHaveLength(CARD_SIZE);
  });

  it('guesser leaves at the reveal: the next seat still guesses next', () => {
    const h = startedGame();
    toGuess(h);
    h.act({ type: 'pass' }, turn(h).guesser);
    h.act({ type: 'next-card' });
    toGuess(h);
    h.act({ type: 'pass' }, 'p2');
    leave(h, 'p2');
    expect(turn(h).stage).toBe('reveal');
    h.act({ type: 'next-card' });
    expect(turn(h).guesser).toBe('p3');
  });

  it('a giver who leaves while clues are written is dropped, and the rest carry on', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['pear'] }, 'p3');
    leave(h, 'p2');
    expect(turn(h).stage).toBe('clues');
    leave(h, 'p4');
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few' });
  });

  it('the last missing giver leaving starts the guessing', () => {
    const h = startedGame([HOST, 'p2', 'p3', 'p4', 'p5']);
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['apples'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['pear'] }, 'p4');
    leave(h, 'p2');
    expect(turn(h).clues.p2).toBeUndefined();
    leave(h, 'p5');
    expect(turn(h)).toMatchObject({ stage: 'guess', givers: ['p3', 'p4'], cancelled: {} });
  });

  it('a giver who leaves after the clues keeps their clue but loses their say', () => {
    const h = startedGame([HOST, 'p2', 'p3', 'p4', 'p5']);
    toGuess(h);
    leave(h, 'p2');
    expect(turn(h).clues.p2).toBeDefined();
    expect(turn(h).givers).toEqual(['p3', 'p4', 'p5']);
    h.act({ type: 'guess', word: 'nope' });
    expect(turn(h).outcome).toBe('wrong');
  });

  it.each(['pick', 'clues', 'guess', 'reveal'] as const)(
    'drops below three players during %s: the game ends',
    (stage) => {
      const h = startedGame(THREE);
      if (stage !== 'pick') h.act({ type: 'pick', index: 0 });
      if (stage === 'guess' || stage === 'reveal') {
        h.act({ type: 'give-clues', clues: ['alpha', 'beta'] }, 'p2');
        h.act({ type: 'give-clues', clues: ['gamma', 'delta'] }, 'p3');
      }
      if (stage === 'reveal') h.act({ type: 'guess', word: 'nope' });
      expect(turn(h).stage).toBe(stage);
      leave(h, 'p3');
      expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few', turn: null });
    },
  );

  it('a spectator leaving changes nothing', () => {
    const h = startedGame();
    join(h, 'watcher');
    h.act({ type: 'sit', playing: false }, 'watcher');
    const before = h.state.turn;
    leave(h, 'watcher');
    expect(h.state.turn).toBe(before);
    leave(h, 'nobody');
  });

  it('standing up mid-game is like leaving the card', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['pear'] }, 'p3');
    h.act({ type: 'sit', playing: false }, 'p4');
    expect(turn(h)).toMatchObject({ stage: 'guess', givers: ['p2', 'p3'] });
    expect(h.state.seats.p4!.playing).toBe(false);
  });

  it('when every giver has gone, the players now at the table write the clues', () => {
    const h = startedGame(THREE);
    h.act({ type: 'pick', index: 0 });
    join(h, 'n1');
    join(h, 'n2');
    leave(h, 'p2');
    leave(h, 'p3');
    expect(turn(h)).toMatchObject({ stage: 'clues', givers: ['n1', 'n2'], perGiver: 2 });
  });
});

/** Gets the current (already picked) card to the guess stage. */
function toGuess2(h: ReturnType<typeof startedGame>) {
  givers(h).forEach((g, i) => h.act({ type: 'give-clues', clues: [`clue${'x'.repeat(i)}`] }, g));
}

describe('late joiners', () => {
  it('wait out the current card, then join the rotation', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    join(h, 'late');
    expect(h.state.seats.late!.playing).toBe(true);
    expect(echo.view(h.state, 'late').role).toBe('waiting');
    expect(h.reject({ type: 'give-clues', clues: ['hello'] }, 'late')).toBe('not-giver');
    toGuess2(h);
    expect(turn(h).givers).not.toContain('late');
    h.act({ type: 'pass' }, turn(h).guesser);
    h.act({ type: 'next-card' });
    h.act({ type: 'pick', index: 0 }, 'p2');
    expect(turn(h).givers).toContain('late');
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      toGuess2(h);
      h.act({ type: 'pass' }, turn(h).guesser);
      h.act({ type: 'next-card' });
      order.push(turn(h).guesser);
      h.act({ type: 'pick', index: 0 }, turn(h).guesser);
    }
    expect(order).toEqual(['p3', 'p4', 'late', HOST]);
  });

  it('joining while the guesser picks still makes you a clue writer', () => {
    const h = startedGame();
    join(h, 'late');
    h.act({ type: 'pick', index: 0 });
    expect(turn(h).givers).toContain('late');
  });

  it('a full table makes newcomers watch', () => {
    const ids = [HOST, 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const h = startedGame(ids);
    join(h, 'p8');
    expect(h.state.seats.p8!.playing).toBe(false);
    expect(h.reject({ type: 'sit', playing: true }, 'p8')).toBe('table-full');
    expect(h.reject({ type: 'sit', playing: true }, 'ghost')).toBe('not-seated');
  });
});

describe('timers', () => {
  const strict = () =>
    startedGame(FOUR, { clueSeconds: 30, guessSeconds: 20, timerMode: 'strict' });
  const fire = (h: ReturnType<typeof startedGame>) => {
    const due = echo.nextDeadline!(h.state)!;
    expect(due).not.toBeNull();
    expect(echo.onDeadline!(h.state, due - 1)).toBe(h.state);
    h.state = echo.onDeadline!(h.state, due);
    const next = echo.nextDeadline!(h.state);
    if (next !== null) expect(next).toBeGreaterThan(due);
    return due;
  };

  it('times each stage from when it starts', () => {
    const h = strict();
    expect(turn(h).deadline).toBe(NOW + 20_000);
    h.act({ type: 'pick', index: 0 }, HOST, NOW + 5_000);
    expect(turn(h).deadline).toBe(NOW + 35_000);
  });

  it('picks a word for a guesser who runs out of time', () => {
    const h = strict();
    const seed = h.state.seed;
    expect(echo.view(h.state, HOST).turn!.autoPicked).toBe(false);
    fire(h);
    expect(turn(h).stage).toBe('clues');
    expect(echo.view(h.state, HOST).turn!.autoPicked).toBe(true);
    expect(turn(h).pick).toBeGreaterThanOrEqual(0);
    expect(turn(h).pick).toBeLessThan(CARD_SIZE);
    // The seed moves on, so the next timed-out pick isn't predictable from this one.
    expect(h.state.seed).not.toBe(seed);
  });

  it('moves on with whatever clues are in', () => {
    const h = strict();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['apples'] }, 'p3');
    fire(h);
    expect(turn(h).stage).toBe('guess');
    expect(turn(h).clues.p4).toBeUndefined();
    expect(Object.keys(turn(h).cancelled)).toHaveLength(2);
    // The writer who ran out of time is remembered, for them and for the reveal.
    expect(echo.view(h.state, 'p4').turn!.missed).toEqual(['p4']);
    h.act({ type: 'pass' });
    expect(h.state.history.at(-1)!.missed).toEqual(['P4']);
    expect(h.state.history.at(-1)!.timedOut).toBeUndefined();
  });

  it('sends nobody as missed when every clue is in', () => {
    const h = strict();
    toGuess(h);
    expect(echo.view(h.state, 'p2').turn!.missed).toEqual([]);
    expect(turn(h).missed).toBeUndefined();
  });

  it('passes for a guesser who runs out of time', () => {
    const h = strict();
    toGuess(h);
    fire(h);
    expect(turn(h)).toMatchObject({ stage: 'reveal', outcome: 'pass' });
    expect(echo.view(h.state, 'p2').turn!.timedOut).toBe(true);
    expect(h.state.history.at(-1)!.timedOut).toBe(true);
    expect(echo.nextDeadline!(h.state)).toBeNull();
  });

  it('a pass by hand is not marked as timed out', () => {
    const h = strict();
    toGuess(h);
    h.act({ type: 'pass' });
    expect(echo.view(h.state, 'p2').turn!.timedOut).toBe(false);
  });

  it('runs a whole game on the timer alone', () => {
    const h = strict();
    let fired = 0;
    while (h.state.phase === 'playing') {
      if (echo.nextDeadline!(h.state) === null) h.act({ type: 'next-card' });
      else {
        fire(h);
        fired++;
      }
      expect(fired).toBeLessThan(100);
    }
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'finished', score: 0 });
  });

  it('soft timers and untimed stages never fire', () => {
    const soft = startedGame(FOUR, { clueSeconds: 30, guessSeconds: 20, timerMode: 'soft' });
    expect(turn(soft).deadline).toBe(NOW + 20_000);
    for (const step of [
      () => soft.act({ type: 'pick', index: 0 }),
      () => toGuess2(soft),
      () => soft.act({ type: 'guess', word: 'nope' }),
    ]) {
      expect(echo.nextDeadline!(soft.state)).toBeNull();
      expect(echo.onDeadline!(soft.state, NOW + 10_000_000)).toBe(soft.state);
      step();
    }
    const untimed = startedGame(FOUR, { timerMode: 'strict' });
    expect(echo.nextDeadline!(untimed.state)).toBeNull();
    expect(echo.nextDeadline!(harness(FOUR).state)).toBeNull();
  });
});

describe('view', () => {
  const json = (h: ReturnType<typeof startedGame>, viewer: string | null) =>
    JSON.stringify(echo.view(h.state, viewer));

  /** Nothing hidden: no card words, no deck words, no seed. */
  function expectNoSecrets(h: ReturnType<typeof startedGame>, viewer: string | null, allowed = '') {
    const text = json(h, viewer);
    const hidden = [...turn(h).card, ...h.state.deck.flat()].filter((w) => w !== allowed);
    for (const word of hidden) expect(text, `${viewer} sees ${word}`).not.toContain(word);
    expect(text).not.toContain('"seed"');
    expect(text).not.toContain(String(h.state.seed));
    expect(text).not.toContain('"deck"');
    expect(text).not.toContain('"card"');
  }

  it('hides the card from everyone while the guesser picks', () => {
    const h = startedGame();
    for (const viewer of [HOST, 'p2', null]) expectNoSecrets(h, viewer);
    expect(echo.view(h.state, HOST).turn).toMatchObject({ cardSize: 5, word: null });
  });

  it('never shows the guesser the word before the reveal', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    expectNoSecrets(h, HOST);
    h.act({ type: 'give-clues', clues: ['zebra'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['Zebras'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p4');
    expectNoSecrets(h, HOST);
    const guessing = echo.view(h.state, HOST);
    expect(guessing.role).toBe('guesser');
    // Only the surviving clue, without its author.
    expect(guessing.turn!.clues).toEqual([
      { by: null, name: null, text: 'apple', cancelled: false, sameAs: [] },
    ]);
    expect(guessing.turn!.cancelledCount).toBe(2);
    expect(json(h, HOST)).not.toContain('ebra');
    h.act({ type: 'guess', word: 'nope' });
    const revealed = echo.view(h.state, HOST);
    expect(revealed.turn!.word).toBe(secret(h));
    expect(revealed.turn!.clues.map((c) => [c.by, c.text, c.cancelled, c.sameAs])).toEqual([
      ['p2', 'zebra', true, ['p3']],
      ['p3', 'Zebras', true, ['p2']],
      ['p4', 'apple', false, []],
    ]);
  });

  it('sorts the surviving clues so their order gives no authors away', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['zulu'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['alpha'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['mike'] }, 'p4');
    expect(echo.view(h.state, HOST).turn!.clues.map((c) => c.text)).toEqual([
      'alpha',
      'mike',
      'zulu',
    ]);
  });

  it('shows clue writers the word and only their own clues until all are in', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['zebra'] }, 'p2');
    const giver = echo.view(h.state, 'p3');
    expect(giver.role).toBe('giver');
    expect(giver.turn).toMatchObject({
      word: secret(h),
      myClues: null,
      clues: [],
      submitted: ['p2'],
    });
    expect(json(h, 'p3')).not.toContain('zebra');
    expect(echo.view(h.state, 'p2').turn!.myClues).toEqual(['zebra']);
    expectNoSecrets(h, 'p3', secret(h));
    h.act({ type: 'give-clues', clues: ['Zebras'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p4');
    const guessing = echo.view(h.state, 'p3').turn!;
    expect(guessing.clues.map((c) => [c.by, c.cancelled])).toEqual([
      ['p2', true],
      ['p3', true],
      ['p4', false],
    ]);
  });

  it('shows spectators and observers what clue writers see, no more', () => {
    const h = startedGame();
    join(h, 'watcher');
    h.act({ type: 'sit', playing: false }, 'watcher');
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['zebra'] }, 'p2');
    for (const viewer of ['watcher', null]) {
      const v = echo.view(h.state, viewer);
      expect(v.role).toBe('spectator');
      expect(v.turn).toMatchObject({ word: secret(h), clues: [], myClues: null });
      expect(json(h, viewer)).not.toContain('zebra');
      expectNoSecrets(h, viewer, secret(h));
    }
    expect(echo.view(h.state, null).me).toBeNull();
  });

  it('shows the history and no turn once the game is over', () => {
    const h = startedGame();
    while (h.state.phase === 'playing') {
      toGuess(h);
      h.act({ type: 'pass' }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    const over = echo.view(h.state, 'p2');
    expect(over.turn).toBeNull();
    expect(over.history).toHaveLength(8);
    expect(over.endReason).toBe('finished');
  });
});

describe('actions and ratings', () => {
  it('validates action shapes', () => {
    const ok = (a: unknown) => actionSchema.safeParse(a).success;
    expect(ok({ type: 'give-clues', clues: ['  moon '] })).toBe(true);
    expect(ok({ type: 'give-clues', clues: ['a\nb'] })).toBe(false);
    expect(ok({ type: 'give-clues', clues: ['x'.repeat(33)] })).toBe(false);
    expect(ok({ type: 'give-clues', clues: [] })).toBe(false);
    expect(ok({ type: 'give-clues', clues: ['a', 'b', 'c'] })).toBe(false);
    expect(ok({ type: 'guess', word: '   ' })).toBe(false);
    expect(ok({ type: 'pick', index: 5 })).toBe(false);
    expect(ok({ type: 'update-settings', deckSize: 10 })).toBe(false);
    expect(ok({ type: 'update-settings', deckSize: 13, guessSeconds: 5 })).toBe(false);
  });

  it('rates a 13-card game as the guide says', () => {
    const bands = Array.from({ length: 14 }, (_, s) => rating(s, 13));
    expect(bands.slice(0, 4).every((r) => r === 'Try again')).toBe(true);
    expect(bands.slice(4, 7).every((r) => r === 'A good start')).toBe(true);
    expect(bands.slice(7, 10).every((r) => r === 'Good')).toBe(true);
    expect(bands.slice(10, 12).every((r) => r === 'Great')).toBe(true);
    expect(bands[12]).toBe('Amazing');
    expect(bands[13]).toBe('Perfect');
    expect(rating(8, 8)).toBe('Perfect');
    expect(rating(0, 20)).toBe('Try again');
  });
});

describe('guessMatches', () => {
  it.each([
    ['Elephant', 'elephant', true],
    ['elephnat', 'elephant', false],
    ['elepant', 'elephant', false],
    ['house', 'HORSE', false],
    ['night', 'LIGHT', false],
    ['watch', 'MATCH', false],
    ['plant', 'PLANE', false],
    ['beach', 'BENCH', false],
    ['spiderman', 'Spider-Man', true],
    ['ice cream', 'Ice-cream', true],
    ['cats', 'cat', true],
    ['mice', 'MOUSE', true],
    ['color', 'COLOUR', true],
    ['MONSTERSINC', 'Monsters Inc', true],
    ['numb', 'NUMBER', false],
    ['corn', 'CORNER', false],
    ['monsters', 'Monsters Inc', false],
    ['hat', 'hate', false],
    ['cot', 'cat', false],
    ['dog', 'elephant', false],
    ['elephantine', 'elephant', false],
  ])('%s for %s: %s', (guess, answer, right) => {
    expect(guessMatches(guess, answer)).toBe(right);
  });
});

describe('word matching in play', () => {
  /** A started game whose guesser has picked `word`. */
  function onCard(word: string) {
    const h = startedGame();
    h.state = { ...h.state, turn: { ...turn(h), card: [word, ...turn(h).card.slice(1)] } };
    h.act({ type: 'pick', index: 0 });
    return h;
  }
  /** The refusal code for `text` as a clue for `word`, or null if it is accepted. */
  const refused = (word: string, text: string) => {
    const h = onCard(word);
    try {
      return h.reject({ type: 'give-clues', clues: [text] }, 'p2');
    } catch {
      return null;
    }
  };
  const guessed = (word: string, guess: string) => {
    const h = onCard(word);
    givers(h).forEach((g, i) => h.act({ type: 'give-clues', clues: [`clue${'x'.repeat(i)}`] }, g));
    h.act({ type: 'guess', word: guess });
    return turn(h).stage === 'reveal' ? turn(h).outcome : turn(h).stage;
  };

  it('scores only a strict match as right, and anything else as wrong', () => {
    expect(guessed('NUMBER', 'numb')).toBe('wrong');
    expect(guessed('CORNER', 'corn')).toBe('wrong');
    expect(guessed('BOXER', 'box')).toBe('wrong');
    expect(guessed('Spider-Man', 'spiderman')).toBe('right');
    expect(guessed('MONSTERS INC', 'MONSTERSINC')).toBe('right');
    expect(guessed('MONSTERS INC', 'monsters')).toBe('wrong');
    expect(guessed('MOUSE', 'mice')).toBe('right');
    expect(guessed('COLOUR', 'color')).toBe('right');
  });

  it('allows words that only hide the word inside them', () => {
    expect(refused('CAT', 'scatter')).toBeNull();
    expect(refused('ICE', 'police')).toBeNull();
    expect(refused('ONE', 'phone')).toBeNull();
    expect(refused('ART', 'party')).toBeNull();
  });

  it('refuses forms of the word both ways, and parts of a multi-word answer', () => {
    expect(refused('SUN', 'sunflower')).toBe('is-the-word');
    expect(refused('SUNFLOWER', 'sun')).toBe('is-the-word');
    expect(refused('MOUSE', 'mice')).toBe('is-the-word');
    expect(refused('COLOUR', 'color')).toBe('is-the-word');
    for (const text of ['Monsters', 'Inc', 'MonstersInc', 'Monsters-Inc']) {
      expect(refused('MONSTERS INC', text), text).toBe('is-the-word');
    }
  });

  it('does not cancel words that merely start alike', () => {
    const h = onCard('COLOUR');
    const [a, b, c] = givers(h);
    h.act({ type: 'give-clues', clues: ['corn'] }, a);
    h.act({ type: 'give-clues', clues: ['corner'] }, b);
    h.act({ type: 'give-clues', clues: ['numb'] }, c);
    expect(turn(h).cancelled).toEqual({});
  });

  it('tells the guesser when no clues arrived rather than that all were cancelled', () => {
    const h = startedGame(FOUR, { clueSeconds: 30, timerMode: 'strict' });
    h.act({ type: 'pick', index: 0 });
    h.state = echo.onDeadline!(h.state, echo.nextDeadline!(h.state)!);
    const v = echo.view(h.state, HOST).turn!;
    expect(v).toMatchObject({ stage: 'guess', clues: [], cancelledCount: 0 });
  });

  it('tells everyone how many words the answer has', () => {
    const h = onCard('MONSTERS INC');
    expect(echo.view(h.state, HOST).turn!.wordCount).toBe(2);
  });
});

describe('skipping late clue writers', () => {
  it('lets the host go on without writers who have not sent a clue', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    const [a, b, c] = givers(h);
    h.act({ type: 'give-clues', clues: ['alpha'] }, a);
    expect(h.reject({ type: 'skip-late-clues' }, b)).toBe('not-host');
    h.act({ type: 'skip-late-clues' });
    expect(turn(h)).toMatchObject({ stage: 'guess', missed: [b, c], skipped: true });
    expect(echo.view(h.state, HOST).turn!.clues.map((x) => x.text)).toEqual(['alpha']);
    expect(h.reject({ type: 'skip-late-clues' })).toBe('wrong-stage');
  });
});
