import { describe, expect, it } from 'vitest';
import { codenames } from '../logic/game.ts';
import { HOST, NOW, OP, SPY, cardsOf, clue, startedGame } from '../logic/test-utils.ts';
import { latestResult } from './result.ts';

const result = (h: ReturnType<typeof startedGame>) =>
  latestResult(codenames.view(h.state, OP.blue));

describe('latestResult', () => {
  it('is empty before any guess, and again once the next clue is given', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    expect(result(h)).toBeNull();
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    expect(result(h)).not.toBeNull();
    clue(h, 'blue', 1);
    expect(result(h)).toBeNull();
  });

  it('celebrates a correct guess and says how many guesses remain', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    const card = cardsOf(h.state, 'red')[0]!;
    h.act({ type: 'guess', card }, OP.red);
    expect(result(h)).toMatchObject({
      tone: 'correct',
      who: `P2 guessed ${h.state.board[card]!.word.toUpperCase()}`,
      headline: "✓ Correct! It's a Red agent.",
      next: 'Red can guess 2 more, or end the turn.',
      card,
    });
  });

  it('says when the last allowed guess ends the turn', () => {
    const h = startedGame();
    clue(h, 'red', 1);
    const [a, b] = cardsOf(h.state, 'red');
    h.act({ type: 'guess', card: a! }, OP.red);
    h.act({ type: 'guess', card: b! }, OP.red);
    expect(result(h)?.next).toBe("That was the last guess for this clue. Blue's turn now.");
  });

  it('explains a bystander miss', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    expect(result(h)).toMatchObject({
      tone: 'wrong',
      headline: "✗ Miss: it's an innocent bystander.",
      next: "Red's turn is over. Blue's turn now.",
    });
  });

  it("explains hitting the other team's agent", () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'blue')[0]! }, OP.red);
    expect(result(h)).toMatchObject({
      tone: 'wrong',
      headline: "✗ Oops! It's a Blue agent.",
      next: "That point goes to Blue. Blue's turn now.",
    });
  });

  it('announces the assassin', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'assassin')[0]! }, OP.red);
    expect(result(h)).toMatchObject({
      tone: 'assassin',
      headline: "☠ It's the assassin!",
      next: 'Red loses instantly. Blue wins the game.',
    });
  });

  it('announces a win on the last agent', () => {
    const h = startedGame();
    clue(h, 'red', 9);
    for (const card of cardsOf(h.state, 'red')) h.act({ type: 'guess', card }, OP.red);
    expect(result(h)?.next).toBe("That was Red's last agent. Red wins the game!");
  });

  it('replaces the last guess with a timeout banner when the next team runs out of time', () => {
    const h = startedGame({ clueSeconds: 30, timerMode: 'strict' });
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.red);
    h.state = codenames.onDeadline!(h.state, NOW + 3_600_000);
    expect(result(h)).toEqual({
      tone: 'skipped',
      who: '',
      headline: "⏱ Time ran out: Blue's turn ended.",
      next: "Red's turn now.",
      card: null,
    });
  });

  it('announces a forfeit and a host skip', () => {
    const h = startedGame();
    h.state = codenames.playerLeft(h.state, SPY.red, NOW);
    expect(result(h)).toMatchObject({
      tone: 'skipped',
      headline: 'Red has nobody to play the turn, so it was skipped.',
      next: "Blue's turn now.",
    });
    const g = startedGame();
    g.act({ type: 'end-turn' }, HOST);
    expect(lastResultFor(g)?.headline).toBe("The host skipped Red's turn.");
  });

  it('says when the team ended its turn after a guess', () => {
    const h = startedGame();
    clue(h, 'red', 2);
    h.act({ type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    h.act({ type: 'end-turn' }, OP.red);
    expect(result(h)?.next).toBe("Red ended the turn. Blue's turn now.");
  });
});

function lastResultFor(h: ReturnType<typeof startedGame>) {
  return latestResult(codenames.view(h.state, OP.red));
}
