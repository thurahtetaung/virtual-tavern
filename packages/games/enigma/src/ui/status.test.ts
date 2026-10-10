import { describe, expect, it } from 'vitest';
import { enigma } from '../logic/game.ts';
import { HOST, decoders, harness, sendClues, startedGame, tx, vote } from '../logic/test-utils.ts';
import { cluesByKeyword, startBlocker, statusFor } from './status.ts';

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
