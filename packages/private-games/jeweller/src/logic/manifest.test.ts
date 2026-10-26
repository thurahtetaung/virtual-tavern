import { describe, expect, it } from 'vitest';
import { strongholdArt, strongholdColors } from './manifest.ts';

describe('strongholdColors', () => {
  const colors = (order: string[], room: Record<string, string>) =>
    strongholdColors(order, (id) => room[id]);

  it('goes by turn order when no room colour is a stronghold colour', () => {
    expect(colors(['a', 'b', 'c'], { a: 'pink', b: 'teal' })).toEqual({
      a: 'blue',
      b: 'red',
      c: 'green',
    });
  });

  it('gives players their room colour, then the rest in turn order', () => {
    expect(colors(['kim', 'ben'], { kim: 'yellow', ben: 'green' })).toEqual({
      kim: 'blue',
      ben: 'green',
    });
    expect(colors(['a', 'b', 'c', 'd'], { a: 'purple', b: 'blue', c: 'orange', d: 'red' })).toEqual(
      { a: 'green', b: 'blue', c: 'orange', d: 'red' },
    );
    expect(colors(['a', 'b', 'c', 'd'], { a: 'sky', b: 'mint', c: 'blue', d: 'grey' })).toEqual({
      a: 'red',
      b: 'green',
      c: 'blue',
      d: 'orange',
    });
  });

  it('never gives two players one colour', () => {
    const rooms: Record<string, string>[] = [
      {},
      { a: 'red', b: 'red' },
      { a: 'orange', d: 'blue' },
    ];
    for (const room of rooms) {
      const got = Object.values(colors(['a', 'b', 'c', 'd'], room));
      expect(new Set(got).size).toBe(4);
    }
  });
});

describe('strongholdArt', () => {
  it('finds the file named for the colour, else goes by the colour order', () => {
    const m = { strongholds: ['strongholds/red.webp', 'strongholds/blue.webp'] };
    expect(strongholdArt(m, 'blue')).toBe('strongholds/blue.webp');
    expect(strongholdArt(m, 'red')).toBe('strongholds/red.webp');
    expect(strongholdArt(m, 'green')).toBe('strongholds/red.webp');
    expect(strongholdArt({ strongholds: ['s/a.png', 's/b.png'] }, 'red')).toBe('s/b.png');
    expect(strongholdArt({}, 'red')).toBeUndefined();
    expect(strongholdArt(null, 'blue')).toBeUndefined();
  });
});
