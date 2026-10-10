import type { ReverieView } from '../logic/types.ts';
import { MIN_PLAYERS, cardsNeededFor } from './rules.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

const name = (view: ReverieView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: ReverieView, cardCount: number): string | null {
  const seated = view.seats.filter((s) => s.playing).length;
  if (seated < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed (${seated} seated).`;
  if (cardCount < cardsNeededFor(seated))
    return 'The chosen card sets are too small for this many players.';
  return null;
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: ReverieView, isHost: boolean, blocker: string | null): Status {
  const me = view.me;
  if (view.phase === 'lobby') {
    if (!me?.playing) return { text: 'Take a seat to play, or just watch.', yourMove: !!me };
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is seated. Press Start when your friends are ready!', yourMove: true }
      : { text: 'All set. Waiting for the host to start…', yourMove: false };
  }
  if (view.phase === 'over') {
    const names = view.winners.map((id) => name(view, id));
    return {
      text:
        names.length > 1
          ? `It's a tie: ${names.join(' and ')} win!`
          : `${names[0] ?? 'Someone'} wins!`,
      yourMove: false,
    };
  }
  const turn = view.turn!;
  const st = name(view, turn.storyteller);
  const isStory = me?.id === turn.storyteller;
  const playing = !!me?.playing;
  if (turn.phase === 'clue') {
    return isStory
      ? { text: 'You are the storyteller. Pick a card and give a clue for it.', yourMove: true }
      : { text: `${st} is choosing a card and a clue…`, yourMove: false };
  }
  if (turn.phase === 'pick') {
    if (isStory)
      return { text: 'Clue given! Waiting for the others to pick their cards…', yourMove: false };
    if (playing && turn.myCards.length === 0) {
      return {
        text:
          view.cardsToGive === 2
            ? 'Give two cards from your hand that could match the clue.'
            : 'Give a card from your hand that could match the clue.',
        yourMove: true,
      };
    }
    return { text: 'Waiting for everyone to give a card…', yourMove: false };
  }
  if (turn.phase === 'vote') {
    if (isStory)
      return { text: 'The table is set. Keep a straight face while they vote!', yourMove: false };
    if (playing && turn.myVote === null)
      return { text: `Which card is ${st}'s? Tap a card to vote.`, yourMove: true };
    return { text: 'Voted. Waiting for the others…', yourMove: false };
  }
  return isHost
    ? { text: 'Cards revealed! Press Next turn when everyone has had a look.', yourMove: true }
    : { text: 'Cards revealed! Waiting for the host…', yourMove: false };
}
