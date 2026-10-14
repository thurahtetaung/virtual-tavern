import { GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { canWriteNotes, decideWinner, enigma, membersOf } from './game.ts';
import {
  BLUE,
  HOST,
  NOW,
  RED,
  content,
  decoders,
  harness,
  members,
  sendClues,
  startedGame,
  tx,
  vote,
  wrongCode,
} from './test-utils.ts';
import {
  type EnigmaState,
  LEGACY_NOTE_ID,
  MAX_CHAT_MESSAGES,
  MAX_NOTE_ITEMS,
  MAX_ROUNDS,
  type Team,
  actionSchema,
} from './types.ts';

/** Plays one full simultaneous round: both teams decode correctly unless told otherwise. */
function playRound(
  h: ReturnType<typeof startedGame>,
  opts: {
    redDecodes?: boolean;
    blueDecodes?: boolean;
    redIntercepts?: boolean;
    blueIntercepts?: boolean;
  } = {},
) {
  sendClues(h, 'red');
  sendClues(h, 'blue');
  const canIntercept = h.state.round >= 2;
  for (const team of ['red', 'blue'] as const) {
    const t = tx(h, team);
    const decodes = team === 'red' ? opts.redDecodes : opts.blueDecodes;
    vote(h, team, decoders(h, team), decodes === false ? wrongCode(t.code) : t.code);
    if (canIntercept) {
      const intercepts = team === 'red' ? opts.blueIntercepts : opts.redIntercepts;
      const other = team === 'red' ? 'blue' : 'red';
      vote(h, team, members(other), intercepts ? t.code : wrongCode(t.code));
    }
  }
  expect(h.state.stage).toBe('reveal');
}

describe('lobby and start', () => {
  it('opens in the lobby with simultaneous flow and the first word list', () => {
    const h = harness();
    expect(h.state).toMatchObject({
      phase: 'lobby',
      settings: {
        wordListIds: ['default'],
        flow: 'simultaneous',
        clueSeconds: null,
        timerMode: 'soft',
      },
    });
  });

  it('needs two players per team and eight words', () => {
    const h = harness();
    h.act({ type: 'join-team', team: 'red' }, HOST);
    h.act({ type: 'join-team', team: 'blue' }, 'b1');
    expect(h.reject({ type: 'start' })).toBe('team-too-small');
    const tiny = harness(undefined, content(['a', 'b', 'c', 'A', 'd', 'e', 'f']));
    tiny.act({ type: 'randomize-teams' });
    expect(tiny.reject({ type: 'start' })).toBe('not-enough-words');
  });

  it('deals four different keywords to each team and starts round one', () => {
    const h = startedGame();
    const all = [...h.state.teams.red.keywords, ...h.state.teams.blue.keywords];
    expect(h.state.teams.red.keywords).toHaveLength(4);
    expect(new Set(all).size).toBe(8);
    expect(h.state).toMatchObject({ phase: 'playing', round: 1, stage: 'clue', active: [0, 1] });
    for (const t of h.state.transmissions) {
      expect(t.code).toHaveLength(3);
      expect(new Set(t.code).size).toBe(3);
      expect(t.code.every((d) => d >= 1 && d <= 4)).toBe(true);
    }
  });

  it('only lets the host change settings, and not mid-game', () => {
    const h = harness();
    expect(h.reject({ type: 'update-settings', flow: 'alternating' }, 'r2')).toBe('not-host');
    h.act({ type: 'update-settings', flow: 'alternating' });
    expect(h.state.settings.flow).toBe('alternating');
    const g = startedGame();
    expect(g.reject({ type: 'update-settings', flow: 'alternating' })).toBe('in-progress');
  });

  it('keeps players on their team mid-game but lets spectators join', () => {
    const h = startedGame();
    expect(h.reject({ type: 'join-team', team: 'blue' }, 'r2')).toBe('team-locked');
    h.state = enigma.playerJoined(h.state, { id: 'late', name: 'Late' });
    h.act({ type: 'join-team', team: 'blue' }, 'late');
    expect(h.state.seats.late?.team).toBe('blue');
  });
});

describe('encryptors and clues', () => {
  it('rotates the Encryptor through each team in seat order', () => {
    const h = startedGame();
    const seen: Record<Team, string[]> = { red: [], blue: [] };
    for (let round = 1; round <= 4; round++) {
      seen.red.push(tx(h, 'red').encryptor);
      seen.blue.push(tx(h, 'blue').encryptor);
      playRound(h);
      h.act({ type: 'next-round' });
    }
    expect(seen.red).toEqual([HOST, 'r2', 'r3', HOST]);
    expect(seen.blue).toEqual(['b1', 'b2', 'b3', 'b1']);
  });

  it('only accepts clues from an active Encryptor, once', () => {
    const h = startedGame();
    expect(h.reject({ type: 'give-clues', clues: ['a', 'b', 'c'] }, 'r2')).toBe('not-encryptor');
    sendClues(h, 'red');
    expect(h.reject({ type: 'give-clues', clues: ['a', 'b', 'c'] }, HOST)).toBe('wrong-stage');
    expect(h.state.stage).toBe('clue');
    sendClues(h, 'blue');
    expect(h.state.stage).toBe('guess');
  });

  it('refuses a clue that is a keyword, a bare number, or a repeat of another clue', () => {
    const h = startedGame();
    const keyword = h.state.teams.red.keywords[2]!;
    const give = (clues: string[]) => h.reject({ type: 'give-clues', clues }, HOST);
    expect(give([` ${keyword.toUpperCase()} `, 'b', 'c'])).toBe('clue-is-keyword');
    expect(give(['a', '42', 'c'])).toBe('clue-is-number');
    expect(give(['a', 'b', '٣'])).toBe('clue-is-number');
    expect(give(['Salty', 'b', 'salty '])).toBe('clues-not-distinct');
    expect(h.state.stage).toBe('clue');
    // The other team's keywords are fair game.
    const theirs = h.state.teams.blue.keywords[0]!;
    h.act({ type: 'give-clues', clues: [theirs, 'legs', ' c '] }, HOST);
    expect(tx(h, 'red').clues).toEqual([theirs, 'legs', 'c']);
  });

  it('refuses a clue the team already gave this game, in any form', () => {
    const h = startedGame();
    h.act({ type: 'give-clues', clues: ['Salty', 'running', 'moon'] }, HOST);
    sendClues(h, 'blue');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    h.act({ type: 'next-round' });
    const enc = tx(h, 'red').encryptor;
    const give = (clues: string[]) => h.reject({ type: 'give-clues', clues }, enc);
    expect(give(['salty', 'b', 'c'])).toBe('clue-used');
    expect(give(['a', 'RUNS', 'c'])).toBe('clue-used');
    expect(give(['a', 'b', 'the moons'])).toBe('clue-used');
    // The other team's old clues are fair game, and so is a clue that only contains an old one.
    h.act({ type: 'give-clues', clues: ['alpha', 'salty sea', 'c'] }, enc);
    expect(tx(h, 'red').clues).toEqual(['alpha', 'salty sea', 'c']);
  });

  it('carries the Encryptor rotation into a rematch, with chat and notes wiped', () => {
    const h = startedGame();
    h.act({ type: 'chat', text: 'old news' }, 'r2');
    h.act({ type: 'add-note', text: 'last game' }, 'b2');
    h.act({ type: 'set-note', slot: 1, text: 'Pizza', base: '' }, 'b2');
    playRound(h, { blueDecodes: false });
    h.act({ type: 'next-round' });
    playRound(h, { blueDecodes: false });
    h.act({ type: 'next-round' });
    expect(h.state.phase).toBe('over');
    h.act({ type: 'start' });
    // Host and r2 encrypted last game, so r3 goes first; likewise b3.
    expect(tx(h, 'red').encryptor).toBe('r3');
    expect(tx(h, 'blue').encryptor).toBe('b3');
    expect(h.state.teams.red).toMatchObject({ chat: [], history: [], misses: 0 });
    expect(h.state.teams.blue.notes).toMatchObject({ items: [], guesses: ['', '', '', ''] });
    expect(h.state.seen).toEqual({
      host: 'red',
      r2: 'red',
      r3: 'red',
      b1: 'blue',
      b2: 'blue',
      b3: 'blue',
    });
  });
});

describe('agreeing on a guess', () => {
  it('needs every decoder to pick the same code and lock it in', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const code = tx(h, 'red').code;
    h.act({ type: 'set-guess', team: 'red', draft: code }, 'r2');
    h.act({ type: 'lock-guess', team: 'red' }, 'r2');
    expect(tx(h, 'red').decodeResult).toBeUndefined();
    h.act({ type: 'set-guess', team: 'red', draft: code }, 'r3');
    expect(tx(h, 'red').decodeResult).toBeUndefined(); // picked but not locked in yet
    h.act({ type: 'lock-guess', team: 'red' }, 'r3');
    expect(tx(h, 'red').decodeResult).toEqual(code);
  });

  it('does not go through when locked-in codes differ, and changing a pick clears the lock', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const code = tx(h, 'red').code;
    vote(h, 'red', ['r2'], code);
    vote(h, 'red', ['r3'], wrongCode(code));
    expect(tx(h, 'red').decodeResult).toBeUndefined();
    expect(enigma.view(h.state, 'r2').transmissions[0]!.disagree).toBe(true);
    h.act({ type: 'set-guess', team: 'red', draft: code }, 'r3');
    expect(tx(h, 'red').decode.r3).toEqual({ draft: code, locked: false });
    h.act({ type: 'lock-guess', team: 'red' }, 'r3');
    expect(tx(h, 'red').decodeResult).toEqual(code);
  });

  it('refuses to lock an incomplete or repeated code, and stops the Encryptor decoding', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    h.act({ type: 'set-guess', team: 'red', draft: [1, 0, 2] }, 'r2');
    expect(h.reject({ type: 'lock-guess', team: 'red' }, 'r2')).toBe('incomplete');
    h.act({ type: 'set-guess', team: 'red', draft: [1, 1, 2] }, 'r2');
    expect(h.reject({ type: 'lock-guess', team: 'red' }, 'r2')).toBe('incomplete');
    expect(h.reject({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, HOST)).toBe(
      'encryptor-cannot-decode',
    );
  });

  it('allows no interception in round one, then lets the whole other team intercept', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(h.reject({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, 'b2')).toBe(
      'no-intercept-yet',
    );
    playRoundFinish(h);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    // Blue's Encryptor this round may still help intercept Red.
    h.act({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, tx(h, 'blue').encryptor);
  });

  it('re-checks agreement when a voter leaves', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    vote(h, 'red', ['r2'], tx(h, 'red').code);
    h.state = enigma.playerLeft(h.state, 'r3', NOW);
    expect(tx(h, 'red').decodeVoters).toEqual(['r2']);
    expect(tx(h, 'red').decodeResult).toEqual(tx(h, 'red').code);
  });

  it('lets a player unlock to change their mind, even after their side has agreed', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const code = tx(h, 'red').code;
    vote(h, 'red', ['r2'], code);
    h.act({ type: 'unlock-guess', team: 'red' }, 'r2');
    expect(tx(h, 'red').decode.r2).toEqual({ draft: code, locked: false });
    vote(h, 'red', ['r3'], code);
    expect(tx(h, 'red').decodeResult).toBeUndefined();
    h.act({ type: 'lock-guess', team: 'red' }, 'r2');
    expect(tx(h, 'red').decodeResult).toEqual(code);
    // Blue is still decoding, so Red's agreement isn't final yet.
    h.act({ type: 'unlock-guess', team: 'red' }, 'r2');
    expect(tx(h, 'red').decodeResult).toBeUndefined();
    h.act({ type: 'set-guess', team: 'red', draft: wrongCode(code) }, 'r3');
    expect(tx(h, 'red').decode.r3).toEqual({ draft: wrongCode(code), locked: false });
  });

  it('needs a team to guess at all', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    h.state = enigma.playerJoined(h.state, { id: 'spec', name: 'Spec' });
    expect(h.reject({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, 'spec')).toBe('no-team');
  });

  it('fixes who votes when guessing starts, so a latecomer watches until the next clues', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    h.state = enigma.playerJoined(h.state, { id: 'late', name: 'Late' });
    h.act({ type: 'join-team', team: 'red' }, 'late');
    expect(tx(h, 'red').decodeVoters).toEqual(['r2', 'r3']);
    expect(h.reject({ type: 'set-guess', team: 'red', draft: [1, 2, 3] }, 'late')).toBe(
      'not-voting',
    );
    const redTx = enigma.view(h.state, 'late').transmissions.find((t) => t.team === 'red')!;
    expect(redTx).toMatchObject({ role: 'waiting', voters: ['r2', 'r3'] });
    vote(h, 'red', ['r2', 'r3'], tx(h, 'red').code);
    expect(tx(h, 'red').decodeResult).toEqual(tx(h, 'red').code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(tx(h, 'red').decodeVoters).toEqual([HOST, 'r3', 'late']);
    expect(tx(h, 'blue').interceptVoters).toEqual([HOST, 'r2', 'r3', 'late']);
    expect(enigma.view(h.state, 'late').transmissions.find((t) => t.team === 'red')!.role).toBe(
      'decoder',
    );
  });
});

