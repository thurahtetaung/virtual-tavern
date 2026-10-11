import {
  type PresencePlayer,
  listNames,
  namesWithPresence,
  waitingFor,
  waitingForHost,
} from '@vt/game-sdk';
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
  // Someone with a seat who isn't dealt in: a late joiner, or a player who stood up.
  if (!playing) {
    if (turn.phase === 'reveal')
      return {
        text: isHost
          ? 'Cards revealed! Press Next turn when everyone has had a look, or Take a seat to play from the next turn.'
          : 'Cards revealed! You’re watching: tap Take a seat to get cards from the next turn.',
        yourMove: isHost,
      };
    const doing =
      turn.phase === 'clue'
        ? `${st} is choosing a card and a clue.`
        : turn.phase === 'pick'
          ? 'The players are giving cards for the clue.'
          : 'The players are voting for the storyteller’s card.';
    return {
      text: `You’re watching this turn. ${doing} You can take a seat at the reveal and get cards from the next turn.`,
      yourMove: false,
    };
  }
  if (turn.phase === 'clue') {
    const skipped = turn.skipped
      ? turn.skipped === me?.id
        ? '⏱ You ran out of time, so the story passed on. '
        : `⏱ ${name(view, turn.skipped)} ran out of time, so the story passed on. `
      : '';
    return isStory
      ? {
          text: `${skipped}You are the storyteller. Pick a card and give a clue for it.`,
          yourMove: true,
        }
      : { text: `${skipped}${stLive} is choosing a card and a clue…`, yourMove: false };
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
    const auto = autoGivenNote(view);
    if (isStory)
      return {
        text: `${auto}The table is set. Keep a straight face while they vote!`,
        yourMove: false,
      };
    if (playing && turn.myVote === null)
      return { text: `${auto}Which card is ${st}'s? Tap a card to vote.`, yourMove: true };
    return {
      text: `${auto}You voted for #${(turn.myVote ?? 0) + 1}. ${stillToAct()}… You can change your vote until the last one is in.`,
      yourMove: false,
    };
  }
  return isHost
    ? { text: 'Cards revealed! Press Next turn when everyone has had a look.', yourMove: true }
    : { text: `Cards revealed! ${host('continue')}`, yourMove: false };
}

/** Names whose cards a strict timer gave for them, as a lead-in to the vote hint. */
export function autoGivenNote(view: ReverieView): string {
  const ids = view.turn?.autoGiven ?? [];
  if (ids.length === 0) return '';
  const mine = view.me && ids.includes(view.me.id);
  const rest = ids.filter((id) => id !== view.me?.id).map((id) => name(view, id));
  const who = [...(mine ? ['you'] : []), ...rest];
  return `⏱ Time ran out, so cards were played for ${listNames(who)}. `;
}

/** Names whose votes a strict timer cut off, for the reveal. */
export function missedVoteNote(view: ReverieView): string | null {
  const ids = view.turn?.missedVote ?? [];
  if (ids.length === 0) return null;
  const who = ids.map((id) => (id === view.me?.id ? 'you' : name(view, id)));
  return `⏱ Time ran out before ${listNames(who)} voted.`;
}
