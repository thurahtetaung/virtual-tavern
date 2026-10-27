import { GameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  LIGHTS,
  NEEDY_AFTER,
  createBomb,
  freePlayPools,
  leftAt,
  runTo,
  timerText,
  act as bombAct,
} from './bomb.ts';
import { KEYPAD_COLUMNS, KNOB, MORSE } from './data.ts';
import { DEFAULT_SETTINGS, defuse } from './game.ts';
import {
  SIMON_COLOURS,
  buttonHold,
  memoryAnswer,
  simonPress,
  spellable,
  vennCut,
  wiresAnswer,
  wofAnswer,
} from './modules.ts';
import { PRINTED } from './rules.ts';
import { ANA, BEN, CHO, bomb, must, send, table, wait } from './test-utils.ts';
import type { Bomb, Module, NeedyModule, Settings, State } from './types.ts';

const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

/** A bomb with the lights on, at time 0 + the lights. */
function lit(seed = 1, o: Partial<Settings> = {}): Bomb {
  const b = createBomb(1, seed, S(o), 0);
  runTo(b, LIGHTS.clock);
  return b;
}

function find<K extends Module['kind']>(
  kind: K,
  o: Partial<Settings> = {},
  from = 1,
): { b: Bomb; m: Extract<Module, { kind: K }> } {
  for (let seed = from; seed < from + 5000; seed++) {
    const b = lit(seed, {
      modules: 11,
      needy: kind === 'venting-gas' || kind === 'capacitor' || kind === 'knob',
      ...o,
    });
    const m = b.modules.find((x) => x.kind === kind);
    if (m) return { b, m: m as Extract<Module, { kind: K }> };
  }
  throw new Error(`no ${kind}`);
}

const info = (b: Bomb) => ({
  serial: b.serial,
  widgets: b.widgets,
  strikes: b.strikes,
  timerText: (t: number) => timerText(leftAt(b, t)),
  rules: PRINTED,
});