/** Finishes round one's guessing with both teams decoding correctly. */
function playRoundFinish(h: ReturnType<typeof startedGame>) {
  vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
  vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
}

describe('reveal and tokens', () => {
  it('files clues in the history and scores decodes and interceptions', () => {
    const h = startedGame();
    playRound(h, { redDecodes: false });
    expect(h.state.teams.red).toMatchObject({ misses: 1, intercepts: 0 });
    expect(h.state.teams.red.history[0]).toMatchObject({
      round: 1,
      clues: ['alpha', 'bravo', 'charlie'],
      decoded: false,
    });
    h.act({ type: 'next-round' });
    playRound(h, { redIntercepts: true });
    expect(h.state.teams.red.intercepts).toBe(1);
    expect(h.state.teams.blue.history[1]).toMatchObject({
      round: 2,
      intercepted: true,
      decoded: true,
    });
  });

  it('only lets the host move on from the reveal', () => {
    const h = startedGame();
    playRound(h);
    expect(h.reject({ type: 'next-round' }, 'r2')).toBe('not-host');
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ round: 2, stage: 'clue' });
  });
});

describe('alternating flow', () => {
  it('plays one transmission at a time, alternating who goes first each round', () => {
    const h = startedGame({ flow: 'alternating' });
    expect(h.state.active).toEqual([0]);
    expect(tx(h, 'red')).toBe(h.state.transmissions[0]);
    expect(h.reject({ type: 'give-clues', clues: ['a', 'b', 'c'] }, tx(h, 'blue').encryptor)).toBe(
      'not-encryptor',
    );
    sendClues(h, 'red');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(h.state.stage).toBe('reveal');
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ round: 1, active: [1], stage: 'clue' });
    sendClues(h, 'blue');
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    h.act({ type: 'next-round' });
    expect(h.state.round).toBe(2);
    expect(h.state.transmissions[0]!.team).toBe('blue');
  });

  it('shows the second Encryptor their code only once their transmission is in play', () => {
    const h = startedGame({ flow: 'alternating' });
    const blueEnc = tx(h, 'blue').encryptor;
    const blueTx = () => enigma.view(h.state, blueEnc).transmissions[1]!;
    expect(blueTx().code).toBeNull();
    sendClues(h, 'red');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(blueTx().code).toBeNull();
    h.act({ type: 'next-round' });
    expect(blueTx().code).toEqual(tx(h, 'blue').code);
  });

  it('applies strict timers to each transmission in turn', () => {
    const h = startedGame({
      flow: 'alternating',
      clueSeconds: 30,
      guessSeconds: 60,
      timerMode: 'strict',
    });
    expect(enigma.nextDeadline!(h.state)).toBe(NOW + 30_000);
    h.state = enigma.onDeadline!(h.state, NOW + 30_000);
    expect(tx(h, 'red')).toMatchObject({ expired: true, revealed: true, decodeResult: null });
    expect(tx(h, 'blue')).toMatchObject({ expired: false, revealed: false });
    expect(h.state).toMatchObject({ stage: 'reveal', teams: { red: { misses: 1 } } });
    h.act({ type: 'next-round' }, HOST, NOW + 40_000);
    expect(h.state).toMatchObject({ active: [1], stage: 'clue', deadline: NOW + 70_000 });
    sendClues(h, 'blue', NOW + 50_000);
    expect(enigma.nextDeadline!(h.state)).toBe(NOW + 110_000);
    h.state = enigma.onDeadline!(h.state, NOW + 110_000);
    expect(h.state).toMatchObject({ stage: 'reveal', teams: { blue: { misses: 1 } } });
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ round: 2, active: [0], stage: 'clue' });
  });

  it('fails the turn of a team that emptied out while the other was transmitting', () => {
    const h = startedGame({ flow: 'alternating' });
    sendClues(h, 'red');
    for (const id of BLUE) h.state = enigma.playerLeft(h.state, id, NOW);
    expect(tx(h, 'blue').expired).toBe(true);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(h.state.stage).toBe('reveal');
    // Blue's transmission is skipped straight to its reveal instead of waiting on a ghost.
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ round: 1, active: [1], stage: 'reveal' });
    expect(h.state.teams.blue.misses).toBe(1);
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ round: 2, stage: 'reveal', teams: { blue: { misses: 2 } } });
    expect(h.state.transmissions[0]!.team).toBe('blue');
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red' });
  });
});

