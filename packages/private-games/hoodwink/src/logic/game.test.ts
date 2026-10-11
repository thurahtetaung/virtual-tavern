import { describe, expect, it } from 'vitest';
import {
  awards,
  hoodwink,
  liePoints,
  lieProblem,
  missingPlayers,
  playingIds,
  rankedScores,
} from './game.ts';
import {
  DECKS,
  FOUR,
  type FakeDeck,
  HOST,
  NOW,
  THREE,
  answer,
  content,
  deck,
  harness,
  lieOf,
  playRound,
  round,
  startedGame,
  truthIndex,
  voteTruth,
  writeAll,
} from './test-utils.ts';
import { type HoodwinkState, MAX_PLAYERS, MAX_USED_QUESTIONS, actionSchema } from './types.ts';

const join = (h: { state: HoodwinkState }, id: string) => {
  h.state = hoodwink.playerJoined(h.state, { id, name: id.toUpperCase() });
};
const leave = (h: { state: HoodwinkState }, id: string, now = NOW) => {
  h.state = hoodwink.playerLeft(h.state, id, now);
};
const ids = (n: number) => Array.from({ length: n }, (_, i) => (i === 0 ? HOST : `p${i + 1}`));
const score = (h: { state: HoodwinkState }, id: string) => h.state.scores[id]?.score ?? 0;

/** A one-question deck whose answer has a distinct alternate spelling. */
const riddle: FakeDeck = {
  ...deck('riddle', 0),
  questionCount: 5,
  questions: Array.from({ length: 5 }, (_, i) => ({
    id: `riddle:${i}`,
    deckId: 'riddle',
    prompt: 'In the made-up land of Quux, people greet each other by waving a ___.',
    answer: 'Wooden spoon',
    alternates: ['Ladle'],
  })),
};

describe('lobby', () => {
  it('offers every non-adult deck by default and seats up to ten players', () => {
    const h = harness(ids(12));
    expect(h.state.settings).toMatchObject({ deckIds: ['odd', 'wild'], rounds: 7 });
    expect(h.state.decks.map((d) => d.id)).toEqual(['odd', 'wild', 'late']);
    expect(playingIds(h.state)).toHaveLength(MAX_PLAYERS);
    expect(h.state.seats.p11!.playing).toBe(false);
    expect(h.reject({ type: 'sit', playing: true }, 'p11').code).toBe('table-full');
    h.act({ type: 'sit', playing: false }, 'p2');
    h.act({ type: 'sit', playing: true }, 'p11');
    expect(h.state.seats.p11!.playing).toBe(true);
  });

  it('only lets the host change settings, and only between games', () => {
    const h = harness(FOUR);
    expect(h.reject({ type: 'update-settings', rounds: 10 }, 'p2').code).toBe('not-host');
    expect(h.reject({ type: 'update-settings', deckIds: ['nope'] }).code).toBe('unknown-deck');
    h.act({
      type: 'update-settings',
      deckIds: ['late', 'odd', 'late'],
      rounds: 10,
      clueSeconds: 60,
      guessSeconds: 30,
      timerMode: 'strict',
    });
    expect(h.state.settings).toEqual({
      deckIds: ['late', 'odd'],
      rounds: 10,
      clueSeconds: 60,
      guessSeconds: 30,
      timerMode: 'strict',
    });
    h.act({ type: 'start' });
    expect(h.reject({ type: 'update-settings', rounds: 5 }).code).toBe('in-progress');
  });

  it('picks up decks added after the room opened', () => {
    const decks: FakeDeck[] = [];
    const h = harness(FOUR, content(decks));
    expect(h.state.settings.deckIds).toEqual([]);
    expect(h.reject({ type: 'start' }).code).toBe('no-decks');
    decks.push(deck('fresh', 10));
    h.act({ type: 'update-settings', rounds: 5 });
    expect(h.state.decks.map((d) => d.id)).toEqual(['fresh']);
    expect(h.state.settings.deckIds).toEqual(['fresh']);
  });

  it('drops decks an admin removed or switched off from the selection', () => {
    const decks: FakeDeck[] = [deck('odd', 12), deck('wild', 6)];
    const h = harness(FOUR, content(decks));
    h.act({ type: 'update-settings', deckIds: ['wild'] });
    decks.pop();
    h.act({ type: 'update-settings', rounds: 5 });
    // The only chosen deck is gone, so the selection falls back to the defaults.
    expect(h.state.settings.deckIds).toEqual(['odd']);
    decks.push(deck('wild', 6));
    h.act({ type: 'update-settings', deckIds: ['odd', 'wild'] });
    decks.shift();
    h.act({ type: 'update-settings', rounds: 7 });
    expect(h.state.settings.deckIds).toEqual(['wild']);
  });

  it('works on a server without question decks', () => {
    const h = harness(FOUR, { wordLists: () => [], words: () => [] });
    expect(h.state.decks).toEqual([]);
    expect(h.reject({ type: 'start' }).code).toBe('no-decks');
  });

  it('renames on rejoin without changing the seat', () => {
    const h = harness(FOUR);
    h.act({ type: 'sit', playing: false }, 'p2');
    h.state = hoodwink.playerJoined(h.state, { id: 'p2', name: 'Renamed' });
    expect(h.state.seats.p2).toEqual({ name: 'Renamed', playing: false });
  });
});

