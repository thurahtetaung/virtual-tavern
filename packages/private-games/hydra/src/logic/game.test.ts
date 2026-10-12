import { describe, expect, it } from 'vitest';
import { claimFlags } from './claims.ts';
import { hydra, ineligibility, upNext } from './game.ts';
import {
  HOST,
  NOW,
  claimAll,
  deadline,
  elect,
  harness,
  ids,
  leave,
  legislate,
  rigged,
  round,
  stack,
  voteAll,
} from './test-utils.ts';
import { RED_COUNT, powerAt } from './tables.ts';
import type { Role } from './types.ts';

const FIVE: Role[] = ['blue', 'blue', 'red', 'leader', 'blue']; // host ana ben cy dee
const SEVEN: Role[] = ['blue', 'blue', 'red', 'leader', 'blue', 'red', 'blue']; // … eve fin

const cardsInPlay = (h: ReturnType<typeof harness>) => {
  const g = h.game();
  return g.deck.length + g.discard.length + g.hand.length + g.enacted.blue + g.enacted.red;
};

describe('setup', () => {
  it.each([5, 6, 7, 8, 9, 10])('deals %i players the right teams and knowledge', (n) => {
    const h = harness(ids(n));
    h.act({ type: 'start' });
    const g = h.game();
    const roles = Object.values(g.roles);
    expect(roles.filter((r) => r === 'leader')).toHaveLength(1);
    expect(roles.filter((r) => r !== 'blue')).toHaveLength(RED_COUNT[n]!);
    expect(g.deck).toHaveLength(17);
    expect(g.total).toBe(17);
    for (const p of g.players) {
      const me = h.view(p).role!;
      const reds = g.players.filter((x) => x !== p && g.roles[x] !== 'blue');
      if (me.role === 'blue') expect(me.known).toEqual([]);
      else if (me.role === 'red') expect(me.known.map((k) => k.id).sort()).toEqual(reds.sort());
      else expect(me.known.map((k) => k.id).sort()).toEqual(n <= 6 ? reds.sort() : []);
    }
    expect(h.state.stage).toBe('reveal');
  });

  it('needs five players', () => {
    const h = harness(ids(4).concat([]));
    expect(h.reject({ type: 'start' })).toBe('too-few');
  });

  it('applies the community rebalance at 6, 7 and 9 only', () => {
    for (const [n, red, enacted] of [
      [5, 11, 0],
      [6, 10, 1],
      [7, 10, 0],
      [8, 11, 0],
      [9, 10, 0],
      [10, 11, 0],
    ] as const) {
      const h = harness(ids(n));
      h.act({ type: 'update-settings', rebalance: true });
      h.act({ type: 'start' });
      const g = h.game();
      expect(
        g.deck.filter((c) => c === 'red'),
        `${n}`,
      ).toHaveLength(red);
      expect(g.enacted.red, `${n}`).toBe(enacted);
      expect(cardsInPlay(h)).toBe(g.total);
    }
  });

  it('starts nominating once everyone is ready', () => {
    const h = rigged(FIVE, { ready: false });
    for (const p of ids(4)) h.act({ type: 'ready' }, p);
    expect(h.state.stage).toBe('reveal');
    h.act({ type: 'ready' }, 'dee');
    expect(h.state.stage).toBe('nominate');
    expect(h.game().president).toBe(HOST);
  });

  it('has the official power tracks', () => {
    expect([1, 2, 3, 4, 5].map((c) => powerAt(5, c))).toEqual([
      null,
      null,
      'peek',
      'execute',
      'execute',
    ]);
    expect([1, 2, 3, 4, 5].map((c) => powerAt(8, c))).toEqual([
      null,
      'investigate',
      'special',
      'execute',
      'execute',
    ]);
    expect([1, 2, 3, 4, 5].map((c) => powerAt(10, c))).toEqual([
      'investigate',
      'investigate',
      'special',
      'execute',
      'execute',
    ]);
  });
});

