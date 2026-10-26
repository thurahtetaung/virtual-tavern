import { describe, expect, it } from 'vitest';
import { mosaic } from './game.ts';
import { bonusOf, emptyBoard, previewOf, scoreAt, tileWall } from './rules.ts';
import {
  HOST,
  board,
  counts,
  game,
  harness,
  setBoard,
  setTable,
  started,
  tileCount,
} from './test-utils.ts';
import type { Colour, LogEntry } from './types.ts';

const lastTake = (h: ReturnType<typeof started>) =>
  [...h.state.log].reverse().find((e) => e.kind === 'take') as Extract<LogEntry, { kind: 'take' }>;

/** Empties the table except one tile, so the next take ends the round. */
const lastTile = (h: ReturnType<typeof started>, c: Colour = 'blue') =>
  setTable(h, [[c], [], [], [], []]);

describe('setup', () => {
  it('deals 4 tiles to 5, 7 or 9 factories by player count', () => {
    for (const [n, f] of [
      [2, 5],
      [3, 7],
      [4, 9],
    ] as const) {
      const h = started(n);
      expect(game(h).factories).toHaveLength(f);
      expect(game(h).factories.every((x) => x.length === 4)).toBe(true);
      expect(game(h).bag).toHaveLength(100 - 4 * f);
      expect(game(h).marker).toBe('centre');
      expect(tileCount(h.state)).toBe(100);
    }
  });

  it('picks the first player at random, then moves one seat on each game', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed < 20; seed++) {
      const h = harness(3, seed);
      h.act(HOST, { type: 'start' });
      firsts.add(game(h).starter);
    }
    expect(firsts.size).toBeGreaterThan(1);
    const h = harness(3, 3);
    h.act(HOST, { type: 'start' });
    const order = game(h).order;
    const first = game(h).starter;
    h.act(HOST, { type: 'back-to-lobby' });
    h.act(HOST, { type: 'start' });
    expect(game(h).starter).toBe(order[(order.indexOf(first) + 1) % 3]);
  });

  it('seats at most 4; the rest watch', () => {
    const h = harness(5);
    expect(h.state.seats.p5!.playing).toBe(false);
    expect(h.refuse('p5', { type: 'sit', playing: true })).toBe('full');
  });
});

