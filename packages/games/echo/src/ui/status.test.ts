import { describe, expect, it } from 'vitest';
import { echo } from '../logic/game.ts';
import { FOUR, HOST, harness, secret, startedGame, toGuess, turn } from '../logic/test-utils.ts';
import { cancelReason, listNames, startBlocker, statusFor } from './status.ts';

const status = (h: { state: Parameters<typeof echo.view>[0] }, id: string | null, host = false) =>
  statusFor(echo.view(h.state, id), host, null);

describe('startBlocker', () => {
  it('needs three players and enough words for the deck', () => {
    const h = harness([HOST, 'p2']);
    expect(startBlocker(echo.view(h.state, HOST), 500)).toContain('at least 3 players');
    const four = harness(FOUR);
    four.act({ type: 'update-settings', deckSize: 20 });
    expect(startBlocker(echo.view(four.state, HOST), 99)).toContain('needs at least 100 words');
    expect(startBlocker(echo.view(four.state, HOST), 100)).toBeNull();
  });
});

describe('statusFor', () => {
  it('guides the lobby', () => {
    const h = harness(FOUR);
    const v = echo.view(h.state, HOST);
    expect(statusFor(v, true, null)).toMatchObject({ yourMove: true });
    expect(statusFor(echo.view(h.state, 'p2'), false, null).text).toContain('Waiting for the host');
    expect(statusFor(v, true, 'Not enough words.').text).toContain('Almost ready');
    h.act({ type: 'sit', playing: false }, 'p2');
    expect(status(h, 'p2').text).toContain("You're watching");
  });

  it("is only the guesser's move while picking and guessing", () => {
    const h = startedGame();
    expect(status(h, HOST)).toMatchObject({ yourMove: true });
    expect(status(h, HOST).text).toContain('Pick one of the 5');
    expect(status(h, 'p2')).toMatchObject({
      yourMove: false,
      text: 'Waiting for HOST to pick a word…',
    });
    h.act({ type: 'pick', index: 0 });
    expect(status(h, HOST).yourMove).toBe(false);
    expect(status(h, 'p2')).toMatchObject({ yourMove: true });
    expect(status(h, 'p2').text).toContain('Write one clue');
    h.act({ type: 'give-clues', clues: ['zebra'] }, 'p2');
    expect(status(h, 'p2')).toMatchObject({ yourMove: false });
    expect(status(h, 'p2').text).toContain('Waiting for 2 more players');
    h.act({ type: 'give-clues', clues: ['yak'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['xylophone'] }, 'p4');
    expect(status(h, HOST)).toMatchObject({ yourMove: true });
    expect(status(h, HOST).text).toContain('Your turn to guess');
    expect(status(h, 'p3').yourMove).toBe(false);
  });

  it('asks the clue writers to judge a near miss, then the host to move on', () => {
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    toGuessFromPick(h);
    h.act({ type: 'guess', word: 'nothing-like-it' });
    expect(status(h, HOST).text).toContain('Not an exact match');
    expect(status(h, 'p2')).toMatchObject({ yourMove: true });
    expect(status(h, 'p2').text).toContain('Count it');
    h.act({ type: 'count-it' }, 'p3');
    expect(status(h, 'p2').text).toContain('P3 counted the guess');
    expect(status(h, HOST, true)).toMatchObject({ yourMove: true });
    expect(status(h, HOST, true).text).toContain('Next card');
  });

  it('reports each outcome at the reveal, and the rating at the end', () => {
    const h = startedGame(FOUR, { deckSize: 8 });
    toGuess(h);
    const word = secret(h);
    h.act({ type: 'guess', word });
    expect(status(h, 'p2').text).toBe(
      `Got it! The word was “${word}”. Waiting for the host to deal the next card…`,
    );
    // Guests are told who moves the game on.
    expect(statusFor(echo.view(h.state, 'p2'), false, null, 'Hana').text).toContain(
      'Waiting for Hana to deal the next card…',
    );
    h.act({ type: 'next-card' });
    toGuess(h);
    h.act({ type: 'pass' }, turn(h).guesser);
    expect(status(h, HOST).text).toMatch(/^Passed\./);
    h.state = { ...h.state, phase: 'over', turn: null, score: 8, endReason: 'finished' };
    expect(status(h, HOST).text).toBe('Game over! You scored 8 of 8: Perfect.');
  });
});

describe('cancelReason', () => {
  it('names who else wrote the same clue', () => {
    expect(listNames(['Ana', 'Ben', 'Cy'])).toBe('Ana, Ben and Cy');
    const h = startedGame();
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['Moon'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['moons'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['stars'] }, 'p4');
    const v = echo.view(h.state, 'p4');
    const moon = v.turn!.clues.find((c) => c.text === 'Moon')!;
    expect(cancelReason(v, moon)).toBe('same as P3’s');
  });
});

/** From the clue stage, every giver sends a distinct clue. */
function toGuessFromPick(h: ReturnType<typeof startedGame>) {
  turn(h).givers.forEach((g, i) =>
    h.act({ type: 'give-clues', clues: [`clue${'x'.repeat(i)}`] }, g),
  );
}