describe('rotation and term limits', () => {
  it('passes the candidacy clockwise and skips the dead', () => {
    const h = rigged(SEVEN);
    elect(h, 'ana', ['host', 'ana', 'ben', 'cy']); // fails
    expect(h.game().president).toBe('ana');
    h.state = { ...h.state, game: { ...h.game(), dead: ['ben'] } };
    elect(h, 'cy', ['host', 'ana', 'cy', 'dee']); // fails
    expect(h.game().president).toBe('cy');
  });

  it('term-limits the last elected pair (only the Chancellor with five alive)', () => {
    const h = rigged(SEVEN);
    round(h, 'ana', 'blue');
    expect(h.game().president).toBe('ana');
    const bad = ineligibility(h.game());
    expect(bad).toMatchObject({ ana: 'self', host: 'term-limit-president' });
    expect(bad.ana).toBe('self');
    expect(h.reject({ type: 'nominate', player: 'host' }, 'ana')).toBe('term-limit-president');
    // Five alive: only the last Chancellor is barred.
    h.state = {
      ...h.state,
      game: {
        ...h.game(),
        dead: ['fin', 'eve'],
        lastElected: { president: 'host', chancellor: 'ben' },
      },
    };
    const five = ineligibility(h.game());
    expect(five.host).toBeUndefined();
    expect(five.ben).toBe('term-limit-chancellor');
    expect(five.fin).toBe('dead');
  });

  it('forgets term limits after chaos', () => {
    const h = rigged(FIVE);
    round(h, 'ana', 'blue');
    expect(h.game().lastElected).toEqual({ president: HOST, chancellor: 'ana' });
    for (let i = 0; i < 3; i++) {
      const p = h.game().president;
      const c = ineligibility(h.game())[HOST] ? 'dee' : HOST;
      h.act({ type: 'nominate', player: p === c ? 'ben' : c }, p);
      voteAll(h, ids(5));
    }
    expect(h.state.stage).toBe('chaos');
    deadline(h);
    expect(h.game().lastElected).toBeNull();
    expect(h.game().tracker).toBe(0);
    expect(h.state.stage).toBe('nominate');
  });

  it('returns a special election to the left of the caller (even when that is the pick)', () => {
    const h = rigged(SEVEN, { deck: ['red', 'red', 'red'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 2 } } };
    elect(h, 'ana');
    legislate(h, 'red'); // 3rd red at 7 players: special election
    claimAll(h);
    expect(h.state.stage).toBe('power');
    expect(h.game().power).toBe('special');
    h.act({ type: 'special', player: 'ana' }, HOST);
    expect(h.game().president).toBe('ana');
    expect(h.view(null).game!.special).toBe(true);
    expect(upNext(h.game())).toBe('ana');
    h.act({ type: 'nominate', player: 'cy' }, 'ana');
    voteAll(h, ids(7));
    // Back to the left of the caller: Ana again.
    expect(h.game().president).toBe('ana');
    expect(h.game().special).toBe(false);
    h.act({ type: 'nominate', player: 'cy' }, 'ana');
    voteAll(h, ids(7));
    expect(h.game().president).toBe('ben');
  });
});

describe('votes', () => {
  it('needs a strict majority: a tie fails', () => {
    const h = rigged(['blue', 'blue', 'red', 'leader', 'blue', 'blue'], {});
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    voteAll(h, ['ben', 'cy', 'dee']);
    expect(h.game().rounds[0]!.elected).toBe(false);
    expect(h.game().tracker).toBe(1);
  });

  it('lets votes change until the last is in, and keeps them hidden until then', () => {
    const h = rigged(FIVE);
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    h.act({ type: 'vote', ballot: 'yes' }, 'ana');
    h.act({ type: 'vote', ballot: 'no' }, 'ana');
    expect(h.view('ben').game!.voted).toEqual(['ana']);
    expect(h.view('ben').game!.myVote).toBeNull();
    expect(h.view('ana').game!.myVote).toBe('no');
    expect(JSON.stringify(h.view('ben'))).not.toContain('"no"');
    for (const p of [HOST, 'ben', 'cy', 'dee']) h.act({ type: 'vote', ballot: 'yes' }, p);
    expect(h.game().rounds[0]!.votes.ana).toBe('no');
  });

  it('dead players cannot vote', () => {
    const h = rigged(FIVE);
    h.state = { ...h.state, game: { ...h.game(), dead: ['dee'] } };
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    expect(h.reject({ type: 'vote', ballot: 'yes' }, 'dee')).toBe('dead');
    voteAll(h);
    expect(h.state.stage).toBe('legislate-president');
  });

  it('strict timers: missing votes are not counted; no votes at all fails', () => {
    const h = rigged(FIVE, { settings: { voteSeconds: 30, pickSeconds: 30, timerMode: 'strict' } });
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    h.act({ type: 'vote', ballot: 'yes' }, 'ana');
    h.act({ type: 'vote', ballot: 'yes' }, 'ben');
    h.act({ type: 'vote', ballot: 'no' }, 'cy');
    deadline(h);
    const r = h.game().rounds[0]!;
    expect(r.elected).toBe(true);
    expect(r.missing.sort()).toEqual(['dee', HOST]);
    const z = rigged(FIVE, { settings: { voteSeconds: 30, timerMode: 'strict' } });
    z.act({ type: 'nominate', player: 'ana' }, HOST);
    deadline(z);
    expect(z.game().rounds[0]!.elected).toBe(false);
  });

  it('soft timers never act', () => {
    const h = rigged(FIVE, { settings: { voteSeconds: 30, timerMode: 'soft' } });
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    expect(h.view(null).game!.deadline).toBe(NOW + 30_000);
    expect(hydra.nextDeadline!(h.state)).toBeNull();
  });
});