describe('winning', () => {
  const finish = (h: ReturnType<typeof startedGame>, rounds: Parameters<typeof playRound>[1][]) => {
    for (const r of rounds) {
      playRound(h, r);
      h.act({ type: 'next-round' });
    }
  };

  it('ends when a team intercepts twice', () => {
    const h = startedGame();
    finish(h, [{}, { redIntercepts: true }, { redIntercepts: true }]);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red' });
  });

  it('ends when a team miscommunicates twice', () => {
    const h = startedGame();
    finish(h, [{ blueDecodes: false }, { blueDecodes: false }]);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red' });
  });

  it('settles simultaneous end conditions and round eight by score, with draws', () => {
    const base = startedGame().state;
    const withTokens = (red: [number, number], blue: [number, number], round = 3): EnigmaState => ({
      ...base,
      round,
      teams: {
        red: { ...base.teams.red, intercepts: red[0], misses: red[1] },
        blue: { ...base.teams.blue, intercepts: blue[0], misses: blue[1] },
      },
    });
    expect(decideWinner(withTokens([2, 0], [2, 1]))).toBe('red');
    expect(decideWinner(withTokens([2, 1], [2, 1]))).toBe('draw');
    expect(decideWinner(withTokens([1, 0], [0, 0]))).toBeNull();
    expect(decideWinner(withTokens([1, 0], [0, 0], 8))).toBe('red');
    expect(decideWinner(withTokens([0, 0], [0, 0], 8))).toBe('draw');
  });

  it('starts a rematch with the other team first', () => {
    const h = startedGame();
    finish(h, [{ blueDecodes: false }, { blueDecodes: false }]);
    h.act({ type: 'start' });
    expect(h.state).toMatchObject({ phase: 'playing', round: 1, gamesPlayed: 2 });
    expect(h.state.transmissions[0]!.team).toBe('blue');
    expect(h.state.teams.red).toMatchObject({ intercepts: 0, misses: 0, history: [] });
  });

  it('goes to the round-eight tiebreak when nobody has two tokens', () => {
    const h = startedGame();
    const quiet = Array.from({ length: MAX_ROUNDS - 1 }, (_, i) =>
      i === 4 ? { redIntercepts: true } : {},
    );
    finish(h, quiet);
    expect(h.state).toMatchObject({ phase: 'playing', round: MAX_ROUNDS });
    finish(h, [{}]);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red' });
    expect(h.state.teams.red.history).toHaveLength(MAX_ROUNDS);
  });

  it('forgets the last game when the host goes back to the lobby', () => {
    const h = startedGame();
    h.act({ type: 'chat', text: 'secret' }, 'r2');
    h.act({ type: 'set-note', slot: 1, text: 'Pizza', base: '' }, 'b2');
    h.act({ type: 'add-note', text: 'their 2 is a fruit' }, 'b2');
    playRound(h, { redDecodes: false });
    h.act({ type: 'back-to-lobby' });
    expect(h.state).toMatchObject({
      phase: 'lobby',
      round: 0,
      seen: {},
      transmissions: [],
      active: [],
    });
    for (const team of ['red', 'blue'] as const) {
      expect(h.state.teams[team]).toMatchObject({
        keywords: [],
        chat: [],
        history: [],
        misses: 0,
        notes: { guesses: ['', '', '', ''], general: '', editedBy: null, items: [] },
      });
    }
    expect(h.state.seats.r2?.team).toBe('red');
    expect(JSON.stringify(enigma.view(h.state, 'r2'))).not.toContain('secret');
    h.act({ type: 'join-team', team: 'blue' }, 'r2');
  });
});

