import { awards, displayText } from '../logic/game.ts';
import { type HoodwinkView, MAX_PLAYERS, MIN_PLAYERS, type RoundView } from '../logic/types.ts';

export interface Status {
  text: string;
  yourMove: boolean;
}

/** Questions in the chosen decks that are still offered. */
export const chosenQuestionCount = (view: HoodwinkView) =>
  view.decks
    .filter((d) => view.settings.deckIds.includes(d.id))
    .reduce((n, d) => n + d.questionCount, 0);

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: HoodwinkView): string | null {
  const playing = view.seats.filter((s) => s.playing).length;
  if (playing < MIN_PLAYERS) {
    return `Hoodwink needs at least ${MIN_PLAYERS} players (${playing} so far).`;
  }
  if (playing > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players can play.`;
  if (view.decks.length === 0) return 'No question decks yet. Ask an admin to add some.';
  const { rounds } = view.settings;
  if (chosenQuestionCount(view) < rounds) {
    return `${rounds} rounds need at least ${rounds} questions in the chosen decks.`;
  }
  return null;
}

export const nameOf = (view: HoodwinkView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ??
  view.scores.find((s) => s.id === id)?.name ??
  'Someone';

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** "1,000" */
export const points = (n: number) => n.toLocaleString('en');

export interface StatusContext {
  /** The host's name, for guests' "Waiting for Hana to…" lines. */
  hostName?: string;
  /** Whether a player is connected, so the missing can be marked offline. */
  online?: (id: string) => boolean;
}

/** Who the round still waits for: players without a lie, or voters without a vote. */
export function missingIds(round: RoundView): string[] {
  if (round.stage === 'write') return round.players.filter((id) => !round.written.includes(id));
  if (round.stage === 'vote') return round.voters.filter((id) => !round.voted.includes(id));
  return [];
}

/** "Dee (offline) and Eve", or "4 more players" when the list would be long. */
export function missingText(view: HoodwinkView, ids: readonly string[], ctx: StatusContext = {}) {
  if (ids.length > 3) return `${ids.length} more players`;
  return listNames(
    ids.map((id) => `${nameOf(view, id)}${ctx.online && !ctx.online(id) ? ' (offline)' : ''}`),
  );
}

function roundStatus(
  view: HoodwinkView,
  round: RoundView,
  isHost: boolean,
  ctx: StatusContext,
): Status {
  const me = view.me?.id ?? '';
  const waiting = view.role === 'waiting' ? ' You join in from the next round.' : '';
  switch (round.stage) {
    case 'write': {
      if (!round.players.includes(me)) {
        return { text: `Everyone is writing a lie…${waiting}`, yourMove: false };
      }
      if (round.myLie === null) {
        return {
          text: 'Fill in the blank with a lie that sounds true. Fool the others!',
          yourMove: true,
        };
      }
      return {
        text: `Lie sent! Waiting for ${missingText(view, missingIds(round), ctx)}… You can still change yours.`,
        yourMove: false,
      };
    }
    case 'vote': {
      if (!round.voters.includes(me)) {
        return { text: `Everyone is hunting for the truth…${waiting}`, yourMove: false };
      }
      if (round.myVote === null) {
        return { text: 'Which answer is the truth? Pick one.', yourMove: true };
      }
      return {
        text: `Voted! Waiting for ${missingText(view, missingIds(round), ctx)}… You can still change your vote.`,
        yourMove: false,
      };
    }
    case 'reveal': {
      const mine = round.points?.[me];
      const scored = mine === undefined ? '' : ` You scored ${points(mine)}.`;
      const last = round.number >= round.rounds;
      const tail = isHost
        ? ` Press ${last ? 'Finish' : 'Next round'} when everyone has had a look.`
        : ` Waiting for ${ctx.hostName ?? 'the host'} to ${last ? 'finish the game' : 'start the next round'}…`;
      return {
        text: `The truth was “${round.answer === null ? '?' : displayText(round.answer)}”.${scored}${tail}`,
        yourMove: isHost,
      };
    }
  }
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: HoodwinkView,
  isHost: boolean,
  blocker: string | null,
  ctx: StatusContext = {},
): Status {
  if (view.phase === 'lobby') {
    if (!view.me?.playing) {
      return { text: "You're watching. Press Play to join the table.", yourMove: false };
    }
    if (blocker) return { text: `Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? { text: 'Everyone is in. Press Start game when your friends are ready!', yourMove: true }
      : {
          text: `All set. Waiting for ${ctx.hostName ?? 'the host'} to start the game…`,
          yourMove: false,
        };
  }
  if (view.phase === 'over') {
    if (view.endReason === 'too-few') {
      return {
        text: `Game over: fewer than ${MIN_PLAYERS} players were left.`,
        yourMove: false,
      };
    }
    const { winners } = awards(view.scores);
    const names = winners.map((id) => (id === view.me?.id ? 'You' : nameOf(view, id)));
    if (names.length === 0) return { text: 'Game over! Nobody scored.', yourMove: false };
    const top = points(view.scores[0]?.score ?? 0);
    return names.length === 1
      ? {
          text: `Game over! ${names[0]} ${names[0] === 'You' ? 'win' : 'wins'} with ${top} points.`,
          yourMove: false,
        }
      : { text: `Game over! A tie at ${top} points: ${listNames(names)}.`, yourMove: false };
  }
  if (!view.round) return { text: 'Shuffling the questions…', yourMove: false };
  return roundStatus(view, view.round, isHost, ctx);
}

/** The prompt split around its blank (`___`, or any run of 2+ underscores). */
export function splitPrompt(prompt: string): [string, string] | null {
  const match = /_{2,}/.exec(prompt);
  if (!match) return null;
  return [prompt.slice(0, match.index), prompt.slice(match.index + match[0].length)];
}

/** 1st, 2nd… with ties sharing a place: scores [9, 9, 5] rank [1, 1, 3]. */
export function ranks(scores: readonly number[]): number[] {
  return scores.map((s) => scores.findIndex((x) => x === s) + 1);
}
