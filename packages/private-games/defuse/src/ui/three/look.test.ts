import { describe, expect, it } from 'vitest';
import { LIGHTS } from '../../logic/bomb.ts';
import { ANA, BEN, bomb, must, table, wait } from '../../logic/test-utils.ts';
import { type Module, NEEDY, SOLVABLE } from '../../logic/types.ts';

const KINDS = [...SOLVABLE, ...NEEDY];
import { view } from '../../logic/view.ts';
import { PREFAB, STRIKE_FLASH, bombLook, moduleLook, morseLit, simonFlash } from './look.ts';

/** A live bomb as the defuser sees it, `ms` after the lights came on. */
function live(settings = {}, ms = 0, seed = 7) {
  const t = table([ANA, BEN], seed, settings);
  must(t, ANA, { type: 'start' });
  wait(t, LIGHTS.clock + ms);
  return t;
}
const seen = (t: ReturnType<typeof live>) => view(t.state, ANA).bomb!;

describe('the 3D bomb shows the state', () => {
  it('maps the timer, its lamps and the lights', () => {
    const t = table([ANA, BEN], 7);
    must(t, ANA, { type: 'start' });
    const b = view(t.state, ANA).bomb!;
    const dark = bombLook(b, b.startedAt + 500);
    expect(dark.timer.lit).toBe(false);
    expect(dark.awake).toBe(false);
    expect(dark.timer.text).toBe('05:00');
    expect(dark.timer.lamps).toBe(2);
    const lit = bombLook(b, b.startedAt + LIGHTS.active);
    expect(lit.timer.lit).toBe(true);
    expect(lit.awake).toBe(true);
    expect(dark.modules.map((m) => m.id).sort()).toEqual(b.modules.map((m) => m.id).sort());
  });

  it('runs the emergency light only in the last minute', () => {
    const t = live({ time: 90 });
    const b = seen(t);
    expect(bombLook(b, b.clockAt + 29_000).lastMinute).toBe(false);
    expect(bombLook(b, b.clockAt + 31_000).lastMinute).toBe(true);
  });

  it('hardcore has no strike lamps', () => {
    const b = seen(live({ hardcore: true }));
    expect(bombLook(b, b.clockAt).timer.lamps).toBe(0);
  });

  it('flashes a module LED red for one second after a strike, green once solved', () => {
    const t = live({ modules: 11 });
    const w = bomb(t).modules.find((m) => m.kind === 'wires')!;
    const b0 = seen(t);
    const wires = b0.modules.find((m) => m.id === w.id)!;
    expect(moduleLook(wires, b0, t.now).led).toBe('off');
    // A wrong cut: find one by trying the last wire, which the seed's bomb does not want.
    const k = wires.kind === 'wires' ? wires.wires.length - 1 : 0;
    must(t, ANA, { type: 'act', module: w.id, op: 'cut', wire: k });
    const b1 = seen(t);
    const after = b1.modules.find((m) => m.id === w.id)!;
    const struck = b1.log.some((e) => e.what === 'strike');
    const l = moduleLook(after, b1, t.now);
    expect(l.led).toBe(after.solved ? 'pass' : struck ? 'strike' : 'off');
    if (struck && !after.solved)
      expect(moduleLook(after, b1, t.now + STRIKE_FLASH).led).toBe('off');
    if (l.kind === 'wires') expect(l.wires[k]!.cut).toBe(true);
  });

  it('maps every module kind to its prefab', () => {
    for (const k of KINDS) expect(PREFAB[k]).toMatch(/Component$/);
  });
});

describe('module looks', () => {
  const base = { face: 0 as const, anchor: 0, solved: false, strikes: 0 };
  const b = { log: [], activated: true, activeAt: 0 } as unknown as Parameters<
    typeof moduleLook
  >[1];

  it('the button lights its strip only past half a second', () => {
    const m = {
      ...base,
      id: 'm00',
      kind: 'button',
      colour: 'blue',
      label: 'abort',
      downAt: 1000,
      strip: 'red',
    } as Module;
    const early = moduleLook(m as never, b, 1400);
    const late = moduleLook(m as never, b, 1600);
    expect(early.kind === 'button' && early.strip).toBe(null);
    expect(late.kind === 'button' && late.strip).toBe('red');
    expect(late.kind === 'button' && late.label).toBe('ABORT');
  });

  it('simon flashes its shown colours in turn, then waits', () => {
    const m = {
      ...base,
      id: 'm00',
      kind: 'simon',
      stage: 1,
      progress: 0,
      playAt: 1000,
      shown: ['red', 'green'],
    };
    expect(simonFlash(m as never, 999)).toBe(-1);
    expect(simonFlash(m as never, 1000)).toBe(0);
    expect(simonFlash(m as never, 1000 + 650)).toBe(2);
    expect(simonFlash(m as never, 1000 + 1300)).toBe(-1);
  });

  it('the morse light starts with the lights and spells dots and dashes', () => {
    // "e" then gap: a dot (1 unit on), then the word gap.
    expect(morseLit(['.'], 0, 100)).toBe(true);
    expect(morseLit(['.'], 0, 300)).toBe(false);
    expect(morseLit(['-'], 0, 700)).toBe(true);
    expect(morseLit(['.'], 1000, 500)).toBe(false);
  });

  it("who's on first hides its labels while the buttons are down", () => {
    const m = {
      ...base,
      id: 'm00',
      kind: 'whos-on-first',
      stage: 0,
      display: 'YES',
      labels: ['A', 'B', 'C', 'D', 'E', 'F'],
      upAt: 2000,
      change: null,
    };
    const down = moduleLook(m as never, b, 1000);
    const up = moduleLook(m as never, b, 2500);
    expect(down.kind === 'whos-on-first' && down.up).toBe(false);
    expect(up.kind === 'whos-on-first' && up.up).toBe(true);
    expect(up.kind === 'whos-on-first' && up.display).toBe('YES');
  });

  it('the vent types its answer letter by letter', () => {
    const m = {
      ...base,
      id: 'm00',
      kind: 'venting-gas',
      state: 'running',
      left: 40_000,
      leftAt: 0,
      resumeAt: 0,
      changeAt: null,
      changes: 0,
      started: true,
      question: 'vent',
      reply: { yes: true, at: 1000, doneAt: 2500, lockUntil: 3000 },
      warnedAt: null,
    };
    const l = moduleLook(m as never, b, 1100);
    expect(l.kind === 'venting-gas' && l.lines).toEqual(['VENT GAS?', 'Y/N Y']);
    const l2 = moduleLook(m as never, b, 2400);
    expect(l2.kind === 'venting-gas' && l2.lines).toEqual(['VENT GAS?', 'Y/N YES']);
    expect(l2.kind === 'venting-gas' && l2.clock.text).toBe('38');
  });

  it('the knob points where the label and its position say', () => {
    const m = {
      ...base,
      id: 'm00',
      kind: 'knob',
      state: 'running',
      left: 40_000,
      leftAt: 0,
      resumeAt: 0,
      changeAt: null,
      changes: 0,
      started: true,
      label: 'right',
      pos: 'down',
      leds: 'X-----------',
    };
    const l = moduleLook(m as never, b, 1000);
    expect(l.kind === 'knob' && l.points).toBe('left');
    expect(l.kind === 'knob' && l.leds[0]).toBe(true);
    expect(l.kind === 'knob' && l.leds[1]).toBe(false);
  });
});
