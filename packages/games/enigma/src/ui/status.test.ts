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
import { chatMuted, cluesByKeyword, revealOutcome, startBlocker, statusFor } from './status.ts';

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

describe('chatMuted', () => {
  it('mutes the Encryptor only while their own team is decoding', () => {
    const h = startedGame();
    const enc = tx(h, 'red').encryptor;
    expect(chatMuted(enigma.view(h.state, enc))).toBe(false);
    sendClues(h, 'red');
    sendClues(h, 'blue');
    expect(chatMuted(enigma.view(h.state, enc))).toBe(true);
    expect(chatMuted(enigma.view(h.state, 'r2'))).toBe(false);
    vote(h, 'red', decoders(h, 'red'), tx(h, 'red').code);
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
    expect(columns[code[0]! - 1]).toEqual([{ round: 1, clue: 'one' }]);
    expect(columns[code[2]! - 1]).toEqual([{ round: 1, clue: 'three' }]);
    expect(columns.flat()).toHaveLength(3);
  });
});
