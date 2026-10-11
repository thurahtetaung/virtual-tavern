import {
  type PresencePlayer,
  namesWithPresence,
  timedOut,
  waitingFor,
  waitingForHost,
} from '@vt/game-sdk';
import {
  CARD_SIZE,
  type ClueView,
  type EchoView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type TurnView,
} from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Who is in the room (and online), so waiting texts can name people and the host. */
export interface People {
  hostId: string;
  players: readonly PresencePlayer[];
}

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: EchoView, wordCount: number): string | null {
  const playing = view.seats.filter((s) => s.playing).length;
  if (playing < MIN_PLAYERS) {
    return `Echo needs at least ${MIN_PLAYERS} players (${playing} so far).`;
  }
  if (playing > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players can play.`;
  const needed = view.settings.deckSize * CARD_SIZE;
  if (wordCount < needed) {
    return `A deck of ${view.settings.deckSize} cards needs at least ${needed} words in the chosen lists.`;
  }
  return null;
}

export const nameOf = (view: EchoView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Why a struck-through clue was cancelled, e.g. "same as Ana's". */
export function cancelReason(view: EchoView, clue: ClueView): string {
  const others = clue.sameAs.map((id) => nameOf(view, id));
  return others.length > 0
    ? `same as ${listNames(others.map((n) => `${n}’s`))}`
    : 'matched another clue';
}

const clueWord = (n: number) => (n === 2 ? 'two clues' : 'one clue');

/** Clue writers still to send their clues. */
export const stillWriting = (turn: TurnView) =>
  turn.givers.filter((g) => !turn.submitted.includes(g));

function outcomeText(view: EchoView, turn: TurnView): string {
  const word = turn.word ? `“${turn.word}”` : 'the word';
  if (turn.outcome === 'right') {
    return turn.countedBy
      ? `Counted! ${nameOf(view, turn.countedBy)} counted the guess for ${word}.`
      : `Got it! The word was ${word}.`;
  }
  if (turn.outcome === 'pass') {
    return turn.timedOut
      ? `⏱ Time ran out: counts as a pass. The word was ${word}.`
      : `Passed. The word was ${word}.`;
  }
  const why = turn.timedOut
    ? '⏱ Nobody decided in time, so it counts as wrong: the'
    : 'Not this time: the';
  // What the wrong guess cost is spelled out once, in the result banner (`lossText`).
  return `${why} word was ${word}.`;
}

/** What a wrong guess just cost: the next card too, unless this was the last one. */
export function lossText(view: EchoView): string {
  return view.history.at(-1)?.burned
    ? 'This card and the next are lost.'
    : 'This card is lost (it was the last one).';
}

/** Who guesses the next card: the next playing seat after the guesser, in seat order. */
export function nextGuesser(view: EchoView, turn: TurnView): string | null {
  const from = view.seats.findIndex((s) => s.id === turn.guesser);
  for (let k = 1; k <= view.seats.length; k++) {
    const seat = view.seats[(from + k) % view.seats.length]!;
    if (seat.id !== turn.guesser && seat.playing) return seat.name;
  }
  return null;
}

const strictNote = (view: EchoView, turn: TurnView, text: string) =>
  view.settings.timerMode === 'strict' && turn.deadline !== null ? ` ${text}` : '';

function playingStatus(
  view: EchoView,
  turn: TurnView,
  isHost: boolean,
  people: People | undefined,
): Status {
  // The guesser's name, marked "(offline)" while their browser is away.
  const guesser =
    (people && namesWithPresence([turn.guesser], people.players)) || nameOf(view, turn.guesser);
  /** "Ana, Ben (offline)": the clue writers still writing, named rather than counted. */
  const writing = (): string => {
    const ids = stillWriting(turn);
    if (people) return waitingFor(ids, people.players, { you: view.me?.id }) || 'Almost done';
    return `Waiting for ${ids.length} more ${ids.length === 1 ? 'player' : 'players'}`;
  };
  const role = view.role;
  const me = view.me?.id ?? '';
  switch (turn.stage) {
    case 'pick':
      return role === 'guesser'
        ? {
            text: `You're the guesser! Pick one of the ${turn.cardSize} hidden words.`,
            yourMove: true,
          }
        : { text: `Waiting for ${guesser} to pick a word…`, yourMove: false };
    case 'clues': {
      if (role === 'guesser') {
        const picked = turn.autoPicked
          ? `${timedOut('a word was picked for you at random')}. `
          : '';
        return {
          text: `${picked}Everyone is writing a clue for you… ${writing()}.`,
          yourMove: false,
        };
      }
      if (role === 'giver' && turn.givers.includes(view.me?.id ?? '')) {
        if (!turn.myClues) {
          return {
            text: `Write ${clueWord(turn.perGiver)} for ${guesser}. Matching clues cancel out!`,
            yourMove: true,
          };
        }
        return {
          text: `Sent! ${writing()}. You can still change yours.`,
          yourMove: false,
        };
      }
      const waiting = role === 'waiting' ? ' You join in from the next card.' : '';
      return {
        text: `Clues are being written for ${guesser}. ${writing()}.${waiting}`,
        yourMove: false,
      };
    }
    case 'guess': {
      if (role === 'guesser') {
        return {
          text: 'Your turn to guess! One try: a wrong guess loses this card and the next. Pass loses only this one.',
          yourMove: true,
        };
      }
      const missed = turn.missed.includes(me)
        ? turn.skipped
          ? 'The host went on without your clue this card. '
          : '⏱ You ran out of time, so there is no clue from you this card. '
        : '';
      return { text: `${missed}Waiting for ${guesser} to guess…`, yourMove: false };
    }
    case 'judge': {
      const giver = turn.givers.includes(me);
      const timeout = strictNote(view, turn, 'If nobody decides in time, it counts as wrong.');
      if (role === 'guesser') {
        return {
          text: `Not an exact match. The clue writers are deciding whether it counts…${timeout}`,
          yourMove: false,
        };
      }
      if (giver) {
        return {
          text: `${guesser} guessed “${turn.guess}”. Is it really the word? One tap decides for the whole table.${timeout}`,
          yourMove: true,
        };
      }
      return isHost
        ? {
            text: `${guesser} guessed “${turn.guess}”. Press Doesn't count to move on.`,
            yourMove: true,
          }
        : {
            text: `The clue writers are deciding whether the guess counts…${timeout}`,
            yourMove: false,
          };
    }
    case 'reveal': {
      const next = view.cardsLeft > 0 ? 'Next card' : 'Finish';
      const what = view.cardsLeft > 0 ? 'deal the next card' : 'finish the game';
      const tail =
        isHost || view.me?.playing
          ? ` Anyone at the table can press ${next} when everyone has had a look.`
          : ` ${people ? waitingForHost(people, what) : `Waiting for the host to ${what}…`}`;
      const upNext = view.cardsLeft > 0 ? nextGuesser(view, turn) : null;
      const who = upNext ? ` Next guesser: ${upNext}.` : '';
      return { text: outcomeText(view, turn) + who + tail, yourMove: isHost };
    }
  }
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: EchoView,
  isHost: boolean,
  blocker: string | null,
  people?: People,
): Status {
  if (view.phase === 'lobby') {
    if (!view.me?.playing) {
      // A full table is already explained by the room's "You're watching" banner.
      const full = view.seats.filter((s) => s.playing).length >= MAX_PLAYERS;
      return full
        ? { text: "You're watching. You can take a seat when one frees up.", yourMove: false }
        : { text: "You're watching. Press Take a seat to join the table.", yourMove: false };
    }
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is in. Press Start game when your friends are ready!', yourMove: true }
      : {
          text: `All set. ${people ? waitingForHost(people, 'start the game') : 'Waiting for the host to start the game…'}`,
          yourMove: false,
        };
  }
  if (view.phase === 'over') {
    // The score and its rating are shown big just below, so this line doesn't repeat them.
    return view.endReason === 'too-few'
      ? { text: `Game over: fewer than ${MIN_PLAYERS} players were left.`, yourMove: false }
      : { text: 'Game over! Here’s how you did:', yourMove: false };
  }
  if (!view.turn) return { text: 'Dealing…', yourMove: false };
  return playingStatus(view, view.turn, isHost, people);
}