describe('starting', () => {
  it('needs the host and at least three players', () => {
    const h = harness([HOST, 'p2']);
    expect(h.reject({ type: 'start' }, 'p2').code).toBe('not-host');
    expect(h.reject({ type: 'start' }).code).toBe('too-few-players');
    join(h, 'p3');
    h.act({ type: 'update-settings', rounds: 5 });
    h.act({ type: 'start' });
    expect(h.state.phase).toBe('playing');
    expect(h.reject({ type: 'start' }).code).toBe('in-progress');
  });

  it('needs at least as many questions as rounds', () => {
    const h = harness(FOUR);
    h.act({ type: 'update-settings', deckIds: ['wild'], rounds: 7 });
    expect(h.reject({ type: 'start' }).message).toBe(
      '7 rounds need at least 7 questions in the chosen decks.',
    );
    h.act({ type: 'update-settings', rounds: 5 });
    h.act({ type: 'start' });
  });

  it('draws distinct questions and starts round one with everyone writing', () => {
    const h = startedGame(FOUR, { rounds: 10 });
    const drawn = [round(h).question, ...h.state.questions];
    expect(drawn).toHaveLength(10);
    expect(new Set(drawn.map((q) => q.id)).size).toBe(10);
    expect(drawn.every((q) => q.deckId === 'odd' || q.deckId === 'wild')).toBe(true);
    expect(round(h)).toMatchObject({ number: 1, stage: 'write', players: FOUR, lies: {} });
    expect(Object.keys(h.state.scores)).toEqual(FOUR);
  });

  it('avoids questions from earlier games while the decks allow, and caps the memory', () => {
    const decks = [deck('small', 12)];
    const h = harness(FOUR, content(decks));
    h.act({ type: 'update-settings', rounds: 5 });
    h.act({ type: 'start' });
    const first = new Set(h.state.usedQuestionIds);
    h.act({ type: 'back-to-lobby' });
    h.act({ type: 'start' });
    const second = h.state.usedQuestionIds.slice(5);
    expect(second.filter((id) => first.has(id))).toEqual([]);
    h.act({ type: 'back-to-lobby' });
    // Only two unseen questions left: both are used, plus the three least recently seen.
    h.act({ type: 'start' });
    const third = h.state.usedQuestionIds.slice(-5);
    const unseen = decks[0]!.questions
      .map((q) => q.id)
      .filter((id) => !first.has(id) && !second.includes(id));
    expect(third).toEqual(expect.arrayContaining(unseen));
    expect(third.filter((id) => first.has(id))).toHaveLength(3);
    expect(new Set(h.state.usedQuestionIds).size).toBe(h.state.usedQuestionIds.length);

    const big = harness(FOUR, content([deck('big', 1000)]));
    big.state = { ...big.state, usedQuestionIds: Array.from({ length: 600 }, (_, i) => `x:${i}`) };
    big.act({ type: 'update-settings', rounds: 5 });
    big.act({ type: 'start' });
    expect(big.state.usedQuestionIds).toHaveLength(MAX_USED_QUESTIONS);
  });
});

