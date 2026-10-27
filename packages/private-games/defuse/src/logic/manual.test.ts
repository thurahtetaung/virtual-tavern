import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { LIGHTS } from './bomb.ts';
import { defuseBot, setBotMistakes } from './bot.ts';
import { defuse } from './game.ts';
import { VENN_QUESTION, vennCutFor, vennCutWith, vennLetter } from './helpers.ts';
import { vennCut } from './modules.ts';
import { PRINTED, PRINTED_SEED, rulesFor } from './rules.ts';
import { ANA, BEN, CHO, must, send, table, wait } from './test-utils.ts';
import type { State } from './types.ts';

// The different manual as a room option: the host only picks printed, new each bomb or the same
// all night; the server draws the seed and keeps it, and no view ever carries it.

const seedIn = (s: State) => s.bomb?.manual ?? null;

/** No view holds the seed: neither as a number under "manual" nor anywhere as the bare number. */
function noSeed(s: State, seed: number) {
  for (const who of [ANA, BEN, CHO, 'zed', null]) {
    const text = JSON.stringify(defuse.view(s, who));
    expect(text).not.toMatch(/"manual":\d/);
    expect(text).not.toMatch(/"nightManual"/);
    expect(text).not.toContain(String(seed));
  }
}

describe('the different manual', () => {
  it('the printed manual by default: bombs follow seed 1 and nobody gets rules', () => {
    const t = table([ANA, BEN]);
    must(t, ANA, { type: 'start' });
    expect(seedIn(t.state)).toBe(PRINTED_SEED);
    expect(defuse.view(t.state, BEN).manual).toBeNull();
  });

  it('new manual each bomb: a fresh seed every bomb, the experts’ manual follows it', () => {
    const t = table([ANA, BEN, CHO], 4, { manual: 'each' });
    const seeds: number[] = [];
    for (let i = 0; i < 3; i++) {
      must(t, ANA, { type: i ? 'next' : 'start' });
      const seed = seedIn(t.state)!;
      expect(seed).not.toBe(PRINTED_SEED);
      seeds.push(seed);
      // Experts and watchers read the bomb's manual; the defuser never does while it ticks.
      const defuser = t.state.defuser!;
      const expert = [ANA, BEN, CHO].find((p) => p !== defuser)!;
      expect(defuse.view(t.state, expert).manual).toEqual(rulesFor(seed));
      expect(defuse.view(t.state, null).manual).toEqual(rulesFor(seed));
      expect(defuse.view(t.state, defuser).manual).toBeNull();
      noSeed(t.state, seed);
      wait(t, 10 * 60_000);
      // At the end the defuser may read the manual they were playing.
      expect(defuse.view(t.state, defuser).manual).toEqual(rulesFor(seed));
      noSeed(t.state, seed);
    }
    expect(new Set(seeds).size).toBe(3);
  });

  it('same manual all night: drawn once, kept every bomb, redrawn only when the host changes it', () => {
    const t = table([ANA, BEN], 5, { manual: 'night' });
    const night = t.state.nightManual!;
    expect(night).not.toBe(PRINTED_SEED);
    // The lobby already shows the night's manual to the readers.
    expect(defuse.view(t.state, BEN).manual).toEqual(rulesFor(night));
    noSeed(t.state, night);
    for (let i = 0; i < 3; i++) {
      must(t, ANA, { type: i ? 'next' : 'start' });
      expect(seedIn(t.state)).toBe(night);
      wait(t, 10 * 60_000);
    }
    must(t, ANA, { type: 'settings', settings: { helpers: true } });
    expect(t.state.nightManual).toBe(night);
    must(t, ANA, { type: 'settings', settings: { manual: 'printed' } });
    expect(t.state.nightManual).toBeNull();
    must(t, ANA, { type: 'settings', settings: { manual: 'night' } });
    expect(t.state.nightManual).not.toBe(night);
  });

  it('the seed is never a setting a player can send', () => {
    for (const bad of [{ manual: 'seed' }, { manual: 42 }, { nightManual: 7 }]) {
      const r = defuse.actionSchema.safeParse({ type: 'settings', settings: bad });
      if (r.success) expect(r.data).toEqual({ type: 'settings', settings: {} });
    }
  });

  it('a bot defuser plays by the manual its bomb follows', () => {
    const t = table([ANA, BEN], 9, { manual: 'each', modules: 5 });
    must(t, ANA, { type: 'start' });
    wait(t, LIGHTS.clock);
    setBotMistakes(0);
    for (let i = 0; i < 1000 && t.state.stage === 'bomb'; i++) {
      const v = defuse.view(t.state, t.state.defuser);
      const move = defuseBot(v, {
        me: t.state.defuser!,
        now: t.now,
        rng: createRng(i),
        words: () => [],
      });
      if (move && move.type !== 'ponder') send(t, t.state.defuser!, move);
      wait(t, 250);
    }
    setBotMistakes(1 / 8);
    // Without its deliberate mistakes it defuses the bomb by the different manual, strike-free.
    expect(t.state.history.at(-1)).toMatchObject({ how: 'defused', strikes: 0 });
  });
});

describe('the experts’ helpers', () => {
  it('the wire lookup agrees with the module, for the printed manual and seeds', () => {
    for (const rules of [PRINTED, rulesFor(2), rulesFor(418)])
      for (const red of [false, true])
        for (const blue of [false, true])
          for (const star of [false, true])
            for (const led of [false, true]) {
              const w = { red, blue, star, led };
              const colour = red && blue ? 'red-blue' : red ? 'red' : blue ? 'blue' : 'white';
              const wire = { slot: 0, colour, led, star, cut: false } as const;
              for (const serial of ['AB1CD2', 'AB1CD3']) {
                const info = { serial, widgets: [], strikes: 0, timerText: () => '', rules };
                expect(vennCutFor(w, rules, serial, [])).toBe(vennCut(wire, info));
              }
              const letter = vennLetter(w, rules);
              if (letter === 'C' || letter === 'D') expect(VENN_QUESTION[letter]).toBeNull();
              expect(vennCutWith(letter, true)).toBe(letter !== 'D');
            }
  });
});