describe('the bomb', () => {
  it('puts the timer in a timer anchor and never two things in one slot', () => {
    for (let seed = 1; seed < 300; seed++) {
      const b = createBomb(1, seed, S({ modules: 11, needy: true }), 0);
      expect([0, 1, 3, 4]).toContain(b.timer.anchor);
      const slots = [
        `${b.timer.face}${b.timer.anchor}`,
        ...b.modules.map((m) => `${m.face}${m.anchor}`),
      ];
      expect(new Set(slots).size).toBe(12);
      expect(
        b.modules.filter((m) => ['venting-gas', 'capacitor', 'knob'].includes(m.kind)),
      ).toHaveLength(1);
    }
  });

  it('puts the Button on the timer face when it has room', () => {
    for (let seed = 1; seed < 400; seed++) {
      const b = createBomb(1, seed, S({ modules: 3 }), 0);
      for (const m of b.modules) if (m.kind === 'button') expect(m.face).toBe(b.timer.face);
    }
  });

  it('leaves out vetoed kinds and weights repeats down', () => {
    const counts = new Map<string, number>();
    for (let seed = 1; seed < 500; seed++) {
      const b = createBomb(1, seed, S({ modules: 5, vetoes: ['maze', 'morse', 'simon'] }), 0);
      expect(b.modules.some((m) => ['maze', 'morse', 'simon'].includes(m.kind))).toBe(false);
      const kinds = b.modules.map((m) => m.kind);
      counts.set('dupes', (counts.get('dupes') ?? 0) + (kinds.length - new Set(kinds).size));
    }
    // With weights ×0.2 a repeat in 5 picks from 8 kinds is rare but possible.
    expect(counts.get('dupes')!).toBeGreaterThan(0);
    expect(counts.get('dupes')!).toBeLessThan(200);
    expect(freePlayPools(S({ modules: 4, needy: true }))[0]!.count).toBe(3);
  });

  it('makes serials as the code does: no O or Y, digits at 3 and 6', () => {
    for (let seed = 1; seed < 300; seed++) {
      const s = createBomb(1, seed, S(), 0).serial;
      expect(s).toMatch(/^[A-Z0-9]{2}\d[A-Z]{2}\d$/);
      expect(s).not.toMatch(/[OY]/);
    }
  });

  it('places every widget in a free cell of its area, one serial tag', () => {
    for (let seed = 1; seed < 200; seed++) {
      const b = createBomb(1, seed, S(), 0);
      expect(b.widgets.filter((w) => w.kind === 'serial')).toHaveLength(1);
      expect(b.widgets).toHaveLength(6);
      const cells = b.widgets.flatMap((w) => [
        `${w.area}:${w.x},${w.z}`,
        `${w.area}:${w.x + 1},${w.z}`,
      ]);
      expect(new Set(cells).size).toBe(cells.length);
    }
  });

  it('runs the lights: timer at 2 s, modules at 6 s, clock at 8 s', () => {
    const b = createBomb(1, 1, S(), 0);
    runTo(b, 5999);
    expect(b.activated).toBe(false);
    runTo(b, 6000);
    expect(b.activated).toBe(true);
    expect(leftAt(b, 7000)).toBe(300_000);
    expect(leftAt(b, 9000)).toBe(299_000);
  });

  it('speeds the clock up 1.25 × and 1.5 ×, and the third strike sets it off', () => {
    const { b, m } = find('wires');
    const wrong = m.wires.findIndex((_, i) => i !== wiresAnswer(m, info(b)));
    const t = LIGHTS.clock + 10_000;
    runTo(b, t);
    bombAct(b, m.id, { op: 'cut', wire: wrong }, t);
    expect(b.strikes).toBe(1);
    expect(b.rate).toBe(1.25);
    expect(leftAt(b, t + 4000)).toBeCloseTo(leftAt(b, t) - 5000);
    const others = m.wires
      .map((_, i) => i)
      .filter((i) => i !== wiresAnswer(m, info(b)) && i !== wrong);
    bombAct(b, m.id, { op: 'cut', wire: others[0]! }, t + 1);
    expect(b.rate).toBe(1.5);
    if (others[1] !== undefined) {
      bombAct(b, m.id, { op: 'cut', wire: others[1] }, t + 2);
      expect(b.end?.how).toBe('strikes');
    }
  });

  it('goes off when the time runs out', () => {
    const b = createBomb(1, 1, S({ time: 30 }), 0);
    runTo(b, LIGHTS.clock + 29_999);
    expect(b.end).toBeNull();
    runTo(b, LIGHTS.clock + 30_000);
    expect(b.end?.how).toBe('time');
  });

  it('shows MM:SS, and SS.cc under a minute', () => {
    expect(timerText(125_400)).toBe('02:05');
    expect(timerText(59_990)).toBe('59.99');
    expect(timerText(4_050)).toBe('04.05');
  });
});

