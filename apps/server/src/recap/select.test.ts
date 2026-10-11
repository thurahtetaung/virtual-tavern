import {
  type AwardModule,
  type AwardRule,
  type GameEvents,
  type Tone,
  createRng,
  fixtureGame,
  mostBy,
  recapEv,
} from '@vt/game-sdk';
import type { RecapLine } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import { type EngineInput, runEngine } from './engine.ts';
import { type Scored, cardCap, pickNight, pickStrip, scoreOf } from './select.ts';

/** A rule awarding the most `type` events, with the given valence. */
const most = (
  id: string,
  type: string,
  valence: AwardRule['valence'],
  weight: AwardRule['weight'] = 3,
  family?: string,
): AwardRule => ({
  id,
  emoji: '⭐',
  title: id,
  valence,
  weight,
  kind: 'award',
  ...(family && { family }),
  copy: {
    cheeky: [`{who} did ${type} {n} times`, `{who}: ${type} ×{n}`],
    wholesome: [`{who} kindly did ${type} {n} times`, `{who} gently: ${type} ×{n}`],
  },
  compute: (g) => mostBy(g.of(type)),
});

const MODULE: AwardModule = {
  rules: [
    most('hits', 'hit', 'glory', 4, 'skill'),
    most('misses', 'miss', 'chaos', 4, 'blunder'),
    most('oops', 'oops', 'chaos', 5, 'blunder2'),
    most('quirks', 'quirk', 'gentle', 2, 'quirk'),
    most('speed', 'fast', 'glory', 3, 'speed'),
    {
      id: 'scene',
      emoji: '🎬',
      title: 'Scene',
      valence: 'glory',
      weight: 5,
      kind: 'moment',
      copy: {
        cheeky: ['A scene: {n} things at once', 'Scene! {n} things'],
        wholesome: ['A lovely scene: {n} things', 'What a scene: {n} things'],
      },
      compute: (g) => (g.of('scene').length ? [{ players: [], value: g.of('scene').length }] : []),
    },
  ],
  nuggets: [
    {
      id: 'hits',
      emoji: '🎯',
      interest: 3,
      compute: (games) => {
        const n = games.reduce((s, g) => s + g.of('hit').length, 0);
        return n ? { value: n, text: `${n} hits` } : null;
      },
    },
  ],
};

const PLAYERS = ['ana', 'ben', 'cy', 'dee', 'eli', 'fay', 'gus'];
const TYPES = ['hit', 'miss', 'oops', 'quirk', 'fast', 'scene'];

/** A random night: 1–5 games, 3–7 players, random events and winners. */
function randomNight(seed: number): GameEvents[] {
  const rng = createRng(seed);
  const games: GameEvents[] = [];
  const count = 1 + rng.int(5);
  for (let n = 1; n <= count; n++) {
    const players = rng
      .shuffle(PLAYERS)
      .slice(0, 3 + rng.int(5))
      .sort();
    const events = Array.from({ length: rng.int(25) }, (_, i) =>
      recapEv(TYPES[rng.int(TYPES.length)]!, players[rng.int(players.length)], {}, n * 1000 + i),
    );
    games.push(
      fixtureGame(events, {
        gameNo: n,
        players,
        winners: players.filter(() => rng.next() < 0.4),
        startedAt: n * 1000,
        endedAt: n * 1000 + 900,
      }),
    );
  }
  return games;
}

const input = (games: GameEvents[], tone: Tone = 'cheeky', extra: Partial<EngineInput> = {}) => ({
  roomId: 'room',
  nightKey: 'night',
  lastEventId: 'last',
  games,
  module: MODULE,
  tone,
  tzOffsetMin: null,
  exclude: new Set<string>(),
  ...extra,
});

const named = (lines: RecapLine[]) => lines.flatMap((l) => l.players);