describe('the session', () => {
  it('shuffles the Chancellor’s two cards and says so', () => {
    let swapped = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const h = rigged(FIVE, { seed, deck: ['blue', 'red', 'red'] });
      elect(h, 'ana');
      h.act({ type: 'discard', index: 2 }, HOST);
      const hand = h.game().hand;
      expect([...hand].sort()).toEqual(['blue', 'red']);
      if (hand[0] === 'red') swapped++;
      expect(h.game().truth[0]!.chancellorHand).toEqual(hand);
      h.act({ type: 'enact', index: 0 }, 'ana');
      expect(h.game().rounds[0]!.session!.shuffled).toBe(true);
    }
    expect(swapped).toBeGreaterThan(3);
    expect(swapped).toBeLessThan(27);
  });

  it('shows the hands only to their holders', () => {
    const h = rigged(FIVE, { deck: ['blue', 'red', 'red'] });
    elect(h, 'ana');
    expect(h.view(HOST).game!.hand).toEqual(['blue', 'red', 'red']);
    for (const p of ['ana', 'ben', 'cy', 'dee', null]) expect(h.view(p).game!.hand).toBeNull();
    h.act({ type: 'discard', index: 1 }, HOST);
    expect(h.view('ana').game!.hand).toHaveLength(2);
    expect(h.view(HOST).game!.hand).toBeNull();
  });

  it('reshuffles the discard when fewer than three cards are left', () => {
    const h = rigged(FIVE);
    const g = h.game();
    h.state = {
      ...h.state,
      game: { ...g, deck: g.deck.slice(0, 5), discard: [...g.discard, ...g.deck.slice(5)] },
    };
    elect(h, 'ana');
    legislate(h, h.game().hand[0]!);
    expect(h.game().deck.length).toBeGreaterThanOrEqual(3);
    expect(h.game().discard).toEqual([]);
    expect(cardsInPlay(h)).toBe(17);
    expect(h.game().notices.at(-1)!.text).toContain('shuffled back');
  });

  it('wins on five blue or six red policies', () => {
    const b = rigged(FIVE);
    b.state = { ...b.state, game: { ...b.game(), enacted: { blue: 4, red: 0 } } };
    round(b, 'ana', 'blue');
    expect(b.state.phase).toBe('over');
    expect(b.game().reason).toBe('blue-policies');
    const r = rigged(FIVE);
    r.state = { ...r.state, game: { ...r.game(), enacted: { blue: 0, red: 5 } } };
    // At 5 red the Leader check comes first: Ana isn't the Leader.
    round(r, 'ana', 'red');
    expect(r.game().reason).toBe('red-policies');
    expect(r.game().winner).toBe('red');
  });
});