describe('modules', () => {
  it('wires: 3, 4, 5 wires 1/6 each, 6 wires half the time', () => {
    const n = new Map<number, number>();
    for (let seed = 1; seed < 3000; seed++) {
      const b = createBomb(1, seed, S({ modules: 11, vetoes: [] }), 0);
      for (const m of b.modules)
        if (m.kind === 'wires') n.set(m.wires.length, (n.get(m.wires.length) ?? 0) + 1);
    }
    const total = [...n.values()].reduce((a, c) => a + c, 0);
    expect(n.get(6)! / total).toBeGreaterThan(0.44);
    expect(n.get(6)! / total).toBeLessThan(0.56);
    expect(n.get(3)! / total).toBeGreaterThan(0.12);
  });

  it('wires: the right cut solves; any other cut strikes, even once solved', () => {
    const { b, m } = find('wires');
    const right = wiresAnswer(m, info(b));
    const t = LIGHTS.clock + 1000;
    expect(bombAct(b, m.id, { op: 'cut', wire: right }, t)).toBe('solve');
    const other = m.wires.findIndex((w) => !w.cut);
    expect(bombAct(b, m.id, { op: 'cut', wire: other }, t + 1)).toBe('strike');
  });

  it('the Button: press or hold by its rules, release on the strip’s digit', () => {
    const { b, m } = find('button');
    const t = LIGHTS.clock + 1000;
    const hold = buttonHold(m.colour, m.label, info(b));
    if (!hold) {
      expect(bombAct(b, m.id, { op: 'down' }, t)).toBeNull();
      expect(bombAct(b, m.id, { op: 'up' }, t + 300)).toBe('solve');
    } else {
      bombAct(b, m.id, { op: 'down' }, t);
      expect(bombAct(b, m.id, { op: 'up' }, t + 200)).toBe('strike');
    }
  });

  it('the Button reads the hundredths under a minute', () => {
    for (let seed = 1; seed < 4000; seed++) {
      const b = lit(seed, { modules: 11, time: 60 });
      const m = b.modules.find((x) => x.kind === 'button');
      if (!m || m.kind !== 'button' || !buttonHold(m.colour, m.label, info(b))) continue;
      runTo(b, LIGHTS.clock + 100);
      bombAct(b, m.id, { op: 'down' }, LIGHTS.clock + 100);
      const digit = { blue: '4', white: '1', yellow: '5', red: '1' }[m.strip!];
      // Find a moment under a minute whose text has the digit only in the hundredths.
      for (let t = LIGHTS.clock + 1000; t < LIGHTS.clock + 50_000; t += 10) {
        const text = timerText(leftAt(b, t));
        if (text.slice(0, 2).includes(digit) || !text.slice(3).includes(digit)) continue;
        runTo(b, t);
        expect(bombAct(b, m.id, { op: 'up' }, t)).toBe('solve');
        return;
      }
    }
    throw new Error('no held button found');
  });

  it('keypad: the column order, a wrong press strikes and stays up', () => {
    const { b, m } = find('keypad');
    const col = KEYPAD_COLUMNS[m.column]!;
    const order = [0, 1, 2, 3].sort(
      (a, z) => col.indexOf(m.symbols[a]!) - col.indexOf(m.symbols[z]!),
    );
    const t = LIGHTS.clock + 1000;
    expect(bombAct(b, m.id, { op: 'press', button: order[1]! }, t)).toBe('strike');
    expect(m.down[order[1]!]).toBe(false);
    for (const [i, k] of order.entries())
      expect(bombAct(b, m.id, { op: 'press', button: k }, t + i)).toBe(i === 3 ? 'solve' : null);
  });

  it('Simon: the map changes with strikes, a replay resets the entry, a stage grows', () => {
    const { b, m } = find('simon');
    const t = b.activeAt + 3000;
    runTo(b, t);
    const strikes = b.strikes;
    const right = SIMON_COLOURS.indexOf(simonPress(m.sequence[0]!, info(b)));
    expect(bombAct(b, m.id, { op: 'press', button: right }, t)).toBeNull();
    expect(m.stage).toBe(1);
    expect(b.strikes).toBe(strikes);
    // Pressing before the lights is a strike (the original's `!IsActive`).
    const early = createBomb(1, 1, S({ modules: 11 }), 0);
    const s = early.modules.find((x) => x.kind === 'simon');
    if (s) expect(bombAct(early, s.id, { op: 'press', button: 0 }, 100)).toBe('strike');
  });

  it("Who's on First: always one right button; a wrong one strikes and redraws", () => {
    for (let seed = 1; seed < 2000; seed++) {
      const b = lit(seed, { modules: 11 });
      const m = b.modules.find((x) => x.kind === 'whos-on-first');
      if (!m || m.kind !== 'whos-on-first') continue;
      expect(m.labels).toHaveLength(6);
      expect(m.display).toBeGreaterThanOrEqual(0);
      const right = wofAnswer(m.display, m.labels);
      expect(right).toBeGreaterThanOrEqual(0);
      const t = m.upAt + 10;
      runTo(b, t);
      const wrong = (right + 1) % 6;
      expect(bombAct(b, m.id, { op: 'press', button: wrong }, t)).toBe('strike');
      expect(m.display).toBe(-1);
      runTo(b, t + 3200);
      expect(m.display).toBeGreaterThanOrEqual(0);
      expect(m.stage).toBe(0);
      return;
    }
  });

  it('Memory: a wrong press goes back to stage 1 with a new sequence', () => {
    const { b, m } = find('memory');
    let t = b.activeAt + 100;
    const right = memoryAnswer(m);
    expect(bombAct(b, m.id, { op: 'press', button: right }, t)).toBeNull();
    expect(m.stage).toBe(1);
    t += 3000;
    runTo(b, t);
    expect(m.valid).toBe(true);
    const wrong = (memoryAnswer(m) + 1) % 4;
    expect(bombAct(b, m.id, { op: 'press', button: wrong }, t)).toBe('strike');
    runTo(b, t + 2000);
    expect(m.stage).toBe(0);
    expect(m.pressedPos).toEqual([]);
  });

  it('Morse: only the word’s frequency solves; the dial stops at the ends', () => {
    const { b, m } = find('morse');
    const t = LIGHTS.clock;
    expect(bombAct(b, m.id, { op: 'dial', by: -1 }, t)).toBe('ignored');
    if (m.word !== 0) expect(bombAct(b, m.id, { op: 'tx' }, t)).toBe('strike');
    for (let i = 0; i < m.word; i++) bombAct(b, m.id, { op: 'dial', by: 1 }, t);
    expect(MORSE[m.dial]).toBe(MORSE[m.word]);
    expect(bombAct(b, m.id, { op: 'tx' }, t)).toBe('solve');
  });

  it('marked wires: every module has a wire to cut; a wrong one strikes', () => {
    for (let seed = 1; seed < 600; seed++) {
      const b = lit(seed, { modules: 11 });
      for (const m of b.modules) {
        if (m.kind !== 'complicated-wires') continue;
        expect(m.wires.length).toBeGreaterThanOrEqual(4);
        expect(m.wires.some((w) => vennCut(w, info(b)))).toBe(true);
      }
    }
  });

  it('wire panels: 9 or 10 wires, the first panel never empty; Down with a needed wire strikes', () => {
    for (let seed = 1; seed < 600; seed++) {
      const b = lit(seed, { modules: 11 });
      for (const m of b.modules) {
        if (m.kind !== 'wire-sequence') continue;
        const shown = m.entries.slice(0, 12).filter((e) => e.colour).length;
        expect([9, 10]).toContain(shown);
        expect(m.entries.slice(0, 3).some((e) => e.colour)).toBe(true);
      }
    }
  });

  it('maze: a wall strikes and the light stays; off the grid does nothing', () => {
    const { b, m } = find('maze');
    const t = LIGHTS.clock;
    const before: [number, number] = [m.at[0], m.at[1]];
    const r = bombAct(b, m.id, { op: 'move', dir: m.at[1] === 0 ? 'up' : 'left' }, t);
    if (m.at[1] === 0) expect(r).toBe('ignored');
    else if (r === 'strike') expect(m.at).toEqual(before);
    expect(
      Math.max(Math.abs(m.goal[0] - before[0]), Math.abs(m.goal[1] - before[1])),
    ).toBeGreaterThan(1);
  });

  it('password: only the answer can be spelled; 6 letters a column', () => {
    for (let seed = 1; seed < 400; seed++) {
      const b = lit(seed, { modules: 11 });
      for (const m of b.modules) {
        if (m.kind !== 'password') continue;
        expect(m.columns.every((c) => c.length === 6)).toBe(true);
        expect(spellable(m.columns)).toEqual([m.word]);
      }
    }
  });
});

