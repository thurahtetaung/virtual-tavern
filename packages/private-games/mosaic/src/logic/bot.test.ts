import { type BotCtx, type PlayerId, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { bestMove, mosaicBot } from './bot.ts';
import { mosaic } from './game.ts';
import { setBoard, setTable, started } from './test-utils.ts';
import type { MosaicAction, MosaicView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: MosaicView, _me: PlayerId): MosaicAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

describe('bots', () => {
  for (const n of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      it(`plays a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(mosaic, seats(n), { seed, host, maxSteps: 3000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        // The game ended on a full row, not by running out of tiles.
        expect(r.state.log.at(-1)).toMatchObject({ kind: 'end' });
        expect(r.state.log.at(-1)).not.toHaveProperty('how');
      });
    }
  }

  it('fills a line that scores rather than dumping on the floor', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'red', 'black'], ['blue', 'yellow', 'aqua', 'aqua'], [], [], []]);
    setBoard(h, 'p1', {
      wall: { 2: ['blue', 'yellow'] },
      lines: [
        { colour: null, count: 0 },
        { colour: null, count: 0 },
        { colour: null, count: 0 },
        { colour: null, count: 0 },
        { colour: null, count: 0 },
      ],
    });
    const move = bestMove(mosaic.view(h.state, 'p1'), 'p1', null)!;
    expect(move).toMatchObject({ source: 0, colour: 'red', target: 2 });
  });

  it('readies once during the wall-tiling', () => {
    const h = started(2);
    setTable(h, [['blue'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    const ctx = { me: 'p2', now: h.now, rng: createRng(1), words: () => [] };
    expect(mosaicBot(mosaic.view(h.state, 'p2'), ctx)).toEqual({ type: 'ready' });
    h.act('p2', { type: 'ready' });
    expect(mosaicBot(mosaic.view(h.state, 'p2'), ctx)).toBeNull();
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: MosaicView, ctx: BotCtx) => unknown = mosaicBot;
    expect(hook).toBeTypeOf('function');
  });
});
