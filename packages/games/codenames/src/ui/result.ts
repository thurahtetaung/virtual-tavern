import { timedOut } from '@vt/game-sdk';
import type { CardKind, CodenamesView, EndTurnReason, Team } from '../logic/types.ts';
import { guessesLeft } from './status.ts';
import { TEAM_LABEL } from './theme.ts';

export type ResultTone = 'correct' | 'wrong' | 'assassin' | 'skipped';

export interface GuessResult {
  tone: ResultTone;
  /** Who guessed what, e.g. "Ana guessed WHALE"; empty when the turn ended without a guess. */
  who: string;
  /** What the card was, e.g. "Correct! It's a Red agent." */
  headline: string;
  /** What happens next, in plain words. */
  next: string;
  /** Board index of the guessed card, for highlighting; null when no card was guessed. */
  card: number | null;
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

/** The turn after `team`'s, as the live turn says (a forfeit may have skipped one). */
function nextTurn(view: CodenamesView, team: Team): string {
  return `${TEAM_LABEL[view.turn?.team ?? other(team)]}'s turn now.`;
}

/** A turn that ended without a guess deciding it: time ran out, a forfeit, or the host skipped it. */
function skipped(view: CodenamesView, entry: { team: Team; reason: EndTurnReason }): GuessResult {
  const team = TEAM_LABEL[entry.team];
  const headline =
    entry.reason === 'timeout'
      ? `${timedOut(`${team}'s turn ended`)}.`
      : entry.reason === 'forfeit'
        ? `${team} has nobody to play the turn, so it was skipped.`
        : `The host skipped ${team}'s turn.`;
  return { tone: 'skipped', who: '', headline, next: nextTurn(view, entry.team), card: null };
}

/**
 * The latest news for the banner: the most recent guess, or a turn that ended on the clock, by
 * forfeit or by the host. Null before the first guess of a turn (so stale results don't linger
 * into the next clue).
 */
export function latestResult(view: CodenamesView): GuessResult | null {
  const log = view.log;
  let i = log.length - 1;
  let passed = false;
  while (i >= 0 && log[i]!.type !== 'guess') {
    const entry = log[i]!;
    if (entry.type === 'clue') return null;
    if (entry.type === 'end-turn') {
      if (entry.reason === 'timeout' || entry.reason === 'forfeit' || entry.reason === 'host') {
        return skipped(view, entry);
      }
      if (entry.reason === 'passed') passed = true;
    }
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
    else if (passed) next = `${team} ended the turn. ${nextTurn(view, guess.team)}`;
    else if (turnEnded)
      next = `That was the last guess for this clue. ${nextTurn(view, guess.team)}`;
    else {
      next = `${team} can guess ${guessesLeft(view)} more, or end the turn.`;
    }
    return { ...base, tone: 'correct', headline: `✓ Correct! It's ${describe(guess.kind)}.`, next };
  }

  const turnTo = nextTurn(view, guess.team);
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
