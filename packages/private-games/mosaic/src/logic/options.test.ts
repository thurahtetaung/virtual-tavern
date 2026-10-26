import { createRng } from '@vt/game-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { mosaicBot } from './bot.ts';
import { mosaic, setTestBag } from './game.ts';
import { bonusOf, emptyBoard, lineProblem, previewOf, tileWall, wallSpaces } from './rules.ts';
import { FACES, flipSpecials, neighbours } from './specials.ts';
import {
  HOST,
  board,
  game,
  harness,
  putWall,
  setBoard,
  setTable,
  started,
  tileCount,
} from './test-utils.ts';
import type { LogEntry, MosaicState, Special, Tile } from './types.ts';

type H = ReturnType<typeof started>;
const lastTake = (h: H) =>
  [...h.state.log].reverse().find((e) => e.kind === 'take') as Extract<LogEntry, { kind: 'take' }>;
const opts = (o: Partial<MosaicState['settings']>) => ({ settings: o });

/** Sets the special factories' faces (index: face). */
function specials(h: H, faces: Record<number, Special>) {
  h.rig((s) => {
    const g = s.game!;
    g.specials = g.factories.map((_, i) => (faces[i] ? { ...faces[i] } : null));
  });
}

describe('grey wall', () => {
  it('a full line with several legal spaces waits for its owner; the row and column rule holds', () => {
    const h = started(2, opts({ grey: true }));
    setBoard(h, 'p1', {
      lines: [
        { colour: null, count: 0 },
        { colour: 'red', count: 1 },
        ...emptyBoard().lines.slice(2),
      ],
    });
    // Red already in column 0 (row 0) and row 1 holds blue in column 3.
    putWall(h, 'p1', [
      [0, 0, 'red'],
      [1, 3, 'blue'],
    ]);
    setTable(h, [['red'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 1 });
    expect(game(h).stage).toBe('wall');
    expect(game(h).walls!.p1!.row).toBe(1);
    expect(game(h).walls!.p2!.row).toBeNull();
    expect(wallSpaces(board(h, 'p1').wall, 1, board(h, 'p1').lines[1]!, true)).toEqual([1, 2, 4]);
    expect(h.refuse('p1', { type: 'wall', row: 1, col: 0 })).toBe('bad-space');
    expect(h.refuse('p1', { type: 'wall', row: 1, col: 3 })).toBe('bad-space');
    expect(h.refuse('p2', { type: 'wall', row: 1, col: 2 })).toBe('done');
    h.act('p1', { type: 'wall', row: 1, col: 4 });
    expect(game(h).stage).toBe('tiling');
    expect(board(h, 'p1').wall[1]![4]).toBe('red');
    expect(game(h).scoring!.players.p1!.placed).toEqual([
      { row: 1, col: 4, colour: 'red', points: 2, across: 2, down: 0 },
    ]);
    expect(tileCount(h.state)).toBe(100);
  });

  it('a single legal space is filled without asking', () => {
    const h = started(2, opts({ grey: true }));
    putWall(h, 'p1', [
      [0, 1, 'blue'],
      [0, 2, 'yellow'],
      [0, 3, 'black'],
      [0, 4, 'aqua'],
    ]);
    setTable(h, [['red'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(game(h).stage).toBe('tiling');
    expect(h.state.phase).toBe('over');
    expect(board(h, 'p1').wall[0]![0]).toBe('red');
  });

  it('a line with no legal space falls to the floor whole (the rulebook’s special case)', () => {
    const h = started(2, opts({ grey: true }));
    setBoard(h, 'p1', {
      lines: [
        { colour: null, count: 0 },
        { colour: 'red', count: 1 },
        ...emptyBoard().lines.slice(2),
      ],
    });
    // Red sits in columns 0–2 already, and row 1's last free spaces are 0 and 1.
    putWall(h, 'p1', [
      [0, 0, 'red'],
      [2, 1, 'red'],
      [3, 2, 'red'],
      [1, 2, 'blue'],
      [1, 3, 'yellow'],
      [1, 4, 'black'],
    ]);
    setTable(h, [['red'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 1 });
    const ps = game(h).scoring!.players.p1!;
    expect(ps.fell).toEqual([1]);
    expect(ps.placed).toEqual([]);
    expect(ps.floor).toEqual(['red', 'red']);
    expect(ps.penalty).toBe(-2);
    expect(tileCount(h.state)).toBe(100);
  });

  it('lines go top to bottom, so an earlier choice can block a later line', () => {
    const b = emptyBoard();
    b.lines[0] = { colour: 'blue', count: 1 };
    b.lines[1] = { colour: 'blue', count: 2 };
    b.wall[1] = [null, 'red', 'yellow', 'black', 'aqua'];
    // Row 0's blue in column 0 leaves row 1 no space: its blues fall.
    const r = tileWall(b, true, () => 0);
    expect(r.placed.map((p) => [p.row, p.col])).toEqual([[0, 0]]);
    expect(r.fell).toEqual([1]);
  });

  it('a colour already in a wall row still can’t go in that row’s line', () => {
    const b = emptyBoard();
    b.wall[2]![4] = 'yellow';
    expect(lineProblem(b, 2, 'yellow', true)).toMatch(/already has this colour/);
    expect(lineProblem(b, 3, 'yellow', true)).toBeNull();
  });

  it('strict timers and leavers take the leftmost space; the bot takes the best', () => {
    const h = started(2, opts({ grey: true, seconds: 30, timerMode: 'strict' }));
    putWall(h, 'p1', [[1, 4, 'blue']]);
    setTable(h, [['red'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(game(h).stage).toBe('wall');
    // The bot would put it above the blue (a run of 2).
    const v = mosaic.view(h.state, 'p1');
    expect(mosaicBot(v, { me: 'p1', now: h.now, rng: createRng(1), words: () => [] })).toEqual({
      type: 'wall',
      row: 0,
      col: 4,
    });
    h.tick();
    expect(board(h, 'p1').wall[0]![0]).toBe('red');
    const entry = h.state.log.find((e) => e.kind === 'wall');
    expect(entry).toMatchObject({ by: 'p1', row: 0, col: 0, auto: 'timer' });
  });

  it('a player who left gets the leftmost space after a beat; the others aren’t held up', () => {
    const h = started(2, opts({ grey: true }));
    setTable(h, [['red'], [], [], [], []]);
    h.state = mosaic.playerLeft(h.state, 'p2', h.now);
    h.rig((s) => {
      s.game!.current = 'p2';
      s.game!.players.p2!.lines[0] = { colour: null, count: 0 };
    });
    // p2 (away) takes the red into line 1 by the table's hand, then chooses its space.
    h.tick();
    expect(game(h).stage).toBe('wall');
    h.tick();
    expect(board(h, 'p2').wall[0]![0]).toBe('red');
    expect(game(h).stage).toBe('tiling');
  });
});

describe('jokers', () => {
  it('replace 1 of each colour at 2 players and 2 of each at 3–4', () => {
    for (const [n, jokers, each] of [
      [2, 5, 19],
      [3, 10, 18],
      [4, 10, 18],
    ] as const) {
      const h = started(n, opts({ jokers: true }));
      const g = game(h);
      const all = [...g.bag, ...g.factories.flat()];
      expect(all.filter((t) => t === 'joker')).toHaveLength(jokers);
      expect(all.filter((t) => t === 'red')).toHaveLength(each);
      expect(tileCount(h.state)).toBe(100);
    }
  });

  it('taking jokers may bring one other colour from the same place; the rest go to the centre', () => {
    const h = started(2, opts({ jokers: true }));
    setTable(h, [
      ['red', 'red', 'joker', 'blue'],
      ['joker', 'yellow', 'yellow', 'yellow'],
      [],
      [],
      [],
    ]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', jokers: true, target: 2 });
    expect(board(h, 'p1').lines[2]).toEqual({ colour: 'red', count: 3, jokers: 1 });
    expect(game(h).centre.blue).toBe(1);
    expect(lastTake(h)).toMatchObject({ colour: 'red', count: 3, jokers: 1 });
    // The jokers alone: they go in any line with room, the yellows slide to the centre.
    h.act('p2', { type: 'take', source: 1, colour: 'joker', target: 0 });
    expect(board(h, 'p2').lines[0]).toEqual({ colour: null, count: 1, jokers: 1 });
    expect(game(h).centre.yellow).toBe(3);
    // No jokers there: refused.
    expect(
      h.refuse('p1', { type: 'take', source: 'centre', colour: 'yellow', jokers: true, target: 1 }),
    ).toBe('no-jokers');
  });

  it('a line holds one colour plus jokers; the colour fills it first and spare jokers spill', () => {
    const h = started(2, opts({ jokers: true }));
    setBoard(h, 'p1', {
      lines: [
        { colour: null, count: 0 },
        { colour: null, count: 1, jokers: 1 },
        ...emptyBoard().lines.slice(2),
      ],
    });
    expect(lineProblem(board(h, 'p1'), 1, 'black')).toBeNull();
    const p = previewOf(board(h, 'p1'), 'black', 1, 1, false, 1);
    expect(p).toMatchObject({ toLine: 1, toFloor: 1, fills: true });
    setTable(h, [['black', 'joker'], [], [], [], []], { aqua: 1 });
    h.act('p1', { type: 'take', source: 0, colour: 'black', jokers: true, target: 1 });
    expect(board(h, 'p1').lines[1]).toEqual({ colour: 'black', count: 2, jokers: 1 });
    expect(board(h, 'p1').floor).toEqual(['joker']);
    expect(lineProblem(board(h, 'p1'), 1, 'red')).toMatch(/another colour|full/);
    const b = emptyBoard();
    b.lines[2] = { colour: 'blue', count: 1 };
    expect(lineProblem(b, 2, 'red')).toMatch(/another colour/);
  });

  it('a mixed line sends a joker to its colour’s space; a joker on a space bars that colour from the row', () => {
    const b = emptyBoard();
    b.lines[1] = { colour: 'red', count: 2, jokers: 1 };
    const r = tileWall(b);
    // Row 1: red's space is column 3.
    expect(b.wall[1]![3]).toBe('joker');
    expect(r.placed[0]).toMatchObject({ row: 1, col: 3, colour: 'joker' });
    expect(r.lid).toEqual(['red']);
    expect(lineProblem(b, 1, 'red')).toMatch(/joker already sits/);
    expect(lineProblem(b, 1, 'blue')).toBeNull();
  });

  it('a line of jokers alone goes on any free space of its row, chosen by its owner', () => {
    const h = started(2, opts({ jokers: true }));
    setTable(h, [['joker'], [], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'joker', target: 0 });
    expect(game(h).stage).toBe('wall');
    h.act('p1', { type: 'wall', row: 0, col: 3 });
    expect(board(h, 'p1').wall[0]![3]).toBe('joker');
    // Column 3 of row 0 is black's space: black can't go in line 1 any more.
    expect(lineProblem(board(h, 'p1'), 0, 'black')).toMatch(/joker already sits/);
  });

  it('jokers count for row and column bonuses, never for a colour', () => {
    const wall = emptyBoard().wall;
    wall[0] = ['blue', 'yellow', 'joker', 'black', 'aqua'];
    for (let r = 1; r < 5; r++) wall[r]![0] = 'blue';
    wall[1]![0] = 'joker';
    expect(bonusOf(wall)).toEqual({ rows: 1, columns: 1, colours: 0, points: 9 });
  });

  it('with the grey wall: a mixed line’s joker goes where its colour may go; jokers never block a column', () => {
    const b = emptyBoard();
    b.wall[0]![2] = 'red';
    b.wall[2]![4] = 'joker';
    b.lines[1] = { colour: 'red', count: 2, jokers: 1 };
    // Red is in column 2; the joker in column 4 doesn't count.
    expect(wallSpaces(b.wall, 1, b.lines[1], true)).toEqual([0, 1, 3, 4]);
    b.lines[2] = { colour: null, count: 3, jokers: 3 };
    expect(wallSpaces(b.wall, 2, b.lines[2], true)).toEqual([0, 1, 2, 3]);
  });

  it('the bot plays whole games with jokers and never sends an illegal take', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const h = started(2 + (seed % 3), { seed, settings: { jokers: true } });
      for (let i = 0; i < 400 && h.state.phase === 'playing'; i++) {
        const g = game(h);
        if (g.stage === 'tiling') h.tick();
        else {
          const by =
            g.stage === 'wall'
              ? Object.keys(g.walls!).find((id) => g.walls![id]!.row !== null)!
              : g.current;
          const move = mosaicBot(mosaic.view(h.state, by), {
            me: by,
            now: h.now,
            rng: createRng(i),
            words: () => [],
          })!;
          h.act(by, move);
        }
        expect(tileCount(h.state)).toBe(100);
      }
      expect(h.state.phase).toBe('over');
    }
  }, 60_000);
});

describe('special factories', () => {
  it('turns as many factories gold as there are players, from the nine faces', () => {
    expect(FACES.map((f) => f.kind + (f.colour ?? ''))).toEqual([
      'sf1',
      'sf2blue',
      'sf2yellow',
      'sf2red',
      'sf2black',
      'sf2aqua',
      'sf3',
      'sf4',
      'sf5',
    ]);
    const rng = createRng(4);
    for (const [n, players] of [
      [5, 2],
      [7, 3],
      [9, 4],
    ] as const) {
      const faces = flipSpecials(n, players, rng);
      expect(faces).toHaveLength(n);
      expect(faces.filter(Boolean)).toHaveLength(players);
    }
    const h = started(3, opts({ specials: true }));
    expect(game(h).specials!.filter(Boolean)).toHaveLength(3);
    expect(h.state.log.some((e) => e.kind === 'specials')).toBe(true);
  });

  it('sets up +1 first, then each colour-gatherer takes one of its colour from each neighbour', () => {
    setTestBag({
      top: [
        ...['red', 'blue', 'blue', 'blue'],
        ...['red', 'red', 'yellow', 'yellow'],
        ...['red', 'aqua', 'aqua', 'aqua'],
        ...['black', 'black', 'black', 'black'],
        ...['yellow', 'yellow', 'aqua', 'aqua'],
        'red',
      ] as Tile[],
      specials: [{ kind: 'sf1' }, { kind: 'sf2', colour: 'red' }],
    });
    try {
      const h = harness(2, 3, { specials: true });
      h.act(HOST, { type: 'start' });
      const f = game(h).factories;
      // sf1 got the 21st tile (a red) first; sf2 then took a red from it and from factory 3.
      expect(f[0]).toEqual(['blue', 'blue', 'blue', 'red']);
      expect(f[1]).toEqual(['yellow', 'yellow', 'red', 'red', 'red', 'red']);
      expect(f[2]).toEqual(['aqua', 'aqua', 'aqua']);
      expect(tileCount(h.state)).toBe(100);
    } finally {
      setTestBag(null);
    }
  });

  it('leftovers stay on the keep-leftovers factory', () => {
    const h = started(2, opts({ specials: true }));
    setTable(h, [['red', 'blue', 'blue'], [], [], [], ['black']]);
    specials(h, { 0: { kind: 'sf3' } });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(game(h).factories[0]).toEqual(['blue', 'blue']);
    expect(lastTake(h)).toMatchObject({ special: 'sf3', leftover: 2 });
  });

  it('the split factory sends each colour left or right as the picker says, wrapping round', () => {
    const h = started(2, opts({ specials: true }));
    setTable(h, [['red', 'blue', 'blue', 'yellow'], ['black'], [], [], ['aqua']]);
    specials(h, { 0: { kind: 'sf4' } });
    expect(
      h.refuse('p1', {
        type: 'take',
        source: 0,
        colour: 'red',
        target: 0,
        split: { blue: 'left' },
      }),
    ).toBe('split-needed');
    h.act('p1', {
      type: 'take',
      source: 0,
      colour: 'red',
      target: 0,
      split: { blue: 'left', yellow: 'right' },
    });
    // Factory 1's left neighbour is factory 5.
    expect(game(h).factories[4]).toEqual(
      ['blue', 'blue', 'aqua'].sort(
        (a, b) =>
          ['blue', 'yellow', 'red', 'black', 'aqua'].indexOf(a) -
          ['blue', 'yellow', 'red', 'black', 'aqua'].indexOf(b),
      ),
    );
    expect(game(h).factories[1]).toEqual(['yellow', 'black']);
    expect(lastTake(h)).toMatchObject({ special: 'sf4', sent: { left: 2, right: 1 } });
    expect(tileCount(h.state)).toBe(100);
  });

  it('the shield catches the next item for the floor (the marker too), at no cost, and leaves the circle', () => {
    const h = started(2, opts({ specials: true }));
    setTable(h, [['red', 'red', 'red', 'blue'], ['yellow'], ['black'], [], []], { aqua: 2 });
    specials(h, { 0: { kind: 'sf5' } });
    // Three reds in line 1: two spill, the first onto the shield.
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(board(h, 'p1').shield).toBe('red');
    expect(board(h, 'p1').floor).toEqual(['red']);
    expect(lastTake(h)).toMatchObject({ special: 'sf5', shielded: true, penalty: -1 });
    expect(game(h).specials![0]!.holder).toBe('p1');
    expect(game(h).centre.blue).toBe(1);
    // Gone from the circle: factory 2's left neighbour is now factory 5.
    expect(neighbours(game(h).specials, 5, 1).left).toBe(4);
    expect(h.refuse('p2', { type: 'take', source: 0, colour: 'red', target: 1 })).toBe(
      'no-factory',
    );
    expect(tileCount(h.state)).toBe(100);
  });

  it('the shield takes the marker if it lands first, and its tile goes to the lid at round end', () => {
    const h = started(2, opts({ specials: true }));
    setTable(h, [['red'], [], [], [], []], { aqua: 1 });
    specials(h, { 0: { kind: 'sf5' } });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(board(h, 'p1').shield).toBeNull();
    h.act('p2', { type: 'take', source: 'centre', colour: 'aqua', target: 0 });
    expect(board(h, 'p2').shield).toBeUndefined();
    const h2 = started(2, opts({ specials: true }));
    setTable(h2, [['red'], ['blue'], [], [], []], { aqua: 1 });
    specials(h2, { 0: { kind: 'sf5' } });
    h2.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    h2.act('p2', { type: 'take', source: 1, colour: 'blue', target: 0 });
    h2.act('p1', { type: 'take', source: 'centre', colour: 'aqua', target: 'floor' });
    const ps = game(h2).scoring!.players.p1!;
    expect(ps.shielded).toBe('first');
    expect(ps.floor).toEqual(['aqua']);
    expect(ps.penalty).toBe(-1);
    expect(board(h2, 'p1').shield).toBeUndefined();
    expect(tileCount(h2.state)).toBe(100);
  });

  it('a strict timer on the split factory makes the bot’s split', () => {
    const h = started(2, opts({ specials: true, seconds: 30, timerMode: 'strict' }));
    setTable(h, [['red', 'blue'], ['blue'], [], [], []]);
    specials(h, { 0: { kind: 'sf4' } });
    h.tick();
    const t = lastTake(h);
    expect(t.auto).toBe('timer');
    expect(tileCount(h.state)).toBe(100);
  });
});

afterEach(() => {
  setTestBag(null);
});
