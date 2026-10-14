import { describe, expect, it } from 'vitest';
import { enigma } from '../logic/game.ts';
import {
  BLUE,
  HOST,
  RED,
  decoders,
  harness,
  sendClues,
  startedGame,
  tx,
  vote,
  wrongCode,
} from '../logic/test-utils.ts';
import {
  chatMuted,
  cluesByKeyword,
  endOfRoundWarnings,
  lockedOnText,
  revealOutcome,
  startBlocker,
  statusFor,
} from './status.ts';

describe('statusFor', () => {
  it('guides players through the lobby', () => {
    const h = harness();
    const v = enigma.view(h.state, 'r2');
    expect(statusFor(v, false, startBlocker(v, 40)).text).toContain('Pick a team');
  });

  it('tells the Encryptor their code, and others who they are waiting for', () => {
    const h = startedGame();
    const enc = tx(h, 'red').encryptor;
    const code = tx(h, 'red').code.join('-');
    expect(statusFor(enigma.view(h.state, enc), false, null)).toMatchObject({ yourMove: true });
    expect(statusFor(enigma.view(h.state, enc), false, null).text).toContain(code);
    sendClues(h, 'red');
    expect(statusFor(enigma.view(h.state, enc), false, null).text).toMatch(
      /Waiting for .* to write clues/,
    );
  });

  it('asks decoders to decode and the host to move on after the reveal', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(statusFor(enigma.view(h.state, 'r2'), false, null).text).toContain('Decode');
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    expect(statusFor(enigma.view(h.state, HOST), true, null)).toMatchObject({ yourMove: true });
  });
});

describe('statusFor names people', () => {
  const room = (offline: string[] = []) => ({
    hostId: HOST,
    players: [...RED, ...BLUE].map((id) => ({
      id,
      name: id.toUpperCase(),
      connected: !offline.includes(id),
    })),
  });

  it('tells a locked-in player who the team is still waiting for', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const [first, ...rest] = decoders(h, 'red');
    vote(h, 'red', [first!], tx(h, 'red').code);
    const status = statusFor(enigma.view(h.state, first!), false, null, room(rest));
    expect(status.yourMove).toBe(false);
    expect(status.text).toBe(
      `Locked in on your code. Waiting for: ${rest.map((id) => `${id.toUpperCase()} (offline)`).join(' and ')}.`,
    );
  });

  it('names the host when waiting for them', () => {
    const h = harness();
    for (const id of RED) h.act({ type: 'join-team', team: 'red' }, id);
    for (const id of BLUE) h.act({ type: 'join-team', team: 'blue' }, id);
    expect(statusFor(enigma.view(h.state, 'r2'), false, null, room()).text).toBe(
      'All set. Waiting for HOST (host) to start the game…',
    );
  });
});

describe('after locking in', () => {
  it('stops saying it is your move and names who is still holding out', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const [a, b] = decoders(h, 'red');
    const code = tx(h, 'red').code;
    vote(h, 'red', [a!], code);
    h.act({ type: 'set-guess', team: 'red', draft: code }, b);
    const status = statusFor(enigma.view(h.state, a!), false, null);
    expect(status.yourMove).toBe(false);
    expect(status.text).toBe(
      `Locked in on your code. Waiting for: ${b!.toUpperCase()} (has ${code.join('-')} picked).`,
    );
    // The holdout is still asked to act.
    expect(statusFor(enigma.view(h.state, b!), false, null).yourMove).toBe(true);
  });

  it('asks a team that locked in different codes to agree', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const [a, b] = decoders(h, 'red');
    const code = tx(h, 'red').code;
    vote(h, 'red', [a!], code);
    vote(h, 'red', [b!], wrongCode(code));
    const status = statusFor(enigma.view(h.state, a!), false, null);
    expect(status).toMatchObject({ yourMove: true });
    expect(status.text).toContain('different codes');
  });
});

