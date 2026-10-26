import { afterEach, describe, expect, it } from 'vitest';
import { setTestBag } from './game.ts';
import { HOST, game, harness } from './test-utils.ts';

describe('the test rig', () => {
  afterEach(() => {
    setTestBag(null);
  });

  it('stacks the bag, fills the first seat’s wall rows, and the first seat starts', () => {
    setTestBag({
      top: ['blue', 'blue', 'yellow', 'yellow', 'red', 'red', 'red', 'red'],
      wall: { 0: ['yellow', 'red', 'black', 'aqua'] },
      firstSeat: true,
    });
    const h = harness(2, 11);
    h.act(HOST, { type: 'start' });
    expect(game(h).factories.slice(0, 2)).toEqual([
      ['blue', 'blue', 'yellow', 'yellow'],
      ['red', 'red', 'red', 'red'],
    ]);
    expect(game(h).players.p1!.wall[0]).toEqual([null, 'yellow', 'red', 'black', 'aqua']);
    expect(game(h).current).toBe('p1');
  });
});