describe('the Leader', () => {
  it('wins when elected Chancellor with 3+ red down, after a pause', () => {
    const h = rigged(FIVE);
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 3 } } };
    h.act({ type: 'nominate', player: 'cy' }, HOST);
    voteAll(h);
    expect(h.state.stage).toBe('leader-check');
    expect(h.view('ana').game!.end).toBeNull();
    deadline(h);
    expect(h.game().reason).toBe('leader-elected');
  });

  it('does not win with only 2 red, and a cleared Chancellor gets the badge', () => {
    const h = rigged(FIVE);
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 2 } } };
    elect(h, 'cy');
    expect(h.state.stage).toBe('legislate-president');
    const q = rigged(FIVE, { settings: { quick: true } });
    q.state = { ...q.state, game: { ...q.game(), enacted: { blue: 0, red: 3 } } };
    q.act({ type: 'nominate', player: 'ana' }, HOST);
    voteAll(q);
    expect(q.state.stage).toBe('legislate-president');
    expect(q.game().cleared).toEqual(['ana']);
  });

  it('counts a red policy enacted by chaos for the danger zone', () => {
    const h = rigged(FIVE);
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 2 }, tracker: 2 } };
    stack(h, ['red', 'blue', 'blue']);
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    voteAll(h, ids(5));
    deadline(h); // chaos: red, and the peek is ignored
    expect(h.game().enacted.red).toBe(3);
    expect(h.state.stage).toBe('nominate');
    expect(h.game().rounds.at(-1)!.chaos).toBe('red');
    h.act({ type: 'nominate', player: 'cy' }, 'ana');
    voteAll(h);
    deadline(h);
    expect(h.game().reason).toBe('leader-elected');
  });

  it('loses when executed', () => {
    const h = rigged(FIVE, { deck: ['red', 'red', 'red'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 3 } } };
    elect(h, 'ana');
    legislate(h, 'red');
    claimAll(h);
    expect(h.game().power).toBe('execute');
    expect(h.reject({ type: 'execute', player: HOST }, HOST)).toBe('self');
    h.act({ type: 'execute', player: 'cy' }, HOST);
    expect(h.game().reason).toBe('leader-executed');
    expect(h.game().winner).toBe('blue');
  });
});

describe('powers', () => {
  it('investigate: once per player, never yourself, result to the President only', () => {
    const h = rigged(SEVEN, { deck: ['red', 'red', 'red'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 1 } } };
    elect(h, 'ana');
    legislate(h, 'red');
    claimAll(h);
    expect(h.game().power).toBe('investigate');
    h.state = { ...h.state, game: { ...h.game(), investigated: ['ben'] } };
    expect(h.reject({ type: 'investigate', player: 'ben' }, HOST)).toBe('investigated');
    expect(h.reject({ type: 'investigate', player: HOST }, HOST)).toBe('self');
    h.act({ type: 'investigate', player: 'cy' }, HOST);
    expect(h.view(HOST).game!.memories.at(-1)).toEqual({
      kind: 'investigate',
      round: 1,
      target: 'cy',
      team: 'red',
    });
    for (const p of ['ben', 'cy', null]) expect(h.view(p).game!.memories).toEqual([]);
    expect(h.view('ana').game!.memories.map((m) => m.kind)).toEqual(['hand']);
    expect(h.state.stage).toBe('claim');
    expect(h.game().needs).toEqual([{ by: HOST, kind: 'investigate', target: 'cy' }]);
    h.act({ type: 'claim', team: 'blue' }, HOST);
    expect(h.state.stage).toBe('nominate');
  });

  it('peek: the President sees the top three in order, then claims them', () => {
    const h = rigged(FIVE, { deck: ['red', 'red', 'blue', 'blue', 'red', 'blue'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 2 } } };
    elect(h, 'ana');
    legislate(h, 'red');
    claimAll(h);
    expect(h.game().power).toBe('peek');
    const top = h.game().deck.slice(0, 3);
    expect(h.view(HOST).game!.peek).toEqual(top);
    expect(h.view('ana').game!.peek).toBeNull();
    h.act({ type: 'peek-done' }, HOST);
    expect(h.game().deck.slice(0, 3)).toEqual(top);
    expect(h.state.stage).toBe('claim');
    h.act({ type: 'claim', cards: ['blue', 'blue', 'blue'] }, HOST);
    expect(h.state.stage).toBe('nominate');
  });

  it('execute: the executed player is out, and their role stays hidden', () => {
    const h = rigged(FIVE, { deck: ['red', 'red', 'red'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 3 } } };
    elect(h, 'ana');
    legislate(h, 'red');
    claimAll(h);
    h.act({ type: 'execute', player: 'ben' }, HOST);
    expect(h.game().dead).toEqual(['ben']);
    expect(h.view('dee').game!.players.find((p) => p.id === 'ben')!.dead).toBe(true);
    expect(JSON.stringify(h.view('dee'))).not.toContain('"roles"');
    expect(h.view('dee').game!.end).toBeNull();
    expect(h.game().president).toBe('ana');
    h.act({ type: 'nominate', player: 'dee' }, 'ana');
    expect(h.reject({ type: 'vote', ballot: 'yes' }, 'ben')).toBe('dead');
  });
});

