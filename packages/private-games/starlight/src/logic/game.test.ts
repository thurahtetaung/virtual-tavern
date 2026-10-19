import { describe, expect, it } from 'vitest';
import { starlight } from './game.ts';
import {
  FOUR,
  HOST,
  NOW,
  content,
  fromFirst,
  harness,
  leave,
  markAll,
  round,
  scout,
  startedGame,
} from './test-utils.ts';
import { CARDS_PER_GAME } from './types.ts';

/** The worked round: A, B, C, D clockwise from the First Scout; D alone in the lead. */
function workedRound(seed = 3) {
  const h = startedGame(FOUR, seed);
  const [a, b, c, d] = fromFirst(h) as [string, string, string, string];
  markAll(h, { [a]: [0, 1, 2], [b]: [0, 1, 3], [c]: [0, 4], [d]: [0, 1, 2, 3, 5] });
  return { h, a, b, c, d };
}

describe('lobby', () => {
  it('offers the game’s word lists and picks the first by default', () => {
    const h = harness();
    expect(h.state.wordLists.map((l) => l.id)).toEqual(['plain']);
    expect(h.state.settings.wordListIds).toEqual(['plain']);
    expect(h.reject({ type: 'update-settings', wordListIds: ['nope'] })).toBe('unknown-list');
    expect(h.reject({ type: 'update-settings', sets: ['base'] }, 'ana')).toBe('not-host');
  });

  it('needs 3 to 6 players, 30 cards and 4 words to start', () => {
    expect(harness([HOST, 'ana']).reject({ type: 'start' })).toBe('cannot-start');
    const h = harness();
    const empty = harness(FOUR, 3, { wordLists: () => [], words: () => [] });
    expect(empty.reject({ type: 'start' })).toBe('cannot-start');
    h.act({ type: 'start' });
    const cards = [...round(h).board, ...h.state.pile];
    expect(cards).toHaveLength(CARDS_PER_GAME);
    expect(new Set(cards).size).toBe(CARDS_PER_GAME);
    expect(h.state.words).toHaveLength(3);
  });

  it('seats at most 6 and only between rounds', () => {
    const h = harness([HOST, 'a', 'b', 'c', 'd', 'e', 'f']);
    expect(Object.values(h.state.seats).filter((s) => s.playing)).toHaveLength(6);
    expect(h.reject({ type: 'sit', playing: true }, 'f')).toBe('full');
    h.act({ type: 'sit', playing: false }, 'e');
    h.act({ type: 'start' });
    expect(h.reject({ type: 'sit', playing: true }, 'e')).toBe('in-progress');
  });
});

describe('the word', () => {
  it('plays each side of a two-word entry as a word of its own, never the pair', () => {
    const words = new Set<string>();
    for (let seed = 1; seed < 40; seed++) {
      const h = startedGame(FOUR, seed, content);
      expect(round(h).stage).toBe('mark');
      for (const w of [round(h).word, ...h.state.words]) {
        expect(w).not.toContain('/');
        words.add(w);
      }
      expect(starlight.view(h.state, 'ana').round!.word).toBe(round(h).word);
    }
    expect([...words].sort()).toEqual(
      ['Moon', 'Tide', 'Lantern', 'Harbour', 'Kite', 'Velvet', 'Thunder', 'Honey'].sort(),
    );
  });

  it('counts both sides towards the words a game needs, once each', () => {
    const pairs = {
      wordLists: () => [{ id: 'p', name: 'Pairs', wordCount: 3 }],
      words: () => ['Moon / Tide', 'Kite / Moon', 'tide'],
    };
    expect(harness(FOUR, 3, pairs).reject({ type: 'start' })).toBe('cannot-start');
    const more = { ...pairs, words: () => ['Moon / Tide', 'Kite / Moon', 'Honey'] };
    const h = harness(FOUR, 3, more);
    h.act({ type: 'start' });
    expect([round(h).word, ...h.state.words].sort()).toEqual(['Honey', 'Kite', 'Moon', 'Tide']);
  });

  it('moves a room saved while the First Scout chose the word on to marking', () => {
    const h = startedGame();
    const { word: _, ...rest } = round(h);
    const saved = {
      ...h.state,
      settings: { ...h.state.settings, clueSeconds: 30, timerMode: 'strict' as const },
      words: [['Meadow', 'Pond'], ['Clock']],
      round: { ...rest, card: ['Lantern', 'Ember'], side: 0, stage: 'word', deadline: NOW + 5 },
    } as unknown as typeof h.state;
    const v = starlight.view(saved, 'ana').round!;
    expect(v).toMatchObject({ word: 'Lantern', stage: 'mark' });
    const later = starlight.onDeadline!(saved, NOW + 5);
    expect(later.round).toMatchObject({ word: 'Lantern', stage: 'mark', deadline: NOW + 30_005 });
    expect(later.words).toEqual(['Meadow', 'Clock']);
    expect(later.round).not.toHaveProperty('card');
    h.state = saved;
    h.act({ type: 'mark', positions: [1] }, 'ana');
    expect(round(h)).toMatchObject({ word: 'Lantern', stage: 'mark' });
    // A round already past the choice keeps the word that was played.
    h.state = {
      ...saved,
      round: { ...saved.round!, stage: 'mark', card: ['Lantern', 'Ember'], side: 1 },
    } as typeof saved;
    expect(starlight.view(h.state, 'ana').round!.word).toBe('Ember');
  });
});

