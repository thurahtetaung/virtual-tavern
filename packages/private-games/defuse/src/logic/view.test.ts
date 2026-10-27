import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { LIGHTS } from './bomb.ts';
import { setBotMistakes } from './bot.ts';
import { defuse } from './game.ts';
import { ANA, BEN, CHO, must, send, table, wait } from './test-utils.ts';
import type { State } from './types.ts';
import { bombView } from './view.ts';

/**
 * `view()` is the boundary: the defuser gets the bomb as it shows (never what only the manual or
 * the code knows), experts and watchers nothing of it (the clock and strikes only with the host's
 * option), the table screen the manual or the bomb, and everyone everything at the end.
 */

const WATCHER = 'zed';

/** The state with every hidden part of the bomb changed. */
function hiddenChanged(s: State): State {
  const c = structuredClone(s);
  c.seed = (c.seed + 1) >>> 0;
  const b = c.bomb!;
  b.r = (b.r + 12345) >>> 0;
  // The room's surprises: their stream, the next check and what is left never reach a view.
  b.pace = b.pace
    ? { r: (b.pace.r + 99) >>> 0, next: (b.pace.next ?? 0) + 777, left: [...b.pace.left].reverse() }
    : { r: 1, next: 2, left: ['alarm'] };
  for (const m of b.modules) {
    if (m.kind === 'keypad') m.column = (m.column + 1) % 6;
    if (m.kind === 'simon')
      m.sequence = m.sequence.map((x, i) => (i > m.stage ? (x === 'red' ? 'blue' : 'red') : x));
    if (m.kind === 'memory') m.digits = m.digits.map((d, i) => (i === m.stage ? d : (d % 4) + 1));
    if (m.kind === 'wire-sequence') for (const e of m.entries) e.n = (e.n + 3) % 9;
    if (m.kind === 'password') m.word = m.word ? 'ZZZZZ' : '';
    if (m.kind === 'venting-gas' && m.state !== 'running')
      m.question = m.question === 'vent' ? 'detonate' : 'vent';
    if (m.kind === 'wire-sequence')
      m.entries[12] = {
        ...m.entries[12]!,
        colour: m.entries[12]!.colour === 'red' ? 'blue' : 'red',
      };
  }
  return c;
}

/** The state with the whole bomb changed (what experts must never learn). */
function bombChanged(s: State): State {
  const c = hiddenChanged(s);
  const b = c.bomb!;
  b.serial = 'AB1CD2';
  b.widgets = [];
  b.modules = [];
  b.log = [];
  b.timer = { face: 1, anchor: 4 };
  return c;
}

const looks = (s: State, who: string | null) => JSON.stringify(defuse.view(s, who));

const NEEDLES = [
  '"column":',
  '"sequence":',
  '"digits":',
  '"word":',
  '"entries":',
  '"maze":',
  '"pattern":',
  '"r":',
  '"seed":',
  '"pace":',
];

function checkLive(s: State, defuser: string, experts: string[]) {
  if (s.stage !== 'bomb') return;
  const dv = looks(s, defuser);
  for (const n of NEEDLES) expect(dv, `defuser sees ${n}`).not.toContain(n);
  expect(looks(hiddenChanged(s), defuser)).toBe(dv);
  for (const e of [...experts, WATCHER]) {
    const v = defuse.view(s, e);
    expect(v.bomb).toBeNull();
    expect(JSON.stringify(v)).not.toContain(s.bomb!.serial);
    if (!s.settings.expertsSeeClock) expect(looks(bombChanged(s), e)).toBe(JSON.stringify(v));
    else expect(v.clock).not.toBeNull();
    expect(v.claims).not.toBeNull();
  }
  // The table screen: the manual by default, the defuser's bomb with the host's choice.
  const stage = defuse.view(s, null);
  if (s.settings.table === 'manual') expect(stage.bomb).toBeNull();
  else expect(JSON.stringify(stage.bomb)).toBe(JSON.stringify(defuse.view(s, defuser).bomb));
  expect(defuse.view(s, defuser).claims).toBeNull();
  expect(defuse.view(s, defuser).notes).toBeNull();
}

describe('view boundary', () => {
  it('every viewer at every stage', () => {
    for (const table_ of ['manual', 'bomb'] as const) {
      for (const clock of [false, true]) {
        const t = table([ANA, BEN, CHO], 7, {
          modules: 11,
          needy: true,
          table: table_,
          expertsSeeClock: clock,
        });
        t.state = defuse.playerJoined(t.state, { id: WATCHER, name: 'Zed' });
        // Lobby: nobody sees a bomb.
        for (const v of [ANA, BEN, WATCHER, null]) expect(defuse.view(t.state, v).bomb).toBeNull();
        must(t, ANA, { type: 'start' });
        must(t, BEN, { type: 'claim', page: 'wires', on: true });
        must(t, BEN, { type: 'note', page: 'wires', text: 'odd serial' });
        checkLive(t.state, ANA, [BEN, CHO]); // in the dark
        wait(t, LIGHTS.clock + 1000);
        checkLive(t.state, ANA, [BEN, CHO]);
        wait(t, 100_000); // needy modules running
        checkLive(t.state, ANA, [BEN, CHO]);
        wait(t, 600_000);
        expect(t.state.stage).toBe('result');
        // The end: everyone sees all of it, hidden parts included.
        for (const v of [ANA, BEN, CHO, WATCHER, null]) {
          const view = defuse.view(t.state, v);
          expect(view.bomb).not.toBeNull();
          expect(JSON.stringify(view.bomb)).toBe(JSON.stringify(bombView(t.state.bomb!, true)));
          expect(JSON.stringify(view)).toMatch(/"(word|maze|column|sequence|digits)":/);
          expect(JSON.stringify(view)).not.toContain('"r":');
        }
      }
    }
  });

  it('a 1,000-bomb seeded fuzz never leaks', () => {
    setBotMistakes(0.3);
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      const modules = 3 + rng.int(9);
      const t = table([ANA, BEN, CHO], seed, {
        modules,
        needy: rng.next() < 0.6,
        hardcore: rng.next() < 0.2,
        table: rng.next() < 0.5 ? 'manual' : 'bomb',
        expertsSeeClock: rng.next() < 0.5,
        time: 30 * (1 + rng.int(20)),
      });
      must(t, ANA, { type: 'start' });
      wait(t, LIGHTS.clock);
      for (let i = 0; i < 60 && t.state.stage === 'bomb'; i++) {
        const v = defuse.view(t.state, ANA);
        const move = defuse.bot!(v, {
          me: ANA,
          now: t.now + 30_000,
          rng: createRng(seed * 97 + i),
          words: () => [],
        });
        if (move && move.type !== 'ponder') send(t, ANA, move);
        if (rng.next() < 0.2) send(t, BEN, { type: 'claim', page: 'maze', on: rng.next() < 0.5 });
        if (i % 7 === 0) checkLive(t.state, ANA, [BEN, CHO]);
        wait(t, 300 + rng.int(4000));
      }
      checkLive(t.state, ANA, [BEN, CHO]);
    }
    setBotMistakes(1 / 8);
  }, 120_000);
});
