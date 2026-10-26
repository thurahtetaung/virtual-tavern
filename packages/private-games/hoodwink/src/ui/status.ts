import { type PresencePlayer, waitingFor, waitingForHost } from '@vt/game-sdk';
import { awards, liePoints } from '../logic/game.ts';
import {
  type HoodwinkView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type RoundView,
  type ScoreView,
  TRUTH_POINTS,
} from '../logic/types.ts';

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

/** Questions in the chosen decks that are still offered. */
export const chosenQuestionCount = (view: HoodwinkView) =>
  view.decks
    .filter((d) => view.settings.deckIds.includes(d.id))
    .reduce((n, d) => n + d.questionCount, 0);

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: HoodwinkView, title = 'Hoodwink'): string | null {
  const playing = view.seats.filter((s) => s.playing).length;
  if (playing < MIN_PLAYERS) {
    return `${title} needs at least ${MIN_PLAYERS} players (${playing} so far).`;
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

/** Who the round still waits for: players without a lie, or voters without a vote. */
export function missingIds(round: RoundView): string[] {
  if (round.stage === 'write') return round.players.filter((id) => !round.written.includes(id));
  if (round.stage === 'vote') return round.voters.filter((id) => !round.voted.includes(id));
  return [];
}

/**
 * The scores to show: while the reveal turns the answers over one by one, as they stood before
 * this round (ranked so), so the scoreboard doesn't give the answers away.
 */
export function shownScores(view: HoodwinkView, revealing: boolean): ScoreView[] {
  const gained = view.round?.points;
  if (!revealing || !gained) return view.scores;
  return view.scores
    .map((s) => ({ ...s, score: s.score - (gained[s.id] ?? 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
}

function roundStatus(
  view: HoodwinkView,
  round: RoundView,
  isHost: boolean,
  room: StatusRoom | undefined,
  revealing: boolean,
): Status {
  const me = view.me?.id ?? '';
  // Without the room (tests), name from the seats; nobody is marked offline then.
  const stillToAct = (ids: readonly string[]) =>
    waitingFor(ids, room?.players ?? view.seats, { you: me }) || 'Waiting';
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
        text: `Lie sent! ${stillToAct(missingIds(round))}… You can still change yours.`,
        yourMove: false,
      };
    }
    case 'vote': {
      if (!round.voters.includes(me)) {
        return { text: `Everyone is hunting for the truth…${waiting}`, yourMove: false };
      }
      const filled = round.myLieFilled
        ? '⏱ Time ran out, so a ready-made lie was filled in for you (it scores half). '
        : '';
      if (round.myVote === null) {
        return { text: `${filled}Which answer is the truth? Pick one.`, yourMove: true };
      }
      return {
        text: `Voted! ${stillToAct(missingIds(round))}… You can still change your vote.`,
        yourMove: false,
      };
    }
    case 'reveal': {
      if (revealing) {
        return { text: 'The moment of truth: who fooled whom?', yourMove: false };
      }
      const mine = round.points?.[me];
      const scored = mine === undefined ? '' : ` You scored ${points(mine)}.`;
      const last = round.number >= round.rounds;
      const what = last ? 'finish the game' : 'start the next round';
      const tail = isHost
        ? ` Press ${last ? 'Finish' : 'Next round'} when everyone has had a look.`
        : ` ${room ? waitingForHost(room, what) : `Waiting for the host to ${what}…`}`;
      const missing = round.voters.filter((id) => !round.voted.includes(id));
      const late =
        round.voteTimedOut && missing.length > 0
          ? ` ⏱ Time ran out on the vote: ${listNames(missing.map((id) => (id === me ? 'you' : nameOf(view, id))))} didn't vote.`
          : '';
      // The truth itself is filled into the question and tops the board, so it isn't repeated here.
      return { text: `Round over!${scored}${late}${tail}`, yourMove: isHost };
    }
  }
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: HoodwinkView,
  isHost: boolean,
  blocker: string | null,
  room?: StatusRoom,
  /** The one-by-one reveal is still running. */
  revealing = false,
): Status {
  if (view.phase === 'lobby') {
    const ended =
      view.endReason === 'abandoned'
        ? isHost
          ? 'You ended the last game early. '
          : 'The host ended the last game early. '
        : '';
    if (!view.me?.playing) {
      return {
        text: `${ended}You're watching. Press Take a seat to join the table.`,
        yourMove: false,
      };
    }
    if (blocker) return { text: `${ended}Almost ready: ${blocker}`, yourMove: false };
    return isHost
      ? {
          text: `${ended}Everyone is in. Press Start game when your friends are ready!`,
          yourMove: true,
        }
      : {
          text: `${ended}All set. ${room ? waitingForHost(room) : 'Waiting for the host to start a game…'}`,
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
  return roundStatus(view, view.round, isHost, room, revealing);
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

/** One reason a player scored this round, e.g. "fooled Ana and Ben" worth 1,000. */
export interface PointsLine {
  reason: string;
  points: number;
}

/**
 * Where a player's points this round came from, worked out from the revealed board: finding the
 * truth, and each lie of theirs that fooled someone (shared when merged, half when picked for
 * them). Doubled in the final round. Empty before the reveal.
 */
export function pointsBreakdown(view: HoodwinkView, round: RoundView, id: string): PointsLine[] {
  if (round.stage !== 'reveal') return [];
  const factor = round.double ? 2 : 1;
  const name = (p: string) => (p === view.me?.id ? 'you' : nameOf(view, p));
  const lines: PointsLine[] = [];
  for (const o of round.options) {
    if (o.truth && o.voters?.includes(id)) {
      lines.push({ reason: 'found the truth', points: TRUTH_POINTS * factor });
    }
    const authors = o.authors ?? [];
    const fooled = o.voters ?? [];
    if (o.truth || !authors.includes(id) || fooled.length === 0) continue;
    const auto = (o.auto ?? []).includes(id);
    const notes = [
      authors.length > 1 && `shared with ${listNames(authors.filter((a) => a !== id).map(name))}`,
      auto && 'half: picked for you',
    ].filter(Boolean);
    lines.push({
      reason: `fooled ${listNames(fooled.map(name))}${notes.length ? ` (${notes.join(', ')})` : ''}`,
      points: liePoints(fooled.length, authors.length, factor, auto),
    });
  }
  return lines;
}