describe('marking', () => {
  it('takes 1 to 10 crosses, and slates stay open until the last lock', () => {
    const h = startedGame();
    expect(h.reject({ type: 'lock' }, 'ana')).toBe('marks');
    h.act({ type: 'mark', positions: [3, 1] }, 'ana');
    expect(round(h).marks.ana).toEqual([1, 3]);
    h.act({ type: 'lock' }, 'ana');
    expect(h.reject({ type: 'mark', positions: [2] }, 'ana')).toBe('locked');
    h.act({ type: 'unlock' }, 'ana');
    h.act({ type: 'mark', positions: [2] }, 'ana');
    for (const id of FOUR) {
      if (id !== 'ana') h.act({ type: 'mark', positions: [0] }, id);
      h.act({ type: 'lock' }, id);
    }
    expect(round(h).stage).toBe('reveal');
    expect(h.reject({ type: 'unlock' }, 'ana')).toBe('wrong-stage');
    expect(round(h).counts).toEqual({ host: 1, ana: 1, ben: 1, cy: 1 });
    expect(round(h).dark).toBeNull();
  });

  it('puts the one player alone in the lead in the Dark, and nobody on a tie', () => {
    const { h, d } = workedRound();
    expect(round(h).dark).toBe(d);
    const t = startedGame();
    const [a, b, c, e] = fromFirst(t) as [string, string, string, string];
    markAll(t, { [a]: [0, 1], [b]: [0, 2], [c]: [3], [e]: [4] });
    expect(round(t).dark).toBeNull();
  });
});