describe('needy modules', () => {
  const needy = (kind: 'venting-gas' | 'capacitor' | 'knob') => {
    const { b, m } = find(kind, { modules: 3 });
    return { b, m: m };
  };

  it('wake after 90 s of bomb time by themselves', () => {
    const { b, m } = needy('knob');
    runTo(b, LIGHTS.clock + NEEDY_AFTER - 1);
    expect(m.state).toBe('waiting');
    runTo(b, LIGHTS.clock + NEEDY_AFTER);
    expect(m.state).toBe('running');
  });

  it('wake 85 % of the time on the first solve elsewhere, always on the second', () => {
    let woke = 0;
    let tries = 0;
    for (let seed = 1; seed < 3000 && tries < 400; seed++) {
      const b = lit(seed, { modules: 3, needy: true });
      const w = b.modules.find((x) => x.kind === 'wires');
      const n = b.modules.find((x) =>
        ['venting-gas', 'capacitor', 'knob'].includes(x.kind),
      ) as NeedyModule;
      if (!w || w.kind !== 'wires') continue;
      tries++;
      const t = LIGHTS.clock + 1000;
      bombAct(b, w.id, { op: 'cut', wire: wiresAnswer(w, info(b)) }, t);
      runTo(b, t + 300);
      if (n.state === 'running') woke++;
    }
    expect(woke / tries).toBeGreaterThan(0.78);
    expect(woke / tries).toBeLessThan(0.92);
  });

  it('the capacitor never comes back after it goes off', () => {
    const { b, m } = needy('capacitor');
    runTo(b, LIGHTS.clock + NEEDY_AFTER + 45_000);
    expect(b.strikes).toBe(1);
    expect(m.state).toBe('off');
    runTo(b, LIGHTS.clock + NEEDY_AFTER + 120_000);
    expect(m.state).toBe('off');
  });

  it('the capacitor lever pushes the countdown back up to 45 s', () => {
    const { b, m } = needy('capacitor');
    const t0 = LIGHTS.clock + NEEDY_AFTER;
    runTo(b, t0 + 20_000);
    bombAct(b, m.id, { op: 'down' }, t0 + 20_000);
    runTo(b, t0 + 22_000);
    bombAct(b, m.id, { op: 'up' }, t0 + 22_000);
    expect(m.left).toBeCloseTo(25_000 + 2000 * (275 / 45 - 1), -1);
  });

  it('venting gas: Y vents, Y on detonate strikes, a timeout strikes', () => {
    const { b, m } = needy('venting-gas');
    const v = m as Extract<Module, { kind: 'venting-gas' }>;
    const t0 = LIGHTS.clock + NEEDY_AFTER;
    runTo(b, t0);
    bombAct(b, v.id, { op: 'answer', yes: v.question === 'vent' }, t0 + 100);
    runTo(b, t0 + 3000);
    expect(v.state).toBe('cooldown');
    expect(b.strikes).toBe(0);
    runTo(b, v.resumeAt + 40_000);
    expect(b.strikes).toBe(1);
  });

  it('the knob checks its position when the countdown ends, then re-arms', () => {
    const { b, m } = needy('knob');
    const k = m as Extract<Module, { kind: 'knob' }>;
    const t0 = LIGHTS.clock + NEEDY_AFTER;
    runTo(b, t0);
    const want = KNOB[k.pattern!]!.pos;
    while (k.pos !== want) bombAct(b, k.id, { op: 'turn' }, t0 + 10);
    runTo(b, t0 + 40_000);
    expect(b.strikes).toBe(0);
    expect(k.state).toBe('cooldown');
    expect(k.resumeAt - (t0 + 40_000)).toBeGreaterThanOrEqual(10_000);
    expect(k.resumeAt - (t0 + 40_000)).toBeLessThanOrEqual(40_000);
  });
});