describe('veto', () => {
  const vetoGame = () => {
    const h = rigged(FIVE, { deck: ['red', 'red', 'blue'] });
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 5 }, tracker: 1 } };
    elect(h, 'ana');
    h.act({ type: 'discard', index: 2 }, HOST);
    return h;
  };

  it('is locked before the fifth red policy', () => {
    const h = rigged(FIVE);
    elect(h, 'ana');
    h.act({ type: 'discard', index: 0 }, HOST);
    expect(h.reject({ type: 'veto' }, 'ana')).toBe('veto-locked');
  });

  it('agreed: both discarded, the tracker moves, the pair is term-limited', () => {
    const h = vetoGame();
    const cards = cardsInPlay(h);
    h.act({ type: 'veto' }, 'ana');
    expect(h.view(HOST).game!.hand).toHaveLength(2);
    h.act({ type: 'veto-answer', agree: true }, HOST);
    expect(h.game().tracker).toBe(2);
    expect(h.game().enacted.red).toBe(5);
    expect(h.game().rounds[0]!.session).toMatchObject({ enacted: null, vetoed: true });
    expect(cardsInPlay(h)).toBe(cards);
    claimAll(h);
    expect(h.game().lastElected).toEqual({ president: HOST, chancellor: 'ana' });
    // Ana is now the candidate; with five alive only she (the last Chancellor) would be barred.
    expect(h.game().president).toBe('ana');
    expect(ineligibility(h.game())[HOST]).toBeUndefined();
  });

  it('a veto on tracker 2 triggers chaos (after the claims)', () => {
    const h = vetoGame();
    h.state = { ...h.state, game: { ...h.game(), tracker: 2 } };
    h.act({ type: 'veto' }, 'ana');
    h.act({ type: 'veto-answer', agree: true }, HOST);
    expect(h.state.stage).toBe('claim');
    claimAll(h);
    expect(h.state.stage).toBe('chaos');
  });

  it('refused: the Chancellor must enact and can’t ask again', () => {
    const h = vetoGame();
    h.act({ type: 'veto' }, 'ana');
    h.act({ type: 'veto-answer', agree: false }, HOST);
    expect(h.state.stage).toBe('legislate-chancellor');
    expect(h.reject({ type: 'veto' }, 'ana')).toBe('veto-asked');
    h.act({ type: 'enact', index: 0 }, 'ana');
    expect(h.game().rounds[0]!.session).toMatchObject({ vetoed: false });
  });
});