describe('the Reveal', () => {
  it('plays the worked round: Sparks, Super-Sparks, falls and the Dark', () => {
    const { h, a, b, c, d } = workedRound();
    expect(scout(h)).toBe(a);
    expect(h.reject({ type: 'show', pos: 3 }, a)).toBe('not-marked');
    expect(h.reject({ type: 'show', pos: 0 }, b)).toBe('not-scout');

    h.act({ type: 'show', pos: 0 }, a); // B, C, D marked it: a Spark.
    expect(round(h).shown[0]).toMatchObject({ kind: 'spark', markers: [a, b, c, d] });
    expect(scout(h)).toBe(b);
    h.act({ type: 'show', pos: 3 }, b); // Only D: a Super-Spark.
    expect(round(h).shown[1]).toMatchObject({ kind: 'super', stars: { [b]: 3, [d]: 3 } });
    expect(h.reject({ type: 'show', pos: 0 }, c)).toBe('already-shown');
    h.act({ type: 'show', pos: 4 }, c); // Nobody else: C falls.
    expect(round(h).fallen).toEqual([c]);
    h.act({ type: 'show', pos: 5 }, d); // D falls too, in the Dark.
    expect(scout(h)).toBe(a);
    h.act({ type: 'show', pos: 1 }, a); // B and fallen D: still a Spark; D fills nothing.
    expect(round(h).shown[4]!.stars).toEqual({ [a]: 2, [b]: 2, [d]: 0 });
    // B has nothing left to show and C and D have fallen: back to A.
    expect(scout(h)).toBe(a);
    h.act({ type: 'show', pos: 2 }, a); // Only fallen D marked it: a Super-Spark for A.
    expect(round(h).shown[5]).toMatchObject({ kind: 'super', stars: { [a]: 3, [d]: 0 } });

    const r = round(h);
    expect(r.stage).toBe('done');
    expect(r.results![a]).toMatchObject({ stars: 7, points: 7, fell: false });
    expect(r.results![b]).toMatchObject({ stars: 7, points: 7 });
    expect(r.results![c]).toMatchObject({ stars: 2, points: 2, fell: true, dark: false });
    // In the Dark and fell: a Spark (2 → 1) and a Super-Spark (3 → 2).
    expect(r.results![d]).toMatchObject({ stars: 5, boxes: 2, dark: true, fell: true, points: 3 });
    expect(h.state.seats[d]!.rounds).toEqual([3]);
  });

  it('scores a Dark player who never fell normally', () => {
    const h = startedGame();
    const [a, b, c, d] = fromFirst(h) as [string, string, string, string];
    markAll(h, { [a]: [0, 1, 2], [b]: [0, 1], [c]: [1, 2], [d]: [0, 2] });
    expect(round(h).dark).toBe(a);
    h.act({ type: 'show', pos: 0 }, a);
    h.act({ type: 'show', pos: 1 }, b);
    h.act({ type: 'show', pos: 2 }, c);
    expect(round(h).stage).toBe('done');
    expect(round(h).results![a]).toMatchObject({ points: 6, dark: true, fell: false });
    expect(round(h).results![b]).toMatchObject({ points: 4 });
  });

  it('makes a Scout with crosses left show one, even when it can only fall', () => {
    const h = startedGame();
    const [a, b, c, d] = fromFirst(h) as [string, string, string, string];
    markAll(h, { [a]: [0], [b]: [0], [c]: [0], [d]: [0, 9] });
    h.act({ type: 'show', pos: 0 }, a);
    expect(scout(h)).toBe(d);
    h.act({ type: 'show', pos: 9 }, d);
    expect(round(h).stage).toBe('done');
    expect(round(h).fallen).toEqual([d]);
  });

  it('ends when everyone has fallen', () => {
    const h = startedGame();
    const order = fromFirst(h);
    markAll(h, Object.fromEntries(order.map((id, i) => [id, [i]])));
    for (const id of order) h.act({ type: 'show', pos: order.indexOf(id) }, id);
    expect(round(h).stage).toBe('done');
    expect(round(h).fallen).toEqual(order);
  });
});

describe('rounds and the end', () => {
  function finishRound(h: ReturnType<typeof startedGame>) {
    const order = fromFirst(h);
    markAll(h, Object.fromEntries(order.map((id) => [id, [0]])));
    h.act({ type: 'show', pos: 0 }, order[0]);
  }

  it('replaces the bottom, middle then top line and moves the First Scout clockwise', () => {
    const h = startedGame();
    const seats = Object.keys(h.state.seats);
    const firsts = [round(h).first];
    const boards = [round(h).board];
    const words = [round(h).word];
    for (let no = 1; no < 4; no++) {
      finishRound(h);
      h.act({ type: 'next-round' });
      firsts.push(round(h).first);
      boards.push(round(h).board);
      words.push(round(h).word);
    }
    const changed = (x: number[], y: number[]) =>
      x.flatMap((card, pos) => (card === y[pos] ? [] : [pos]));
    expect(changed(boards[0]!, boards[1]!)).toEqual([10, 11, 12, 13, 14]);
    expect(changed(boards[1]!, boards[2]!)).toEqual([5, 6, 7, 8, 9]);
    expect(changed(boards[2]!, boards[3]!)).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(boards.flat()).size).toBe(CARDS_PER_GAME);
    expect(round(h).fresh).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < 4; i++) {
      const prev = seats.indexOf(firsts[i - 1]!);
      expect(firsts[i]).toBe(seats[(prev + 1) % seats.length]);
    }
    expect(new Set(words).size).toBe(4);
    finishRound(h);
    h.act({ type: 'next-round' });
    expect(h.state.phase).toBe('over');
    // Everyone sparked the same card every round: a shared win.
    expect(h.state.winners).toHaveLength(4);
    expect(h.state.endReason).toBe('rounds');
  });

  it('starts a new game from the lobby with fresh scores', () => {
    const h = startedGame();
    finishRound(h);
    h.act({ type: 'back-to-lobby' });
    expect(h.state.phase).toBe('lobby');
    h.act({ type: 'start' });
    expect(Object.values(h.state.seats).every((s) => s.rounds.length === 0)).toBe(true);
  });
});