describe('the showdown after a level score', () => {
  /** Plays to the end of round 8 with nobody scoring, then opens the showdown. */
  function levelGame(opts: Parameters<typeof startedGame>[0] = {}) {
    const h = startedGame(opts);
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      playRound(h);
      h.act({ type: 'next-round' });
    }
    return h;
  }
  const blank = ['', '', '', ''];

  it('opens instead of a draw, and the team with more keywords right wins', () => {
    const h = levelGame();
    expect(h.state).toMatchObject({ phase: 'playing', stage: 'showdown', winner: null });
    const blue = h.state.teams.blue.keywords;
    const red = h.state.teams.red.keywords;
    // Case doesn’t matter; the right word in the wrong slot doesn’t count.
    h.act({ type: 'showdown-guesses', guesses: [blue[0]!.toUpperCase(), blue[2]!, '', 'x'] }, 'r2');
    expect(h.reject({ type: 'showdown-guesses', guesses: blank }, 'r3')).toBe('showdown-done');
    expect(h.state.phase).toBe('playing');
    h.act({ type: 'showdown-guesses', guesses: [red[0]!, red[1]!, 'x', 'y'] }, 'b1');
    expect(h.state).toMatchObject({ phase: 'over', winner: 'blue', startingTeam: 'blue' });
    expect(enigma.view(h.state, null).showdown).toMatchObject({
      right: { red: [true, false, false, false], blue: [true, true, false, false] },
      by: { red: 'r2', blue: 'b1' },
    });
  });

  it('is a shared win when the teams get as many right', () => {
    const h = levelGame();
    h.act({ type: 'showdown-guesses', guesses: blank }, 'r2');
    h.act({ type: 'showdown-guesses', guesses: blank }, 'b2');
    expect(h.state).toMatchObject({ phase: 'over', winner: 'draw' });
  });

  it('only opens on a level score', () => {
    const h = startedGame();
    const quiet = Array.from({ length: MAX_ROUNDS }, (_, i) =>
      i === 4 ? { redIntercepts: true } : {},
    );
    for (const r of quiet) {
      playRound(h, r);
      h.act({ type: 'next-round' });
    }
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red', showdown: null });
  });

  it('hides a team’s guesses from the other team and watchers until the end', () => {
    const h = levelGame();
    h.act({ type: 'showdown-guesses', guesses: ['Zorblax', '', '', ''] }, 'r2');
    for (const viewer of ['b1', null]) {
      const v = enigma.view(h.state, viewer);
      expect(v.showdown).toMatchObject({ done: { red: true, blue: false }, right: null });
      expect(JSON.stringify(v)).not.toContain('Zorblax');
    }
    expect(enigma.view(h.state, 'r3').showdown?.guesses.red).toEqual(['Zorblax', '', '', '']);
  });

  it('lets the Encryptor talk again, and only the host-free paths end it', () => {
    const h = levelGame();
    for (const id of [...RED, ...BLUE]) expect(canWriteNotes(h.state, id)).toBe(true);
    expect(h.reject({ type: 'next-round' })).toBe('wrong-stage');
  });

  it('uses the team’s notes when the strict timer runs out or the team has left', () => {
    const h = levelGame({ guessSeconds: 60, timerMode: 'strict' });
    expect(h.state.deadline).not.toBeNull();
    h.state = {
      ...h.state,
      teams: {
        ...h.state.teams,
        red: {
          ...h.state.teams.red,
          notes: { ...h.state.teams.red.notes, guesses: [...h.state.teams.blue.keywords] },
        },
      },
    };
    h.act({ type: 'showdown-guesses', guesses: blank }, 'b1');
    h.state = enigma.onDeadline!(h.state, enigma.nextDeadline!(h.state)!);
    expect(h.state).toMatchObject({ phase: 'over', winner: 'red' });

    const left = levelGame();
    left.act({ type: 'showdown-guesses', guesses: blank }, 'r2');
    for (const id of BLUE) left.state = enigma.playerLeft(left.state, id, NOW);
    expect(left.state).toMatchObject({ phase: 'over', winner: 'draw' });
  });

  it('forgets the showdown on a rematch', () => {
    const h = levelGame();
    h.act({ type: 'showdown-guesses', guesses: blank }, 'r2');
    h.act({ type: 'showdown-guesses', guesses: blank }, 'b2');
    h.act({ type: 'start' });
    expect(h.state.showdown).toBeNull();
    expect(enigma.view(h.state, 'r2').showdown).toBeNull();
  });
});

describe('timers', () => {
  it('never ends anything in reminder mode', () => {
    const h = startedGame({ clueSeconds: 30 });
    expect(h.state.deadline).toBe(NOW + 30_000);
    expect(enigma.nextDeadline!(h.state)).toBeNull();
    expect(enigma.onDeadline!(h.state, NOW * 10)).toBe(h.state);
  });

  it('in strict mode, missing clues count as a miscommunication', () => {
    const h = startedGame({ clueSeconds: 30, timerMode: 'strict' });
    sendClues(h, 'red');
    h.state = enigma.onDeadline!(h.state, NOW + 30_000);
    expect(tx(h, 'blue')).toMatchObject({
      expired: true,
      timedOut: true,
      clues: null,
      decodeResult: null,
    });
    expect(tx(h, 'red').timedOut).toBeUndefined();
    expect(enigma.view(h.state, 'r2').transmissions.find((t) => t.team === 'blue')).toMatchObject({
      expired: true,
      timedOut: true,
    });
    expect(h.state.stage).toBe('guess');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(h.state.teams.blue.misses).toBe(1);
  });

  it('in strict mode, unfinished guesses fail when the guess timer runs out', () => {
    const h = startedGame({ guessSeconds: 60, timerMode: 'strict' });
    sendClues(h, 'red');
    sendClues(h, 'blue', NOW + 1000);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    h.state = enigma.onDeadline!(h.state, enigma.nextDeadline!(h.state)!);
    expect(h.state.stage).toBe('reveal');
    expect(h.state.teams).toMatchObject({ red: { misses: 0 }, blue: { misses: 1 } });
    expect(enigma.view(h.state, 'b2').transmissions.every((t) => t.guessTimedOut)).toBe(true);
  });

  it('a team left with nobody expires without blaming the timer', () => {
    const h = startedGame();
    for (const id of RED) h.state = enigma.playerLeft(h.state, id, NOW);
    expect(tx(h, 'red')).toMatchObject({ expired: true });
    expect(enigma.view(h.state, 'b1').transmissions[0]).toMatchObject({ timedOut: false });
  });
});

