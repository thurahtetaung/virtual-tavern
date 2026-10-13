import { type Rng, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { awaited, eligible, hydra, powerTargets, vetoUnlocked } from './game.ts';
import {
  HOST,
  type Harness,
  claimAll,
  deadline,
  elect,
  harness,
  ids,
  leave,
  legislate,
  rigged,
  stack,
  voteAll,
} from './test-utils.ts';
import type { HydraAction, Policy, Role } from './types.ts';

/**
 * Everything every viewer may (and may not) see, checked on the raw JSON they would receive.
 * Problems are collected and asserted once (thousands of `expect`s would make the fuzz crawl).
 */
function checkViews(h: Harness, label: string, only?: (string | null)[]) {
  const s = h.state;
  const g = s.game!;
  const over = s.phase === 'over';
  const problems: string[] = [];
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  for (const viewer of only ?? [...g.players, null]) {
    const v = hydra.view(s, viewer);
    const json = JSON.stringify(v);
    const bad = (what: string) => problems.push(`${label} / ${viewer ?? 'watcher'}: ${what}`);
    // The deck, the discard pile and the seed never leave the server.
    for (const key of ['"deck":', '"discard":', '"seed"']) if (json.includes(key)) bad(key);
    if (!over) {
      if (v.game!.end !== null) bad('end before the end');
      for (const key of ['"truth"', '"roles"', '"drawn"']) if (json.includes(key)) bad(key);
    }
    // Your own role only, and only what your role knows.
    if (viewer === null) {
      if (v.role !== null) bad('a watcher has a role');
    } else {
      const role = g.roles[viewer]!;
      if (v.role?.role !== role) bad('wrong role');
      const known = v.role?.known ?? [];
      if (role === 'blue' && known.length) bad('a blue player knows someone');
      if (role === 'leader' && g.players.length > 6 && known.length)
        bad('the Leader knows someone');
      for (const k of known) if (g.roles[k.id] !== k.role) bad(`wrong knowledge of ${k.id}`);
    }
    // Hands: the President's 3 to the President, the Chancellor's 2 to the Chancellor (and the
    // President during a veto request). Nobody else.
    const holders =
      s.stage === 'legislate-president'
        ? [g.president]
        : s.stage === 'legislate-chancellor'
          ? [g.chancellor]
          : s.stage === 'veto-response'
            ? [g.president, g.chancellor]
            : [];
    if (viewer !== null && holders.includes(viewer) && !over) {
      if (!same(v.game!.hand, g.hand)) bad('missing their own hand');
    } else if (v.game!.hand !== null) bad('sees a hand');
    // The peek: the President only, during the power.
    if (viewer === g.president && s.stage === 'power' && g.power === 'peek') {
      if (!same(v.game!.peek, g.deck.slice(0, 3))) bad('missing the peek');
    } else if (v.game!.peek !== null) bad('sees the peek');
    // Votes: only who has voted until all are in; your own ballot only to you.
    if (s.stage === 'vote') {
      if (v.game!.myVote !== (viewer !== null ? (g.votes[viewer] ?? null) : null)) bad('myVote');
      if (!same(v.game!.rounds.at(-1)!.votes, {})) bad('votes before they are all in');
    }
    // Memories (hands, investigations, peeks): your own only.
    if (!same(v.game!.memories, viewer !== null ? (g.memories[viewer] ?? []) : [])) bad('memories');
    // Nobody's private memory shows in the public parts (claims are public, a memory never is).
    const pub = JSON.stringify({ ...v.game, memories: null, peek: null, hand: null, end: null });
    for (const kind of ['investigate', 'peek', 'hand'])
      if (pub.includes(`"kind":"${kind}","round"`)) bad(`a ${kind} memory in public`);
  }
  expect(problems).toEqual([]);
}

const FIVE: Role[] = ['blue', 'blue', 'red', 'leader', 'blue'];
const SEVEN: Role[] = ['blue', 'blue', 'red', 'leader', 'blue', 'red', 'blue'];

describe('view() redaction, every viewer at every phase', () => {
  it('a 5-player game: reveal, vote, both sessions, claims, peek, execution, the end', () => {
    const h = rigged(FIVE, { ready: false });
    checkViews(h, 'reveal');
    for (const p of ids(5)) h.act({ type: 'ready' }, p);
    checkViews(h, 'nominate');
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 2 } } };
    stack(h, ['red', 'red', 'blue', 'blue', 'red', 'blue']);
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    checkViews(h, 'vote');
    h.act({ type: 'vote', ballot: 'yes' }, 'ana');
    checkViews(h, 'vote, one in');
    voteAll(h);
    checkViews(h, 'legislate-president');
    h.act({ type: 'discard', index: 2 }, HOST);
    checkViews(h, 'legislate-chancellor');
    h.act({ type: 'enact', index: h.game().hand.indexOf('red') }, 'ana');
    checkViews(h, 'claims');
    claimAll(h);
    checkViews(h, 'peek');
    h.act({ type: 'peek-done' }, HOST);
    checkViews(h, 'peek claim');
    claimAll(h);
    // Into the danger zone: the Leader check, then an execution.
    stack(h, ['red', 'red', 'red']);
    h.act({ type: 'nominate', player: 'ben' }, 'ana');
    voteAll(h);
    checkViews(h, 'leader-check');
    deadline(h);
    legislate(h, 'red');
    claimAll(h);
    checkViews(h, 'execute');
    h.act({ type: 'execute', player: 'cy' }, 'ana');
    checkViews(h, 'over');
    const end = h.view('dee').game!.end!;
    expect(end.roles.cy).toBe('leader');
    expect(end.truth.length).toBeGreaterThan(0);
  });

  it('a 7-player game: investigation, a veto request and chaos', () => {
    const h = rigged(SEVEN, { deck: ['red', 'red', 'red'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 1 } } };
    elect(h, 'ana');
    legislate(h, 'red');
    claimAll(h);
    checkViews(h, 'investigate');
    h.act({ type: 'investigate', player: 'cy' }, HOST);
    checkViews(h, 'investigate claim');
    h.act({ type: 'claim', team: 'blue' }, HOST);
    checkViews(h, 'after');
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 5 } } };
    stack(h, ['red', 'blue', 'red']);
    h.act({ type: 'nominate', player: 'dee' }, 'ana');
    voteAll(h);
    deadline(h);
    h.act({ type: 'discard', index: 0 }, 'ana');
    h.act({ type: 'veto' }, 'dee');
    checkViews(h, 'veto-response');
    h.act({ type: 'veto-answer', agree: true }, 'ana');
    claimAll(h);
    for (let i = 0; i < 2; i++) {
      const p = h.game().president;
      h.act({ type: 'nominate', player: eligible(h.game())[0]! }, p);
      voteAll(h, ids(7));
    }
    checkViews(h, 'chaos');
  });

  it('a player who left keeps their secrets', () => {
    const h = rigged(FIVE);
    leave(h, 'ben');
    checkViews(h, 'after leaving');
  });
});