describe('taking tiles', () => {
  it('takes every tile of a colour; the rest of the factory slides to the centre', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'blue', 'yellow'], ['black'], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 1 });
    expect(board(h, 'p1').lines[1]).toEqual({ colour: 'red', count: 2 });
    expect(game(h).factories[0]).toEqual([]);
    expect(game(h).centre).toEqual(counts({ blue: 1, yellow: 1 }));
    expect(game(h).current).toBe('p2');
    expect(lastTake(h)).toMatchObject({ count: 2, toLine: 2, leftover: 2, penalty: 0 });
  });

  it('spills what doesn’t fit onto the floor, and past 7 spaces into the lid at no cost', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'red', 'red'], ['black'], [], [], []]);
    setBoard(h, 'p1', { floor: ['blue', 'blue', 'blue', 'blue'] });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 0 });
    expect(board(h, 'p1').lines[0]).toEqual({ colour: 'red', count: 1 });
    expect(board(h, 'p1').floor).toHaveLength(7);
    expect(game(h).lid.red).toBe(0);
    expect(lastTake(h)).toMatchObject({ toLine: 1, toFloor: 3, toLid: 0, penalty: -8 });
    expect(tileCount(h.state)).toBe(100);
  });

  it('a full floor sends the rest to the lid', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'black', 'black'], ['black'], [], [], []]);
    setBoard(h, 'p1', { floor: ['blue', 'blue', 'blue', 'blue', 'blue', 'blue', 'blue'] });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 'floor' });
    expect(game(h).lid.red).toBe(2);
    expect(lastTake(h)).toMatchObject({ toFloor: 0, toLid: 2, penalty: 0 });
    expect(tileCount(h.state)).toBe(100);
  });

  it('refuses another colour in a line, a colour already in that wall row, and a full line', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'blue', 'blue'], ['black'], [], [], []]);
    setBoard(h, 'p1', {
      lines: [
        { colour: 'yellow', count: 1 },
        { colour: 'black', count: 1 },
        { colour: null, count: 0 },
        { colour: null, count: 0 },
        { colour: null, count: 0 },
      ],
      wall: { 2: ['red'] },
    });
    expect(h.refuse('p1', { type: 'take', source: 0, colour: 'red', target: 0 })).toBe('bad-line');
    expect(h.refuse('p1', { type: 'take', source: 0, colour: 'red', target: 1 })).toBe('bad-line');
    expect(h.refuse('p1', { type: 'take', source: 0, colour: 'red', target: 2 })).toBe('bad-line');
    expect(h.refuse('p1', { type: 'take', source: 1, colour: 'red', target: 3 })).toBe('not-there');
    expect(h.refuse('p2', { type: 'take', source: 0, colour: 'red', target: 3 })).toBe(
      'not-your-turn',
    );
    // Two lines may hold the same colour.
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 3 });
    h.act('p2', { type: 'take', source: 1, colour: 'black', target: 0 });
    h.act('p1', { type: 'take', source: 'centre', colour: 'blue', target: 4 });
    expect(board(h, 'p1').lines[3]).toEqual({ colour: 'red', count: 2 });
  });

  it('may throw usable tiles on the floor (marked as dumped)', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'blue', 'blue'], ['black'], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 'floor' });
    expect(board(h, 'p1').floor).toEqual(['red', 'red']);
    expect(lastTake(h)).toMatchObject({ dumped: 2, penalty: -2 });
  });

  it('with no line for the colour, everything goes to the floor (not counted as dumped)', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'blue', 'blue'], ['black'], [], [], []]);
    setBoard(h, 'p1', { wall: { 0: ['red'], 1: ['red'], 2: ['red'], 3: ['red'], 4: ['red'] } });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 'floor' });
    expect(lastTake(h)).toMatchObject({ dumped: 0, toFloor: 2 });
  });

  it('the first to take from the centre takes the marker, on the leftmost free floor space', () => {
    const h = started(2);
    setTable(h, [
      ['red', 'red', 'blue', 'blue'],
      ['black', 'black', 'red', 'red'],
      ['aqua', 'aqua', 'aqua', 'aqua'],
      [],
      [],
    ]);
    setBoard(h, 'p2', { floor: ['yellow'] });
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 1 });
    h.act('p2', { type: 'take', source: 'centre', colour: 'blue', target: 1 });
    expect(board(h, 'p2').floor).toEqual(['yellow', 'first']);
    expect(game(h).marker).toBe('p2');
    expect(lastTake(h)).toMatchObject({ marker: true, penalty: -1 });
    h.act('p1', { type: 'take', source: 1, colour: 'black', target: 2 });
    h.act('p2', { type: 'take', source: 'centre', colour: 'red', target: 2 });
    expect(lastTake(h)).toMatchObject({ marker: false });
    expect(board(h, 'p2').floor).toEqual(['yellow', 'first']);
  });

  it('the marker with a full floor: no space, no extra cost, still starts next round', () => {
    const h = started(2);
    setTable(h, [['red', 'black', 'black', 'black'], [], [], [], []], { blue: 1 });
    setBoard(h, 'p1', {
      floor: ['yellow', 'yellow', 'yellow', 'yellow', 'yellow', 'yellow', 'yellow'],
    });
    h.act('p1', { type: 'take', source: 'centre', colour: 'blue', target: 0 });
    expect(game(h).marker).toBe('p1');
    expect(board(h, 'p1').floor).not.toContain('first');
    expect(lastTake(h)).toMatchObject({ marker: true, penalty: 0 });
    h.act('p2', { type: 'take', source: 0, colour: 'black', target: 2 });
    h.act('p1', { type: 'take', source: 'centre', colour: 'red', target: 'floor' });
    expect(game(h).stage).toBe('tiling');
    h.act('p1', { type: 'ready' });
    h.act('p2', { type: 'ready' });
    expect(game(h).starter).toBe('p1');
  });
});