describe('what each player can see', () => {
  function midRound() {
    const h = startedGame();
    playRound(h);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    // r2 is Red's Encryptor this round, so r3 does the talking.
    h.act({ type: 'chat', text: 'I think 3 is space' }, 'r3');
    h.act({ type: 'set-note', slot: 2, text: 'Volcano?', base: '' }, 'r3');
    h.act({ type: 'add-note', text: 'Blue clues are all Glimmerwick' }, 'r3');
    h.act({ type: 'set-guess', team: 'blue', draft: [4, 0, 0] }, 'r2');
    h.act({ type: 'set-guess', team: 'red', draft: [1, 2, 0] }, 'r3');
    return h;
  }

  it('keeps keywords, chat, notes and drafts inside the team', () => {
    const h = midRound();
    const red = enigma.view(h.state, 'r2');
    const blue = enigma.view(h.state, 'b2');
    expect(red.teams.red.keywords).toEqual(h.state.teams.red.keywords);
    expect(red.teams.blue.keywords).toBeNull();
    expect(blue.teams.red.keywords).toBeNull();
    expect(red.chat.map((m) => m.text)).toEqual(['I think 3 is space']);
    expect(blue.chat).toEqual([]);
    expect(red.notes?.guesses[1]).toBe('Volcano?');
    expect(blue.notes?.guesses[1]).toBe('');
    expect(red.notes?.items.map((n) => n.text)).toEqual(['Blue clues are all Glimmerwick']);
    expect(blue.notes?.items).toEqual([]);
    expect(JSON.stringify(blue)).not.toContain('Glimmerwick');
    // Red sees its own drafts on both transmissions; Blue sees none of them.
    expect(Object.keys(red.transmissions.find((t) => t.team === 'red')!.teamVotes)).toEqual(['r3']);
    expect(Object.keys(red.transmissions.find((t) => t.team === 'blue')!.teamVotes)).toEqual([
      'r2',
    ]);
    for (const t of blue.transmissions) expect(Object.keys(t.teamVotes)).not.toContain('r2');
    expect(JSON.stringify(blue)).not.toContain('Volcano');
    expect(JSON.stringify(blue)).not.toContain('space');
  });

  it('shows the code only to its Encryptor until the reveal', () => {
    const h = midRound();
    const redTx = (viewer: string | null) =>
      enigma.view(h.state, viewer).transmissions.find((t) => t.team === 'red')!;
    expect(redTx(tx(h, 'red').encryptor).code).toEqual(tx(h, 'red').code);
    expect(redTx('r3').code).toBeNull();
    expect(redTx('b1').code).toBeNull();
    expect(redTx(null).code).toBeNull();
    expect(redTx(null).role).toBe('spectator');
  });

  it('gives spectators the public history only, and reveals everything at the end', () => {
    const h = midRound();
    const spectator = enigma.view(h.state, null);
    expect(spectator.teams.red.keywords).toBeNull();
    expect(spectator.teams.red.history).toHaveLength(1);
    expect(spectator.chat).toEqual([]);
    expect(spectator.notes).toBeNull();
    expect(JSON.stringify(spectator)).not.toContain('Glimmerwick');
    expect(JSON.stringify(spectator)).not.toContain('Volcano');
    const over = enigma.view({ ...h.state, phase: 'over' }, null);
    expect(over.teams.red.keywords).toEqual(h.state.teams.red.keywords);
    expect(over.teams.blue.keywords).toEqual(h.state.teams.blue.keywords);
  });

  it('never sends who has seen which keywords', () => {
    const h = midRound();
    for (const viewer of [HOST, 'b1', null]) {
      expect(enigma.view(h.state, viewer)).not.toHaveProperty('seen');
    }
  });

  it('locks a player to their team even after leaving and rejoining the room', () => {
    const h = startedGame();
    h.state = enigma.playerLeft(h.state, 'r2', NOW);
    h.state = enigma.playerJoined(h.state, { id: 'r2', name: 'R2' });
    expect(h.state.seats.r2?.team).toBeNull();
    expect(h.reject({ type: 'join-team', team: 'blue' }, 'r2')).toBe('team-locked');
    expect(enigma.view(h.state, 'r2').teams.blue.keywords).toBeNull();
    h.act({ type: 'join-team', team: 'red' }, 'r2');
    expect(h.reject({ type: 'join-team', team: null }, 'r2')).toBe('team-locked');
  });
});