describe('writing lies', () => {
  it('collects one lie each, editable until the last is in, then opens voting', () => {
    const h = startedGame();
    expect(h.reject({ type: 'vote', option: 0 }, 'p2').code).toBe('wrong-stage');
    h.act({ type: 'lie', text: '  A tiny hat  ' }, 'p2');
    h.act({ type: 'lie', text: 'A big hat' }, 'p2');
    expect(round(h).lies.p2).toBe('A big hat');
    h.act({ type: 'lie', text: 'Spoons' }, HOST);
    h.act({ type: 'lie', text: 'Socks' }, 'p3');
    expect(round(h).stage).toBe('write');
    h.act({ type: 'lie', text: 'Kites' }, 'p4');
    expect(round(h).stage).toBe('vote');
    expect(round(h).options).toHaveLength(5);
    expect(round(h).voters).toEqual(FOUR);
    expect(h.reject({ type: 'lie', text: 'Late' }, 'p2').code).toBe('wrong-stage');
  });

  it('rejects empty, overlong and multi-line lies', () => {
    const h = startedGame();
    expect(h.reject({ type: 'lie', text: '   ' }, 'p2').code).toBe('empty-lie');
    expect(h.reject({ type: 'lie', text: 'x'.repeat(161) }, 'p2').code).toBe('lie-too-long');
    expect(h.reject({ type: 'lie', text: 'two\nlines' }, 'p2').code).toBe('lie-lines');
    h.act({ type: 'lie', text: 'x'.repeat(160) }, 'p2');
    expect(actionSchema.safeParse({ type: 'lie', text: 'x'.repeat(401) }).success).toBe(false);
    h.act({ type: 'lie', text: '  a   spaced\t lie ' }, 'p2');
    expect(round(h).lies.p2).toBe('a spaced lie');
  });

  it('rejects the real answer in any case, plural or accepted alternate', () => {
    const h = startedGame(FOUR, { provider: content([riddle]) });
    for (const text of ['wooden spoon', 'WOODEN SPOONS', ' Wooden  spoon! ', 'ladles', 'Ládle']) {
      const err = h.reject({ type: 'lie', text }, 'p2');
      expect(err.code, text).toBe('is-the-truth');
      expect(err.message).toBe('That’s the real answer — write a lie!');
    }
    h.act({ type: 'lie', text: 'Wooden fork' }, 'p2');
    expect(lieProblem('spoon', riddle.questions[0])).toBeNull();
    expect(lieProblem('wooden spoon')).toBeNull();
    // Plurals of words with an ending count as the truth too.
    const crossing = { answer: 'Zebra crossing', alternates: [] };
    expect(lieProblem('zebra crossings', crossing)?.code).toBe('is-the-truth');
  });

  it('only lets this round’s players write', () => {
    const h = startedGame();
    join(h, 'late');
    expect(h.reject({ type: 'lie', text: 'hi' }, 'late').code).toBe('not-playing-round');
  });
});

