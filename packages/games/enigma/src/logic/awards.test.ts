import {
  type AwardCandidate,
  type GameEvents,
  type RecapEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { enigmaAwards } from './awards.ts';
import { insights } from './insights.ts';
import {
  BLUE,
  HOST,
  RED,
  decoders,
  members,
  sendClues,
  startedGame,
  tx,
  vote,
  wrongCode,
} from './test-utils.ts';
import type { EnigmaAction, Team } from './types.ts';

const PLAYERS = ['r1', 'r2', 'b1', 'b2'];
const rule = (id: string) => {
  const r = enigmaAwards.rules.find((x) => x.id === `enigma.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents): AwardCandidate[] => rule(id).compute!(g);
const game = (events: RecapEvent[]) => fixtureGame(events, { players: PLAYERS });

const decode = (team: string, round: number, success: boolean, props = {}) =>
  recapEv('decode', null, { success, team, round, expired: false, ...props });
const intercept = (team: string, round: number, success: boolean, props = {}) =>
  recapEv('intercept', null, { success, team, round, ...props });
const clues = (by: string, words: string[], team = 'red', props = {}) =>
  recapEv('clues', by, { clues: words, team, round: 1, ...props });

/** Four clean rounds for both teams, nobody intercepted. */
const quietRounds = (n = 4) =>
  Array.from({ length: n }, (_, i) => [
    decode('red', i + 1, true, { encryptor: 'r1', voters: ['r2'] }),
    decode('blue', i + 1, true, { encryptor: 'b1', voters: ['b2'] }),
  ]).flat();

describe('enigma awards', () => {
  it('ships copy for every rule in both tones', () => {
    for (const r of enigmaAwards.rules) {
      expect(r.copy.cheeky.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.copy.wholesome.length, r.id).toBeGreaterThanOrEqual(2);
      expect(typeof r.compute, r.id).toBe('function');
    }
  });

  it('Crystal Clear: two or more decodes and no misses', () => {
    const ok = [
      decode('red', 1, true, { encryptor: 'r1' }),
      decode('red', 2, true, { encryptor: 'r1' }),
    ];
    expect(run('crystal-clear', game(ok))).toMatchObject([{ players: ['r1'], value: 2 }]);
    expect(run('crystal-clear', game(ok.slice(1)))).toEqual([]);
    expect(
      run('crystal-clear', game([...ok, decode('red', 3, false, { encryptor: 'r1' })])),
    ).toEqual([]);
    // Old events lack the encryptor.
    expect(run('crystal-clear', game([decode('red', 1, true), decode('red', 2, true)]))).toEqual(
      [],
    );
  });

  it('Open Book and Code Cracker: interceptions by sender and by voters', () => {
    const events = [
      intercept('blue', 2, true, { encryptor: 'r1', voters: ['b1', 'b2'] }),
      intercept('blue', 3, true, { encryptor: 'r1', voters: ['b1'] }),
    ];
    expect(run('open-book', game(events))).toMatchObject([{ players: ['r1'], value: 2 }]);
    expect(run('code-cracker', game(events))).toMatchObject([
      { players: ['b1'], value: 2, runnerUp: 1 },
    ]);
    expect(run('open-book', game([intercept('blue', 2, false, { encryptor: 'r1' })]))).toEqual([]);
    expect(run('code-cracker', game([intercept('blue', 2, true)]))).toEqual([]);
  });

  it('Lost in Translation and Radio Silence tell misses from timeouts', () => {
    const miss = decode('red', 1, false, { encryptor: 'r1' });
    const late = decode('red', 2, false, { encryptor: 'r2', expired: true });
    expect(run('lost-in-translation', game([miss, late]))).toMatchObject([{ players: ['r1'] }]);
    expect(run('radio-silence', game([miss, late]))).toMatchObject([{ players: ['r2'] }]);
    expect(rule('radio-silence').stripOnly).toBe(true);
    expect(run('lost-in-translation', game([decode('red', 1, false)]))).toEqual([]);
  });

  it('Codebreakers: the team with more interceptions, named with its players', () => {
    const events = [
      decode('red', 1, true, { encryptor: 'r1', voters: ['r2'] }),
      decode('blue', 1, true, { encryptor: 'b1', voters: ['b2'] }),
      intercept('red', 2, true),
      intercept('red', 3, true),
      intercept('blue', 3, true),
    ];
    expect(run('codebreakers', game(events))).toMatchObject([
      { players: ['r1', 'r2'], value: 2, runnerUp: 1, params: { team: 'Red' } },
    ]);
    // A tie names nobody.
    expect(run('codebreakers', game(events.slice(0, 3).concat(events[4]!)))).toEqual([]);
  });

  it('Unbreakable and Perfect Record need four rounds', () => {
    const four = quietRounds(4);
    expect(run('unbreakable', game(four)).map((c) => c.params?.team)).toEqual(['Red', 'Blue']);
    expect(run('perfect-record', game(four)).map((c) => c.params?.team)).toEqual(['Red', 'Blue']);
    expect(run('unbreakable', game(quietRounds(3)))).toEqual([]);
    const leaky = [...four, intercept('blue', 4, true), decode('blue', 5, false)];
    expect(run('unbreakable', game(leaky)).map((c) => c.params?.team)).toEqual(['Blue']);
    expect(run('perfect-record', game(leaky)).map((c) => c.params?.team)).toEqual(['Red']);
  });

  it('First Blood and the round-two snipe', () => {
    const events = [
      intercept('blue', 2, false),
      intercept('red', 2, true),
      intercept('blue', 3, true),
    ];
    expect(run('first-blood', game(events))).toMatchObject([{ value: 2, params: { team: 'Red' } }]);
    expect(run('early-intercept', game(events))).toMatchObject([{ params: { team: 'Red' } }]);
    expect(
      run('first-blood', game([intercept('red', 2, true), intercept('blue', 2, true)])),
    ).toEqual([]);
    expect(run('early-intercept', game([intercept('red', 3, true)]))).toEqual([]);
  });

  it('Speed and Slow Cipher compare mean encryption times', () => {
    const events = [
      clues('r1', ['a'], 'red', { actMs: 10_000 }),
      clues('r1', ['b'], 'red', { actMs: 20_000 }),
      clues('b1', ['c'], 'blue', { actMs: 60_000 }),
      clues('b1', ['d'], 'blue', { actMs: 80_000 }),
    ];
    expect(run('speed-cipher', game(events))).toMatchObject([
      { players: ['r1'], params: { s: 15 } },
    ]);
    expect(run('slow-cipher', game(events))).toMatchObject([
      { players: ['b1'], params: { s: 70 } },
    ]);
    expect(run('speed-cipher', game(events.slice(0, 1)))).toEqual([]);
  });

  it('Clue Recycler and Big Words Energy', () => {
    const events = [clues('r1', ['Ocean', 'x', 'y']), clues('r1', ['ocean ', 'z', 'w'])];
    expect(run('clue-recycler', game(events))).toMatchObject([
      { players: ['r1'], params: { w: 'ocean' } },
    ]);
    expect(run('clue-recycler', game(events.slice(0, 1)))).toEqual([]);
    const long = [clues('b1', ['seventeen', 'abundance']), clues('b1', ['luminous', 'cathedral'])];
    expect(run('big-words', game([...events, ...long]))).toMatchObject([
      { players: ['b1'], value: 8.8 },
    ]);
    expect(run('big-words', game(events))).toEqual([]);
  });

  it('moments: photo finish, draw and double whammy', () => {
    const score = recapEv('outcome', null, { winner: 'red', round: 8, reason: 'score' });
    expect(run('photo-finish', game([score]))).toMatchObject([{ value: 8 }]);
    expect(
      run('photo-finish', game([recapEv('outcome', null, { winner: 'red', round: 3 })])),
    ).toEqual([]);
    expect(
      run('draw', game([recapEv('outcome', null, { winner: 'draw', round: 8 })])),
    ).toMatchObject([{ players: [], value: 8 }]);
    const whammy = [decode('red', 3, false, { encryptor: 'r1' }), intercept('blue', 3, true)];
    expect(run('double-whammy', game(whammy))).toMatchObject([{ players: ['r1'], value: 3 }]);
    expect(run('double-whammy', game([whammy[0]!, intercept('blue', 2, true)]))).toEqual([]);
  });

  it('nuggets and history', () => {
    const g = game([
      clues('r1', ['ocean', 'ocean', 'lighthouse'], 'red', { actMs: 4000 }),
      decode('red', 1, true, { encryptor: 'r1' }),
      decode('blue', 1, false, { encryptor: 'b1' }),
      decode('red', 2, true, { encryptor: 'r2' }),
      intercept('red', 2, true),
      decode('blue', 2, false, { encryptor: 'b2' }),
    ]);
    const texts = enigmaAwards.nuggets.map((n) => n.compute([g])?.text);
    expect(texts).toContain('2 rounds played');
    expect(texts).toContain('1 intercepts · 2 misses');
    expect(texts).toContain('Most used clue: "ocean" ×2');
    expect(texts).toContain('Longest clue: "lighthouse"');
    expect(enigmaAwards.history!(g)).toEqual([
      'Round 1: Red ({p:r1}) decoded · Blue ({p:b1}) missed',
      'Round 2: Red ({p:r2}) decoded · Blue ({p:b2}) missed, intercepted',
    ]);
  });

  it('never throws on events missing their props', () => {
    const g = game(['clues', 'decode', 'intercept', 'outcome'].map((t) => recapEv(t, 'r1')));
    for (const r of enigmaAwards.rules) expect(() => r.compute!(g), r.id).not.toThrow();
    for (const n of enigmaAwards.nuggets) expect(() => n.compute([g]), n.id).not.toThrow();
    expect(() => enigmaAwards.history!(g)).not.toThrow();
  });
});

describe('enigma awards on a real game', () => {
  it('reads what insights() reports', () => {
    const h = startedGame();
    const events: RecapEvent[] = [];
    const act = h.act.bind(h);
    h.act = (action: EnigmaAction, by = HOST, now?: number) => {
      const before = h.state;
      const after = act(action, by, now);
      events.push(...insights(before, after, action, by).map((e) => recapEventOf(e)));
      return after;
    };
    // Red intercepts every round from round 2 and wins in round 3.
    while (h.state.phase === 'playing') {
      sendClues(h, 'red');
      sendClues(h, 'blue');
      for (const team of ['red', 'blue'] as const) {
        const t = tx(h, team);
        vote(h, team, decoders(h, team), t.code);
        if (h.state.round >= 2) {
          const rival: Team = team === 'red' ? 'blue' : 'red';
          vote(h, team, members(rival), team === 'blue' ? t.code : wrongCode(t.code));
        }
      }
      h.act({ type: 'next-round' });
    }
    const g = fixtureGame(events, { players: [...RED, ...BLUE] });
    expect(run('codebreakers', g)).toMatchObject([
      { players: [...RED].sort(), value: 2, params: { team: 'Red' } },
    ]);
    expect(
      run('code-cracker', g)
        .flatMap((c) => c.players)
        .every((p) => RED.includes(p)),
    ).toBe(true);
    expect(
      run('open-book', g)
        .flatMap((c) => c.players)
        .every((p) => BLUE.includes(p)),
    ).toBe(true);
    expect(run('first-blood', g)).toMatchObject([{ value: 2, params: { team: 'Red' } }]);
    expect(events.findLast((e) => e.type === 'outcome')?.props).toMatchObject({
      reason: 'intercepts',
    });
    const lines = enigmaAwards.history!(g);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toMatch(
      /^Round 2: Red \(\{p:\w+\}\) decoded · Blue \(\{p:\w+\}\) decoded, intercepted$/,
    );
  });
});
