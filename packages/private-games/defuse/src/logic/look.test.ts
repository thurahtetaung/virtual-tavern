import { GameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { defuse } from './game.ts';
import { ANA, BEN, must, send, table } from './test-utils.ts';
import type { Look } from './types.ts';

/** The defuser's view of the bomb, for a table screen showing it (`look`). */
const LOOK: Look = { mode: '3d', pose: 'module', yaw: 180, settle: 0, module: 'm10' };

describe('the defuser’s look', () => {
  it('only the defuser sends it, only while a bomb is live', () => {
    const t = table([ANA, BEN], 3, { table: 'bomb' });
    expect(send(t, ANA, { type: 'look', ...LOOK })).toBeInstanceOf(GameError);
    must(t, ANA, { type: 'start' });
    expect(send(t, BEN, { type: 'look', ...LOOK })).toBeInstanceOf(GameError);
    must(t, ANA, { type: 'look', ...LOOK });
    expect(t.state.look).toEqual(LOOK);
  });

  it('reaches the defuser and a table screen showing the bomb, never the experts', () => {
    const t = table([ANA, BEN], 3, { table: 'bomb' });
    must(t, ANA, { type: 'start' });
    must(t, ANA, { type: 'look', ...LOOK });
    expect(defuse.view(t.state, null).look).toEqual(LOOK);
    expect(defuse.view(t.state, ANA).look).toEqual(LOOK);
    expect(defuse.view(t.state, BEN).look).toBe(null);
    const manual = table([ANA, BEN], 3);
    must(manual, ANA, { type: 'start' });
    must(manual, ANA, { type: 'look', ...LOOK });
    expect(defuse.view(manual.state, null).look).toBe(null);
  });

  it('is cleared for each new bomb and refuses a turn that is not a quarter', () => {
    const t = table([ANA, BEN], 3, { table: 'bomb' });
    must(t, ANA, { type: 'start' });
    expect(defuse.actionSchema.safeParse({ type: 'look', ...LOOK, yaw: 45 }).success).toBe(false);
    must(t, ANA, { type: 'look', ...LOOK });
    t.state = { ...t.state, stage: 'result' };
    must(t, ANA, { type: 'start' });
    expect(t.state.look).toBe(null);
  });
});