describe('voting', () => {
  it('merges identical lies into one option credited to every author', () => {
    const h = startedGame();
    h.act({ type: 'lie', text: 'Cheese wheel' }, HOST);
    h.act({ type: 'lie', text: 'cheese wheels' }, 'p2');
    h.act({ type: 'lie', text: 'Goat' }, 'p3');
    h.act({ type: 'lie', text: 'Bucket' }, 'p4');
    const options = round(h).options;
    expect(options).toHaveLength(4);
    const merged = options.find((o) => o.authors.length === 2)!;
    expect(merged).toEqual({
      text: 'Cheese wheel',
      truth: false,
      authors: [HOST, 'p2'],
      auto: [],
      house: false,
    });
  });

  it('capitalises every answer on the board alike, truth included', () => {
    const lower: FakeDeck = {
      ...deck('lower', 0),
      questionCount: 5,
      questions: Array.from({ length: 5 }, (_, i) => ({
        id: `lower:${i}`,
        deckId: 'lower',
        prompt: 'What did the imaginary poet Vexa always say?',
        answer: 'a stitch in the moon saves nine owls',
        alternates: [],
      })),
    };
    const h = startedGame(FOUR, { provider: content([lower]) });
    writeAll(h);
    expect(
      round(h)
        .options.map((o) => o.text)
        .sort(),
    ).toEqual(
      ['A stitch in the moon saves nine owls', 'Lie host', 'Lie p2', 'Lie p3', 'Lie p4'].sort(),
    );
    expect(round(h).lies.p2).toBe('lie p2');
  });

  it('shuffles the board from the hidden seed', () => {
    const boards = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const h = harness(FOUR, content(), seed);
      h.act({ type: 'update-settings', rounds: 5 });
      h.act({ type: 'start' });
      writeAll(h);
      boards.add(truthIndex(h));
      expect(h.state.seed).not.toBe(0);
    }
    expect(boards.size).toBeGreaterThan(1);
  });

  it('refuses a vote for your own lie or a missing option, and lets you change your vote', () => {
    const h = startedGame();
    writeAll(h);
    expect(h.reject({ type: 'vote', option: lieOf(h, 'p2') }, 'p2').message).toBe(
      "That's your own lie! Pick another answer.",
    );
    expect(h.reject({ type: 'vote', option: 9 }, 'p2').code).toBe('bad-option');
    h.act({ type: 'vote', option: lieOf(h, 'p3') }, 'p2');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p2');
    expect(round(h).votes.p2).toBe(truthIndex(h));
    join(h, 'late');
    expect(h.reject({ type: 'vote', option: 0 }, 'late').code).toBe('not-voter');
  });

  it('refuses a vote for a merged lie from any of its authors', () => {
    const h = startedGame();
    h.act({ type: 'lie', text: 'Same' }, HOST);
    h.act({ type: 'lie', text: 'same' }, 'p2');
    h.act({ type: 'lie', text: 'Other' }, 'p3');
    h.act({ type: 'lie', text: 'Else' }, 'p4');
    expect(h.reject({ type: 'vote', option: lieOf(h, 'p2') }, HOST).code).toBe('own-lie');
    expect(h.reject({ type: 'vote', option: lieOf(h, 'p2') }, 'p2').code).toBe('own-lie');
  });
});

