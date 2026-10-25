import { afterEach, describe, expect, it } from 'vitest';
import { iconic, startProblem } from './game.ts';
import {
  HOST,
  NOW,
  chooseWord,
  giver,
  guessRight,
  guessersOf,
  harness,
  round,
  started,
} from './test-utils.ts';
import { CHOOSE_MS, REVEAL_MS, UNDO_MS, WORDS_TO_END } from './types.ts';
import { setTestWord } from './words.ts';

afterEach(() => setTestWord(null));

describe('lobby', () => {
  it('starts with the level lists picked by name and the printed defaults', () => {
    const h = harness(4);
    expect(h.state.settings).toMatchObject({
      givers: 'auto',
      length: 'twelve',
      scoring: true,
      bonus: false,
      roundMinutes: 5,
      timerMode: 'soft',
      lists: { easy: ['e'], hard: ['h'], challenging: ['c'] },
    });
  });

  it('needs 3 players and three words per level', () => {
    expect(harness(2).refuse(HOST, { type: 'start' })).toBe('cannot-start');
    const h = harness(3);
    expect(startProblem(h.state, { easy: 3, hard: 2, challenging: 9 })).toMatch(/hard/);
    expect(startProblem(h.state, { easy: 3, hard: 3, challenging: 3 })).toBeNull();
    // An empty choice falls back to the level's default list.
    h.act(HOST, { type: 'update-settings', lists: { level: 'hard', ids: [] } });
    h.act(HOST, { type: 'start' });
    expect(h.state.settings.lists.hard).toEqual(['h']);
    expect(h.state.phase).toBe('playing');
  });

  it('only the host changes settings, and only lists on offer', () => {
    const h = harness(4);
    expect(h.refuse('p2', { type: 'update-settings', scoring: false })).toBe('not-host');
    expect(
      h.refuse(HOST, { type: 'update-settings', lists: { level: 'easy', ids: ['nope'] } }),
    ).toBe('unknown-list');
  });

  it('deals a card of nine: three words of each level', () => {
    const h = started(4);
    const card = round(h).card;
    expect(card.map((w) => w.level)).toEqual([
      'easy',
      'easy',
      'easy',
      'hard',
      'hard',
      'hard',
      'challenging',
      'challenging',
      'challenging',
    ]);
    expect(card.filter((w) => w.level === 'easy').every((w) => w.word.startsWith('easy'))).toBe(
      true,
    );
  });

  it('one clue giver under 5 players, two from 5, or as the host says', () => {
    expect(started(4).state.game!.round.givers).toHaveLength(1);
    expect(started(5).state.game!.round.givers).toHaveLength(2);
    expect(started(4, { settings: { givers: 2 } }).state.game!.round.givers).toHaveLength(2);
    expect(started(6, { settings: { givers: 1 } }).state.game!.round.givers).toHaveLength(1);
  });

  it('the test word goes first on every card', () => {
    setTestWord('lighthouse');
    expect(started(3).state.game!.round.card[0]!.word).toBe('lighthouse');
  });
});

describe('choosing a word', () => {
  it('a single clue giver picks straight away', () => {
    const h = started(4, { first: 'p2' });
    expect(h.refuse('p3', { type: 'pick', index: 2 })).toBe('not-giver');
    h.act('p2', { type: 'pick', index: 4 });
    expect(round(h).stage).toBe('clue');
    expect(round(h).answer).toEqual(round(h).card[4]);
  });

  it('a pair: proposal, then agree', () => {
    const h = started(5, { first: 'p1' });
    h.act('p1', { type: 'pick', index: 3 });
    expect(round(h).stage).toBe('choose');
    expect(h.refuse('p1', { type: 'agree' })).toBe('not-partner');
    expect(h.refuse('p2', { type: 'pick', index: 1 })).toBe('proposed');
    h.act('p2', { type: 'agree' });
    expect(round(h).answer).toEqual(round(h).card[3]);
  });

  it('a veto passes the pick over; a second veto keeps the last pick', () => {
    const h = started(5, { first: 'p1' });
    h.act('p1', { type: 'pick', index: 0 });
    h.act('p2', { type: 'veto' });
    expect(round(h).stage).toBe('choose');
    expect(h.refuse('p1', { type: 'pick', index: 1 })).toBe('not-picker');
    h.act('p2', { type: 'pick', index: 7 });
    h.act('p1', { type: 'veto' });
    expect(round(h).stage).toBe('clue');
    expect(round(h).answer).toEqual(round(h).card[7]);
  });

  it('one reroll per turn, before a proposal', () => {
    const h = started(5, { first: 'p1' });
    const before = round(h).card;
    h.act('p2', { type: 'reroll' });
    expect(round(h).card).not.toEqual(before);
    expect(h.refuse('p1', { type: 'reroll' })).toBe('rerolled');
    const h2 = started(5, { first: 'p1' });
    h2.act('p1', { type: 'pick', index: 0 });
    expect(h2.refuse('p2', { type: 'reroll' })).toBe('proposed');
  });

  it('a 45-second reminder; the host can choose for a quiet clue giver', () => {
    const h = started(4);
    expect(iconic.nextDeadline!(h.state)).toBe(NOW + CHOOSE_MS);
    h.tick();
    expect(round(h).reminded).toBe(true);
    expect(round(h).stage).toBe('choose');
    expect(h.refuse('p3', { type: 'act-for' })).toBe('not-host');
    h.act(HOST, { type: 'act-for' });
    expect(round(h).stage).toBe('clue');
    expect(round(h).auto).toBe(true);
  });
});

