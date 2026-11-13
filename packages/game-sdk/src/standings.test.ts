import { describe, expect, it } from 'vitest';
import { ordinal, rankStandings, winTitle, winnersLine, winnersTitle } from './standings.ts';

const entry = (name: string, score: number) => ({ name, score });
const places = (ranked: ReturnType<typeof rankStandings<{ name: string; score: number }>>) =>
  ranked.map((r) => `${r.place}${r.tied ? '=' : ''} ${r.entry.name}`);

describe('rankStandings', () => {
  it('ranks best first', () => {
    const ranked = rankStandings(
      [entry('Ana', 3), entry('Ben', 7), entry('Cy', 5)],
      (e) => e.score,
    );
    expect(places(ranked)).toEqual(['1 Ben', '2 Cy', '3 Ana']);
  });

  it('lets ties share a place and skips the next one', () => {
    const ranked = rankStandings(
      [entry('Ana', 5), entry('Ben', 7), entry('Cy', 7), entry('Dee', 5), entry('Eve', 1)],
      (e) => e.score,
    );
    expect(places(ranked)).toEqual(['1= Ben', '1= Cy', '3= Ana', '3= Dee', '5 Eve']);
  });

  it('can rank lowest first', () => {
    const ranked = rankStandings([entry('Ana', 3), entry('Ben', 1)], (e) => e.score, {
      lowerIsBetter: true,
    });
    expect(places(ranked)).toEqual(['1 Ben', '2 Ana']);
  });

  it('handles nobody', () => {
    expect(rankStandings([], () => 0)).toEqual([]);
  });
});

describe('winnersLine', () => {
  const name = (e: { name: string }) => e.name;
  it('names one winner once, or everyone who shares the win', () => {
    expect(
      winnersLine(
        rankStandings([entry('Ana', 2), entry('Ben', 1)], (e) => e.score),
        name,
      ),
    ).toBe('Ana wins!');
    expect(
      winnersLine(
        rankStandings([entry('Ana', 2), entry('Ben', 2), entry('Cy', 1)], (e) => e.score),
        name,
      ),
    ).toBe('Ana and Ben share the win!');
    expect(winnersLine([], name)).toBe('');
  });
});

describe('ordinal', () => {
  it('spells places', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '101st',
    ]);
  });
});

describe('winnersTitle', () => {
  const e = (id: string, score: number) => ({ id, name: id.toUpperCase(), score });
  it('names the top scorer, the viewer as You, a shared win, and nobody without points', () => {
    expect(winnersTitle([e('a', 3), e('b', 5)])).toBe('B wins!');
    expect(winnersTitle([e('a', 3), e('b', 5)], 'b')).toBe('You win!');
    expect(winnersTitle([e('a', 5), e('b', 5)], 'a')).toBe('You and B share the win!');
    expect(winnersTitle([e('a', 0), e('b', 0)])).toBe('');
  });
});

describe('winTitle', () => {
  const name = (id: string) => id.toUpperCase();
  it('names the winners, the viewer as You, and nobody as empty', () => {
    expect(winTitle(['a'], name)).toBe('A wins!');
    expect(winTitle(['a'], name, 'a')).toBe('You win!');
    expect(winTitle(['a', 'b'], name, 'b')).toBe('You and A win!');
    expect(winTitle([], name)).toBe('');
  });
});
