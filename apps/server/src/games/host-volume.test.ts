import { type GameDefinition, GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildGames } from './registry.ts';

// Every game with sound takes the host's `host-volume` action the same way: only from the host,
// 0 to 1, kept with a growing version in what every viewer sees (and on the table screen's
// volumes where the game has one). A room saved without it has none, and takes it from then on.

const SOUND_GAMES = [
  'nightfall',
  'hydra',
  'hogwarts',
  'short-fuse',
  'going-once',
  'sketchy',
  'cliffhanger',
  'defuse',
];
const TABLE_GAMES = new Set(['going-once', 'sketchy', 'cliffhanger', 'defuse']);

const content = {
  wordLists: () => [],
  words: () => [],
  questionDecks: () => [],
  questions: () => [],
  openQuestions: () => [],
  contentPacks: () => [],
  narrationLengths: () => null,
};
const PLAYERS = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id.toUpperCase() }));

type Loose = Record<string, unknown> & { settings?: Record<string, unknown> };
const hostOf = (view: unknown) => {
  const v = view as Loose;
  return (v.settings?.hostVolumes ?? v.hostVolumes) as
    Record<string, { level: number; v: number }> | undefined;
};
const tableOf = (view: unknown) => {
  const v = view as Loose;
  return (v.settings?.tableVolumes ?? v.tableVolumes) as Record<string, number> | undefined;
};

describe.each(SOUND_GAMES)('%s: the host sets everyone’s volume', (id) => {
  const game = buildGames().get(id) as unknown as GameDefinition<unknown, unknown, unknown>;
  const fresh = () => game.create({ now: 1_000, rng: createRng(7), content }, PLAYERS);
  const ctx = (by: string, isHost: boolean, now = 5_000) => ({
    now,
    rng: createRng(3),
    content,
    by,
    isHost,
  });
  const act = (state: unknown, which: string, level: number, by = 'a', now = 5_000) =>
    game.reduce(state, { type: 'host-volume', which, level }, ctx(by, by === 'a', now));

  it('is the host’s alone', () => {
    const out = act(fresh(), 'music', 0.4, 'b');
    expect(out).toBeInstanceOf(GameError);
    expect((out as GameError).code).toBe('not-host');
  });

  it('takes 0 to 1 on the four sliders only', () => {
    const ok = (a: unknown) => game.actionSchema.safeParse(a).success;
    for (const which of ['master', 'music', 'effects', 'voice'])
      expect(ok({ type: 'host-volume', which, level: 0.5 })).toBe(true);
    expect(ok({ type: 'host-volume', which: 'master', level: 0 })).toBe(true);
    expect(ok({ type: 'host-volume', which: 'master', level: 1 })).toBe(true);
    expect(ok({ type: 'host-volume', which: 'master', level: 1.2 })).toBe(false);
    expect(ok({ type: 'host-volume', which: 'master', level: -0.1 })).toBe(false);
    expect(ok({ type: 'host-volume', which: 'bass', level: 0.5 })).toBe(false);
  });

  it('reaches every viewer with a growing version', () => {
    const before = fresh();
    // A room saved before has no host volumes: nothing to apply.
    expect(hostOf(game.view(before, 'b'))?.music).toBeUndefined();
    const once = act(before, 'music', 0.4);
    expect(once).not.toBeInstanceOf(GameError);
    const seen = hostOf(game.view(once, 'b'))!;
    expect(seen.music).toEqual({ level: 0.4, v: 5_000 });
    expect(hostOf(game.view(once, null))!.music!.level).toBe(0.4);
    // Same clock: the version still moves on, and other sliders keep theirs.
    const twice = act(act(once, 'master', 0.7), 'music', 0.6);
    const again = hostOf(game.view(twice, 'c'))!;
    expect(again.music).toEqual({ level: 0.6, v: 5_001 });
    expect(again.master).toEqual({ level: 0.7, v: 5_000 });
    // Saved and loaded, it stays.
    expect(hostOf(game.view(JSON.parse(JSON.stringify(twice)), 'b'))).toEqual(again);
    if (TABLE_GAMES.has(id)) expect(tableOf(game.view(twice, null))).toMatchObject({ music: 0.6 });
  });

  it('works mid-game too', () => {
    let s = fresh();
    const start = game.reduce(s, { type: 'start' }, ctx('a', true));
    if (start instanceof GameError) return; // games that need more setup are covered in the lobby
    s = start;
    const out = act(s, 'effects', 0.25, 'a', 9_000);
    expect(out).not.toBeInstanceOf(GameError);
    expect(hostOf(game.view(out, 'b'))!.effects).toEqual({ level: 0.25, v: 9_000 });
  });
});
