import {
  type AwardRule,
  type InsightEvent,
  createRng,
  fixtureGame,
  gameEvents,
  isGameError,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { shortFuseAwards } from './awards.ts';
import { shortFuseBot } from './bot.ts';
import { shortFuse } from './game.ts';
import { insights } from './insights.ts';
import type { ShortFuseAction, ShortFuseState } from './types.ts';

const PLAYERS = ['a', 'b', 'c', 'd'];
const game = (...events: ReturnType<typeof recapEv>[]) =>
  fixtureGame(events, { players: PLAYERS, winners: ['a'] });
const rule = (id: string): AwardRule =>
  shortFuseAwards.rules.find((r) => r.id === `short-fuse.${id}`)!;
const outcome = (props: Record<string, unknown> = {}) =>
  recapEv('outcome', 'a', { players: 4, turns: 20, longestChain: 0, maxOwed: 1, ...props });

describe('awards', () => {
  it('first to go: the first explosion', () => {
    const g = game(
      recapEv('explode', 'c', { turn: 4 }),
      recapEv('explode', 'b', { turn: 9 }),
      outcome(),
    );
    expect(rule('first-to-go').compute!(g)).toEqual([{ players: ['c'], value: 4 }]);
    expect(rule('first-to-go').compute!(game(outcome()))).toEqual([]);
  });

  it('bomb squad and nope machine need two, and share ties', () => {
    const d = (p: string) => recapEv('bomb', p, { kind: 'bomb', saved: 'defuse' });
    expect(rule('bomb-squad').compute!(game(d('a'), d('a'), d('b')))[0]?.players).toEqual(['a']);
    expect(rule('bomb-squad').compute!(game(d('a'), d('b')))).toEqual([]);
    const n = (p: string) => recapEv('nope', p, { n: 1 });
    expect(rule('nope-machine').compute!(game(n('a'), n('a'), n('b'), n('b')))[0]?.players).toEqual(
      ['a', 'b'],
    );
  });

  it('nope war: a play that survived two or more Nopes', () => {
    expect(rule('nope-war').compute!(game(recapEv('yup', 'b', { chain: 2 })))[0]).toMatchObject({
      players: ['b'],
      value: 2,
    });
    expect(rule('nope-war').compute!(game(recapEv('yup', 'b', { chain: 0 })))).toEqual([]);
  });

  it('return to sender credits whoever hid the Bomb', () => {
    const g = game(recapEv('explode', 'c', { turn: 3, placedBy: 'b' }), outcome());
    expect(rule('return-to-sender').compute!(g)[0]?.players).toEqual(['b']);
    expect(rule('return-to-sender').compute!(game(recapEv('explode', 'c', { turn: 3 })))).toEqual(
      [],
    );
  });

  it('target practice, so close and the event horizon', () => {
    expect(rule('target-practice').compute!(game(outcome({ maxOwed: 5, maxOwedBy: 'd' })))).toEqual(
      [{ players: ['d'], value: 5 }],
    );
    expect(rule('target-practice').compute!(game(outcome({ maxOwed: 3, maxOwedBy: 'd' })))).toEqual(
      [],
    );
    expect(rule('so-close').compute!(game(recapEv('explode', 'b', { left: 2 })))[0]?.value).toBe(2);
    expect(rule('so-close').compute!(game(recapEv('explode', 'b', { left: 9 })))).toEqual([]);
    expect(
      rule('event-horizon').compute!(game(recapEv('explode', 'b', { kind: 'void', turn: 7 })))[0],
    ).toMatchObject({ players: ['b'], value: 7 });
  });

  it('clean hands: the winner never defused', () => {
    expect(rule('clean-hands').compute!(game(outcome()))[0]?.players).toEqual(['a']);
    const used = game(recapEv('bomb', 'a', { saved: 'defuse' }), outcome());
    expect(rule('clean-hands').compute!(used)).toEqual([]);
  });

  it('blind luck, heavy head, seeing double and the stacked deck', () => {
    expect(rule('blind-luck').compute!(game(recapEv('cured', 'c')))[0]?.players).toEqual(['c']);
    expect(rule('blind-luck').compute!(game(outcome()))).toEqual([]);
    const raid = () => recapEv('steal', 'b', { how: 'pair', victim: 'a', hit: true, stash: true });
    expect(rule('heavy-head').compute!(game(raid(), raid(), raid()))[0]).toMatchObject({
      players: ['a'],
      value: 3,
    });
    expect(rule('heavy-head').compute!(game(raid(), raid()))).toEqual([]);
    expect(
      rule('bark-bite').compute!(game(recapEv('explode', 'c', { kind: 'twin', barkedBy: 'd' })))[0]
        ?.players,
    ).toEqual(['d']);
    expect(rule('bark-bite').compute!(game(recapEv('explode', 'c', { kind: 'bomb' })))).toEqual([]);
    expect(rule('stacked').compute!(game(recapEv('stack', 'b', { n: 3 })))[0]).toMatchObject({
      players: ['b'],
      value: 3,
    });
    expect(rule('stacked').compute!(game(recapEv('stack', 'b', { n: 1 })))).toEqual([]);
  });

  it('reads old events without the newer props', () => {
    const g = game(
      recapEv('explode', 'b'),
      recapEv('steal', 'a'),
      recapEv('play', 'a'),
      recapEv('outcome'),
    );
    for (const r of shortFuseAwards.rules) expect(() => r.compute?.(g)).not.toThrow();
    for (const n of shortFuseAwards.nuggets) expect(() => n.compute([g])).not.toThrow();
  });

  it('a real bot game feeds the awards through its own insights', () => {
    const rng = createRng(4);
    const content = { wordLists: () => [], words: () => [] };
    const ids = ['a', 'b', 'c', 'd', 'e'];
    let now = 1000;
    let state: ShortFuseState = shortFuse.create(
      { now, rng, content },
      ids.map((id) => ({ id, name: id })),
    );
    const events: InsightEvent[] = [];
    const apply = (next: ShortFuseState, action: ShortFuseAction | null, by: string | null) => {
      events.push(...insights(state, next, action, by));
      state = next;
    };
    apply(
      shortFuse.reduce(
        state,
        { type: 'update-settings', x1: true },
        { by: 'a', isHost: true, now, rng, content },
      ) as ShortFuseState,
      null,
      'a',
    );
    apply(
      shortFuse.reduce(
        state,
        { type: 'start' },
        { by: 'a', isHost: true, now, rng, content },
      ) as ShortFuseState,
      null,
      'a',
    );
    for (let step = 0; step < 5000 && state.phase === 'playing'; step++) {
      let moved = false;
      for (const me of ids) {
        const move = shortFuseBot(shortFuse.view(state, me), { me, now, rng, words: () => [] });
        if (!move) continue;
        now += 500;
        const next = shortFuse.reduce(state, move, {
          by: me,
          isHost: me === 'a',
          now,
          rng,
          content,
        });
        if (isGameError(next)) continue;
        apply(next, move, me);
        moved = true;
        break;
      }
      if (!moved) {
        now = Math.max(now + 1, shortFuse.nextDeadline!(state) ?? now + 1);
        apply(shortFuse.onDeadline!(state, now), null, null);
      }
    }
    expect(state.phase).toBe('over');
    const recap = events.map((e, i) => recapEventOf(e, i + 1));
    const outcomeEv = recap.findLast((e) => e.type === 'outcome')!;
    const g = gameEvents({
      gameId: 'short-fuse',
      gameNo: 1,
      startedAt: 0,
      endedAt: recap.length + 1,
      players: ids,
      winners: (outcomeEv.props.winners as string[]) ?? [],
      finished: true,
      events: recap,
    });
    expect(g.of('explode')).toHaveLength(4);
    expect(rule('first-to-go').compute!(g)).toHaveLength(1);
    const lines = shortFuseAwards.rules.flatMap((r) =>
      (r.compute?.(g) ?? []).map((c) => renderCopy(r.copy.cheeky[0]!, c)),
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l).not.toMatch(/\{(?!p:|card:)/);
    expect(shortFuseAwards.history!(g)[0]).toMatch(/4 💥 · \d+ turns/);
  });
});