describe('scoring', () => {
  it('gives 1,000 for the truth and 500 per player fooled', () => {
    const h = startedGame();
    writeAll(h);
    h.act({ type: 'vote', option: truthIndex(h) }, HOST);
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p2');
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p3');
    h.act({ type: 'vote', option: lieOf(h, 'p2') }, 'p4');
    expect(round(h).stage).toBe('reveal');
    expect(round(h).points).toEqual({ host: 2000, p2: 500, p3: 0, p4: 0 });
    expect(h.state.scores.host).toMatchObject({ score: 2000, fooled: 2, truths: 1 });
    expect(h.state.scores.p2).toMatchObject({ score: 500, fooled: 1, truths: 0 });
  });

  it('splits a merged lie’s points between its authors, rounding down to 50s', () => {
    expect(liePoints(1, 2, 1)).toBe(250);
    expect(liePoints(1, 3, 1)).toBe(150);
    expect(liePoints(2, 3, 1)).toBe(300);
    expect(liePoints(1, 3, 2)).toBe(300);
    expect(liePoints(3, 1, 2)).toBe(3000);
    expect(liePoints(1, 0, 1)).toBe(0);

    const h = startedGame(ids(5));
    h.act({ type: 'lie', text: 'Same' }, HOST);
    h.act({ type: 'lie', text: 'same' }, 'p2');
    h.act({ type: 'lie', text: 'SAME' }, 'p3');
    h.act({ type: 'lie', text: 'Other' }, 'p4');
    h.act({ type: 'lie', text: 'Else' }, 'p5');
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p4');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p5');
    for (const id of [HOST, 'p2', 'p3']) h.act({ type: 'vote', option: lieOf(h, 'p4') }, id);
    expect(round(h).points).toEqual({ host: 150, p2: 150, p3: 150, p4: 1500, p5: 1000 });
  });

  it('counts the final round double and then ends the game', () => {
    const h = startedGame(FOUR, { rounds: 5 });
    for (let i = 0; i < 4; i++) {
      expect(round(h).number).toBe(i + 1);
      playRound(h);
    }
    expect(round(h).number).toBe(5);
    writeAll(h);
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p2');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p3');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p4');
    h.act({ type: 'vote', option: truthIndex(h) }, HOST);
    expect(round(h).points).toEqual({ host: 3000, p2: 0, p3: 2000, p4: 2000 });
    expect(score(h, HOST)).toBe(4 * 1000 + 3000);
    expect(h.reject({ type: 'next-round' }, 'p2').code).toBe('not-host');
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'finished', round: null });
    const view = hoodwink.view(h.state, 'p2');
    expect(view.scores.map((s) => [s.id, s.score])).toEqual([
      [HOST, 7000],
      ['p3', 6000],
      ['p4', 6000],
      ['p2', 4000],
    ]);
    expect(awards(view.scores)).toEqual({
      winners: [HOST],
      bestLiar: [HOST],
      truthSeeker: [HOST, 'p3', 'p4'],
    });
  });

  it('plays again with fresh scores, or goes back to the lobby', () => {
    const h = startedGame(THREE, { rounds: 5 });
    for (let i = 0; i < 5; i++) playRound(h);
    expect(h.state.phase).toBe('over');
    h.act({ type: 'start' });
    expect(h.state).toMatchObject({ phase: 'playing', gamesPlayed: 2 });
    expect(score(h, HOST)).toBe(0);
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({ phase: 'lobby', round: null, scores: {}, questions: [] });
  });

  it('gives no awards for nothing', () => {
    expect(awards([{ id: 'a', name: 'A', score: 0, fooled: 0, truths: 0, left: false }])).toEqual({
      winners: [],
      bestLiar: [],
      truthSeeker: [],
    });
  });
});