describe('team chat and notes', () => {
  it('shares notes between teammates and caps note lengths', () => {
    const h = startedGame();
    h.act({ type: 'add-note', text: 'Their 1 is probably food' }, BLUE[1]);
    expect(enigma.view(h.state, BLUE[2]!).notes?.items).toEqual([
      { id: 'n1', by: BLUE[1], text: 'Their 1 is probably food', at: NOW },
    ]);
    expect(
      actionSchema.safeParse({ type: 'set-note', slot: 1, text: 'x'.repeat(41), base: '' }).success,
    ).toBe(false);
  });

  it('lets any teammate remove any note, and nobody else', () => {
    const h = startedGame();
    h.act({ type: 'add-note', text: 'one' }, 'b3');
    h.act({ type: 'add-note', text: 'two' }, 'b2');
    // A Red player removing "n1" only touches Red's own (empty) list.
    h.act({ type: 'remove-note', id: 'n1' }, 'r2');
    expect(h.state.teams.blue.notes.items?.map((n) => n.text)).toEqual(['one', 'two']);
    h.act({ type: 'remove-note', id: 'n1' }, 'b3');
    expect(h.state.teams.blue.notes.items?.map((n) => n.text)).toEqual(['two']);
    // Removing a note that's already gone is harmless.
    h.act({ type: 'remove-note', id: 'n1' }, 'b2');
    expect(h.state.teams.blue.notes.items?.map((n) => n.text)).toEqual(['two']);
    // Ids are never reused.
    h.act({ type: 'add-note', text: 'three' }, 'b3');
    expect(h.state.teams.blue.notes.items?.map((n) => n.id)).toEqual(['n2', 'n3']);
  });

  it('keeps both of two notes added at nearly the same time', () => {
    const h = startedGame();
    // Both teammates send from the same starting state; actions run one after the other.
    h.act({ type: 'add-note', text: 'from b3' }, 'b3', NOW);
    h.act({ type: 'add-note', text: 'from b2' }, 'b2', NOW + 1);
    expect(enigma.view(h.state, 'b3').notes?.items.map((n) => [n.by, n.text])).toEqual([
      ['b3', 'from b3'],
      ['b2', 'from b2'],
    ]);
  });

  it('caps a team at MAX_NOTE_ITEMS notes and each note at 200 characters', () => {
    const h = startedGame();
    for (let i = 0; i < MAX_NOTE_ITEMS; i++) h.act({ type: 'add-note', text: `note ${i}` }, 'b3');
    expect(h.reject({ type: 'add-note', text: 'one too many' }, 'b2')).toBe('notes-full');
    // The other team's list is separate.
    h.act({ type: 'add-note', text: 'red has room' }, 'r2');
    h.act({ type: 'remove-note', id: 'n1' }, 'b2');
    h.act({ type: 'add-note', text: 'room again' }, 'b2');
    expect(h.state.teams.blue.notes.items).toHaveLength(MAX_NOTE_ITEMS);
    expect(actionSchema.safeParse({ type: 'add-note', text: 'x'.repeat(200) }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'add-note', text: 'x'.repeat(201) }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'add-note', text: '   ' }).success).toBe(false);
  });

  it('refuses a keyword guess made over a teammate’s newer one, and keeps theirs', () => {
    const h = startedGame();
    // b3 and b2 both start editing guess 1 while it's empty; b2 saves first.
    h.act({ type: 'set-note', slot: 1, text: 'Pizza', base: '' }, 'b2');
    const before = h.state;
    const result = enigma.reduce(
      h.state,
      { type: 'set-note', slot: 1, text: 'Lasagne', base: '' },
      { by: 'b3', isHost: false, now: NOW, rng: createRng(1), content: content() },
    );
    expect(result).toBeInstanceOf(GameError);
    expect(result).toMatchObject({ code: 'note-conflict', message: 'B2 just changed this' });
    expect(h.state).toBe(before);
    expect(h.state.teams.blue.notes.guesses[0]).toBe('Pizza');
    // Starting from the current value works, and so does clearing it.
    h.act({ type: 'set-note', slot: 1, text: 'Lasagne', base: 'Pizza' }, 'b3');
    h.act({ type: 'set-note', slot: 1, text: '', base: 'Lasagne' }, 'b2');
    expect(h.state.teams.blue.notes.guesses).toEqual(['', '', '', '']);
    // Saving what's already there is not a conflict.
    h.act({ type: 'set-note', slot: 2, text: 'Sea', base: '' }, 'b3');
    h.act({ type: 'set-note', slot: 2, text: 'Sea', base: '' }, 'b2');
  });

  it('shows a room’s old single notes field as a removable first note', () => {
    const h = startedGame();
    // A room saved before notes became a list.
    const legacy = (editedBy: string | null) => {
      const blue = h.state.teams.blue;
      return {
        ...h.state,
        teams: {
          ...h.state.teams,
          blue: {
            ...blue,
            notes: { guesses: ['Pizza', '', '', ''], general: 'old hunches', editedBy },
          },
        },
      };
    };
    h.state = legacy(null);
    expect(enigma.view(h.state, 'b3').notes).toEqual({
      guesses: ['Pizza', '', '', ''],
      items: [{ id: LEGACY_NOTE_ID, by: '', text: 'old hunches', at: 0 }],
    });
    expect(enigma.view(h.state, 'r2').notes?.items).toEqual([]);
    h.state = legacy('b2');
    expect(enigma.view(h.state, 'b3').notes?.items[0]?.by).toBe('b2');

    // The next change moves it into the list; nothing is lost.
    h.act({ type: 'add-note', text: 'new hunch' }, 'b3');
    expect(h.state.teams.blue.notes).toMatchObject({ general: '', guesses: ['Pizza', '', '', ''] });
    expect(enigma.view(h.state, 'b3').notes?.items.map((n) => [n.id, n.text])).toEqual([
      [LEGACY_NOTE_ID, 'old hunches'],
      ['n1', 'new hunch'],
    ]);
    h.act({ type: 'set-note', slot: 1, text: 'Pasta', base: 'Pizza' }, 'b3');
    h.act({ type: 'remove-note', id: LEGACY_NOTE_ID }, 'b3');
    expect(enigma.view(h.state, 'b3').notes?.items.map((n) => n.text)).toEqual(['new hunch']);

    // Removing it straight away works too, and an old room still plays on.
    h.state = legacy(null);
    h.act({ type: 'remove-note', id: LEGACY_NOTE_ID }, 'b2');
    expect(enigma.view(h.state, 'b3').notes?.items).toEqual([]);
    playRound(h);
    h.act({ type: 'next-round' });
    expect(h.state.round).toBe(2);
  });

  it('needs a team to chat or take notes', () => {
    const h = startedGame();
    h.state = enigma.playerJoined(h.state, { id: 'spec', name: 'Spec' });
    expect(h.reject({ type: 'chat', text: 'hi' }, 'spec')).toBe('no-team');
    expect(h.reject({ type: 'set-note', slot: 1, text: 'x', base: '' }, 'spec')).toBe('no-team');
    expect(h.reject({ type: 'add-note', text: 'x' }, 'spec')).toBe('no-team');
    expect(h.reject({ type: 'remove-note', id: 'n1' }, 'spec')).toBe('no-team');
    // b1 is Blue's Encryptor this round, so only b2 may write notes.
    expect(canWriteNotes(h.state, 'b2')).toBe(true);
    expect(canWriteNotes(h.state, 'b1')).toBe(false);
  });

  it('mutes the Encryptor in chat and notes from the deal until the reveal', () => {
    const h = startedGame();
    // The code is dealt: no chat or notes while writing clues…
    expect(h.reject({ type: 'chat', text: 'psst: the code is 4-3-1' }, HOST)).toBe(
      'encryptor-silent',
    );
    expect(h.reject({ type: 'add-note', text: '4-3-1' }, HOST)).toBe('notes-muted');
    expect(canWriteNotes(h.state, HOST)).toBe(false);
    sendClues(h, 'red');
    sendClues(h, 'blue');
    // …nor while the team decodes.
    expect(h.reject({ type: 'chat', text: 'psst, 3-1-4' }, HOST)).toBe('encryptor-silent');
    expect(h.reject({ type: 'set-note', slot: 2, text: 'sea', base: '' }, HOST)).toBe(
      'notes-muted',
    );
    h.act({ type: 'add-note', text: 'Blue 2 = sea?' }, 'r2');
    expect(h.reject({ type: 'remove-note', id: 'n1' }, HOST)).toBe('notes-muted');
    h.act({ type: 'chat', text: 'is clue 1 about food?' }, 'r2');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    // Agreeing isn't enough (the team could still reopen): only the reveal lifts it.
    expect(h.reject({ type: 'chat', text: 'nice one' }, HOST)).toBe('encryptor-silent');
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    expect(h.state.stage).toBe('reveal');
    h.act({ type: 'chat', text: 'nice one' }, HOST);
    h.act({ type: 'set-note', slot: 2, text: 'sea', base: '' }, HOST);
    h.act({ type: 'remove-note', id: 'n1' }, HOST);
    expect(h.state.teams.red.chat.map((m) => m.by)).toEqual(['r2', HOST]);
  });

  it('mutes the second Encryptor in alternating flow only once their code is dealt', () => {
    const h = startedGame({ flow: 'alternating' });
    h.act({ type: 'chat', text: 'go red' }, 'b1');
    sendClues(h, 'red');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    h.act({ type: 'next-round' });
    expect(h.reject({ type: 'chat', text: 'hm' }, 'b1')).toBe('encryptor-silent');
  });

  it('keeps only the latest messages', () => {
    const h = startedGame();
    for (let i = 0; i < MAX_CHAT_MESSAGES + 5; i++) h.act({ type: 'chat', text: `m${i}` }, 'r2');
    expect(h.state.teams.red.chat).toHaveLength(MAX_CHAT_MESSAGES);
    expect(h.state.teams.red.chat[0]?.text).toBe('m5');
  });
});