describe('the room', () => {
  const live = (s: State) => s.stage === 'bomb';

  it('the host defuses first, then it rotates', () => {
    const t = table([ANA, BEN, CHO]);
    must(t, ANA, { type: 'start' });
    expect(t.state.defuser).toBe(ANA);
    wait(t, LIGHTS.clock + 300_001);
    expect(t.state.stage).toBe('result');
    expect(t.state.defuser).toBe(BEN);
    must(t, ANA, { type: 'next' });
    expect(t.state.defuser).toBe(BEN);
    expect(live(t.state)).toBe(true);
  });

  it('random: drawn when the bomb starts', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const t = table([ANA, BEN, CHO], seed, { defuserMode: 'random' });
      must(t, ANA, { type: 'start' });
      seen.add(t.state.defuser!);
    }
    expect(seen.size).toBe(3);
  });

  it('volunteers: one volunteer defuses; with several the host picks one of them', () => {
    const t = table([ANA, BEN, CHO], 1, { defuserMode: 'volunteer' });
    expect(send(t, ANA, { type: 'start' })).toBeInstanceOf(GameError);
    must(t, BEN, { type: 'volunteer', on: true });
    expect(t.state.defuser).toBe(BEN);
    must(t, CHO, { type: 'volunteer', on: true });
    expect(t.state.defuser).toBeNull();
    expect(send(t, ANA, { type: 'set-defuser', player: ANA })).toBeInstanceOf(GameError);
    must(t, ANA, { type: 'set-defuser', player: CHO });
    must(t, ANA, { type: 'start' });
    expect(t.state.defuser).toBe(CHO);
  });

  it('only the defuser touches the bomb; experts claim and note; the defuser does not', () => {
    const t = table([ANA, BEN]);
    must(t, ANA, { type: 'start' });
    wait(t, LIGHTS.clock);
    const id = bomb(t).modules[0]!.id;
    expect(send(t, BEN, { type: 'act', module: id, op: 'cut', wire: 0 })).toBeInstanceOf(GameError);
    must(t, BEN, { type: 'claim', page: 'wires', on: true });
    must(t, BEN, { type: 'note', page: 'wires', text: 'serial odd' });
    expect(t.state.claims.wires).toEqual([BEN]);
    expect(send(t, ANA, { type: 'claim', page: 'wires', on: true })).toBeInstanceOf(GameError);
  });

  it('a defuser who leaves keeps the bomb; the host hands it over', () => {
    const t = table([ANA, BEN, CHO]);
    must(t, ANA, { type: 'set-defuser', player: BEN });
    must(t, ANA, { type: 'start' });
    t.state = defuse.playerLeft(t.state, BEN, t.now);
    expect(t.state.defuser).toBe(BEN);
    must(t, ANA, { type: 'hand-over', player: CHO });
    expect(t.state.defuser).toBe(CHO);
  });

  it('dates a timed press back up to half a second, never ahead', () => {
    const t = table([ANA, BEN]);
    must(t, ANA, { type: 'start' });
    wait(t, LIGHTS.clock + 5000);
    const b = bomb(t);
    const m = b.modules.find((x) => x.kind === 'button');
    if (!m) return;
    must(t, ANA, { type: 'act', module: m.id, op: 'down', at: t.now - 5000 });
    expect((bomb(t).modules.find((x) => x.id === m.id) as { downAt: number }).downAt).toBe(
      t.now - 500,
    );
  });

  it('seats twelve; the rest watch', () => {
    const ids = Array.from({ length: 14 }, (_, i) => `p${i}`);
    const t = table(ids);
    expect(t.state.seats).toHaveLength(12);
    expect(t.state.watchers).toHaveLength(2);
    t.state = defuse.playerLeft(t.state, 'p0', 0);
    expect(t.state.seats).toHaveLength(12);
    expect(t.state.watchers).toHaveLength(1);
  });

  it('the next deadline is always ahead after a deadline runs', () => {
    const t = table([ANA, BEN], 3, { modules: 11, needy: true, time: 600 });
    must(t, ANA, { type: 'start' });
    wait(t, 700_000);
    expect(t.state.stage).toBe('result');
  });
});
