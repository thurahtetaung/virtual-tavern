import { describe, expect, it } from 'vitest';
import { CARD_COUNTS, CARD_SETS, EXTRA_CARDS, SET_IDS, poolOf } from './cards.ts';
import { seance } from './game.ts';
import { startProblem, tableCards } from './setup.ts';
import { HOST, harness, startedGame, toFinal } from './test-utils.ts';
import { DIFFICULTIES, MAX_PLAYERS, MIN_PLAYERS, type SeanceState, actionSchema } from './types.ts';

/** Suspects and places past the sets' 31 are the extra ones. */
const isExtra = (n: number) => n > 31;

describe('extra suspects and places: card numbers', () => {
  it('20 suspects and 20 places, numbered on after the sets’ 31, with no objects or stories', () => {
    expect(EXTRA_CARDS.suspect).toEqual(Array.from({ length: 20 }, (_, i) => 32 + i));
    expect(EXTRA_CARDS.place).toEqual(EXTRA_CARDS.suspect);
    expect(EXTRA_CARDS.object).toEqual([]);
    expect(EXTRA_CARDS.story).toEqual([]);
    expect(EXTRA_CARDS.vision).toEqual([]);
    for (const kind of ['suspect', 'place'] as const) {
      const sets = SET_IDS.flatMap((s) => [...CARD_SETS[s][kind]]);
      expect(Math.max(...sets)).toBe(31);
      expect(CARD_COUNTS[kind]).toBe(sets.length + EXTRA_CARDS[kind].length);
    }
  });

  it('join the suspects and places only when on', () => {
    expect(poolOf([...SET_IDS], 'suspect')).toHaveLength(31);
    expect(poolOf([...SET_IDS], 'suspect', [], true)).toHaveLength(51);
    expect(poolOf([...SET_IDS], 'place', [], true)).toHaveLength(51);
    expect(poolOf([...SET_IDS], 'object', [], true)).toHaveLength(32);
    expect(poolOf([...SET_IDS], 'story', [], true)).toHaveLength(20);
    expect(poolOf([...SET_IDS], 'vision', [], true)).toHaveLength(173);
  });
});

describe('extra suspects and places: settings', () => {
  it('are off in a new lobby and the host switches them', () => {
    const h = harness(4);
    expect(h.state.settings.extras).toBe(false);
    h.act({ type: 'update-settings', extras: true });
    expect(h.state.settings.extras).toBe(true);
    expect(seance.view(h.state, HOST).settings.extras).toBe(true);
    expect(actionSchema.safeParse({ type: 'update-settings', extras: 'yes' }).success).toBe(false);
  });

  it('every player count and difficulty can start, with and without them', () => {
    const base = harness(4).state.settings;
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const seats = Array.from({ length: n }, (_, i) => ({
        id: `p${i}`,
        playing: true,
        volunteer: false,
      }));
      for (const difficulty of DIFFICULTIES)
        for (const extras of [false, true])
          for (const third of ['object', 'story'] as const)
            expect(startProblem({ ...base, difficulty, extras, third }, seats)).toBeNull();
    }
  });

  it('cannot make up for missing objects on their own', () => {
    const seats = ['a', 'b', 'c', 'd'].map((id) => ({ id, playing: true, volunteer: false }));
    const settings = { ...harness(4).state.settings, sets: ['promo' as const], extras: true };
    expect(startProblem(settings, seats)).toMatch(/object/);
  });
});

describe('extra suspects and places: in play', () => {
  it('stay off the table by default', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const g = startedGame(7, { difficulty: 'hard' }, seed).game();
      for (const pillar of ['suspect', 'place'] as const)
        expect(g.table[pillar].some(isExtra)).toBe(false);
    }
  });

  it('when on, the table draws from all 51, and the line-up can mix them with the rest', () => {
    let mixed = false;
    let seen = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const h = startedGame(7, { difficulty: 'hard', extras: true }, seed);
      const g = h.game();
      expect(g.table.suspect).toHaveLength(tableCards('hard', 7));
      expect(g.table.object.every((n) => n <= CARD_COUNTS.object)).toBe(true);
      for (const pillar of ['suspect', 'place'] as const) {
        expect(g.table[pillar].every((n) => n >= 1 && n <= 51)).toBe(true);
        seen += g.table[pillar].filter(isExtra).length;
      }
      if (mixed) continue;
      toFinal(h);
      // The line-up is every psychic's three found cards: an extra card is found like any other.
      const found = h.game().psychics.map((p) => p.found);
      expect(found.every((f, i) => f.join() === h.game().psychics[i]!.targets.join())).toBe(true);
      const cards = found.flatMap((f) => f.slice(0, 2));
      if (cards.some(isExtra) && cards.some((n) => !isExtra(n))) mixed = true;
    }
    expect(seen).toBeGreaterThan(0);
    expect(mixed).toBe(true);
  });
});

describe('extra suspects and places: rooms saved before them', () => {
  function old(state: SeanceState): SeanceState {
    const { extras: _e, ...settings } = state.settings;
    return JSON.parse(JSON.stringify({ ...state, settings })) as SeanceState;
  }

  it('load with them off and start without them', () => {
    const h = startedGame(7, { difficulty: 'hard' });
    h.act({ type: 'back-to-lobby' }, HOST);
    h.state = old(h.state);
    expect(h.state.settings.extras).toBeUndefined();
    expect(seance.view(h.state, HOST).settings.extras).toBe(false);
    h.act({ type: 'start' });
    for (const pillar of ['suspect', 'place'] as const)
      expect(h.game().table[pillar].some(isExtra)).toBe(false);
  });
});