describe('scoring', () => {
  it('a lone tile scores 1; joined runs score their lengths, the tile counting in both', () => {
    const wall = emptyBoard().wall;
    expect(scoreAt(wall, 2, 2).points).toBe(1);
    // A row of 3 and a column of 3 through (2, 2): 6, not 8.
    wall[2]![1] = 'blue';
    wall[2]![3] = 'blue';
    wall[1]![2] = 'blue';
    wall[3]![2] = 'blue';
    wall[2]![2] = 'blue';
    expect(scoreAt(wall, 2, 2)).toEqual({ points: 6, across: 3, down: 3 });
    // Diagonals never count.
    const w2 = emptyBoard().wall;
    w2[0]![0] = 'blue';
    w2[1]![1] = 'yellow';
    expect(scoreAt(w2, 1, 1).points).toBe(1);
  });

  it('tiles full lines top to bottom (an upper tile already counts), keeps the rest, charges the floor', () => {
    const b = emptyBoard();
    b.lines[0] = { colour: 'blue', count: 1 }; // row 0, col 0
    b.lines[1] = { colour: 'aqua', count: 2 }; // row 1, col 0: under the blue
    b.lines[3] = { colour: 'red', count: 2 }; // not full
    b.floor = ['first', 'black', 'black'];
    b.score = 1;
    const r = tileWall(b);
    expect(r.placed.map((p) => [p.row, p.col, p.points])).toEqual([
      [0, 0, 1],
      [1, 0, 2],
    ]);
    expect(r.lid).toEqual(['aqua', 'black', 'black']);
    expect(r.penalty).toBe(-4);
    // 1 + 1 + 2 − 4 = 0, never below.
    expect(b.score).toBe(0);
    expect(b.lines[3]).toEqual({ colour: 'red', count: 2 });
    expect(b.floor).toEqual([]);
  });

  it('the preview says what a filled line will score', () => {
    const b = emptyBoard();
    b.wall[2]![2] = 'blue';
    b.lines[2] = { colour: 'red', count: 1 };
    // Red in row 2 goes to column 4.
    const p = previewOf(b, 'red', 3, 2, true);
    expect(p).toMatchObject({ toLine: 2, toFloor: 1, fills: true, penalty: -2, points: 1 });
    b.wall[2]![3] = 'black';
    expect(previewOf(b, 'red', 2, 2, false).points).toBe(3);
    expect(previewOf(b, 'blue', 1, 2, false).problem).toMatch(/already has/);
  });

  it('bonuses: +2 a row, +7 a column, +10 a colour', () => {
    const b = emptyBoard();
    for (let c = 0; c < 5; c++) b.wall[0]![c] = 'blue';
    for (let r = 0; r < 5; r++) b.wall[r]![0] = 'blue';
    expect(bonusOf(b.wall)).toEqual({ rows: 1, columns: 1, colours: 0, points: 9 });
  });
});

