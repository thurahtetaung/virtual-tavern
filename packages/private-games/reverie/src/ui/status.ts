import { type PresencePlayer, namesWithPresence, waitingFor, waitingForHost } from '@vt/game-sdk';
import type { ReverieView } from '../logic/types.ts';
import { MIN_PLAYERS, cardsNeededFor } from './rules.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** The room as the status line needs it, to name the host and who is still to act. */
export interface StatusRoom {
  you: string;
  hostId: string;
  players: readonly PresencePlayer[];
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
export function statusFor(
  view: ReverieView,
  isHost: boolean,
  blocker: string | null,
  room?: StatusRoom,
): Status {
  const me = view.me;
  // Without the room (tests), names come from the seats and nobody is marked offline.
  const people = room?.players ?? view.seats;
  const host = (what: string) =>
    room ? waitingForHost(room, what) : `Waiting for the host to ${what}…`;
  /** Everyone still to give a card or vote, by name. */
  const stillToAct = () =>
    waitingFor(
      view.seats
        .filter((s) => s.playing && !s.done && s.id !== view.turn?.storyteller)
        .map((s) => s.id),
      people,
      { you: me?.id },
    ) || 'Waiting for the others';
  if (view.phase === 'lobby') {
    if (!me?.playing) return { text: 'Take a seat to play, or just watch.', yourMove: !!me };
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is seated. Press Start when your friends are ready!', yourMove: true }
      : { text: `All set. ${host('start')}`, yourMove: false };
  }
  if (view.phase === 'over') {
    const names = view.winners.map((id) => name(view, id));
    const result =
      names.length > 1
        ? `It's a tie: ${names.join(' and ')} win!`
        : `${names[0] ?? 'Someone'} wins!`;
    return {
      text: view.endReason === 'too-few' ? `Not enough players to continue. ${result}` : result,
      yourMove: false,
    };
  }
  const turn = view.turn!;
  const st = name(view, turn.storyteller);
  const stLive = namesWithPresence([turn.storyteller], people) || st;
  const isStory = me?.id === turn.storyteller;
  const playing = !!me?.playing;
  if (turn.phase === 'clue') {
    return isStory
      ? { text: 'You are the storyteller. Pick a card and give a clue for it.', yourMove: true }
      : { text: `${stLive} is choosing a card and a clue…`, yourMove: false };
  }
  if (turn.phase === 'pick') {
    if (isStory) return { text: `Clue given! ${stillToAct()}…`, yourMove: false };
    if (playing && turn.myCards.length === 0) {
      return {
        text:
          view.cardsToGive === 2
            ? 'Give two cards from your hand that could match the clue.'
            : 'Give a card from your hand that could match the clue.',
        yourMove: true,
      };
    }
    return { text: `${stillToAct()}…`, yourMove: false };
  }
  if (turn.phase === 'vote') {
    if (isStory)
      return { text: 'The table is set. Keep a straight face while they vote!', yourMove: false };
    if (playing && turn.myVote === null)
      return { text: `Which card is ${st}'s? Tap a card to vote.`, yourMove: true };
    return { text: `${playing ? 'Voted. ' : ''}${stillToAct()}…`, yourMove: false };
  }
  return isHost
    ? { text: 'Cards revealed! Press Next turn when everyone has had a look.', yourMove: true }
    : { text: `Cards revealed! ${host('continue')}`, yourMove: false };
}