describe('once your side agrees', () => {
  it('says which code it is locked on and that a change reopens it', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const code = tx(h, 'red').code;
    const [a] = decoders(h, 'red');
    vote(h, 'red', decoders(h, 'red'), code);
    const redTx = enigma.view(h.state, a!).transmissions.find((t) => t.team === 'red')!;
    // Round 1 has no interceptors, so Red is waiting on Blue's code, not on an interception.
    const locked = `Your team is locked on ${code.join('-')} (waiting for everyone else). Change your pick to reopen.`;
    expect(lockedOnText(redTx)).toBe(locked);
    expect(statusFor(enigma.view(h.state, a!), false, null)).toEqual({
      text: locked,
      yourMove: false,
    });
    // The Encryptor is told the agreed code too.
    expect(statusFor(enigma.view(h.state, HOST), false, null).text).toBe(
      `Your team is locked on ${code.join('-')}. Waiting for the other team…`,
    );
    // Blue still has to decode, so it is still their move.
    expect(statusFor(enigma.view(h.state, 'b2'), false, null).yourMove).toBe(true);
  });

  it('waits for the other team while it is still intercepting', () => {
    const h = startedGame({ flow: 'alternating' });
    for (const team of ['red', 'blue'] as const) {
      sendClues(h, team);
      vote(h, team, decoders(h, team), tx(h, team).code);
      h.act({ type: 'next-round' });
    }
    sendClues(h, 'blue');
    const code = tx(h, 'blue').code;
    vote(h, 'blue', RED, code);
    const view = enigma.view(h.state, 'r2').transmissions.find((t) => t.team === 'blue')!;
    expect(lockedOnText(view)).toBe(
      `Your team is locked on ${code.join('-')} (waiting for the other team). Change your pick to reopen.`,
    );
  });
});

describe('endOfRoundWarnings', () => {
  it('warns mid-round that the game ends after this round, then hands over to the outcome', () => {
    // Alternating: Red goes first in round 1, Blue first in round 2.
    const h = startedGame({ flow: 'alternating' });
    const play = (team: 'red' | 'blue', decodes: boolean) => {
      sendClues(h, team);
      const code = tx(h, team).code;
      vote(h, team, decoders(h, team), decodes ? code : wrongCode(code));
      if (h.state.round >= 2) vote(h, team, team === 'red' ? BLUE : RED, wrongCode(code));
    };
    play('red', true);
    h.act({ type: 'next-round' });
    play('blue', false);
    h.act({ type: 'next-round' });
    play('blue', false);
    // Blue's second miscommunication comes mid-round: Red still gets its turn.
    const warning = ['💥 Blue has 2 miscommunications: the game ends after this round.'];
    expect(endOfRoundWarnings(enigma.view(h.state, 'r2'))).toEqual(warning);
    expect(revealOutcome(enigma.view(h.state, 'r2'))).toBeNull();
    h.act({ type: 'next-round' });
    expect(h.state).toMatchObject({ phase: 'playing', stage: 'clue', round: 2 });
    expect(endOfRoundWarnings(enigma.view(h.state, null))).toEqual(warning);
    play('red', true);
    // The round's last reveal: the outcome takes over from the warning.
    expect(endOfRoundWarnings(enigma.view(h.state, 'b1'))).toEqual([]);
    expect(revealOutcome(enigma.view(h.state, 'b1'))?.winner).toBe('red');
  });

  it('warns everyone when a team hits 2 tokens before the round is over', () => {
    const h = startedGame({ flow: 'alternating' });
    const view = enigma.view(h.state, null);
    const midRound = {
      ...view,
      stage: 'reveal' as const,
      teams: { ...view.teams, blue: { ...view.teams.blue, misses: 2, intercepts: 2 } },
    };
    expect(endOfRoundWarnings(midRound)).toEqual([
      '🕵️ Blue has 2 interceptions: the game ends after this round.',
      '💥 Blue has 2 miscommunications: the game ends after this round.',
    ]);
    // Once the round's last code is revealed there is nothing left to warn about.
    const done = {
      ...midRound,
      transmissions: midRound.transmissions.map((t) => ({ ...t, revealed: true })),
    };
    expect(endOfRoundWarnings(done)).toEqual([]);
    expect(
      endOfRoundWarnings({ ...midRound, settings: { ...midRound.settings, flow: 'simultaneous' } }),
    ).toEqual([]);
  });
});

