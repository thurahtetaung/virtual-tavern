import {
  type AwardRule,
  type GameEvents,
  type InsightEvent,
  TONES,
  fixtureGame,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { echoAwards } from './awards.ts';
import { echo } from './game.ts';
import { insights } from './insights.ts';
import { FOUR, HOST, NOW, secret, startedGame, turn } from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = echoAwards.rules.find((x) => x.id === `echo.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);

const card = (guesser: string, outcome: string, props: Record<string, unknown> = {}) =>
  recapEv('card', guesser, { word: 'moon', outcome, clueCount: 3, cancelledCount: 0, ...props });
const match = (a: string, b: string, word = 'tide') => recapEv('match', null, { a, b, word });
const game = (...events: Parameters<typeof fixtureGame>[0]) =>
  fixtureGame(events, { players: ['a', 'b', 'c', 'd', 'e'] });

describe('echo awards', () => {
  it('ships copy for every rule in both tones, short and clean', () => {
    for (const r of echoAwards.rules) {
      for (const tone of TONES) {
        expect(r.copy[tone].length, `${r.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, {
            players: ['x'],
            value: 12,
            params: { w: 'w'.repeat(10), s: 3.4 },
          })
            .replace(/\{p:[^}]+\}/g, 'N'.repeat(12))
            .replace(/\{\w+:[^}]+\}/g, 'L'.repeat(10));
          expect(text.length, `${r.id}: ${text}`).toBeLessThanOrEqual(70);
          expect(text).not.toMatch(
            /stupid|idiot|dumb|worst|loser|fail|trash|choke|carried|useless/i,
          );
        }
      }
    }
  });

  it('Shared Brain Cell: the pair that echoed most', () => {
    expect(
      run('shared-brain-cell', game(match('a', 'b'), match('b', 'a', 'sea'), match('c', 'd'))),
    ).toMatchObject([{ players: ['a', 'b'], value: 2, runnerUp: 1, params: { w: 'sea' } }]);
    expect(run('shared-brain-cell', game(match('a', 'b'), match('c', 'd')))).toEqual([]);
    expect(run('shared-brain-cell', game(card('a', 'right')))).toEqual([]);
  });

  it('Cancel Culture needs two cancels, and shares ties', () => {
    expect(run('cancel-culture', game(match('a', 'b'), match('a', 'b')))).toMatchObject([
      { players: ['a', 'b'], value: 2 },
    ]);
    expect(run('cancel-culture', game(match('a', 'b')))).toEqual([]);
  });

  it('Clue MVP and Lone Survivor read the survivors', () => {
    const g = game(
      card('a', 'right', { survivors: ['b', 'c'] }),
      card('b', 'right', { survivors: ['c'] }),
      card('c', 'wrong', { survivors: ['b'] }),
    );
    expect(run('clue-mvp', g)).toMatchObject([{ players: ['c'], value: 2 }]);
    expect(run('lone-survivor', g)).toMatchObject([{ players: ['c'], value: 1 }]);
    // Old events have no survivors: no candidate, no throw.
    const old = game(card('a', 'right'), card('b', 'right'));
    expect(run('clue-mvp', old)).toEqual([]);
    expect(run('lone-survivor', old)).toEqual([]);
    expect(run('wordsmith', old)).toEqual([]);
  });

  it('Bullseye, Brave Guesser and Safety First count outcomes', () => {
    const g = game(
      card('a', 'right'),
      card('a', 'right'),
      card('b', 'wrong'),
      card('c', 'pass'),
      card('c', 'pass'),
      card('d', 'pass', { auto: true }),
      card('d', 'pass', { auto: true }),
    );
    expect(run('bullseye', g)).toMatchObject([{ players: ['a'], value: 2 }]);
    expect(run('brave-guesser', g)).toMatchObject([{ players: ['b'], value: 1 }]);
    expect(run('safety-first', g)).toMatchObject([{ players: ['c'], value: 2 }]);
    expect(run('bullseye', game(card('a', 'right')))).toEqual([]);
  });

  it('drops a tie of four or more', () => {
    const g = game(...['a', 'b', 'c', 'd'].map((p) => card(p, 'wrong')));
    expect(run('brave-guesser', g)).toEqual([]);
    const three = game(...['a', 'b', 'c'].map((p) => card(p, 'wrong')));
    expect(run('brave-guesser', three)).toMatchObject([{ players: ['a', 'b', 'c'], value: 1 }]);
  });

  it('Quick Study', () => {
    const g = game(
      card('a', 'right', { actMs: 9000 }),
      card('c', 'right', { actMs: 3200 }),
      card('d', 'right', { actMs: 1000, auto: true }),
    );
    expect(run('quick-study', g)).toMatchObject([{ players: ['c'], params: { s: 3.2 } }]);
  });

  it('Wordsmith: the longest surviving clue', () => {
    const g = game(
      card('a', 'right', { survivors: ['b', 'c'], survivorWords: ['lighthouse', 'sea'] }),
    );
    expect(run('wordsmith', g)).toMatchObject([
      { players: ['b'], value: 10, params: { w: 'lighthouse' } },
    ]);
  });

  it('moments: total eclipse, buzzer beater, a chorus, a perfect game', () => {
    expect(
      run('total-eclipse', game(card('a', 'pass', { clueCount: 3, cancelledCount: 3 }))),
    ).toMatchObject([{ players: ['a'], value: 3 }]);
    expect(run('total-eclipse', game(card('a', 'pass', { cancelledCount: 2 })))).toEqual([]);
    const last = game(card('a', 'right'), recapEv('outcome', null, { score: 1 }));
    expect(run('buzzer-beater', last)).toMatchObject([{ players: ['a'], value: 1 }]);
    const chorus = game(
      card('a', 'pass'),
      match('b', 'c', 'Sun'),
      match('b', 'd', 'Sun'),
      match('c', 'd', 'Sun'),
    );
    expect(run('big-cancel', chorus)).toMatchObject([
      { players: ['b', 'c', 'd'], value: 3, params: { w: 'Sun' } },
    ]);
    const perfect = game(recapEv('outcome', null, { score: 8, deckSize: 8 }));
    expect(run('perfect-echo', perfect)).toMatchObject([
      { players: ['a', 'b', 'c', 'd', 'e'], value: 8 },
    ]);
    expect(run('perfect-echo', game(recapEv('outcome', null, { score: 7, deckSize: 8 })))).toEqual(
      [],
    );
  });

  it('nuggets and history', () => {
    const g = game(
      card('a', 'right', { actMs: 2000 }),
      card('b', 'right'),
      card('c', 'right'),
      card('a', 'wrong'),
    );
    const texts = echoAwards.nuggets.flatMap((n) => n.compute([g])?.text ?? []);
    expect(texts).toContain('75% of guesses right');
    expect(texts).toContain('Longest run: 3 right in a row');
    expect(echoAwards.history!(g)[0]).toBe('Card 1 · {p:a} on "moon": right');
    const long = game(...Array.from({ length: 20 }, () => card('a', 'right')));
    expect(echoAwards.history!(long)).toHaveLength(12);
  });

  it('works on a real game played through the engine', () => {
    const h = startedGame(FOUR);
    const events: InsightEvent[] = [];
    const act = h.act.bind(h);
    h.act = (action, by = HOST, now = NOW) => {
      const before = h.state;
      const after = act(action, by, now);
      events.push(...insights(before, after, action, by));
      return after;
    };
    // First card: two writers echo each other, the guesser still gets it from the third clue.
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['Moon'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['moons'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['lighthouse'] }, 'p4');
    h.act({ type: 'guess', word: secret(h) });
    h.act({ type: 'next-card' });
    while (h.state.phase === 'playing') {
      h.act({ type: 'pick', index: 0 }, turn(h).guesser);
      turn(h).givers.forEach((g, i) =>
        h.act({ type: 'give-clues', clues: [['apple', 'river', 'candle'][i]!] }, g),
      );
      h.act({ type: 'guess', word: secret(h) }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    expect(echo.awards).toBe(echoAwards);
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: FOUR },
    );
    expect(run('shared-brain-cell', g)).toMatchObject([{ players: ['p2', 'p3'] }]);
    expect(run('lone-survivor', g)).toMatchObject([{ players: ['p4'] }]);
    expect(run('perfect-echo', g)).toMatchObject([{ players: FOUR, value: 8 }]);
    // Everyone guessed two cards right: a four-way tie singles nobody out.
    expect(run('bullseye', g)).toEqual([]);
    const lines = echoAwards.history!(g);
    expect(lines).toHaveLength(8);
    expect(lines[0]).toMatch(/^Card 1 · \{p:host\} on ".+": right$/);
    for (const r of echoAwards.rules)
      expect(() => r.compute?.(g) ?? r.computeNight?.([g])).not.toThrow();
  });
});