describe('placing pieces', () => {
  const clue = () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    return h;
  };

  it('main first; the first tap of a set is its marker, then cubes', () => {
    const h = clue();
    expect(h.refuse('p1', { type: 'place', set: 'sub1', icon: 5 })).toBe('main-first');
    expect(h.refuse('p2', { type: 'place', set: 'main', icon: 5 })).toBe('not-giver');
    h.act('p1', { type: 'place', set: 'main', icon: 5 });
    h.act('p1', { type: 'place', set: 'main', icon: 9 });
    h.act('p1', { type: 'place', set: 'sub1', icon: 20 });
    expect(round(h).board.main).toEqual({ marker: 5, cubes: [{ icon: 9, n: 1 }] });
    expect(round(h).board.sub1).toEqual({ marker: 20, cubes: [] });
  });

  it('stacks, keeps the order and takes pieces back one at a time', () => {
    const h = clue();
    for (const icon of [5, 9, 12, 9, 9]) h.act('p1', { type: 'place', set: 'main', icon });
    expect(round(h).board.main.cubes).toEqual([
      { icon: 9, n: 3 },
      { icon: 12, n: 1 },
    ]);
    h.act('p1', { type: 'remove', set: 'main', icon: 9 });
    expect(round(h).board.main.cubes[0]).toEqual({ icon: 9, n: 2 });
    h.act('p1', { type: 'remove', set: 'main', icon: 12 });
    h.act('p1', { type: 'place', set: 'main', icon: 12 });
    expect(round(h).board.main.cubes.map((c) => c.icon)).toEqual([9, 12]);
    h.act('p1', { type: 'remove', set: 'main', icon: 5 });
    expect(round(h).board.main.marker).toBeNull();
    expect(h.refuse('p1', { type: 'remove', set: 'sub2', icon: 5 })).toBe('nothing-there');
  });

  it('caps cubes at 10 green and 8 of each other colour', () => {
    const h = clue();
    h.act('p1', { type: 'place', set: 'main', icon: 1 });
    for (let i = 0; i < 10; i++) h.act('p1', { type: 'place', set: 'main', icon: 2 + i });
    expect(h.refuse('p1', { type: 'place', set: 'main', icon: 40 })).toBe('no-cubes');
    h.act('p1', { type: 'place', set: 'sub4', icon: 50 });
    for (let i = 0; i < 8; i++) h.act('p1', { type: 'place', set: 'sub4', icon: 50 });
    expect(round(h).board.sub4.cubes).toEqual([{ icon: 50, n: 8 }]);
    expect(h.refuse('p1', { type: 'place', set: 'sub4', icon: 51 })).toBe('no-cubes');
  });

  it('wipes the board in one go', () => {
    const h = clue();
    h.act('p1', { type: 'place', set: 'main', icon: 1 });
    h.act('p1', { type: 'place', set: 'sub2', icon: 7 });
    h.act('p1', { type: 'wipe' });
    expect(round(h).board.main.marker).toBeNull();
    expect(round(h).board.sub2.marker).toBeNull();
  });
});