// ---- The fuzz test ----

function randomMove(h: Harness, rng: Rng): { action: HydraAction; by: string } | 'deadline' | null {
  const s = h.state;
  const g = s.game!;
  if (s.stage === 'leader-check' || s.stage === 'chaos') return 'deadline';
  const waiting = awaited(s);
  if (!waiting.length) return null;
  const by = waiting[rng.int(waiting.length)]!;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  switch (s.stage) {
    case 'reveal':
      return { action: { type: 'ready' }, by };
    case 'nominate':
      return { action: { type: 'nominate', player: pick(eligible(g)) }, by };
    case 'vote':
      return { action: { type: 'vote', ballot: rng.int(3) === 0 ? 'no' : 'yes' }, by };
    case 'legislate-president':
      return { action: { type: 'discard', index: rng.int(3) }, by };
    case 'legislate-chancellor':
      if (vetoUnlocked(g) && !g.vetoRequested && rng.int(3) === 0)
        return { action: { type: 'veto' }, by };
      return { action: { type: 'enact', index: rng.int(2) }, by };
    case 'veto-response':
      return { action: { type: 'veto-answer', agree: rng.int(2) === 0 }, by };
    case 'power':
      if (g.power === 'peek') return { action: { type: 'peek-done' }, by };
      return {
        action: { type: g.power!, player: pick(powerTargets(g, g.power!)) } as HydraAction,
        by,
      };
    case 'claim': {
      const need = g.needs.find((n) => n.by === by)!;
      if (rng.int(10) === 0) return { action: { type: 'skip-claim', player: by }, by: HOST };
      const c: Policy[] = ['blue', 'red'];
      switch (need.kind) {
        case 'president': {
          const blues = rng.int(4);
          const discarded = blues === 0 ? 'red' : blues === 3 ? 'blue' : pick(c);
          return { action: { type: 'claim', blues, discarded }, by };
        }
        case 'chancellor':
          return { action: { type: 'claim', blues: rng.int(3) }, by };
        case 'peek':
          return { action: { type: 'claim', cards: [pick(c), pick(c), pick(c)] }, by };
        case 'investigate':
          return { action: { type: 'claim', team: pick(c) }, by };
      }
    }
  }
  return null;
}