describe('claims', () => {
  it('block the next nomination until both are in, and are final', () => {
    const h = rigged(FIVE);
    stack(h, ['blue', 'red', 'red']);
    elect(h, 'ana');
    legislate(h, 'blue');
    expect(h.state.stage).toBe('claim');
    expect(h.reject({ type: 'nominate', player: 'ben' }, 'ana')).toBe('wrong-stage');
    h.act({ type: 'claim', blues: 1 }, HOST);
    expect(h.reject({ type: 'claim', blues: 0 }, HOST)).toBe('claimed');
    expect(h.reject({ type: 'claim', blues: 3 }, 'ana')).toBe('bad-claim');
    expect(h.view('ben').game!.rounds[0]!.claims).toEqual([
      { by: HOST, kind: 'president', blues: 1, at: NOW },
    ]);
    h.act({ type: 'claim', blues: 1 }, 'ana');
    expect(h.state.stage).toBe('nominate');
  });

  it('can be skipped only by the host, once the timer has run out', () => {
    const h = rigged(FIVE);
    stack(h, ['blue', 'red', 'red']);
    elect(h, 'ana');
    legislate(h, 'blue');
    h.act({ type: 'claim', blues: 1 }, HOST);
    expect(h.reject({ type: 'skip-claim', player: 'ana' })).toBe('too-soon');
    h.now += 45_000;
    expect(h.reject({ type: 'skip-claim', player: 'ana' }, 'ben')).toBe('not-host');
    h.act({ type: 'skip-claim', player: 'ana' });
    expect(h.game().rounds[0]!.claims[1]).toMatchObject({ by: 'ana', skipped: 'host' });
    expect(h.state.stage).toBe('nominate');
    // The timer itself never fills a claim in.
    expect(hydra.nextDeadline!(h.state)).toBeNull();
  });

  it('flags claims that public information shows can’t all be true', () => {
    const h = rigged(FIVE);
    stack(h, ['blue', 'red', 'red']);
    elect(h, 'ana');
    legislate(h, 'blue');
    h.act({ type: 'claim', blues: 0 }, HOST); // three red, but blue came out
    h.act({ type: 'claim', blues: 2 }, 'ana'); // can't get two blue from none
    const kinds = claimFlags(h.game().rounds).map((f) => f.kind);
    expect(kinds).toEqual(['government-mismatch', 'president-vs-enacted']);
  });

  it('a player who left has their claim skipped', () => {
    const h = rigged(FIVE);
    stack(h, ['blue', 'red', 'red']);
    elect(h, 'ana');
    legislate(h, 'blue');
    leave(h, 'ana');
    expect(h.game().rounds[0]!.claims).toEqual([
      expect.objectContaining({ by: 'ana', skipped: 'left' }),
    ]);
    h.act({ type: 'claim', blues: 1 }, HOST);
    // Ana is the next candidate, so the table nominates for her too.
    expect(h.state.stage).toBe('vote');
    expect(h.game().rounds[1]!.autos).toContainEqual({ who: 'ana', what: 'nomination' });
  });
});

describe('act for and timers', () => {
  it('the host acts for an absent player with a legal move, and everyone is told', () => {
    const h = rigged(FIVE);
    expect(h.reject({ type: 'act-for', player: 'ana' })).toBe('not-waiting');
    h.act({ type: 'act-for', player: HOST });
    expect(h.state.stage).toBe('vote');
    expect(h.game().notices.at(-1)!.text).toContain('by the host');
    h.act({ type: 'act-for', player: 'ana' });
    expect(h.game().abstain).toEqual(['ana']);
    h.act({ type: 'vote', ballot: 'yes' }, 'ana'); // changed their mind: counted after all
    expect(h.game().abstain).toEqual([]);
  });

  it('never claims for anyone', () => {
    const h = rigged(FIVE);
    stack(h, ['blue', 'red', 'red']);
    elect(h, 'ana');
    legislate(h, 'blue');
    expect(h.reject({ type: 'act-for', player: 'ana' })).toBe('use-skip');
  });

  it('strict timers play the turn at random', () => {
    const h = rigged(FIVE, { settings: { pickSeconds: 20, timerMode: 'strict' } });
    deadline(h);
    expect(h.state.stage).toBe('vote');
    expect(h.game().rounds[0]!.autos).toEqual([{ who: HOST, what: 'nomination' }]);
    voteAll(h);
    deadline(h);
    expect(h.state.stage).toBe('legislate-chancellor');
    deadline(h);
    expect(h.state.stage).toBe('claim');
  });

  it('anyone can nudge a player the table waits on, not too often', () => {
    const h = rigged(FIVE);
    expect(h.reject({ type: 'nudge', player: 'ana' }, 'ben')).toBe('not-waiting');
    h.act({ type: 'nudge', player: HOST }, 'ben');
    expect(h.view('cy').game!.nudges).toEqual({ [HOST]: NOW });
    expect(h.reject({ type: 'nudge', player: HOST }, 'cy')).toBe('too-soon');
    expect(h.reject({ type: 'nudge', player: HOST }, HOST)).toBe('self');
  });

  it('plays a departed player’s turns', () => {
    const h = rigged(FIVE);
    leave(h, HOST);
    expect(h.state.stage).toBe('vote');
  });
});