describe('rounds', () => {
  it('the marker holder starts next round; the lid fills the bag when it runs out', () => {
    const h = started(2);
    setTable(h, [['red', 'black', 'black', 'black'], [], [], [], []], { blue: 1 });
    h.act('p1', { type: 'take', source: 0, colour: 'black', target: 2 });
    h.act('p2', { type: 'take', source: 'centre', colour: 'blue', target: 0 });
    h.act('p1', { type: 'take', source: 'centre', colour: 'red', target: 0 });
    expect(game(h).stage).toBe('tiling');
    expect(game(h).scoring!.players.p2!.placed).toHaveLength(1);
    h.rig((s) => {
      const g = s.game!;
      // Most of the bag in the lid: the fill takes the bag, then the lid.
      for (const t of g.bag.splice(3)) g.lid[t] += 1;
    });
    h.act('p2', { type: 'ready' });
    h.act('p1', { type: 'ready' });
    expect(game(h).round).toBe(2);
    expect(game(h).starter).toBe('p2');
    expect(game(h).current).toBe('p2');
    expect(game(h).marker).toBe('centre');
    expect(game(h).factories.every((f) => f.length === 4)).toBe(true);
    expect(tileCount(h.state)).toBe(100);
  });

  it('nobody took the marker: the same player starts again, at no cost', () => {
    const h = started(2);
    setTable(h, [['red', 'red', 'red', 'red'], ['blue', 'blue', 'blue', 'blue'], [], [], []]);
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 3 });
    h.act('p2', { type: 'take', source: 1, colour: 'blue', target: 3 });
    expect(game(h).stage).toBe('tiling');
    expect(game(h).scoring!.players.p1).toMatchObject({ penalty: 0, after: 1 });
    h.tick();
    expect(game(h).round).toBe(2);
    expect(game(h).starter).toBe('p1');
  });

  it('with bag and lid empty, factories are filled as far as they go', () => {
    const h = started(2);
    lastTile(h);
    h.rig((s) => {
      const g = s.game!;
      g.bag = ['red', 'red', 'red', 'red', 'red', 'blue'];
      g.lid = counts({});
    });
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 'floor' });
    h.act('p1', { type: 'skip-tiling' });
    // The blue went to the lid, so the bag gets it back: 7 tiles in all.
    expect(game(h).factories.map((f) => f.length)).toEqual([4, 3, 0, 0, 0]);
  });

  it('a round with no tiles anywhere ends the game as normal', () => {
    const h = started(2);
    lastTile(h);
    setBoard(h, 'p2', { wall: { 0: ['blue', 'yellow'] }, score: 5 });
    h.rig((s) => {
      s.game!.bag = [];
      s.game!.lid = counts({});
    });
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    h.tick();
    expect(h.state.phase).toBe('over');
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'end', how: 'empty' });
    expect(game(h).winners).toEqual(['p2']);
  });

  it('the wall-tiling waits for everyone still here, a deadline, or the host', () => {
    const h = started(3);
    lastTile(h);
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    expect(mosaic.nextDeadline!(h.state)).toBe(h.now + 3000 + 1500 * 3);
    expect(h.refuse('p2', { type: 'take', source: 0, colour: 'red', target: 0 })).toBe(
      'wrong-stage',
    );
    h.act('p1', { type: 'ready' });
    h.act('p2', { type: 'ready' });
    expect(game(h).stage).toBe('tiling');
    h.state = mosaic.playerLeft(h.state, 'p3', h.now);
    expect(game(h).stage).toBe('draft');
    expect(game(h).round).toBe(2);
    expect(h.refuse('p2', { type: 'skip-tiling' })).toBe('not-host');
  });
});

describe('the end', () => {
  it('ends after the round in which a row is completed, with bonuses', () => {
    const h = started(2);
    lastTile(h);
    setBoard(h, 'p1', { wall: { 0: ['yellow', 'red', 'black', 'aqua'] }, score: 10 });
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    expect(h.state.phase).toBe('over');
    const ps = game(h).scoring!.players.p1!;
    // Placed at the row's start: a run of 5 scores 5; then +2 for the row.
    expect(ps.placed[0]!.points).toBe(5);
    expect(ps.bonus).toEqual({ rows: 1, columns: 0, colours: 0, points: 2 });
    expect(board(h, 'p1').score).toBe(17);
    expect(game(h).winners).toEqual(['p1']);
    expect(game(h).scoring!.last).toBe(true);
  });

  it('a tie goes to most full rows, then a shared win', () => {
    const h = started(2);
    lastTile(h);
    setBoard(h, 'p1', { wall: { 0: ['yellow', 'red', 'black', 'aqua'] }, score: 3 });
    setBoard(h, 'p2', { score: 10 });
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    expect(board(h, 'p1').score).toBe(10);
    expect(game(h).winners).toEqual(['p1']);

    const t = started(2);
    lastTile(t);
    setBoard(t, 'p1', { wall: { 0: ['yellow', 'red', 'black', 'aqua'] }, score: 3 });
    setBoard(t, 'p2', { wall: { 1: ['blue', 'yellow', 'red', 'black', 'aqua'] }, score: 8 });
    t.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    // p1: 3 + 5 + 2 = 10; p2: 8 + 2 = 10; one row each.
    expect(board(t, 'p2').score).toBe(10);
    expect(game(t).winners).toEqual(['p1', 'p2']);
  });
});