describe('players leaving', () => {
  it('hands an unsent clue to a teammate when the Encryptor leaves', () => {
    const h = startedGame();
    h.state = enigma.playerLeft(h.state, HOST, NOW);
    expect(tx(h, 'red').encryptor).toBe('r2');
    sendClues(h, 'red');
    expect(tx(h, 'red').clues).toHaveLength(3);
  });

  it('skips a team that has nobody left', () => {
    const h = startedGame();
    for (const id of RED) h.state = enigma.playerLeft(h.state, id, NOW);
    sendClues(h, 'blue');
    expect(tx(h, 'red')).toMatchObject({ expired: true, decodeResult: null });
  });

  it('keeps a transmission going when its Encryptor leaves after sending clues', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    h.state = enigma.playerLeft(h.state, HOST, NOW);
    expect(tx(h, 'red')).toMatchObject({
      encryptor: HOST,
      expired: false,
      decodeVoters: ['r2', 'r3'],
    });
    vote(h, 'red', ['r2', 'r3'], tx(h, 'red').code);
    expect(tx(h, 'red').decodeResult).toEqual(tx(h, 'red').code);
  });

  it('keeps the clue stage open for a team down to its Encryptor, so a rejoiner can decode', () => {
    const h = startedGame();
    h.state = enigma.playerLeft(h.state, 'r3', NOW);
    h.state = enigma.playerLeft(h.state, 'r2', NOW);
    expect(tx(h, 'red')).toMatchObject({ encryptor: HOST, expired: false });
    // r2 comes back before the clues go out and decodes as usual.
    h.state = enigma.playerJoined(h.state, { id: 'r2', name: 'R2' });
    h.act({ type: 'join-team', team: 'red' }, 'r2');
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(tx(h, 'red').decodeVoters).toEqual(['r2']);
    vote(h, 'red', ['r2'], tx(h, 'red').code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    expect(h.state).toMatchObject({ stage: 'reveal', teams: { red: { misses: 0 } } });
  });

  it('counts clues nobody could decode as a miscommunication', () => {
    const h = startedGame();
    h.state = enigma.playerLeft(h.state, 'r3', NOW);
    h.state = enigma.playerLeft(h.state, 'r2', NOW);
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(enigma.view(h.state, 'b2').transmissions[0]).toMatchObject({ noDecoders: true });
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    expect(h.state).toMatchObject({ stage: 'reveal', teams: { red: { misses: 1 } } });
  });
});

describe('actionSchema', () => {
  it('trims clues and notes', () => {
    expect(actionSchema.parse({ type: 'give-clues', clues: [' a ', 'b', 'c'] })).toMatchObject({
      clues: ['a', 'b', 'c'],
    });
    expect(actionSchema.parse({ type: 'set-note', slot: 1, text: '   ', base: 'x' })).toMatchObject(
      { text: '' },
    );
    expect(actionSchema.parse({ type: 'add-note', text: ' a note ' })).toMatchObject({
      text: 'a note',
    });
  });

  it.each([
    { type: 'give-clues', clues: ['a', 'b'] },
    { type: 'give-clues', clues: ['a', 'b', 'x'.repeat(41)] },
    { type: 'give-clues', clues: ['a', 'b', '   '] },
    { type: 'give-clues', clues: ['a', 'b', 'two\nlines'] },
    { type: 'set-note', slot: 1, text: 'x'.repeat(41), base: '' },
    { type: 'set-note', slot: 1, text: 'x' },
    { type: 'set-note', slot: 'general', text: 'x', base: '' },
    { type: 'set-guess', team: 'red', draft: [1, 2, 5] },
    { type: 'set-guess', team: 'green', draft: [1, 2, 3] },
    { type: 'set-note', slot: 5, text: 'x', base: '' },
    { type: 'remove-note', id: '' },
    { type: 'chat', text: '   ' },
    { type: 'update-settings', flow: 'sideways' },
  ])('rejects %j', (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });
});

describe('round 2 rule fixes', () => {
  it('checks clues against accents, plurals, whole words and numbers', () => {
    const h = harness(
      undefined,
      content(['Café', 'moon', 'shell', 'night', 'apple', 'river', 'tiger', 'bread']),
      1,
    );
    h.state = { ...h.state, startingTeam: 'red' };
    for (const id of RED) h.act({ type: 'join-team', team: 'red' }, id);
    for (const id of BLUE) h.act({ type: 'join-team', team: 'blue' }, id);
    h.act({ type: 'start' });
    const keywords = h.state.teams.red.keywords;
    const enc = tx(h, 'red').encryptor;
    const give = (clue: string) =>
      h.reject({ type: 'give-clues', clues: [clue, 'zebra', 'yonder'] }, enc);
    for (const k of keywords) {
      expect(give(`${k}s`), `${k}s`).toBe('clue-is-keyword');
      expect(give(`the ${k}`), `the ${k}`).toBe('clue-is-keyword');
    }
    if (keywords.includes('Café')) expect(give('Cafe')).toBe('clue-is-keyword');
    for (const clue of ['three', 'Four', '#3', '3rd', 'III', 'iv']) {
      expect(give(clue), clue).toBe('clue-is-number');
    }
  });

  it('rotates fairly when players leave and rejoin', () => {
    const h = startedGame();
    const seen: string[] = [];
    const live = (team: Team) => membersOf(h.state, team);
    const round = () => {
      seen.push(tx(h, 'red').encryptor);
      sendClues(h, 'red');
      sendClues(h, 'blue');
      for (const team of ['red', 'blue'] as const) {
        const code = tx(h, team).code;
        vote(
          h,
          team,
          live(team).filter((id) => id !== tx(h, team).encryptor),
          code,
        );
        if (h.state.round >= 2)
          vote(h, team, live(team === 'red' ? 'blue' : 'red'), wrongCode(code));
      }
      h.act({ type: 'next-round' });
    };
    round(); // host
    // Round 2 is r2's, but r2 drops out before writing clues and comes straight back.
    expect(tx(h, 'red').encryptor).toBe('r2');
    h.state = enigma.playerLeft(h.state, 'r2', NOW);
    h.state = enigma.playerJoined(h.state, { id: 'r2', name: 'R2' });
    h.act({ type: 'join-team', team: 'red' }, 'r2');
    round(); // r3 stepped in
    round(); // r2 has encrypted least, so the rejoiner goes next
    round(); // everyone has gone once: back to the host
    expect(seen).toEqual([HOST, 'r3', 'r2', HOST]);
    // Round 5 went to r3 (seat order breaks the tie), so r2 is up after that.
    expect(tx(h, 'red').encryptor).toBe('r3');
    expect(enigma.view(h.state, 'r2').teams.red.nextEncryptor).toBe('r2');
  });

  it('replaces an Encryptor who leaves with the teammate who has encrypted least', () => {
    const h = startedGame();
    playRound(h);
    h.act({ type: 'next-round' });
    expect(tx(h, 'red').encryptor).toBe('r2');
    h.state = enigma.playerLeft(h.state, 'r2', NOW);
    expect(tx(h, 'red').encryptor).toBe('r3');
  });

  it('lets the host skip an offline voter', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const [a, b] = decoders(h, 'red');
    vote(h, 'red', [a!], tx(h, 'red').code);
    expect(enigma.view(h.state, HOST).transmissions[0]!.waitingOn).toContain(b);
    expect(h.reject({ type: 'skip-voter', team: 'red', player: b! }, a)).toBe('not-host');
    h.act({ type: 'skip-voter', team: 'red', player: b! });
    expect(tx(h, 'red').decodeResult).toEqual(tx(h, 'red').code);
    expect(h.reject({ type: 'skip-voter', team: 'red', player: b! })).toBe('not-voting');
  });
});