describe('500 seeded random games', () => {
  it('conserve every card, never leak, and always reach an end', () => {
    const endings = new Map<string, number>();
    for (let seed = 1; seed <= 500; seed++) {
      const rng = createRng(seed * 7919);
      const n = 5 + (seed % 6);
      const h = harness(ids(n), seed);
      h.act({
        type: 'update-settings',
        rebalance: seed % 4 === 0,
        quick: seed % 3 === 0,
        ...(seed % 5 === 0 && { voteSeconds: 30, pickSeconds: 30, timerMode: 'strict' as const }),
      });
      h.act({ type: 'start' });
      const total = h.game().total;
      let steps = 0;
      while (h.state.phase === 'playing') {
        steps++;
        if (steps > 600) throw new Error(`seed ${seed}: no end after 600 moves`);
        // Now and then a strict timer fires, a player leaves, or the host acts for someone.
        const roll = rng.int(60);
        if (roll === 0 && hydra.nextDeadline!(h.state) !== null) deadline(h);
        else if (roll === 1 && h.state.stage !== 'claim' && awaited(h.state).length)
          h.act({ type: 'act-for', player: awaited(h.state)[0]! });
        else if (roll === 2 && steps % 7 === 0 && h.game().left.length < 2)
          leave(h, h.game().players[1 + rng.int(n - 1)]!);
        else {
          const move = randomMove(h, rng);
          if (move === 'deadline') deadline(h);
          else if (move === null) throw new Error(`seed ${seed}: stuck at ${h.state.stage}`);
          else if (move.action.type === 'skip-claim') {
            h.now = Math.max(h.now, h.game().claimDeadline ?? h.now);
            h.act(move.action, move.by);
          } else h.act(move.action, move.by);
        }
        const g = h.game();
        const cards =
          g.deck.length + g.discard.length + g.hand.length + g.enacted.blue + g.enacted.red;
        expect(cards, `seed ${seed}`).toBe(total);
        // One viewer (in turn) after every move, everyone every tenth move and at the end.
        const all = [...h.game().players, null];
        if (steps % 10 === 0 || (h.state.phase as string) === 'over')
          checkViews(h, `seed ${seed} step ${steps}`);
        else checkViews(h, `seed ${seed} step ${steps}`, [all[steps % all.length]!]);
      }
      const g = h.game();
      endings.set(g.reason!, (endings.get(g.reason!) ?? 0) + 1);
    }
    // Every way to end shows up somewhere.
    expect([...endings.keys()].sort()).toEqual([
      'blue-policies',
      'leader-elected',
      'leader-executed',
      'red-policies',
    ]);
  }, 300_000);
});