describe('guessing and judging', () => {
  it('guesses join the list in order; repeats and clue givers are refused', () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    h.act('p2', { type: 'guess', text: '  a  tower ' });
    h.act('p3', { type: 'guess', text: 'bridge' });
    expect(round(h).guesses.map((g) => [g.by, g.text])).toEqual([
      ['p2', 'a tower'],
      ['p3', 'bridge'],
    ]);
    expect(h.refuse('p2', { type: 'guess', text: 'Towers' })).toBe('repeat');
    expect(h.refuse('p1', { type: 'guess', text: 'x' })).toBe('not-guesser');
    expect(h.refuse('p2', { type: 'guess', text: '  ' })).toBe('empty');
  });

  it('marks wrong and close, and flags a matching guess only for the clue givers', () => {
    const h = started(4, { first: 'p1' });
    const word = chooseWord(h);
    h.act('p2', { type: 'guess', text: 'nope' });
    h.act('p3', { type: 'guess', text: `The ${word.toUpperCase()}` });
    const [a, b] = round(h).guesses;
    h.act('p1', { type: 'mark', guess: a!.id, mark: 'close' });
    expect(round(h).guesses[0]!.mark).toBe('close');
    h.act('p1', { type: 'mark', guess: a!.id, mark: null });
    expect(h.refuse('p2', { type: 'mark', guess: a!.id, mark: 'wrong' })).toBe('not-giver');
    expect(iconic.view(h.state, 'p1').game!.round.secret!.looksRight).toEqual([b!.id]);
    expect(iconic.view(h.state, 'p2').game!.round.secret).toBeNull();
    // Never awarded by itself.
    expect(round(h).stage).toBe('clue');
  });

  it('a right mark can be undone for 5 seconds, then scores', () => {
    const h = started(4, { first: 'p1' });
    const word = chooseWord(h);
    h.act('p2', { type: 'guess', text: word });
    const id = round(h).guesses[0]!.id;
    h.act('p1', { type: 'award', guess: id });
    expect(round(h).stage).toBe('clue');
    h.act('p1', { type: 'undo' });
    expect(round(h).award).toBeNull();
    h.act('p1', { type: 'award', guess: id });
    expect(iconic.nextDeadline!(h.state)).toBe(h.now + UNDO_MS);
    h.tick();
    expect(round(h).stage).toBe('reveal');
    expect(round(h).result).toMatchObject({ outcome: 'guessed', how: 'right', guesser: 'p2' });
    expect(h.state.game!.scores).toMatchObject({ p1: 1, p2: 2, p3: 0, p4: 0 });
  });

  it('the next clue giver is the next seat; a pair moves on two', () => {
    const h = started(4, { first: 'p2' });
    guessRight(h);
    h.tick();
    expect(round(h).givers).toEqual(['p3']);
    expect(round(h).stage).toBe('choose');
    const p = started(6, { first: 'p5' });
    guessRight(p);
    expect(round(p).result!.until).toBe(p.now + REVEAL_MS);
    p.tick();
    expect(round(p).givers).toEqual(['p1', 'p2']);
  });
});

describe('scoring options', () => {
  it('a pair and a helper score 1 each; the bonus adds by level', () => {
    const h = started(6, { first: 'p1', settings: { bonus: true, roundMinutes: null } });
    h.act('p1', { type: 'pick', index: 6 });
    h.act('p2', { type: 'agree' });
    expect(round(h).answer!.level).toBe('challenging');
    h.act('p1', { type: 'invite', player: 'p6' });
    h.act('p3', { type: 'guess', text: round(h).answer!.word });
    h.act('p2', { type: 'award', guess: round(h).guesses[0]!.id });
    h.tick();
    expect(h.state.game!.scores).toMatchObject({ p1: 3, p2: 3, p6: 3, p3: 4, p4: 0 });
  });

  it('with scoring off nobody scores, and words guessed decide', () => {
    const h = started(3, { first: 'p1', settings: { scoring: false, length: 'endless' } });
    guessRight(h, 'p2');
    expect(h.state.game!.scores).toEqual({ p1: 0, p2: 0, p3: 0 });
    h.act(HOST, { type: 'end-game' });
    expect(h.state.phase).toBe('over');
    expect(h.state.game!.winners).toEqual(['p2']);
  });
});

describe('stalls', () => {
  it('the word is dropped once every guesser gives up; guessing still works after', () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    h.act('p2', { type: 'give-up', on: true });
    h.act('p2', { type: 'guess', text: 'still trying' });
    h.act('p3', { type: 'give-up', on: true });
    h.act('p3', { type: 'give-up', on: false });
    h.act('p3', { type: 'give-up', on: true });
    expect(round(h).stage).toBe('clue');
    h.act('p4', { type: 'give-up', on: true });
    expect(round(h).result).toMatchObject({ outcome: 'abandoned', how: 'gave-up' });
    expect(h.state.game!.scores).toEqual({ p1: 0, p2: 0, p3: 0, p4: 0 });
  });

  it('the clue givers can pass', () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    expect(h.refuse('p2', { type: 'pass' })).toBe('not-giver');
    h.act('p1', { type: 'pass' });
    expect(round(h).result).toMatchObject({ outcome: 'abandoned', how: 'pass' });
  });

  it('the soft clock only reminds, then a helper may join and place pieces', () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    expect(h.refuse('p1', { type: 'invite', player: 'p2' })).toBe('too-soon');
    h.tick();
    expect(round(h).reminded).toBe(true);
    expect(round(h).stage).toBe('clue');
    h.act('p1', { type: 'invite', player: 'p2' });
    expect(h.refuse('p1', { type: 'invite', player: 'p3' })).toBe('has-helper');
    expect(h.refuse('p2', { type: 'guess', text: 'x' })).toBe('not-guesser');
    h.act('p1', { type: 'place', set: 'main', icon: 3 });
    h.act('p2', { type: 'place', set: 'main', icon: 4 });
    expect(iconic.view(h.state, 'p2').game!.round.secret!.answer).toEqual(round(h).answer);
    expect(iconic.nextDeadline!(h.state)).toBeNull();
  });

  it('the strict clock drops the word', () => {
    const h = started(4, { first: 'p1', settings: { timerMode: 'strict', roundMinutes: 3 } });
    chooseWord(h);
    expect(iconic.nextDeadline!(h.state)).toBe(h.now + 3 * 60_000);
    h.tick();
    expect(round(h).result).toMatchObject({ outcome: 'abandoned', how: 'timer' });
  });
});

