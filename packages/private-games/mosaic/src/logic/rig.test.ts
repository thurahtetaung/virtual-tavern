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

  it('adds the option walls only with their option on', () => {
    setTestBag({
      wall: { 0: ['yellow', 'red', 'black', 'aqua'] },
      optionWall: { grey: { 3: [null, 'blue', 'yellow', null, 'red'] } },
      firstSeat: true,
    });
    const grey = harness(2, 11, { grey: true });
    grey.act(HOST, { type: 'start' });
    expect(game(grey).players.p1!.wall[3]).toEqual([null, 'blue', 'yellow', null, 'red']);
    const plain = harness(2, 11);
    plain.act(HOST, { type: 'start' });
    expect(game(plain).players.p1!.wall[3]).toEqual([null, null, null, null, null]);
  });
});
