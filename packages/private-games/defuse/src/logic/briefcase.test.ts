import { GameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { type CaseDial, DEFAULT_SETTINGS, LIMITS, turnDial } from './game.ts';
import { ANA, BEN, must, send, table } from './test-utils.ts';

describe('the briefcase’s keys and switches', () => {
  it('step the time by 30 s and the modules by one, clamped to the lobby’s limits', () => {
    const s = { ...DEFAULT_SETTINGS, time: 300, modules: 3 };
    expect(turnDial(s, 'time-up')).toEqual({ time: 330 });
    expect(turnDial(s, 'time-down')).toEqual({ time: 270 });
    expect(turnDial(s, 'modules-up')).toEqual({ modules: 4 });
    expect(turnDial(s, 'modules-down')).toBeNull();
    expect(turnDial({ ...s, time: LIMITS.time.max }, 'time-up')).toBeNull();
    expect(turnDial({ ...s, time: LIMITS.time.min }, 'time-down')).toBeNull();
    expect(turnDial({ ...s, modules: LIMITS.modules.max }, 'modules-up')).toBeNull();
    expect(turnDial(s, 'needy')).toEqual({ needy: true });
    expect(turnDial({ ...s, hardcore: true }, 'hardcore')).toEqual({ hardcore: false });
  });

  it('send the lobby’s settings action: the host’s turns change the room, anyone else’s are refused', () => {
    const t = table([ANA, BEN]);
    for (const dial of ['time-up', 'modules-up', 'needy', 'hardcore'] as CaseDial[])
      must(t, ANA, { type: 'settings', settings: turnDial(t.state.settings, dial)! });
    expect(t.state.settings).toMatchObject({ time: 330, modules: 4, needy: true, hardcore: true });
    const before = t.state;
    const r = send(t, BEN, { type: 'settings', settings: turnDial(t.state.settings, 'time-up')! });
    expect(r).toBeInstanceOf(GameError);
    expect((r as GameError).code).toBe('not-host');
    expect(t.state).toBe(before);
  });
});