describe('nothing is final until every side agrees at once', () => {
  /** Round 2, simultaneous, clues sent: Red decodes Blue's interception on both codes. */
  function roundTwo() {
    const h = startedGame();
    playRound(h);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    return h;
  }

  it('scores the code a team changed to, not the one it agreed on first', () => {
    // Red's interceptors briefly all lock in Blue's real code, then change to a wrong one.
    const h = roundTwo();
    const real = tx(h, 'blue').code;
    vote(h, 'blue', RED, real);
    expect(tx(h, 'blue').interceptResult).toEqual(real);
    expect(h.state.stage).toBe('guess');
    const [first] = RED;
    h.act({ type: 'unlock-guess', team: 'blue' }, first);
    expect(tx(h, 'blue').interceptResult).toBeUndefined();
    vote(h, 'blue', RED, wrongCode(real));
    expect(tx(h, 'blue').interceptResult).toEqual(wrongCode(real));
    // Everyone else agrees, and the reveal scores the changed guess.
    vote(h, 'blue', decoders(h, 'blue'), real);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    vote(h, 'red', BLUE, wrongCode(tx(h, 'red').code));
    expect(h.state.stage).toBe('reveal');
    expect(h.state.teams.red.intercepts).toBe(0);
    expect(h.state.teams.blue.history.at(-1)).toMatchObject({
      interceptGuess: wrongCode(real),
      intercepted: false,
      decoded: true,
    });
  });

  it('keeps a decode that has agreed open while the interception is still voting', () => {
    const h = startedGame({ flow: 'alternating' });
    playRound2Alternating(h);
    const code = tx(h, 'red').code;
    vote(h, 'red', decoders(h, 'red'), code);
    expect(tx(h, 'red').decodeResult).toEqual(code);
    expect(h.state.stage).toBe('guess');
    const redTx = (id: string) =>
      enigma.view(h.state, id).transmissions.find((t) => t.team === 'red');
    expect(redTx(decoders(h, 'red')[0]!)).toMatchObject({
      settled: true,
      agreed: code,
      otherSideSettled: false,
    });
    // Blue sees only its own side: no Red code leaks through `agreed`.
    expect(redTx('b1')).toMatchObject({
      settled: false,
      agreed: null,
      otherSideSettled: true,
    });
    // Red reopens, and the reveal waits for it again.
    h.act({ type: 'unlock-guess', team: 'red' }, decoders(h, 'red')[0]);
    vote(h, 'red', BLUE, wrongCode(code));
    expect(h.state.stage).toBe('guess');
    vote(h, 'red', [decoders(h, 'red')[0]!], code);
    expect(h.state.stage).toBe('reveal');
    expect(h.state.teams.red.history.at(-1)).toMatchObject({ decoded: true, intercepted: false });
  });

  it('keeps the Encryptor muted after their team agrees, since it can still reopen', () => {
    const h = roundTwo();
    const enc = tx(h, 'red').encryptor;
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(h.state.stage).toBe('guess');
    expect(canWriteNotes(h.state, enc)).toBe(false);
    expect(h.reject({ type: 'chat', text: 'hint' }, enc)).toBe('encryptor-silent');
  });

  it('keeps a strict timer expiry final', () => {
    const h = startedGame({ clueSeconds: 30, guessSeconds: 60, timerMode: 'strict' });
    sendClues(h, 'red');
    h.state = enigma.onDeadline!(h.state, NOW + 30_000);
    // Blue never sent clues: its result is fixed, and nobody can vote it open again.
    expect(tx(h, 'blue')).toMatchObject({ expired: true, decodeResult: null });
    expect(h.reject({ type: 'set-guess', team: 'blue', draft: [1, 2, 3] }, 'b2')).toBe('settled');
    vote(h, 'red', ['r2'], tx(h, 'red').code);
    expect(tx(h, 'blue')).toMatchObject({ decodeResult: null, interceptResult: null });
    // The guess timer then settles Red's undecided side for good.
    h.state = enigma.onDeadline!(h.state, enigma.nextDeadline!(h.state)!);
    expect(h.state.stage).toBe('reveal');
    expect(h.state.teams).toMatchObject({ red: { misses: 1 }, blue: { misses: 1 } });
    expect(h.reject({ type: 'unlock-guess', team: 'red' }, 'r2')).toBe('wrong-stage');
  });

  it('lets the host skip a voter after the other side has agreed, which reveals', () => {
    const h = roundTwo();
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    vote(h, 'blue', RED, wrongCode(tx(h, 'blue').code));
    const [b1, b2, b3] = BLUE;
    vote(h, 'red', [b1!, b2!], wrongCode(tx(h, 'red').code));
    // Everything has agreed except b3: an agreed side has nobody to skip.
    expect(h.reject({ type: 'skip-voter', team: 'red', player: decoders(h, 'red')[0]! })).toBe(
      'not-voting',
    );
    h.act({ type: 'skip-voter', team: 'red', player: b3! });
    expect(h.state.stage).toBe('reveal');
    expect(h.state.teams.red.history.at(-1)).toMatchObject({
      interceptGuess: wrongCode(tx(h, 'red').code),
      decoded: true,
    });
  });
});

/** Alternating flow: plays round 1 for both teams, then sends Red's round-2 clues. */
function playRound2Alternating(h: ReturnType<typeof startedGame>) {
  for (const team of ['red', 'blue'] as const) {
    sendClues(h, team);
    vote(h, team, decoders(h, team), tx(h, team).code);
    h.act({ type: 'next-round' });
  }
  // Round 2 opens with Blue in alternating flow; play it through to Red's turn.
  sendClues(h, 'blue');
  vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
  vote(h, 'blue', RED, wrongCode(tx(h, 'blue').code));
  h.act({ type: 'next-round' });
  sendClues(h, 'red');
}
