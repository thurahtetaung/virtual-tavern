import type { CodenamesView, Team } from '../logic/types.ts';
import { TEAM_LABEL } from './theme.ts';

/** Guesses the current team may still make; null = unlimited. */
export function guessesLeft(view: CodenamesView): number | null {
  const count = view.turn?.clue?.count ?? null;
  if (count === null || count === 0) return null;
  return Math.max(0, count + 1 - view.turn!.guessesMade);
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: CodenamesView, wordCount: number): string | null {
  for (const team of ['red', 'blue'] as const) {
    const members = view.seats.filter((s) => s.team === team);
    if (!members.some((s) => s.role === 'spymaster'))
      return `${TEAM_LABEL[team]} needs a Spymaster.`;
    if (!members.some((s) => s.role === 'operative')) {
      return `${TEAM_LABEL[team]} needs at least one Operative.`;
    }
  }
  if (view.settings.wordListIds.length === 0) return 'Pick at least one word list.';
  if (wordCount < 25) return `The chosen word lists have ${wordCount} words; 25 are needed.`;
  return null;
}

export interface Status {
  text: string;
  /** True when the viewer is expected to act now. */
  yourMove: boolean;
}

const team = (t: Team) => TEAM_LABEL[t];

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: CodenamesView, isHost: boolean, blocker: string | null): Status {
  const me = view.me;
  if (view.phase === 'lobby') {
    if (!me || me.team === null) {
      return {
        text: 'Pick a team below. Each team needs one Spymaster and at least one Operative.',
        yourMove: true,
      };
    }
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? {
          text: 'Everyone is seated. Press Start game when your friends are ready!',
          yourMove: true,
        }
      : { text: 'All set. Waiting for the host to start the game…', yourMove: false };
  }

  if (view.phase === 'over') {
    const winner = view.winner!;
    const how =
      view.winReason === 'assassin'
        ? `${team(winner === 'red' ? 'blue' : 'red')} found the assassin`
        : `${team(winner)} found all their agents`;
    return { text: `${team(winner)} team wins! ${how}.`, yourMove: false };
  }

  const turn = view.turn!;
  const mine = me?.team === turn.team;
  if (turn.stage === 'clue') {
    if (mine && me?.role === 'spymaster') {
      return {
        text: 'Your turn! Give your team a one-word clue and a number of cards it relates to.',
        yourMove: true,
      };
    }
    return {
      text: mine
        ? 'Your Spymaster is thinking of a clue…'
        : `${team(turn.team)} Spymaster is thinking of a clue…`,
      yourMove: false,
    };
  }

  const left = guessesLeft(view);
  const leftText =
    left === null ? 'any number of guesses' : `${left} guess${left === 1 ? '' : 'es'} left`;
  if (mine && me?.role === 'operative') {
    return {
      text: `Your turn to guess (${leftText}). Tap a card to suggest it, then press Reveal.`,
      yourMove: true,
    };
  }
  if (mine) return { text: 'Your team is guessing. Stay poker-faced!', yourMove: false };
  return { text: `${team(turn.team)} team is guessing (${leftText}).`, yourMove: false };
}
