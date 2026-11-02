import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { redHerring } from './game.ts';
import {
  FOUR,
  HOST,
  SIX,
  type Harness,
  game,
  leave,
  playAll,
  round,
  setWord,
  startedGame,
  talkAll,
} from './test-utils.ts';
import type { RedHerringState, RedHerringView } from './types.ts';

const WORD = 'Zephyrine';
const viewOf = (s: RedHerringState, id: string | null) => redHerring.view(s, id);
const json = (s: RedHerringState, id: string | null) => JSON.stringify(viewOf(s, id));

/**
 * What reaches `viewer` that must not, at this point: a list of problems (empty when all is
 * well). Plain checks rather than `expect`, so the fuzz stays fast.
 */
function leaks(s: RedHerringState, viewer: string | null): string[] {
  const g = s.game;
  if (!g) return [];
  const out: string[] = [];
  const v = viewOf(s, viewer);
  const text = JSON.stringify(v);
  const r = g.round;
  const over = s.phase === 'over';
  // Other hands: only counts. The deck: only a count. The balanced deal's history: never.
  const mine = new Set(v.game!.hand);
  for (const [id, hand] of Object.entries(g.hands))
    if (id !== viewer && !over && hand.some((c) => mine.has(c))) out.push(`${id}'s hand`);
  if (text.includes('"deck":[')) out.push('the deck');
  if (text.includes('conspired')) out.push('the deal history');
  // Nobody learns who the Conspirator is before the reveal, not even the Conspirator.
  if (r.stage !== 'reveal' && !over) {
    if (v.game!.round.result !== null) out.push('the result');
    if (JSON.stringify(v.game!.round).includes('conspirator')) out.push('the Conspirator');
    // Earlier rounds are public; this one is not in them yet.
    if (v.game!.history.some((x) => x.no === r.no)) out.push('this round in the history');
  }
  // The word: the word-picker once written; everyone once it is out; never the Conspirator before.
  const said =
    over ||
    ['explain', 'discuss', 'reveal'].includes(r.stage) ||
    (r.stage === 'vote' && !s.settings.noDiscussion);
  const knows =
    viewer === r.picker || (r.order.slice(1).includes(viewer ?? '') && viewer !== r.conspirator);
  if (r.word && !said && !knows && text.includes(r.word)) out.push('the word');
  // Secret votes: only who voted, until the reveal.
  if (!s.settings.openVote && r.stage === 'vote') {
    if (v.game!.round.votes !== null) out.push('the votes');
    if (v.game!.round.myVote !== (viewer === null ? null : (r.votes[viewer] ?? null)))
      out.push('someone else’s vote');
  }
  return out.map((what) => `${viewer ?? 'watcher'} at ${r.stage}: ${what}`);
}

/** The view with the notebook taken out. */
const withoutNotebook = (v: RedHerringView) => {
  const copy = structuredClone(v);
  if (copy.game) {
    copy.game.round.notebook = copy.game.round.notebook ? { word: null } : null;
    copy.game.hand = [];
    copy.me = null;
  }
  return JSON.stringify(copy);
};

function playedTo(stage: string, settings = {}) {
  const h = startedGame(SIX, 7, settings);
  setWord(h, WORD);
  if (stage === 'play') return h;
  playAll(h);
  if (stage === 'explain' || stage === 'vote') {
    if (stage === 'vote') talkAll(h);
    return h;
  }
  return h;
}

