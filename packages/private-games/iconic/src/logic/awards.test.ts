import { type InsightEvent, fixtureGame, recapEv, recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { iconicAwards } from './awards.ts';
import { insights } from './insights.ts';
import { HOST, chooseWord, giver, guessRight, guessersOf, round, started } from './test-utils.ts';
import type { IconicState } from './types.ts';

const rule = (id: string) => iconicAwards.rules.find((r) => r.id === id)!;
const nugget = (id: string) => iconicAwards.nuggets.find((r) => r.id === id)!;

const word = (guesser: string | null, props: Record<string, unknown> = {}, givers = ['g']) =>
  recapEv('word', guesser, {
    outcome: guesser ? 'guessed' : 'abandoned',
    word: 'tower',
    level: 'easy',
    ms: 30_000,
    pieces: 6,
    givers,
    closeBy: [],
    icons: [1, 2],
    ...props,
  });

describe('award rules', () => {
  it('Mind Reader: most words guessed first, at least two', () => {
    const g = fixtureGame([word('a'), word('a'), word('b')]);
    expect(rule('ic.mind-reader').compute!(g)).toEqual([{ players: ['a'], value: 2, runnerUp: 1 }]);
    expect(rule('ic.mind-reader').compute!(fixtureGame([word('a'), word('b')]))).toEqual([]);
  });

  it('Speed Demon: the fastest guess under a minute; ties share', () => {
    const g = fixtureGame([word('a', { ms: 9_000 }), word('b', { ms: 12_000 })]);
    const [c] = rule('ic.speed-demon').compute!(g);
    expect(c).toMatchObject({ players: ['a'], value: 9_000, params: { s: 9 } });
    expect(rule('ic.speed-demon').compute!(fixtureGame([word('a', { ms: 90_000 })]))).toEqual([]);
    const tie = rule('ic.speed-demon').compute!(
      fixtureGame([word('a', { ms: 5_000 }), word('b', { ms: 5_000 })]),
    );
    expect(tie[0]!.players).toEqual(['a', 'b']);
  });

  it('Minimalist: the fewest pieces in a guessed word, shared by a pair', () => {
    const g = fixtureGame([word('a', { pieces: 2 }, ['x', 'y']), word('b', { pieces: 3 }, ['z'])]);
    expect(rule('ic.minimalist').compute!(g)[0]).toMatchObject({
      players: ['x', 'y'],
      params: { pieces: '2 pieces' },
    });
    // Abandoned words and big clues don't count.
    expect(
      rule('ic.minimalist').compute!(
        fixtureGame([word(null, { pieces: 1 }), word('a', { pieces: 9 })]),
      ),
    ).toEqual([]);
  });

  it('Painter: ten pieces or more in one guessed word', () => {
    expect(rule('ic.painter').compute!(fixtureGame([word('a', { pieces: 14 })]))).toEqual([
      { players: ['g'], value: 14 },
    ]);
    expect(rule('ic.painter').compute!(fixtureGame([word('a', { pieces: 9 })]))).toEqual([]);
  });

  it('So Close: most "close" marks, at least two', () => {
    const g = fixtureGame([
      word('a', { closeBy: ['b', 'b', 'c'] }),
      word(null, { closeBy: ['b'] }),
    ]);
    expect(rule('ic.close-call').compute!(g)[0]).toMatchObject({ players: ['b'], value: 3 });
  });

  it('old events without the props give nothing', () => {
    const g = fixtureGame([recapEv('word', 'a', {}), recapEv('word', 'a', {})]);
    for (const r of iconicAwards.rules.filter((x) => x.id !== 'ic.mind-reader'))
      expect(r.compute!(g), r.id).toEqual([]);
    for (const n of iconicAwards.nuggets) expect(n.compute([g]), n.id).toBeNull();
  });
});

describe('nuggets and history', () => {
  it('names the icon of the night as a placeholder', () => {
    const g = fixtureGame([
      word('a', { icons: [17, 3] }),
      word('b', { icons: [17] }),
      word(null, { icons: [17, 3] }),
    ]);
    expect(nugget('ic.icon-of-night').compute([g])?.text).toBe(
      'Icon of the night: {card:17}, in 3 clues',
    );
    expect(nugget('ic.fastest').compute([g])).toEqual({
      value: 30,
      text: 'Fastest word guessed: 30 s',
    });
  });

  it('one line per word', () => {
    const g = fixtureGame([word('a', { ms: 12_300 }), word(null, { word: 'mo{on' })]);
    expect(iconicAwards.history!(g)).toEqual([
      '{p:a} guessed “tower” in 12.3 s',
      '“moon” was abandoned',
    ]);
  });
});

describe('a real game', () => {
  it('feeds the awards through its own insights', () => {
    const h = started(4, { first: 'p1' });
    const events: InsightEvent[] = [];
    const run = (fn: () => void) => {
      const before: IconicState = h.state;
      fn();
      events.push(...insights(before, h.state, null, null));
    };
    for (let i = 0; i < 3; i++) {
      run(() => chooseWord(h));
      const g = giver(h);
      run(() => h.act(g, { type: 'place', set: 'main', icon: 17 }));
      const p = guessersOf(h)[0]!;
      run(() => h.act(p, { type: 'guess', text: 'close one' }));
      run(() => h.act(g, { type: 'mark', guess: round(h).guesses[0]!.id, mark: 'close' }));
      h.wait(4_000);
      run(() => h.act(p, { type: 'guess', text: round(h).answer!.word }));
      run(() => h.act(g, { type: 'award', guess: round(h).guesses[1]!.id }));
      run(() => h.tick());
      run(() => h.tick());
    }
    run(() => guessRight(h));
    run(() => h.act(HOST, { type: 'back-to-lobby' }));
    const words = events.filter((e) => e.type === 'word');
    expect(words).toHaveLength(4);
    expect(words[0]!.props).toMatchObject({ outcome: 'guessed', pieces: 1, icons: [17] });
    const g = fixtureGame(events.map((e, i) => recapEventOf(e, i + 1)));
    expect(rule('ic.close-call').compute!(g).length).toBe(1);
    expect(nugget('ic.icon-of-night').compute([g])?.text).toContain('{card:17}');
    expect(nugget('ic.words').compute([g])?.value).toBe(4);
  });

  it('reports the outcome when the game ends', () => {
    const h = started(3, { settings: { length: 'endless' } });
    guessRight(h);
    const before = h.state;
    h.act(HOST, { type: 'end-game' });
    const [out] = insights(before, h.state, null, HOST);
    expect(out).toMatchObject({ type: 'outcome', props: { words: 1, rounds: 1 } });
    expect(out!.winners).toHaveLength(1);
  });
});
