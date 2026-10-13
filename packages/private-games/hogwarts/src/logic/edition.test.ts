import { type ActionCtx, GameError, createRng } from '@vt/game-sdk';
import { type HydraAction, type HydraState, hydra } from '@vt/private-hydra/logic';
import { describe, expect, it } from 'vitest';
import { guide, hogwarts } from './index.ts';

const players = ['host', 'ana', 'ben', 'cy', 'dee'];

describe('the themed edition', () => {
  it('is a back-room game of its own, on Hydra’s engine', () => {
    expect(hogwarts.id).toBe('hogwarts');
    expect(hogwarts.access).toBe('private');
    // Hydra's engine throughout (functions compared by reference); only the listing differs.
    expect({
      ...hogwarts,
      id: hydra.id,
      name: hydra.name,
      description: hydra.description,
      guide: hydra.guide,
    }).toEqual(hydra);
    expect(JSON.stringify(guide)).not.toMatch(/\{[A-Za-z:]+\}/);
  });

  it('keeps every hand, role and vote secret, as Hydra does', () => {
    const rng = createRng(3);
    const content = { wordLists: () => [], words: () => [] };
    let state: HydraState = hogwarts.create(
      { now: 0, rng, content },
      players.map((id) => ({ id, name: id })),
    );
    const act = (action: HydraAction, by = 'host') => {
      const ctx: ActionCtx = { by, isHost: by === 'host', now: 0, rng, content };
      const r = hogwarts.reduce(state, action, ctx);
      if (r instanceof GameError) throw new Error(r.message);
      state = r;
    };
    act({ type: 'start' });
    for (const p of players) act({ type: 'ready' }, p);
    const g = () => state.game!;
    const president = g().president;
    act({ type: 'nominate', player: players.find((p) => p !== president)! }, president);
    act({ type: 'vote', ballot: 'yes' }, players[0]);
    // One vote in: nobody sees how anyone voted.
    for (const p of players) expect(hogwarts.view(state, p).game!.rounds.at(-1)!.votes).toEqual({});
    for (const p of players.slice(1)) act({ type: 'vote', ballot: 'yes' }, p);
    expect(state.stage === 'legislate-president' || state.stage === 'leader-check').toBe(true);
    for (const p of players) {
      const v = hogwarts.view(state, p);
      const json = JSON.stringify(v);
      expect(v.role?.role).toBe(g().roles[p]);
      for (const key of ['"deck":', '"truth"', '"roles"', '"seed"'])
        expect(json).not.toContain(key);
      if (state.stage === 'legislate-president')
        expect(v.game!.hand).toEqual(p === president ? g().hand : null);
    }
    // Portraits stay with their owners until the end.
    for (const p of players) expect(hogwarts.view(state, p).game!.end).toBeNull();
  });
});
