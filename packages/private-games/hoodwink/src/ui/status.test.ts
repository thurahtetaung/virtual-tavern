import { describe, expect, it } from 'vitest';
import { hoodwink } from '../logic/game.ts';
import {
  FOUR,
  HOST,
  content,
  deck,
  harness,
  lieOf,
  playRound,
  round,
  startedGame,
  truthIndex,
  writeAll,
} from '../logic/test-utils.ts';
import type { HoodwinkState } from '../logic/types.ts';
import { listNames, nameOf, ranks, splitPrompt, startBlocker, statusFor } from './status.ts';

const status = (h: { state: HoodwinkState }, id: string | null, host = false) =>
  statusFor(hoodwink.view(h.state, id), host, null);

describe('startBlocker', () => {
  it('needs three players, some decks, and enough questions for the rounds', () => {
    expect(startBlocker(hoodwink.view(harness([HOST, 'p2']).state, HOST))).toContain(
      'at least 3 players (2 so far)',
    );
    expect(startBlocker(hoodwink.view(harness(FOUR, content([])).state, HOST))).toContain(
      'No question decks yet',
    );
    const h = harness(FOUR, content([deck('few', 6)]));
    h.act({ type: 'update-settings', rounds: 7 });
    expect(startBlocker(hoodwink.view(h.state, HOST))).toBe(
      '7 rounds need at least 7 questions in the chosen decks.',
    );
    h.act({ type: 'update-settings', rounds: 5 });
    expect(startBlocker(hoodwink.view(h.state, HOST))).toBeNull();
  });
});

describe('statusFor', () => {
  it('guides the lobby', () => {
    const h = harness(FOUR);
    expect(status(h, HOST, true)).toMatchObject({ yourMove: true });
    expect(status(h, 'p2').text).toContain('Waiting for the host');
    const players = FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: true }));
    expect(
      statusFor(hoodwink.view(h.state, 'p2'), false, null, { you: 'p2', hostId: HOST, players })
        .text,
    ).toBe('All set. Waiting for HOST (host) to start…');
    expect(statusFor(hoodwink.view(h.state, HOST), true, 'No decks.').text).toBe(
      'Almost ready: No decks.',
    );
    h.act({ type: 'sit', playing: false }, 'p2');
    expect(status(h, 'p2').text).toContain("You're watching");
  });

  it('asks everyone to write, then to vote', () => {
    const h = startedGame();
    expect(status(h, 'p2')).toMatchObject({ yourMove: true });
    expect(status(h, 'p2').text).toContain('lie that sounds true');
    h.act({ type: 'lie', text: 'Ferrets' }, 'p2');
    expect(status(h, 'p2')).toEqual({
      text: 'Lie sent! Waiting for: HOST, P3 and P4… You can still change yours.',
      yourMove: false,
    });
    expect(status(h, null).text).toBe('Everyone is writing a lie…');
    h.state = hoodwink.playerJoined(h.state, { id: 'late', name: 'Late' });
    expect(status(h, 'late').text).toContain('You join in from the next round.');
    for (const id of [HOST, 'p3', 'p4']) h.act({ type: 'lie', text: `lie ${id}` }, id);
    expect(status(h, 'p2')).toEqual({
      text: 'Which answer is the truth? Pick one.',
      yourMove: true,
    });
    h.act({ type: 'vote', option: truthIndex(h) }, 'p2');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p3');
    h.act({ type: 'vote', option: truthIndex(h) }, 'p4');
    expect(status(h, 'p2').text).toBe('Voted! Waiting for: HOST… You can still change your vote.');
    // With the room, offline players are marked so nobody waits on them unawares.
    const players = FOUR.map((id) => ({ id, name: id.toUpperCase(), connected: id !== HOST }));
    expect(
      statusFor(hoodwink.view(h.state, 'p2'), false, null, { you: 'p2', hostId: HOST, players })
        .text,
    ).toBe('Voted! Waiting for: HOST (offline)… You can still change your vote.');
    expect(status(h, 'late').text).toContain('hunting for the truth');
  });

  it('reveals the truth and the viewer’s points, and asks the host to move on', () => {
    const h = startedGame();
    writeAll(h);
    const truth = round(h).question.answer;
    h.act({ type: 'vote', option: truthIndex(h) }, HOST);
    for (const id of ['p2', 'p3', 'p4']) h.act({ type: 'vote', option: lieOf(h, HOST) }, id);
    expect(status(h, HOST, true)).toEqual({
      text: `The truth was “${truth}”. You scored 2,500. Press Next round when everyone has had a look.`,
      yourMove: true,
    });
    expect(status(h, 'p2')).toEqual({
      text: `The truth was “${truth}”. You scored 0. Waiting for the host to start the next round…`,
      yourMove: false,
    });
    const players = [{ id: HOST, name: 'Hana' }];
    expect(
      statusFor(hoodwink.view(h.state, 'p2'), false, null, { you: 'p2', hostId: HOST, players })
        .text,
    ).toContain('Waiting for Hana (host) to start the next round…');
  });

  it('names the winner, a tie, or a game cut short', () => {
    const h = startedGame(FOUR, { rounds: 5 });
    for (let i = 0; i < 5; i++) playRound(h);
    expect(status(h, HOST).text).toBe('Game over! A tie at 6,000 points: You, P2, P3 and P4.');
    h.state = {
      ...h.state,
      scores: { ...h.state.scores, p2: { ...h.state.scores.p2!, score: 9000 } },
    };
    expect(status(h, HOST).text).toBe('Game over! P2 wins with 9,000 points.');
    expect(status(h, 'p2').text).toBe('Game over! You win with 9,000 points.');
    h.state = { ...h.state, endReason: 'too-few' };
    expect(status(h, HOST).text).toBe('Game over: fewer than 3 players were left.');
  });
});

describe('helpers', () => {
  it('splits the prompt around its blank', () => {
    expect(splitPrompt('A ___ walks into a bar.')).toEqual(['A ', ' walks into a bar.']);
    expect(splitPrompt('Ends with ____')).toEqual(['Ends with ', '']);
    expect(splitPrompt('No blank here')).toBeNull();
  });

  it('ranks ties together', () => {
    expect(ranks([9, 9, 5, 2, 2])).toEqual([1, 1, 3, 4, 4]);
  });

  it('names players, including those who left', () => {
    expect(listNames(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy');
    const h = startedGame();
    h.state = hoodwink.playerLeft(h.state, 'p4', 0);
    const v = hoodwink.view(h.state, HOST);
    expect(nameOf(v, 'p4')).toBe('P4');
    expect(nameOf(v, 'ghost')).toBe('Someone');
  });
});
