import { type Rng, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { stampede } from './game.ts';
import { HOST, answerAll, harness, ids, next, started } from './test-utils.ts';
import type { StampedeAction, StampedeState } from './types.ts';

const json = (state: StampedeState, viewer: string | null) =>
  JSON.stringify(stampede.view(state, viewer)).toLowerCase();

/**
 * Every answer of the round in play that `viewer` may not see yet: before the reveal (or the
 * holder's pick), everyone else's; none after.
 */
function hidden(state: StampedeState, viewer: string | null): string[] {
  const round = state.round;
  if (!round || round.stage === 'pick' || round.stage === 'reveal') return [];
  const mine = viewer === null ? undefined : round.answers[viewer]?.toLowerCase();
  return (
    Object.entries(round.answers)
      // (An answer inside the viewer's own, "oak" in "oaks", can't be told apart: skip it.)
      .filter(([id, a]) => id !== viewer && !(mine ?? '').includes(a.toLowerCase()))
      .map(([, a]) => a.toLowerCase())
  );
}

/** What each viewer sees that they shouldn't (plain checks: `expect` per item is too slow here). */
function leaks(state: StampedeState, viewers: (string | null)[], always = true): string[] {
  const out: string[] = [];
  for (const viewer of viewers) {
    const secret = hidden(state, viewer);
    // The fuzz only looks when there is something to hide (it takes minutes otherwise).
    if (!always && secret.length === 0) continue;
    const seen = json(state, viewer);
    for (const answer of secret)
      if (seen.includes(answer))
        out.push(`${viewer ?? 'watcher'} sees "${answer}" at ${state.round?.stage}`);
    // Never the hidden seed or the room's question history.
    for (const key of ['"seed"', 'usedquestionids'])
      if (seen.includes(key)) out.push(`${viewer ?? 'watcher'} sees ${key}`);
  }
  return out;
}

const expectNoLeaks = (state: StampedeState, viewers: (string | null)[]) =>
  expect(leaks(state, viewers)).toEqual([]);

describe('Stampede view', () => {
  it('hides every answer until all are in, then shows them all at the reveal', () => {
    const h = started(4);
    const viewers = [...ids(4), null];
    expectNoLeaks(h.state, viewers);
    answerAll(h, ['zqapple', 'zqbanana', 'zqapple']);
    expectNoLeaks(h.state, viewers);
    // Only ticks: who has answered, never what.
    expect(stampede.view(h.state, 'p4').round).toMatchObject({
      answered: ['p1', 'p2', 'p3'],
      myAnswer: null,
      groups: null,
    });
    // Not even the host sees an answer before the last one is in.
    expect(json(h.state, HOST)).not.toContain('zqbanana');
    h.act('p4', { type: 'answer', text: 'zqcherry' });
    expect(h.state.round!.stage).toBe('reveal');
    for (const viewer of viewers) expect(json(h.state, viewer)).toContain('zqcherry');
  });

  it('never shows an unfinished round once the game ends early', () => {
    const h = started(3);
    answerAll(h, ['zqsecret', 'zqother']);
    h.state = stampede.playerLeft(h.state, 'p3', h.now);
    expect(h.state.phase).toBe('over');
    expectNoLeaks(h.state, ['p1', 'p2', null]);
    expect(json(h.state, 'p2')).not.toContain('zqsecret');
  });

  it('keeps the answers hidden through a skip and a new host', () => {
    const h = started(3);
    answerAll(h, ['zqfirst']);
    h.act(HOST, { type: 'skip' });
    expect(json(h.state, HOST)).not.toContain('zqfirst');
    answerAll(h, ['zqone', 'zqtwo']);
    h.host = 'p2';
    expectNoLeaks(h.state, ['p1', 'p2', 'p3', null]);
    h.act('p3', { type: 'answer', text: 'zqthree' });
    expect(json(h.state, 'p2')).toContain('zqone');
  });
});

/** A random legal-looking move for `by`: answers come from a small shared pool and some unique ones. */
function randomMove(rng: Rng, state: StampedeState, by: string, host: string): StampedeAction {
  const round = state.round;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  if (state.phase !== 'playing' || !round) return { type: 'start' };
  // Answers carry the round, so a past round's herd in the log never looks like a leak.
  const r = `r${round.number}x`;
  switch (round.stage) {
    case 'answer':
      return pick<StampedeAction>([
        {
          type: 'answer',
          text: rng.int(2) ? pick(['zqoak', 'zqelm', 'zqash']) + r : `zq${by}u${rng.int(9)}${r}`,
        },
        { type: 'answer', text: pick(['zqoak', 'zqoaks', 'zqelm']) + r },
        { type: 'moo' },
        { type: 'skip' },
        ...(by === host ? [{ type: 'continue-without' as const }] : []),
      ]);
    case 'merge':
      return { type: 'reveal' };
    case 'pick':
      return { type: 'pick', player: pick(round.pick?.options ?? [by]) };
    case 'reveal':
      return { type: 'next-round' };
  }
}

describe('Stampede view fuzz', () => {
  it('leaks no answer to anyone over 500 seeded games', () => {
    const found: string[] = [];
    for (let seed = 1; seed <= 500 && !found.length; seed++) {
      const rng = createRng(seed);
      const n = 3 + rng.int(6);
      const h = harness(n, {
        seed,
        settings: {
          target: 5,
          holderPicks: rng.int(2) === 1,
          timerMode: rng.int(2) ? 'strict' : 'soft',
          answerSeconds: rng.int(2) ? 30 : null,
        },
      });
      const viewers = [...ids(n), null];
      h.act(HOST, { type: 'start' });
      for (let step = 0; step < 150 && h.state.phase === 'playing'; step++) {
        const roll = rng.int(40);
        const live = Object.keys(h.state.seats);
        if (roll === 0 && live.length > 3) {
          // Someone leaves (never the room's host in this harness).
          const leaver = live.filter((id) => id !== h.host)[rng.int(live.length - 1)]!;
          h.state = stampede.playerLeft(h.state, leaver, h.now);
        } else if (roll === 1 && stampede.nextDeadline!(h.state) !== null) {
          h.tick();
        } else if (roll === 2 && live.length > 1) {
          // The host role moves to another player.
          h.host = live[rng.int(live.length)]!;
        } else {
          const by = live[rng.int(live.length)]!;
          const move = randomMove(rng, h.state, by, h.host);
          if (!stampede.actionSchema.safeParse(move).success) found.push(`bad move ${move.type}`);
          const before = h.state;
          try {
            h.act(by, move);
          } catch {
            h.state = before;
          }
        }
        h.now += 1000;
        found.push(...leaks(h.state, viewers, false));
        if (found.length) break;
        if (h.state.phase === 'playing' && h.state.round?.stage === 'reveal' && rng.int(3) === 0)
          next(h);
      }
    }
    expect(found).toEqual([]);
  }, 120_000);
});