describe('players coming and going', () => {
  it('lets late joiners watch until the next round', () => {
    const h = startedGame();
    join(h, 'late');
    expect(hoodwink.view(h.state, 'late').role).toBe('waiting');
    writeAll(h);
    expect(round(h).voters).not.toContain('late');
    voteTruth(h);
    h.act({ type: 'next-round' });
    expect(round(h).players).toContain('late');
    expect(h.state.scores.late).toMatchObject({ name: 'LATE', score: 0 });
    expect(hoodwink.view(h.state, 'late').role).toBe('player');
  });

  it('drops a leaver’s lie while writing, and may open voting', () => {
    const h = startedGame(ids(5));
    h.act({ type: 'lie', text: 'one' }, HOST);
    h.act({ type: 'lie', text: 'two' }, 'p2');
    h.act({ type: 'lie', text: 'three' }, 'p3');
    h.act({ type: 'lie', text: 'four' }, 'p5');
    leave(h, 'p2');
    expect(round(h).lies.p2).toBeUndefined();
    expect(round(h).stage).toBe('write');
    leave(h, 'p4'); // the last one still writing
    expect(round(h).stage).toBe('vote');
    expect(
      round(h)
        .options.map((o) => o.text)
        .sort(),
    ).toEqual(['Four', 'One', 'Three', answer(h)].sort());
    expect(round(h).voters).toEqual([HOST, 'p3', 'p5']);
  });

  it('keeps a leaver’s lie and vote once voting has started, and may reveal', () => {
    const h = startedGame(ids(5));
    writeAll(h);
    h.act({ type: 'vote', option: lieOf(h, 'p3') }, 'p2');
    leave(h, 'p3');
    leave(h, 'p2');
    expect(round(h).options.some((o) => o.authors.includes('p3'))).toBe(true);
    expect(round(h).voters).toEqual([HOST, 'p2', 'p4', 'p5']);
    h.act({ type: 'vote', option: truthIndex(h) }, HOST);
    h.act({ type: 'vote', option: truthIndex(h) }, 'p4');
    expect(round(h).stage).toBe('vote');
    leave(h, 'p5'); // the last one still voting: too few now, so the game ends
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few' });
    expect(score(h, 'p3')).toBe(0);
  });

  it('reveals when the last voter still to vote leaves', () => {
    const h = startedGame(ids(5));
    writeAll(h);
    for (const id of [HOST, 'p2', 'p3', 'p4']) h.act({ type: 'vote', option: lieOf(h, 'p5') }, id);
    leave(h, 'p5');
    expect(round(h).stage).toBe('reveal');
    expect(h.state.scores.p5).toMatchObject({ score: 2000, fooled: 4 });
    expect(hoodwink.view(h.state, HOST).scores[0]).toMatchObject({ id: 'p5', left: true });
  });

  it('ignores leavers at the reveal and strangers leaving', () => {
    const h = startedGame(ids(4));
    writeAll(h);
    voteTruth(h);
    const before = h.state;
    leave(h, 'nobody');
    expect(h.state).toBe(before);
    leave(h, 'p4');
    expect(round(h).stage).toBe('reveal');
    expect(round(h).points.p4).toBe(1000);
    h.act({ type: 'next-round' });
    expect(round(h).players).toEqual([HOST, 'p2', 'p3']);
  });

  it('ends the game when fewer than three are left, in any stage', () => {
    for (const stage of ['write', 'vote', 'reveal'] as const) {
      const h = startedGame(THREE);
      if (stage !== 'write') writeAll(h);
      if (stage === 'reveal') voteTruth(h);
      expect(round(h).stage).toBe(stage);
      h.act({ type: 'sit', playing: false }, 'p3');
      expect(h.state, stage).toMatchObject({ phase: 'over', endReason: 'too-few' });
    }
  });
});

