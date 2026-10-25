import { type PresencePlayer, listNames, waitingFor, waitingForHost } from '@vt/game-sdk';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import { MAX_PLAYERS, MIN_PLAYERS, type RoundView, type StampedeView } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** The room as the status line needs it, to name the host and who is still to act. */
export interface StatusRoom {
  you: string;
  hostId: string;
  isHost: boolean;
  players: readonly PresencePlayer[];
}

export const nameOf = (view: StampedeView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ??
  view.scores.find((s) => s.id === id)?.name ??
  'Someone';

/** "you" for the viewer, else the name. */
export const who = (view: StampedeView, id: string | null | undefined) =>
  id && id === view.me?.id ? 'you' : nameOf(view, id);

/** Questions in the chosen decks that are still offered. */
export const chosenQuestionCount = (view: StampedeView) =>
  view.decks
    .filter((d) => view.settings.deckIds.includes(d.id))
    .reduce((n, d) => n + d.questionCount, 0);

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: StampedeView, title: string): string | null {
  const playing = view.seats.filter((s) => s.playing).length;
  if (playing < MIN_PLAYERS)
    return `${title} needs at least ${MIN_PLAYERS} players (${playing} so far).`;
  if (playing > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players can play.`;
  if (view.decks.length === 0) return 'No question decks yet. Ask an admin to add some.';
  if (chosenQuestionCount(view) === 0) return 'Pick at least one question deck.';
  return null;
}

/** Players still writing. */
export const missingIds = (round: RoundView) =>
  round.stage === 'answer' ? round.players.filter((id) => !round.answered.includes(id)) : [];

/** Who's checking the groups, as the status line names them. */
function checkerLine(view: StampedeView, round: RoundView, room: StatusRoom): Status {
  const me = view.me?.id ?? '';
  if (round.groups) {
    return {
      text: 'Check the groups: join answers that mean the same thing, split any that don’t, then reveal.',
      yourMove: true,
    };
  }
  if (room.isHost) {
    return { text: 'You’re the host now: open the answers to check them.', yourMove: true };
  }
  const checker = round.checker && round.checker !== me ? nameOf(view, round.checker) : null;
  return {
    text: checker
      ? `All answers are in! ${checker} (host) is checking them…`
      : `All answers are in! ${waitingForHost(room, 'check them')}`,
    yourMove: false,
  };
}

function roundStatus(view: StampedeView, round: RoundView, room: StatusRoom, names: Names): Status {
  const me = view.me?.id ?? '';
  const f = (s: string) => fillNames(s, names);
  const waiting = view.role === 'waiting' ? ' You join in from the next question.' : '';
  switch (round.stage) {
    case 'answer': {
      if (!round.players.includes(me)) {
        return { text: `Everyone is writing an answer…${waiting}`, yourMove: false };
      }
      if (round.myAnswer === null) {
        return {
          text: 'What will most people say? Write the answer you think the herd will give.',
          yourMove: true,
        };
      }
      const still = waitingFor(missingIds(round), room.players, { you: me }) || 'Waiting';
      return { text: `Answer in! ${still}… You can still change yours.`, yourMove: false };
    }
    case 'merge':
      return checkerLine(view, round, room);
    case 'pick': {
      const holder = view.pinkCow;
      if (holder === me) {
        return {
          text: f('Several answers stood alone. Pick who takes the {pink} from you.'),
          yourMove: true,
        };
      }
      return {
        text: f(`${nameOf(view, holder)} is picking who takes the {pink}…`),
        yourMove: false,
      };
    }
    case 'reveal': {
      const result = round.result!;
      const parts: string[] = [];
      if (result.scorers.includes(me)) parts.push(f('You’re in the herd: +1 {cow}!'));
      else if (result.tie) parts.push('A tie at the top: nobody scores.');
      if (result.pinkTo === me && result.pinkFrom !== me) parts.push(f('You take the {pink}.'));
      if (result.raisedTo)
        parts.push(f(`Tie at the target: now first to ${cowCount(names, result.raisedTo)}.`));
      const tail = room.isHost
        ? 'Press Next question when everyone has had a look.'
        : waitingForHost(room, 'ask the next question');
      return { text: [...parts, tail].join(' '), yourMove: false };
    }
  }
}

export function statusFor(
  view: StampedeView,
  room: StatusRoom,
  names: Names,
  title: string,
): Status {
  const f = (s: string) => fillNames(s, names);
  if (view.phase === 'lobby') {
    if (room.isHost) {
      const blocker = startBlocker(view, title);
      return blocker
        ? { text: blocker, yourMove: false }
        : { text: 'Pick the decks and the target, then start.', yourMove: true };
    }
    return {
      text: view.me?.playing
        ? waitingForHost(room, 'start')
        : `You’re watching. ${waitingForHost(room, 'start')}`,
      yourMove: false,
    };
  }
  if (view.phase === 'over') {
    switch (view.endReason) {
      case 'won': {
        const names = listNames(view.winners.map((id) => who(view, id)));
        const won = view.winners.length === 1 && view.winners[0] === view.me?.id;
        return {
          text: won
            ? '🏆 You win! Your herd is complete.'
            : `🏆 ${names} ${view.winners.length > 1 ? 'win' : 'wins'}!`,
          yourMove: false,
        };
      }
      case 'too-few':
        return { text: 'Too few players left, so the game ended with no winner.', yourMove: false };
      case 'no-questions':
        return { text: 'The decks ran out of questions, so the game ended.', yourMove: false };
      default:
        return { text: 'Game over.', yourMove: false };
    }
  }
  const round = view.round;
  if (!round) return { text: f('Getting the next question…'), yourMove: false };
  return roundStatus(view, round, room, names);
}