describe('the deciding reveal', () => {
  it('says who won and why, and the game-over hint keeps the reason without repeating it', () => {
    const h = startedGame();
    // Blue miscommunicates in rounds 1 and 2; nobody intercepts.
    const playRound = () => {
      sendClues(h, 'red');
      sendClues(h, 'blue');
      vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
      vote(h, 'blue', decoders(h, 'blue'), wrongCode(tx(h, 'blue').code));
      if (h.state.round >= 2) {
        vote(h, 'blue', RED, wrongCode(tx(h, 'blue').code));
        vote(h, 'red', BLUE, wrongCode(tx(h, 'red').code));
      }
    };
    playRound();
    expect(revealOutcome(enigma.view(h.state, HOST))).toBeNull();
    h.act({ type: 'next-round' });
    playRound();
    expect(h.state.stage).toBe('reveal');
    const outcome = revealOutcome(enigma.view(h.state, HOST));
    expect(outcome?.winner).toBe('red');
    const status = statusFor(enigma.view(h.state, HOST), true, null);
    expect(status.text).toContain('Red wins!');
    expect(status.text).toContain('See results');
    h.act({ type: 'next-round' });
    const over = statusFor(enigma.view(h.state, 'b1'), false, null).text;
    expect(over).toBe('Game over. Blue had 2 miscommunications.');
  });
});

describe('the showdown', () => {
  it('leads a level score to the showdown, then names its result', () => {
    const h = startedGame();
    h.state = { ...h.state, stage: 'reveal', round: 8 };
    const reveal = statusFor(enigma.view(h.state, HOST), true, null);
    expect(reveal.text).toContain('Dead level!');
    expect(reveal.text).toContain('so it goes to a showdown');
    expect(reveal.text).toContain('Press Start the showdown.');
    h.act({ type: 'next-round' });
    expect(endOfRoundWarnings(enigma.view(h.state, 'r2'))).toEqual([]);
    expect(statusFor(enigma.view(h.state, 'r2'), false, null)).toMatchObject({ yourMove: true });
    expect(statusFor(enigma.view(h.state, null), false, null).yourMove).toBe(false);
    h.act({ type: 'showdown-guesses', guesses: [...h.state.teams.blue.keywords] }, 'r2');
    expect(statusFor(enigma.view(h.state, 'r3'), false, null).text).toBe(
      'Your team has handed in its guesses. Waiting for Blue…',
    );
    h.act({ type: 'showdown-guesses', guesses: ['', '', '', ''] }, 'b1');
    expect(statusFor(enigma.view(h.state, 'b1'), false, null).text).toMatch(
      /In the showdown Red named 4 keywords right and Blue 0\.$/,
    );
  });
});

describe('chatMuted', () => {
  it('mutes the Encryptor from the deal until the reveal, even once their team agrees', () => {
    const h = startedGame();
    const enc = tx(h, 'red').encryptor;
    expect(chatMuted(enigma.view(h.state, enc))).toBe(true);
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(chatMuted(enigma.view(h.state, enc))).toBe(true);
    expect(chatMuted(enigma.view(h.state, 'r2'))).toBe(false);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
    expect(chatMuted(enigma.view(h.state, enc))).toBe(true);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    expect(chatMuted(enigma.view(h.state, enc))).toBe(false);
  });
});

describe('cluesByKeyword', () => {
  it('files each clue under the keyword number its code digit points to', () => {
    const h = startedGame();
    sendClues(h, 'red');
    sendClues(h, 'blue');
    const code = tx(h, 'red').code;
    vote(h, 'red', decoders(h, 'red'), code);
    vote(h, 'blue', decoders(h, 'blue'), tx(h, 'blue').code);
    const columns = cluesByKeyword(enigma.view(h.state, null), 'red');
    expect(columns[code[0]! - 1]).toEqual([{ round: 1, clue: 'alpha' }]);
    expect(columns[code[2]! - 1]).toEqual([{ round: 1, clue: 'charlie' }]);
    expect(columns.flat()).toHaveLength(3);
  });
});
