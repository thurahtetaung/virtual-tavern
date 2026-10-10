import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { codenames } from '../logic/game.ts';
import { OP, SPY, cardsOf, clue, content, startedGame } from '../logic/test-utils.ts';
import { guessesLeft, startBlocker, statusFor } from './status.ts';

describe('statusFor', () => {
  it('guides spectators in the lobby to pick a team', () => {
    const state = codenames.create({ now: 0, rng: createRng(1), content: content() }, [
      { id: 'x', name: 'X' },
    ]);
    const view = codenames.view(state, 'x');
    expect(statusFor(view, false, startBlocker(view, 30))).toMatchObject({ yourMove: true });
  });

  it('tells each role what to do during a turn', () => {
    const h = startedGame();
    expect(statusFor(codenames.view(h.state, SPY.red), false, null)).toMatchObject({
      yourMove: true,
    });
    expect(statusFor(codenames.view(h.state, OP.red), false, null).yourMove).toBe(false);
    clue(h, 'red', 2);
    const op = statusFor(codenames.view(h.state, OP.red), false, null);
    expect(op).toMatchObject({ yourMove: true });
    expect(op.text).toContain('3 guesses left');
    expect(statusFor(codenames.view(h.state, OP.blue), false, null).text).toContain(
      'Red team is guessing',
    );
  });
});

describe('guessesLeft', () => {
  it('counts down from the clue number plus one', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    expect(guessesLeft(codenames.view(h.state, null))).toBe(3);
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    expect(guessesLeft(codenames.view(h.state, null))).toBe(2);
  });
});

describe('startBlocker', () => {
  it('explains missing seats and words', () => {
    const h = startedGame();
    const view = codenames.view(h.state, null);
    expect(startBlocker(view, 30)).toBeNull();
    expect(startBlocker(view, 10)).toContain('25 are needed');
    expect(startBlocker({ ...view, seats: [] }, 30)).toBe('Red needs a Spymaster.');
  });
});
