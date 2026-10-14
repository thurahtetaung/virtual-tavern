import { type BotCtx, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { shortFuseBot } from './bot.ts';
import { shortFuse } from './game.ts';
import { rigged } from './test-utils.ts';
import type { Settings, ShortFuseAction, ShortFuseView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const ctx = (me: string, seed = 1): BotCtx => ({
  me,
  now: 0,
  rng: createRng(seed),
  words: () => [],
});

/** The human host's buttons: pick the deck, then start. */
const host =
  (settings: Partial<Settings>) =>
  (view: ShortFuseView): ShortFuseAction | null => {
    if (view.phase !== 'lobby') return null;
    const ready = Object.entries(settings).every(
      ([k, v]) => view.settings[k as keyof Settings] === v,
    );
    return ready ? { type: 'start' } : { type: 'update-settings', ...settings };
  };

const PRESETS: Record<string, Partial<Settings>> = {
  classic: { core: 'classic', art: 'classic', x1: false },
  adult: { core: 'classic', art: 'adult', x1: false },
  party: { core: 'party', art: 'classic', x1: false },
  'classic+x1': { core: 'classic', art: 'classic', x1: true },
  'party+x1': { core: 'party', art: 'classic', x1: true, faster: true },
  'classic+x2': { core: 'classic', art: 'classic', x1: false, x2: true },
  'classic+x3': { core: 'classic', art: 'classic', x1: false, x3: true },
  'all three': { core: 'classic', art: 'classic', x1: true, x2: true, x3: true },
  'party+x2+x3': { core: 'party', art: 'classic', x1: false, x2: true, x3: true },
  zombie: { core: 'classic', art: 'classic', x1: false, x4: true },
  'zombie faster': { core: 'classic', art: 'adult', x1: false, x4: true, faster: true },
  'party+x4': { core: 'party', art: 'classic', x1: false, x4: true },
  chaos: { core: 'classic', art: 'classic', x1: true, x2: true, x3: true, x4: true },
};
/** The later expansions (and Chaos) play at every table size; the rest at a spread of them. */
const sizes = (name: string) =>
  /x2|x3|x4|all|zombie|chaos/.test(name) ? [2, 3, 4, 5, 6, 7, 8, 9, 10] : [2, 3, 5, 7, 10];

describe('bots', () => {
  it('take the view, never the state', () => {
    expectTypeOf(shortFuseBot).parameter(0).toEqualTypeOf<ShortFuseView>();
  });

  for (const [name, settings] of Object.entries(PRESETS))
    for (const n of sizes(name))
      it(`finish a ${name} game at ${n} players with no refused moves`, () => {
        for (const seed of [1, 2, 3]) {
          const r = playWithBots(shortFuse, seats(n), {
            seed,
            host: host(settings),
            maxSteps: 4000,
          });
          expect(r.refused, `${name} ${n}p seed ${seed}`).toEqual([]);
          expect(r.over, `${name} ${n}p seed ${seed}`).toBe(true);
        }
      });

  it('dodges a Bomb it saw on top', () => {
    const h = rigged([['peek3', 'skip'], []], ['bomb', 'cat1', 'cat2']);
    h.play('host', ['peek3']);
    expect(shortFuseBot(h.view('host'), ctx('host'))).toMatchObject({ type: 'play' });
    const move = shortFuseBot(h.view('host'), ctx('host')) as Extract<
      ShortFuseAction,
      { type: 'play' }
    >;
    expect(h.game().cards[move.cards[0]!]!.t).toBe('skip');
  });

  it('defuses, and moves danger to the back when rearranging', () => {
    const h = rigged([['defuse', 'alter3'], []], ['bomb', 'cat1', 'cat2'], {
      settings: { x1: true },
    });
    h.play('host', ['alter3']);
    expect(shortFuseBot(h.view('host'), ctx('host'))).toEqual({ type: 'order', order: [1, 2, 0] });
    h.act({ type: 'order', order: [0, 1, 2] }, 'host');
    h.act({ type: 'draw' }, 'host');
    expect(shortFuseBot(h.view('host'), ctx('host'))).toEqual({ type: 'defuse' });
  });

  it('only sits down in the lobby and leaves starting to the host', () => {
    const h = rigged([[], []], []);
    h.act({ type: 'draw' }, 'host');
    expect(shortFuseBot(h.view('host'), ctx('host'))).toBeNull();
  });
});