describe('timers and leavers', () => {
  it('soft: a reminder; the host may act for the player', () => {
    const h = started(2);
    expect(game(h).clock).toMatchObject({ reminded: false });
    h.tick();
    expect(game(h).clock!.reminded).toBe(true);
    expect(game(h).current).toBe('p1');
    expect(mosaic.nextDeadline!(h.state)).toBeNull();
    expect(h.refuse('p2', { type: 'act-for', player: 'p1' })).toBe('not-host');
    h.act(HOST, { type: 'act-for', player: 'p1' });
    expect(lastTake(h)).toMatchObject({ by: 'p1', auto: 'host' });
  });

  it('strict: the safe move, never a floor dump when a line can take the tiles', () => {
    const h = started(2, { settings: { timerMode: 'strict', seconds: 30 } });
    setTable(h, [['red', 'red', 'blue', 'blue'], ['black', 'black', 'black', 'black'], [], [], []]);
    h.tick();
    expect(lastTake(h)).toMatchObject({ by: 'p1', auto: 'timer', toFloor: 0 });
    expect(lastTake(h).target).not.toBe('floor');
    expect(game(h).current).toBe('p2');
  });

  it('a player who left has the safe move made after 3 s, and carries on when back', () => {
    const h = started(2);
    h.state = mosaic.playerLeft(h.state, 'p1', h.now);
    expect(mosaic.nextDeadline!(h.state)).toBe(h.now + 3000);
    h.tick();
    expect(lastTake(h)).toMatchObject({ by: 'p1', auto: 'left' });
    h.state = mosaic.playerJoined(h.state, { id: 'p1', name: 'P1' });
    expect(game(h).left).toEqual({});
  });

  it('the host removes a player who left: tiles to the lid, the turn and the marker move on', () => {
    const h = started(3);
    setTable(
      h,
      [['red', 'red', 'blue', 'blue'], ['black', 'black', 'black', 'black'], [], [], [], [], []],
      {
        yellow: 1,
      },
    );
    h.act('p1', { type: 'take', source: 0, colour: 'red', target: 1 });
    h.act('p2', { type: 'take', source: 'centre', colour: 'yellow', target: 4 });
    expect(game(h).marker).toBe('p2');
    expect(h.refuse(HOST, { type: 'remove', player: 'p2' })).toBe('not-left');
    h.state = mosaic.playerLeft(h.state, 'p2', h.now);
    h.act(HOST, { type: 'remove', player: 'p2' });
    expect(game(h).removed).toEqual(['p2']);
    expect(board(h, 'p2').lines.every((l) => l.count === 0)).toBe(true);
    expect(game(h).lid.yellow).toBe(1);
    expect(tileCount(h.state)).toBe(100);
    expect(game(h).current).toBe('p3');
    h.act('p3', { type: 'take', source: 1, colour: 'black', target: 3 });
    h.act('p1', { type: 'take', source: 'centre', colour: 'blue', target: 2 });
    expect(game(h).stage).toBe('tiling');
    expect(game(h).scoring!.players.p2).toBeUndefined();
    h.tick();
    // p2 held the marker: the next seat starts.
    expect(game(h).starter).toBe('p3');
    expect(game(h).order).toEqual(['p1', 'p2', 'p3']);
  });

  it('one player left wins, with bonuses', () => {
    const h = started(2);
    setBoard(h, 'p1', { wall: { 0: ['blue', 'yellow', 'red', 'black', 'aqua'] }, score: 4 });
    h.state = mosaic.playerLeft(h.state, 'p2', h.now);
    h.act(HOST, { type: 'remove', player: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p1']);
    expect(board(h, 'p1').score).toBe(6);
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'end', how: 'alone' });
  });

  it('play again, and back to the lobby', () => {
    const h = started(2);
    lastTile(h);
    setBoard(h, 'p1', { wall: { 0: ['yellow', 'red', 'black', 'aqua'] } });
    h.act('p1', { type: 'take', source: 0, colour: 'blue', target: 0 });
    expect(h.refuse('p2', { type: 'play-again' })).toBe('not-host');
    h.act(HOST, { type: 'play-again' });
    expect(h.state.phase).toBe('playing');
    expect(tileCount(h.state)).toBe(100);
    h.act(HOST, { type: 'back-to-lobby' });
    expect(h.state.phase).toBe('lobby');
  });
});