describe('game end', () => {
  it(`ends once ${WORDS_TO_END} words are guessed`, () => {
    const h = started(3);
    for (let i = 0; i < WORDS_TO_END; i++) {
      guessRight(h);
      if (i < WORDS_TO_END - 1) {
        expect(h.state.phase).toBe('playing');
        h.tick();
      }
    }
    expect(h.state.phase).toBe('over');
    expect(h.state.game!.wordsGuessed).toBe(WORDS_TO_END);
    expect(iconic.nextDeadline!(h.state)).toBeNull();
  });

  it('one word each: ends once every player has had a word guessed', () => {
    const h = started(3, { settings: { length: 'each' } });
    guessRight(h);
    h.tick();
    chooseWord(h);
    h.act(giver(h), { type: 'pass' });
    h.tick();
    guessRight(h);
    h.tick();
    // The first clue giver again: the one who passed still has none.
    guessRight(h);
    h.tick();
    expect(h.state.phase).toBe('playing');
    guessRight(h);
    expect(h.state.phase).toBe('over');
  });

  it('only an endless game can be ended by the host', () => {
    expect(started(3).refuse(HOST, { type: 'end-game' })).toBe('not-endless');
  });

  it('play again keeps the settings', () => {
    const h = started(3, { settings: { length: 'endless', bonus: true } });
    h.act(HOST, { type: 'end-game' });
    h.act(HOST, { type: 'play-again' });
    expect(h.state.phase).toBe('playing');
    expect(h.state.settings.bonus).toBe(true);
  });
});

describe('coming and going', () => {
  it('a clue giver leaving abandons the word', () => {
    const h = started(4, { first: 'p2' });
    chooseWord(h);
    h.state = iconic.playerLeft(h.state, 'p2', h.now);
    expect(round(h).result).toMatchObject({ outcome: 'abandoned', how: 'left' });
    h.tick();
    expect(round(h).givers).toEqual(['p3']);
  });

  it('a clue giver leaving before choosing passes the turn on at once', () => {
    const h = started(4, { first: 'p2' });
    h.state = iconic.playerLeft(h.state, 'p2', h.now);
    expect(round(h)).toMatchObject({ stage: 'choose', givers: ['p3'] });
  });

  it('a guesser leaving can drop the word when the rest gave up', () => {
    const h = started(4, { first: 'p1' });
    chooseWord(h);
    h.act('p2', { type: 'give-up', on: true });
    h.act('p3', { type: 'give-up', on: true });
    h.state = iconic.playerLeft(h.state, 'p4', h.now);
    expect(round(h).result?.how).toBe('gave-up');
  });

  it('newcomers sit down at the next round; one player left ends the game', () => {
    const h = started(3, { first: 'p1' });
    h.state = iconic.playerJoined(h.state, { id: 'p9', name: 'New' });
    expect(h.state.seats.p9).toMatchObject({ playing: false, waiting: true });
    guessRight(h);
    h.tick();
    expect(h.state.game!.order).toContain('p9');
    h.state = iconic.playerLeft(h.state, 'p9', h.now);
    h.state = iconic.playerLeft(h.state, 'p3', h.now);
    expect(h.state.phase).toBe('playing');
    h.state = iconic.playerLeft(h.state, 'p2', h.now);
    expect(h.state.phase).toBe('over');
  });

  it('a helper leaving just leaves the team', () => {
    const h = started(4, { first: 'p1', settings: { roundMinutes: null } });
    chooseWord(h);
    h.act('p1', { type: 'invite', player: 'p3' });
    h.state = iconic.playerLeft(h.state, 'p3', h.now);
    expect(round(h).helper).toBeNull();
    expect(round(h).stage).toBe('clue');
    expect(guessersOf(h)).toEqual(['p2', 'p4']);
  });
});