describe('players leaving', () => {
  it('drops a leaver’s slate before the Reveal and passes the First Scout pawn on', () => {
    const h = startedGame([HOST, 'ana', 'ben', 'cy', 'dee']);
    const first = round(h).first;
    leave(h, first);
    expect(round(h).players).not.toContain(first);
    expect(round(h).first).not.toBe(first);
    const order = fromFirst(h);
    markAll(h, Object.fromEntries(order.map((id) => [id, [1]])));
    expect(round(h).stage).toBe('reveal');
  });

  it('announces when the last unlocked player leaves', () => {
    const h = startedGame([HOST, 'ana', 'ben', 'cy', 'dee']);
    const [a, b, c, d, e] = fromFirst(h);
    markAll(h, { [a!]: [1], [b!]: [1], [c!]: [2], [d!]: [3] });
    h.act({ type: 'mark', positions: [4] }, e);
    leave(h, e!);
    expect(round(h).stage).toBe('reveal');
  });

  it('keeps a leaver’s crosses counting mid-Reveal and moves the Scout on', () => {
    const h = startedGame([HOST, 'ana', 'ben', 'cy', 'dee']);
    const [a, b, c, d, e] = fromFirst(h) as [string, string, string, string, string];
    markAll(h, { [a]: [0], [b]: [0, 1], [c]: [1], [d]: [2], [e]: [3] });
    h.act({ type: 'show', pos: 0 }, a);
    expect(scout(h)).toBe(b);
    leave(h, b);
    expect(scout(h)).toBe(c);
    h.act({ type: 'show', pos: 1 }, c); // Gone B marked it: a Super-Spark for C alone.
    expect(round(h).shown.at(-1)).toMatchObject({ kind: 'super', stars: { [c]: 3, [b]: 0 } });
  });

  it('ends the game when fewer than 3 are left', () => {
    const h = startedGame([HOST, 'ana', 'ben']);
    leave(h, 'ben');
    expect(h.state.phase).toBe('over');
    expect(h.state.endReason).toBe('too-few');
  });

  it('gives a returning player their scores back', () => {
    const h = startedGame();
    const order = fromFirst(h);
    markAll(h, Object.fromEntries(order.map((id) => [id, [0]])));
    h.act({ type: 'show', pos: 0 }, order[0]);
    const before = h.state.seats.ana!.rounds;
    leave(h, 'ana');
    h.state = starlight.playerJoined(h.state, { id: 'ana', name: 'ANA' });
    expect(h.state.seats.ana!.rounds).toEqual(before);
    expect(h.state.seats.ana!.playing).toBe(false);
  });
});

describe('timers', () => {
  it('only presses on in strict mode', () => {
    const h = harness(FOUR, 3, content);
    h.act({ type: 'update-settings', clueSeconds: 30, guessSeconds: 20 });
    h.act({ type: 'start' });
    expect(round(h).deadline).toBe(NOW + 30_000);
    expect(starlight.nextDeadline!(h.state)).toBeNull();
  });

  it('locks slates as they are and shows for a slow Scout', () => {
    const h = harness();
    h.act({ type: 'update-settings', clueSeconds: 30, guessSeconds: 20, timerMode: 'strict' });
    h.act({ type: 'start' });
    h.act({ type: 'mark', positions: [2, 3] }, 'ana');
    let state = starlight.onDeadline!(h.state, NOW + 30_000);
    const r = state.round!;
    expect(r.stage).toBe('reveal');
    expect(r.marks.ana).toEqual([2, 3]);
    for (const id of FOUR) expect(r.marks[id]!.length).toBeGreaterThan(0);
    expect(r.autoLocked.sort()).toEqual([...FOUR].sort());
    while (state.round!.stage === 'reveal') {
      const due = starlight.nextDeadline!(state)!;
      expect(due).toBeGreaterThan(0);
      state = starlight.onDeadline!(state, due);
      expect(state.round!.shown.at(-1)!.auto).toBe(true);
    }
    expect(state.round!.stage).toBe('done');
    expect(starlight.nextDeadline!(state)).toBeNull();
  });
});
