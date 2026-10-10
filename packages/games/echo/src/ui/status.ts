import { rating } from '../logic/game.ts';
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
  if (turn.outcome === 'pass') return `Passed. The word was ${word}.`;
  return `Not this time: the word was ${word}. This card and the next are lost.`;
}

function playingStatus(view: EchoView, turn: TurnView, isHost: boolean): Status {
  const guesser = nameOf(view, turn.guesser);
  const role = view.role;
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
        return { text: 'Everyone is writing a clue for you…', yourMove: false };
      }
      if (role === 'giver' && turn.givers.includes(view.me?.id ?? '')) {
        if (!turn.myClues) {
          return {
            text: `Write ${clueWord(turn.perGiver)} for ${guesser}. Matching clues cancel out!`,
            yourMove: true,
          };
        }
        const left = stillWriting(turn).length;
        return {
          text: `Sent! Waiting for ${left} more ${left === 1 ? 'player' : 'players'}… You can still change yours.`,
          yourMove: false,
        };
      }
      const waiting = role === 'waiting' ? ' You join in from the next card.' : '';
      return { text: `Clues are being written for ${guesser}…${waiting}`, yourMove: false };
    }
    case 'guess':
      return role === 'guesser'
        ? { text: 'Your turn to guess! You get one try, or you can pass.', yourMove: true }
        : { text: `Waiting for ${guesser} to guess…`, yourMove: false };
    case 'judge': {
      const giver = turn.givers.includes(view.me?.id ?? '');
      if (role === 'guesser') {
        return {
          text: 'Not an exact match. The clue writers are checking your guess…',
          yourMove: false,
        };
      }
      if (giver) {
        return {
          text: `${guesser} guessed “${turn.guess}”. Is it really the word? Count it, or Continue.`,
          yourMove: true,
        };
      }
      return isHost
        ? { text: `${guesser} guessed “${turn.guess}”. Press Continue to move on.`, yourMove: true }
        : { text: 'The clue writers are checking the guess…', yourMove: false };
    }
    case 'reveal': {
      const next = view.cardsLeft > 0 ? 'Next card' : 'Finish';
      const tail = isHost ? ` Press ${next} when everyone has had a look.` : '';
      return { text: outcomeText(view, turn) + tail, yourMove: isHost };
    }
  }
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(view: EchoView, isHost: boolean, blocker: string | null): Status {
  if (view.phase === 'lobby') {
    if (!view.me?.playing) {
      return { text: "You're watching. Press Play to join the table.", yourMove: false };
    }
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is in. Press Start game when your friends are ready!', yourMove: true }
      : { text: 'All set. Waiting for the host to start the game…', yourMove: false };
  }
  if (view.phase === 'over') {
    if (view.endReason === 'too-few') {
      return {
        text: `Game over: fewer than ${MIN_PLAYERS} players were left. You scored ${view.score}.`,
        yourMove: false,
      };
    }
    return {
      text: `Game over! You scored ${view.score} of ${view.settings.deckSize}: ${rating(view.score, view.settings.deckSize)}.`,
      yourMove: false,
    };
  }
  if (!view.turn) return { text: 'Dealing…', yourMove: false };
  return playingStatus(view, view.turn, isHost);
}
