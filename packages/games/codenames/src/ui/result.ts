import type { CardKind, CodenamesView, Team } from '../logic/types.ts';
import { guessesLeft } from './status.ts';
import { TEAM_LABEL } from './theme.ts';

export type ResultTone = 'correct' | 'wrong' | 'assassin';

export interface GuessResult {
  tone: ResultTone;
  /** Who guessed what, e.g. "Ana guessed WHALE". */
  who: string;
  /** What the card was, e.g. "Correct! It's a Red agent." */
  headline: string;
  /** What happens next, in plain words. */
  next: string;
  /** Board index of the guessed card, for highlighting. */
  card: number;
}

const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

function describe(kind: CardKind): string {
  switch (kind) {
    case 'red':
    case 'blue':
      return `a ${TEAM_LABEL[kind]} agent`;
    case 'bystander':
      return 'an innocent bystander';
    case 'assassin':
      return 'the assassin';
  }
}

/**
 * Outcome of the most recent guess, shown until the next clue is given.
 * Null before the first guess of a turn (so stale results don't linger into the next clue).
 */
export function lastGuessResult(view: CodenamesView): GuessResult | null {
  const log = view.log;
  let i = log.length - 1;
  while (i >= 0 && log[i]!.type !== 'guess') {
    if (log[i]!.type === 'clue') return null;
    i--;
  }
  const guess = log[i];
  if (!guess || guess.type !== 'guess') return null;

  const after = log.slice(i + 1);
  const over = after.find((e) => e.type === 'game-over');
  const turnEnded = after.some((e) => e.type === 'end-turn');
  const name = view.seats.find((s) => s.id === guess.by)?.name ?? 'Someone';
  const word = guess.word.toUpperCase();
  const card = view.board.findIndex((c) => c.word === guess.word);
  const team = TEAM_LABEL[guess.team];
  const base = { who: `${name} guessed ${word}`, card };

  if (guess.kind === 'assassin') {
    const winner = TEAM_LABEL[other(guess.team)];
    return {
      ...base,
      tone: 'assassin',
      headline: `☠ It's the assassin!`,
      next: `${team} loses instantly. ${winner} wins the game.`,
    };
  }

  if (guess.kind === guess.team) {
    let next: string;
    if (over?.type === 'game-over') next = `That was ${team}'s last agent. ${team} wins the game!`;
    else if (turnEnded)
      next = `That was the last guess for this clue. ${TEAM_LABEL[other(guess.team)]}'s turn now.`;
    else {
      const left = guessesLeft(view);
      next =
        left === null
          ? `${team} can keep guessing, or end the turn.`
          : `${team} can guess ${left} more, or end the turn.`;
    }
    return { ...base, tone: 'correct', headline: `✓ Correct! It's ${describe(guess.kind)}.`, next };
  }

  const turnTo = `${TEAM_LABEL[other(guess.team)]}'s turn now.`;
  if (guess.kind === 'bystander') {
    return {
      ...base,
      tone: 'wrong',
      headline: `✗ Miss: it's ${describe('bystander')}.`,
      next: `${team}'s turn is over. ${turnTo}`,
    };
  }
  // The other team's agent: it counts for them.
  const beneficiary = TEAM_LABEL[guess.kind];
  return {
    ...base,
    tone: 'wrong',
    headline: `✗ Oops! It's ${describe(guess.kind)}.`,
    next:
      over?.type === 'game-over'
        ? `That was ${beneficiary}'s last agent, so ${beneficiary} wins the game!`
        : `That point goes to ${beneficiary}. ${turnTo}`,
  };
}