describe('view()', () => {
  it('sends each player only their own hand, others as counts', () => {
    const h = startedGame(FOUR);
    for (const id of FOUR) {
      const v = viewOf(h.state, id);
      expect(v.game!.hand).toEqual(game(h).hands[id]);
      expect(v.game!.players.every((p) => p.hand === 6)).toBe(true);
      for (const other of FOUR.filter((o) => o !== id))
        for (const c of game(h).hands[other]!) expect(v.game!.hand).not.toContain(c);
    }
    expect(viewOf(h.state, null).game!.hand).toEqual([]);
  });

  it('the word reaches the word-picker and the Detectives, never the Conspirator or watchers', () => {
    const h = playedTo('play');
    const r = round(h);
    for (const id of SIX) {
      const text = json(h.state, id);
      if (id === r.conspirator) expect(text).not.toContain(WORD);
      else expect(text).toContain(WORD);
    }
    expect(json(h.state, null)).not.toContain(WORD);
    expect(json(h.state, 'stranger')).not.toContain(WORD);
    expect(viewOf(h.state, r.picker).game!.round.notebook).toBeNull();
    expect(viewOf(h.state, r.conspirator).game!.round.notebook).toEqual({ word: null });
  });

  it('a Conspirator’s view is shaped exactly like a Detective’s, but for the word', () => {
    const h = playedTo('play');
    const r = round(h);
    const detective = r.order.slice(1).find((id) => id !== r.conspirator)!;
    // Swap the two players' hands and seats and the views must match: only the notebook differs.
    expect(withoutNotebook(viewOf(h.state, r.conspirator))).toBe(
      withoutNotebook(viewOf(h.state, detective)),
    );
    const c = viewOf(h.state, r.conspirator);
    const d = viewOf(h.state, detective);
    expect(Object.keys(c.game!.round).sort()).toEqual(Object.keys(d.game!.round).sort());
    expect(d.game!.round.notebook).toEqual({ word: WORD });
  });

  it('nobody learns who the Conspirator is before the reveal; everyone does at it', () => {
    const h = playedTo('vote');
    for (const id of [...SIX, null]) expect(json(h.state, id)).not.toContain('conspirator');
    // Two states that differ only in who the Conspirator is look the same to a Detective.
    const r = round(h);
    const others = r.order.slice(1).filter((id) => id !== r.conspirator);
    const [a, b] = others as [string, string];
    const swapped = structuredClone(h.state);
    swapped.game!.round.conspirator = b;
    expect(json(swapped, a)).toBe(json(h.state, a));
    for (const v of r.order.slice(1)) {
      const target = r.order.slice(1).find((id) => id !== v)!;
      h.act({ type: 'vote', player: target }, v);
    }
    for (const id of [...SIX, null])
      expect(viewOf(h.state, id).game!.round.result?.conspirator).toBe(r.conspirator);
  });

  it('secret votes show only who has voted until all are in; open votes show as cast', () => {
    const h = playedTo('vote');
    const r = round(h);
    const [a, b, c] = r.order.slice(1) as [string, string, string];
    h.act({ type: 'vote', player: c }, a);
    for (const id of [...SIX, null]) {
      const v = viewOf(h.state, id);
      expect(v.game!.round.voted).toEqual([a]);
      expect(v.game!.round.votes).toBeNull();
      expect(v.game!.round.myVote).toBe(id === a ? c : null);
    }
    // Who someone voted for is invisible: two different votes look alike to everyone else.
    const other = structuredClone(h.state);
    other.game!.round.votes[a] = b;
    for (const id of [b, c, r.picker, null]) expect(json(other, id)).toBe(json(h.state, id));

    const open = playedTo('vote', { openVote: true });
    const ro = round(open);
    open.act({ type: 'vote', player: ro.order[2]! }, ro.order[1]);
    expect(viewOf(open.state, ro.order[3]!).game!.round.votes).toEqual({
      [ro.order[1]!]: ro.order[2],
    });
  });

  it('No Discussion: the word stays out of the Conspirator’s view until the reveal', () => {
    const h = playedTo('explain', { noDiscussion: true });
    expect(round(h).stage).toBe('vote');
    expect(json(h.state, round(h).conspirator)).not.toContain(WORD);
    const talk = playedTo('explain');
    expect(json(talk.state, round(talk).conspirator)).toContain(WORD);
  });

  it('a seeded fuzz: 1,000 games, every viewer at every step, never a secret', () => {
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      const n = 4 + rng.int(7);
      const ids = Array.from({ length: n }, (_, i) => (i ? `p${i}` : HOST));
      const settings = {
        openVote: rng.next() < 0.3,
        noDiscussion: rng.next() < 0.3,
        balanced: rng.next() < 0.3,
        scoring: (['rulebook', 'caught', 'fun'] as const)[rng.int(3)]!,
        sets: rng.next() < 0.2 ? ['base', 'noir', 'ours-set-3', 'ours-stellar'] : ['base', 'noir'],
      };
      const h = startedGame(ids, seed, settings);
      const check = () => {
        const found = [...ids, null].flatMap((id) => leaks(h.state, id));
        if (found.length) expect(found).toEqual([]);
      };
      // Play one or two rounds with random moves (and sometimes a leaver).
      const rounds = 1 + rng.int(2);
      for (let k = 0; k < rounds && h.state.phase === 'playing'; k++) {
        check();
        step(h, rng, ids, check);
        if (h.state.phase === 'playing') h.act({ type: 'next-round' });
      }
      check();
    }
  }, 120_000);
});

function step(h: Harness, rng: ReturnType<typeof createRng>, ids: string[], check: () => void) {
  for (let i = 0; i < 200 && h.state.phase === 'playing' && round(h).stage !== 'reveal'; i++) {
    const r = round(h);
    if (rng.next() < 0.02) {
      const who = ids[1 + rng.int(ids.length - 1)]!;
      if (game(h).left[who] === undefined) leave(h, who);
      check();
      continue;
    }
    const stage = r.stage;
    switch (r.stage) {
      case 'card':
      case 'play': {
        const hand = game(h).hands[r.turn!]!;
        h.act({ type: 'play', card: hand[rng.int(hand.length)]! }, r.turn!);
        break;
      }
      case 'word':
        h.act({ type: 'word', word: `${WORD}${r.no}` }, r.picker);
        break;
      case 'explain':
        h.act({ type: 'done' }, r.turn!);
        break;
      case 'discuss':
        h.act({ type: 'end-discussion' });
        break;
      case 'vote': {
        const voter = r.turn ?? r.order.slice(1).find((v) => r.votes[v] === undefined)!;
        const options = r.order.slice(1).filter((id) => id !== voter);
        h.act({ type: 'vote', player: options[rng.int(options.length)]! }, voter);
        break;
      }
    }
    // Every viewer at every stage, and at a random sample of the moves in between.
    if (h.state.phase !== 'playing' || round(h).stage !== stage || rng.next() < 0.25) check();
  }
}
