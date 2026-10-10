import { type InsightEvent, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { enigma } from './game.ts';
import { insights } from './insights.ts';
import {
  HOST,
  type Harness,
  NOW,
  RED,
  decoders,
  members,
  sendClues,
  startedGame,
  tx,
  vote,
  wrongCode,
} from './test-utils.ts';
import type { EnigmaState, Team } from './types.ts';

/** Reports every action the harness applies from now on, and keeps every state it passes. */
function record(h: Harness) {
  const events: InsightEvent[] = [];
  const states: EnigmaState[] = [h.state];
  const act = h.act.bind(h);
  h.act = (action, by = HOST, now = NOW) => {
    const before = h.state;
    const after = act(action, by, now);
    events.push(...insights(before, after, action, by));
    states.push(after);
    return after;
  };
  /** Events since the last call. */
  const take = () => events.splice(0);
  return { take, states };
}

/** One simultaneous round; both teams decode, nobody intercepts, unless told otherwise. */
function playRound(h: Harness, opts: { blueDecodes?: boolean; redIntercepts?: boolean } = {}) {
  sendClues(h, 'red');
  sendClues(h, 'blue');
  for (const team of ['red', 'blue'] as const) {
    const t = tx(h, team);
    vote(
      h,
      team,
      decoders(h, team),
      opts.blueDecodes === false && team === 'blue' ? wrongCode(t.code) : t.code,
    );
    if (h.state.round >= 2) {
      const other: Team = team === 'red' ? 'blue' : 'red';
      vote(
        h,
        team,
        members(other),
        opts.redIntercepts && team === 'blue' ? t.code : wrongCode(t.code),
      );
    }
  }
}

describe('insights', () => {
  it('reports clues as the Encryptor sends them', () => {
    const h = startedGame();
    const { take } = record(h);
    const encryptor = tx(h, 'red').encryptor;
    sendClues(h, 'red');
    expect(take()).toEqual([
      {
        type: 'clues',
        playerId: encryptor,
        words: [
          { kind: 'clue', word: 'one' },
          { kind: 'clue', word: 'two' },
          { kind: 'clue', word: 'three' },
        ],
        props: { clues: ['one', 'two', 'three'], team: 'red', round: 1 },
      },
    ]);
  });

  it('reports decodes at the reveal, and no interceptions in round one', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const { take } = record(h);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(take()).toEqual([]);
    vote(h, 'blue', decoders(h, 'blue'), wrongCode(tx(h, 'blue').code));
    expect(take()).toEqual([
      { type: 'decode', props: { success: true, team: 'red', round: 1, expired: false } },
      { type: 'decode', props: { success: false, team: 'blue', round: 1, expired: false } },
    ]);
  });

  it('reports interceptions for the intercepting team from round two', () => {
    const h = startedGame();
    playRound(h);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const { take } = record(h);
    playRoundVotes(h, { redIntercepts: true });
    expect(take()).toEqual([
      { type: 'decode', props: { success: true, team: 'red', round: 2, expired: false } },
      { type: 'intercept', props: { success: false, team: 'blue', round: 2 } },
      { type: 'decode', props: { success: true, team: 'blue', round: 2, expired: false } },
      { type: 'intercept', props: { success: true, team: 'red', round: 2 } },
    ]);
  });

  it('reports clues that never came when the strict clue timer runs out', () => {
    const h = startedGame({ clueSeconds: 30, timerMode: 'strict' });
    sendClues(h, 'red');
    const before = h.state;
    h.state = enigma.onDeadline!(before, NOW + 30_000);
    expect(insights(before, h.state, null, null)).toEqual([]);
    const { take } = record(h);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(take()).toEqual([
      { type: 'decode', props: { success: true, team: 'red', round: 1, expired: false } },
      { type: 'decode', props: { success: false, team: 'blue', round: 1, expired: true } },
    ]);
  });

  it('reports the winner, crediting the whole winning team', () => {
    const h = startedGame();
    const { take } = record(h);
    playRound(h, { blueDecodes: false });
    h.act({ type: 'next-round' });
    playRound(h, { blueDecodes: false });
    take();
    h.act({ type: 'next-round' });
    expect(take()).toEqual([{ type: 'outcome', winners: RED, props: { winner: 'red', round: 2 } }]);
  });

  it('reports a draw with no winners', () => {
    const h = startedGame();
    const base = h.state;
    const before: EnigmaState = { ...base, stage: 'reveal', round: 8 };
    const after = enigma.reduce(before, { type: 'next-round' }, ctx());
    expect(insights(before, after as EnigmaState, { type: 'next-round' }, HOST)).toEqual([
      { type: 'outcome', winners: [], props: { winner: 'draw', round: 8 } },
    ]);
  });

  it('never reports chat, notes or votes', () => {
    const h = startedGame();
    const { take } = record(h);
    h.act({ type: 'chat', text: 'secret plan' }, 'r2');
    h.act({ type: 'set-note', slot: 1, text: 'maybe ocean' }, 'b2');
    sendClues(h, 'red');
    sendClues(h, 'blue');
    take();
    h.act({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, decoders(h, 'red')[0]);
    h.act({ type: 'lock-guess', team: 'red' }, decoders(h, 'red')[0]);
    expect(take()).toEqual([]);
    expect(JSON.stringify(insights(h.state, h.state, null, null))).toBe('[]');
  });

  it('never throws, whatever two states of a game it is handed', () => {
    const h = startedGame();
    const { states, take } = record(h);
    while (h.state.phase === 'playing') {
      playRound(h, { redIntercepts: true });
      h.act({ type: 'next-round' });
    }
    expect(take().filter((e) => e.type === 'outcome')).toEqual([
      { type: 'outcome', winners: RED, props: { winner: 'red', round: 3 } },
    ]);
    h.act({ type: 'start' });
    h.act({ type: 'back-to-lobby' });
    for (const a of states) {
      for (const b of states) expect(() => insights(a, b, null, null)).not.toThrow();
    }
  });
});

/** Votes on both transmissions after clues are in (round two or later). */
function playRoundVotes(h: Harness, opts: { redIntercepts?: boolean }) {
  for (const team of ['red', 'blue'] as const) {
    const t = tx(h, team);
    vote(h, team, decoders(h, team), t.code);
    const other: Team = team === 'red' ? 'blue' : 'red';
    vote(
      h,
      team,
      members(other),
      opts.redIntercepts && team === 'blue' ? t.code : wrongCode(t.code),
    );
  }
}

function ctx() {
  return {
    by: HOST,
    isHost: true,
    now: NOW,
    rng: createRng(1),
    content: { wordLists: () => [], words: () => [] },
  };
}