describe('timers', () => {
  const strict = {
    rounds: 5 as const,
    clueSeconds: 60,
    guessSeconds: 30,
    timerMode: 'strict' as const,
  };

  it('only enforces deadlines in strict mode', () => {
    const soft = startedGame(FOUR, { ...strict, timerMode: 'soft' });
    expect(round(soft).deadline).toBe(NOW + 60_000);
    expect(hoodwink.nextDeadline!(soft.state)).toBeNull();
    expect(hoodwink.onDeadline!(soft.state, NOW + 60_000)).toBe(soft.state);
    const h = startedGame(FOUR, strict);
    expect(hoodwink.nextDeadline!(h.state)).toBe(NOW + 60_000);
    expect(hoodwink.onDeadline!(h.state, NOW + 1)).toBe(h.state);
  });

  it('moves on without missing lies, then scores missing votes as nothing', () => {
    const h = startedGame(FOUR, strict);
    h.act({ type: 'lie', text: 'one' }, 'p2');
    h.act({ type: 'lie', text: 'two' }, 'p3');
    const due = NOW + 60_000;
    h.state = hoodwink.onDeadline!(h.state, due);
    expect(round(h)).toMatchObject({ stage: 'vote', deadline: due + 30_000 });
    expect(round(h).options).toHaveLength(3);
    expect(hoodwink.nextDeadline!(h.state)).toBeGreaterThan(due);
    h.act({ type: 'vote', option: lieOf(h, 'p3') }, 'p2', due);
    h.state = hoodwink.onDeadline!(h.state, due + 30_000);
    expect(round(h).stage).toBe('reveal');
    expect(round(h).points).toEqual({ host: 0, p2: 0, p3: 500, p4: 0 });
    expect(hoodwink.nextDeadline!(h.state)).toBeNull();
  });

  it('goes straight to the reveal with no points when nobody wrote a lie', () => {
    const h = startedGame(FOUR, strict);
    h.state = hoodwink.onDeadline!(h.state, NOW + 60_000);
    expect(round(h)).toMatchObject({ stage: 'reveal', deadline: null });
    expect(round(h).options).toEqual([
      { text: answer(h), truth: true, authors: [], auto: [], house: false },
    ]);
    expect(Object.values(round(h).points).every((p) => p === 0)).toBe(true);
    h.act({ type: 'next-round' });
    expect(round(h)).toMatchObject({ number: 2, stage: 'write' });
  });

  it('has no vote deadline without a guess timer', () => {
    const h = startedGame(FOUR, { ...strict, guessSeconds: undefined });
    writeAll(h);
    expect(hoodwink.nextDeadline!(h.state)).toBeNull();
  });

  it('always makes progress: every deadline it fires is later or gone', () => {
    const h = startedGame(FOUR, { ...strict, rounds: 5 });
    let now = NOW;
    for (let i = 0; i < 20 && h.state.phase === 'playing'; i++) {
      const due = hoodwink.nextDeadline!(h.state);
      if (due === null) {
        h.act({ type: 'next-round' }, HOST, now);
        continue;
      }
      now = due;
      h.state = hoodwink.onDeadline!(h.state, now);
      const next = hoodwink.nextDeadline!(h.state);
      expect(next === null || next > now).toBe(true);
    }
    expect(h.state.phase).toBe('over');
  });
});

describe('continue without', () => {
  const soft = {
    rounds: 5 as const,
    clueSeconds: 60,
    guessSeconds: 30,
    timerMode: 'soft' as const,
  };

  it('lets the host stop waiting for a missing writer, as a strict timeout would', () => {
    const h = startedGame(FOUR, soft);
    h.act({ type: 'lie', text: 'one' }, 'p2');
    h.act({ type: 'lie', text: 'two' }, 'p3');
    h.act({ type: 'lie', text: 'three' }, HOST);
    expect(missingPlayers(round(h))).toEqual(['p4']);
    // Only the host may, and only while someone is missing.
    expect(h.reject({ type: 'continue-without' }, 'p2').code).toBe('not-host');
    const strict = startedGame(FOUR, { ...soft, timerMode: 'strict' });
    strict.act({ type: 'lie', text: 'one' }, 'p2');
    strict.act({ type: 'lie', text: 'two' }, 'p3');
    strict.act({ type: 'lie', text: 'three' }, HOST);
    const timedOut = hoodwink.onDeadline!(strict.state, NOW + 60_000);
    h.act({ type: 'continue-without' }, HOST, NOW + 60_000);
    // The same board and stage as the strict timeout gives.
    expect(round(h).stage).toBe('vote');
    expect(round(h).options.map((o) => o.text)).toEqual(timedOut.round!.options.map((o) => o.text));
    expect(round(h).voters).toEqual(FOUR);
  });

  it('reveals without the missing voters, who score nothing', () => {
    const h = startedGame(FOUR, soft);
    writeAll(h);
    for (const id of [HOST, 'p2', 'p3'])
      h.act({ type: 'vote', option: lieOf(h, id === 'p3' ? 'p2' : 'p3') }, id);
    expect(missingPlayers(round(h))).toEqual(['p4']);
    h.act({ type: 'continue-without' });
    expect(round(h).stage).toBe('reveal');
    expect(round(h).points?.p4).toBe(0);
    expect(h.reject({ type: 'continue-without' }).code).toBe('wrong-stage');
  });

  it('refuses outside a round', () => {
    const h = harness(FOUR);
    expect(h.reject({ type: 'continue-without' }).code).toBe('wrong-stage');
  });
});

