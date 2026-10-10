import { describe, expect, it } from 'vitest';
import { decideWinner, enigma } from './game.ts';
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
import { type EnigmaState, type Team, actionSchema } from './types.ts';

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
    expect(tx(h, 'red').decodeResult).toEqual(tx(h, 'red').code);
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
      clues: ['one', 'two', 'three'],
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
    expect(tx(h, 'blue')).toMatchObject({ expired: true, clues: null, decodeResult: null });
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
  });
});

describe('what each player can see', () => {
  function midRound() {
    const h = startedGame();
    playRound(h);
    h.act({ type: 'next-round' });
    sendClues(h, 'red');
    sendClues(h, 'blue');
    h.act({ type: 'chat', text: 'I think 3 is space' }, 'r2');
    h.act({ type: 'set-note', slot: 2, text: 'Volcano?' }, 'r3');
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
    const over = enigma.view({ ...h.state, phase: 'over' }, null);
    expect(over.teams.red.keywords).toEqual(h.state.teams.red.keywords);
    expect(over.teams.blue.keywords).toEqual(h.state.teams.blue.keywords);
  });
});

describe('team chat and notes', () => {
  it('shares notes between teammates and caps note lengths', () => {
    const h = startedGame();
    h.act({ type: 'set-note', slot: 'general', text: 'Their 1 is probably food' }, BLUE[0]);
    expect(enigma.view(h.state, BLUE[2]!).notes).toMatchObject({
      general: 'Their 1 is probably food',
      editedBy: BLUE[0],
    });
    expect(h.reject({ type: 'set-note', slot: 1, text: 'x'.repeat(41) }, 'b2')).toBe(
      'note-too-long',
    );
  });

  it('needs a team to chat or take notes', () => {
    const h = startedGame();
    h.state = enigma.playerJoined(h.state, { id: 'spec', name: 'Spec' });
    expect(h.reject({ type: 'chat', text: 'hi' }, 'spec')).toBe('no-team');
    expect(h.reject({ type: 'set-note', slot: 1, text: 'x' }, 'spec')).toBe('no-team');
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
});

describe('actionSchema', () => {
  it.each([
    { type: 'give-clues', clues: ['a', 'b'] },
    { type: 'give-clues', clues: ['a', 'b', 'x'.repeat(41)] },
    { type: 'set-guess', team: 'red', draft: [1, 2, 5] },
    { type: 'set-guess', team: 'green', draft: [1, 2, 3] },
    { type: 'set-note', slot: 5, text: 'x' },
    { type: 'chat', text: '   ' },
    { type: 'update-settings', flow: 'sideways' },
  ])('rejects %j', (action) => {
    expect(actionSchema.safeParse(action).success).toBe(false);
  });
});
