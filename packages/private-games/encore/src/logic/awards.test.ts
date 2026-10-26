import {
  type InsightEvent,
  createRng,
  fixtureGame,
  isGameError,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { encoreAwards } from './awards.ts';
import { encoreBot } from './bot.ts';
import { encore } from './game.ts';
import { insights } from './insights.ts';
import { content, playing } from './test-utils.ts';
import type { EncoreAction } from './types.ts';

const rule = (id: string) => encoreAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c'] };
const show = (by: string, props: Record<string, unknown>) =>
  recapEv('show', by, { size: 1, kind: 'single', captured: 0, ...props });

describe('awards', () => {
  it('showstopper: the biggest show, 4 cards or more', () => {
    const g = fixtureGame([show('a', { size: 5 }), show('b', { size: 4 })], players);
    expect(rule('en.big-show').compute!(g)[0]).toMatchObject({ players: ['a'], value: 5 });
    expect(rule('en.big-show').compute!(fixtureGame([show('a', { size: 3 })], players))).toEqual(
      [],
    );
    // Moves the table made don't count.
    expect(
      rule('en.big-show').compute!(fixtureGame([show('a', { size: 6, auto: true })], players)),
    ).toEqual([]);
  });

  it('crowd favourite, talent recruit and borrowed brilliance', () => {
    const g = fixtureGame(
      [
        ...Array.from({ length: 3 }, () => recapEv('recruit', 'b', { owner: 'a' })),
        recapEv('recruit', 'c', { owner: 'a' }),
        recapEv('recruit', 'a', { owner: 'c', auto: true }),
        show('c', { withRecruited: true }),
        show('c', { withRecruited: true }),
        show('b', { withRecruited: false }),
      ],
      players,
    );
    expect(rule('en.crowd-favourite').compute!(g)[0]).toMatchObject({ players: ['a'], value: 4 });
    expect(rule('en.talent-recruit').compute!(g)).toEqual([]);
    expect(rule('en.recycled').compute!(g)[0]).toMatchObject({ players: ['c'], value: 2 });
    // 2-player chips paid into the middle are nobody's points.
    const paid = fixtureGame(
      Array.from({ length: 4 }, () => recapEv('recruit', 'b', { owner: 'a', paid: true })),
      players,
    );
    expect(rule('en.crowd-favourite').compute!(paid)).toEqual([]);
    expect(rule('en.talent-recruit').compute!(paid)[0]).toMatchObject({ players: ['b'], value: 4 });
  });

  it('curtain closer and in the red', () => {
    const round = (ender: string, negative: string[]) =>
      recapEv('round', ender, { how: 'unbeaten', negative, round: 1 });
    const g = fixtureGame([round('a', ['b', 'c']), round('a', ['b']), round('c', [])], players);
    expect(rule('en.encore').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('en.in-the-red').compute!(g)[0]).toMatchObject({ players: ['b'], value: 2 });
    // Old events without the props give nothing.
    expect(rule('en.in-the-red').compute!(fixtureGame([recapEv('round', 'a')], players))).toEqual(
      [],
    );
  });

  it('history and nuggets', () => {
    const g = fixtureGame(
      [
        show('a', { size: 5 }),
        recapEv('round', 'a', { round: 1, how: 'out' }),
        recapEv('round', 'b', { round: 2, how: 'unbeaten' }),
        recapEv('outcome', null, { scores: [9, 3] }),
        ...Array.from({ length: 10 }, () => recapEv('recruit', 'c', { owner: 'a' })),
      ],
      players,
    );
    expect(encoreAwards.history!(g)).toEqual([
      'Round 1: {p:a} played out their hand',
      'Round 2: {p:b} went unbeaten',
    ]);
    expect(encoreAwards.nuggets.map((n) => n.compute([g]))).toEqual([
      { value: 5, text: 'Biggest show: 5 cards' },
      { value: 9, text: 'Highest score: 9 points' },
      { value: 10, text: '10 cards recruited' },
    ]);
  });

  it('insights note a Show that used a recruited card', () => {
    const h = playing(3, { p1: '5/1 7/1 9/2' }, { table: '6/1 9/3', owner: 'p3' });
    const before = h.state;
    h.act('p1', { type: 'recruit-show', end: 'left', flip: false, at: 1, from: 0, to: 2 });
    const events = insights(before, h.state, null, 'p1');
    expect(events.map((e) => e.type)).toEqual(['recruit', 'show']);
    expect(events[1]!.props).toMatchObject({
      size: 3,
      kind: 'run',
      withRecruited: true,
      double: true,
    });
    expect(events[0]!.props).toMatchObject({ owner: 'p3', double: true });
  });

  it('every rule reads a real game played by bots', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c', 'd'];
      let now = 1_000;
      let state = encore.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: EncoreAction) => {
        const next = encore.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) throw new Error(next.code);
        events.push(...insights(state, next, action, by));
        state = next;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 3000 && state.phase === 'playing'; i++) {
        now += 1000;
        const g = state.game!;
        const by =
          g.stage === 'flip'
            ? g.order.find((id) => g.players[id]!.flip === null)!
            : g.stage === 'scores'
              ? g.order.find((id) => !g.players[id]!.ready)!
              : g.current;
        const move = encoreBot(encore.view(state, by), { me: by, now, rng, words: () => [] });
        act(by, move!);
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('round')).toHaveLength(4);
      expect(g.of('show').length).toBeGreaterThan(8);
      for (const r of encoreAwards.rules)
        for (const c of r.compute!(g))
          for (const t of r.copy.cheeky) expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