describe('view', () => {
  it('never shows the answer or the seed before the reveal', () => {
    const h = startedGame(FOUR, { provider: content([riddle]) });
    const secrets = (s: HoodwinkState) => [String(s.seed), 'Ladle', 'Wooden spoon'];
    const check = () => {
      for (const viewer of [...FOUR, null, 'stranger']) {
        const json = JSON.stringify(hoodwink.view(h.state, viewer));
        const hidden =
          round(h).stage === 'write' ? secrets(h.state) : [String(h.state.seed), 'Ladle'];
        for (const s of hidden) expect(json, `${s} for ${viewer}`).not.toContain(s);
        expect(json).not.toContain('riddle:');
      }
    };
    check();
    h.act({ type: 'lie', text: 'Feather' }, 'p2');
    check();
    writeAll(h);
    check();
    const v = hoodwink.view(h.state, 'p2');
    expect(v.round!.answer).toBeNull();
    expect(v.round!.options.every((o) => o.truth === null && o.authors === null)).toBe(true);
    expect(v.round!.options.filter((o) => o.mine).map((o) => o.text)).toEqual(['Lie p2']);
    h.act({ type: 'vote', option: 0 }, HOST);
    check();
    const after = hoodwink.view(h.state, 'p3').round!;
    expect(after.voted).toEqual([HOST]);
    expect(after.options.every((o) => o.voters === null)).toBe(true);
    expect(after.myVote).toBeNull();
    expect(hoodwink.view(h.state, HOST).round!.myVote).toBe(0);
    voteTruth(h);
    const revealed = hoodwink.view(h.state, null).round!;
    expect(revealed.answer).toBe('Wooden spoon');
    expect(revealed.options.find((o) => o.truth)!.voters).toHaveLength(4);
    expect(revealed.options.find((o) => o.text === 'Lie p3')!.authors).toEqual(['p3']);
    expect(revealed.points).toMatchObject({ p2: 1000 });
  });

  it('shows writers only their own lie while writing', () => {
    const h = startedGame();
    h.act({ type: 'lie', text: 'Secret one' }, 'p2');
    h.act({ type: 'lie', text: 'Secret two' }, 'p3');
    const p2 = hoodwink.view(h.state, 'p2').round!;
    expect(p2).toMatchObject({ myLie: 'Secret one', written: ['p2', 'p3'], options: [] });
    expect(JSON.stringify(hoodwink.view(h.state, 'p2'))).not.toContain('Secret two');
    expect(JSON.stringify(hoodwink.view(h.state, null))).not.toContain('Secret');
  });

  it('shows the round number, the double final round, and the role', () => {
    const h = startedGame(FOUR, { rounds: 5 });
    expect(hoodwink.view(h.state, HOST).round).toMatchObject({
      number: 1,
      rounds: 5,
      double: false,
    });
    for (let i = 0; i < 4; i++) playRound(h);
    expect(hoodwink.view(h.state, HOST).round).toMatchObject({ number: 5, double: true });
    expect(hoodwink.view(h.state, null).role).toBe('spectator');
    expect(hoodwink.view(h.state, null).me).toBeNull();
    expect(rankedScores(h.state)).toHaveLength(4);
  });

  it('lists the decks offered, never their questions', () => {
    const json = JSON.stringify(hoodwink.view(harness(FOUR).state, HOST));
    expect(json).toContain('"questionCount":12');
    expect(json).not.toContain('Zorbly');
    expect(DECKS).toHaveLength(3);
  });
});