describe('night card selection', () => {
  it('gives everyone who played at least one award (over many random nights)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const games = randomNight(seed);
      const out = runEngine(input(games));
      const covered = new Set([...named(out.awards), ...(out.mvp ? named([out.mvp]) : [])]);
      for (const p of new Set(games.flatMap((g) => g.players)))
        expect(covered.has(p), `seed ${seed}: ${p}`).toBe(true);
    }
  });

  it('keeps the caps: lines, two per player, one blunder per player', () => {
    for (let seed = 1; seed <= 150; seed++) {
      const games = randomNight(seed);
      const members = new Set(games.flatMap((g) => g.players)).size;
      const out = runEngine(input(games));
      // The guarantee may add a shared fallback line beyond the cap, never more than one per player.
      expect(out.awards.length).toBeLessThanOrEqual(Math.max(cardCap(members), members));
      const count = new Map<string, number>();
      const chaos = new Map<string, number>();
      for (const a of out.awards)
        for (const p of a.players) {
          count.set(p, (count.get(p) ?? 0) + 1);
          if (a.valence === 'chaos') chaos.set(p, (chaos.get(p) ?? 0) + 1);
        }
      for (const [p, n] of count) expect(n, `seed ${seed}: ${p}`).toBeLessThanOrEqual(2);
      for (const [p, n] of chaos) expect(n, `seed ${seed}: ${p}`).toBeLessThanOrEqual(1);
      // No award twice on the card.
      const ids = out.awards.map((a) => `${a.awardId}`);
      const repeats = ids.filter((id, i) => ids.indexOf(id) !== i);
      expect(repeats.every((id) => id.startsWith('night-'))).toBe(true);
    }
  });

  it('strips: the size, different players, at most one blunder', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const out = runEngine(input(randomNight(seed)));
      for (const g of out.games) {
        expect(g.lines.length).toBeLessThanOrEqual(3);
        const players = g.lines.filter((l) => l.awardId !== 'scene').flatMap((l) => l.players);
        expect(players.length).toBe(new Set(players).size);
        expect(g.lines.filter((l) => l.valence === 'chaos').length).toBeLessThanOrEqual(1);
      }
    }
  });

  it('is deterministic for a seed, and another seed only reorders and rewords', () => {
    const games = randomNight(42);
    expect(runEngine(input(games))).toEqual(runEngine(input(games)));
    const other = runEngine(input(games, 'cheeky', { lastEventId: 'other' }));
    const base = runEngine(input(games));
    // The same people are covered either way.
    expect(new Set(named(other.awards))).toEqual(new Set(named(base.awards)));
  });

  it('Wholesome never leads with a blunder and uses the kind copy', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const out = runEngine(input(randomNight(seed), 'wholesome'));
      if (out.awards.some((a) => a.valence !== 'chaos'))
        expect(out.awards[0]!.valence).not.toBe('chaos');
      for (const g of out.games)
        if (g.lines.some((l) => l.valence !== 'chaos'))
          expect(g.lines[0]!.valence).not.toBe('chaos');
      for (const a of out.awards.filter((l) => !l.awardId.startsWith('night-')))
        expect(a.text).toMatch(/kindly|gently|lovely|What a scene/);
    }
  });

  it('leaves excluded players out entirely', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const out = runEngine(input(randomNight(seed), 'cheeky', { exclude: new Set(['ana']) }));
      const everywhere = [
        ...named(out.awards),
        ...(out.mvp?.players ?? []),
        ...out.games.flatMap((g) => [...g.players, ...g.winners, ...named(g.lines)]),
      ];
      expect(everywhere).not.toContain('ana');
    }
  });

  it('a broken rule never breaks the recap', () => {
    const broken: AwardModule = {
      ...MODULE,
      rules: [
        ...MODULE.rules,
        {
          ...MODULE.rules[0]!,
          id: 'broken',
          compute: () => {
            throw new Error('nope');
          },
        },
      ],
      history: () => {
        throw new Error('nope');
      },
    };
    const out = runEngine(input(randomNight(3), 'cheeky', { module: broken }));
    expect(out.games.every((g) => g.history.length === 0)).toBe(true);
  });
});

describe('scoring and the strip', () => {
  const rule = (over: Partial<AwardRule>): AwardRule => ({
    id: 'r',
    emoji: '⭐',
    title: 'R',
    valence: 'glory',
    weight: 3,
    kind: 'award',
    copy: { cheeky: ['{who}', '{who}'], wholesome: ['{who}', '{who}'] },
    ...over,
  });

  it('a clear lead scores higher than a narrow one', () => {
    const r = rule({});
    expect(scoreOf(r, { players: ['a'], value: 5, runnerUp: 1 }, 'cheeky', 0)).toBeGreaterThan(
      scoreOf(r, { players: ['a'], value: 5, runnerUp: 4 }, 'cheeky', 0),
    );
  });

  it('blunders count for less in Wholesome mode', () => {
    const r = rule({ valence: 'chaos' });
    const c = { players: ['a'], value: 3 };
    expect(scoreOf(r, c, 'wholesome', 0)).toBeLessThan(scoreOf(r, c, 'cheeky', 0));
  });

  it('makes room for a win when the best lines are all quirks', () => {
    const s = (id: string, valence: AwardRule['valence'], score: number, p: string): Scored => ({
      rule: rule({ id, valence, family: id }),
      cand: { players: [p], value: 1 },
      score,
    });
    const strip = pickStrip(
      [
        s('a', 'gentle', 90, 'x'),
        s('b', 'gentle', 80, 'y'),
        s('c', 'chaos', 70, 'z'),
        s('d', 'glory', 10, 'w'),
      ],
      3,
    );
    expect(strip.map((l) => l.rule.id)).toContain('d');
    expect(strip).toHaveLength(3);
  });

  it('the guaranteed award is never a blunder', () => {
    const s = (id: string, valence: AwardRule['valence'], score: number): Scored => ({
      rule: rule({ id, valence }),
      cand: { players: ['solo'], value: 1 },
      score,
    });
    const fallback: Scored = { ...s('fallback', 'gentle', 0) };
    const picked = pickNight({
      scored: [s('blunder', 'chaos', 99)],
      members: ['solo'],
      fallbacks: () => [fallback],
    });
    // Solo's own line is the gentle fallback; the blunder may only come on top of it.
    expect(picked.awards.map((a) => a.rule.id)).toContain('fallback');
  });
});
