import { type PresencePlayer, listNames, waitingFor, waitingForHost } from '@vt/game-sdk';
import { promptCount } from '../logic/game.ts';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ScoreView,
  type SketchyView,
  type TurnView,
  roundsFor,
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

/** Why the game can't start yet, or null if it can. */
export function startBlocker(view: SketchyView): string | null {
  const playing = view.seats.filter((s) => s.playing).length;
  if (playing < MIN_PLAYERS)
    return `Sketchy needs at least ${MIN_PLAYERS} players (${playing} so far).`;
  if (playing > MAX_PLAYERS) return `At most ${MAX_PLAYERS} players can play.`;
  if (view.packs.length === 0) return 'No prompt packs yet. Ask an admin to add some.';
  if (view.settings.packIds.length === 0) return 'Pick at least one prompt pack.';
  const need = playing * roundsFor(playing);
  if (promptCount(view.packs, view.settings) < need) {
    return `This game needs at least ${need} prompts in the chosen packs.`;
  }
  return null;
}

export const nameOf = (view: SketchyView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ??
  view.scores.find((s) => s.id === id)?.name ??
  'Someone';

/** "1,000" */
export const points = (n: number) => n.toLocaleString('en');

/**
 * The scores to show: while the reveal turns the answers over one by one, as they stood before
 * this drawing, so the scoreboard doesn't give the answers away.
 */
export function shownScores(view: SketchyView, revealing: boolean): ScoreView[] {
  const gained = view.game?.turn?.points;
  if (!revealing || !gained) return view.scores;
  return view.scores
    .map((s) => ({ ...s, score: s.score - (gained[s.id] ?? 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
}

/** Everyone tied on the top score (nobody when it's 0). */
export function winners(scores: readonly ScoreView[]): string[] {
  const best = Math.max(0, ...scores.map((s) => s.score));
  return best > 0 ? scores.filter((s) => s.score === best).map((s) => s.id) : [];
}

function turnStatus(
  view: SketchyView,
  t: TurnView,
  stage: 'write' | 'vote' | 'reveal',
  isHost: boolean,
  room: StatusRoom | undefined,
  revealing: boolean,
): Status {
  const me = view.me?.id ?? '';
  const still = (ids: string[] | null) =>
    ids
      ? waitingFor(ids, room?.players ?? view.seats, { you: me }) || 'Waiting'
      : 'Waiting for the others';
  const waiting = view.role === 'waiting' ? ' You join in from the next round.' : '';
  if (stage === 'reveal') {
    if (revealing) return { text: 'The moment of truth: who fooled whom?', yourMove: false };
    const mine = t.points?.[me];
    const scored = mine === undefined ? '' : ` You scored ${points(mine)}.`;
    const what = 'move on';
    const tail = isHost
      ? ' Press Next when everyone has had a look.'
      : ` ${room ? waitingForHost(room, what) : `Waiting for the host to ${what}…`}`;
    return {
      text: `That was ${t.mine ? 'your' : `${nameOf(view, t.artist)}’s`} drawing!${scored}${tail}`,
      yourMove: isHost,
    };
  }
  if (t.mine) {
    return {
      text:
        stage === 'write'
          ? 'This is your drawing! The others are writing fake titles for it. Keep a straight face.'
          : 'Your drawing! They’re picking the real title. Like the fakes that make you laugh.',
      yourMove: false,
    };
  }
  if (!t.writing) {
    return {
      text: `${stage === 'write' ? 'Everyone is writing fake titles…' : 'Everyone is picking the real title…'}${waiting}`,
      yourMove: false,
    };
  }
  if (stage === 'write') {
    if (t.myLie === null) {
      return {
        text: 'What could this drawing be called? Write a fake title that fools the others.',
        yourMove: true,
      };
    }
    return {
      text: `Title sent! ${still(t.missing)}… You can still change yours.`,
      yourMove: false,
    };
  }
  const missed = t.myLie === null ? '⏱ Picking started before your title was in. ' : '';
  if (t.myVote === null)
    return { text: `${missed}Which is the real title? Pick one.`, yourMove: true };
  return { text: `Picked! Like the funny ones. ${still(t.missing)}…`, yourMove: false };
}

/** Plain-language guidance for whoever is looking at the screen. */
export function statusFor(
  view: SketchyView,
  isHost: boolean,
  blocker: string | null,
  room?: StatusRoom,
  revealing = false,
): Status {
  if (view.phase === 'lobby') {
    const ended =
      view.endReason === 'abandoned'
        ? isHost
          ? 'You ended the last game early. '
          : 'The host ended the last game early. '
        : '';
    if (!view.me?.playing)
      return {
        text: `${ended}You're watching. Press Take a seat to join the table.`,
        yourMove: false,
      };
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
      return { text: `Game over: fewer than ${MIN_PLAYERS} players were left.`, yourMove: false };
    }
    const names = winners(view.scores).map((id) => (id === view.me?.id ? 'You' : nameOf(view, id)));
    if (names.length === 0) return { text: 'Game over! Nobody scored.', yourMove: false };
    const top = points(view.scores[0]?.score ?? 0);
    return names.length === 1
      ? {
          text: `Game over! ${names[0]} ${names[0] === 'You' ? 'win' : 'wins'} with ${top} points.`,
          yourMove: false,
        }
      : { text: `Game over! A tie at ${top} points: ${listNames(names)}.`, yourMove: false };
  }
  const g = view.game;
  if (!g) return { text: 'Shuffling the prompts…', yourMove: false };
  if (g.stage === 'draw') {
    if (g.myPrompt === null) return { text: 'Everyone is drawing…', yourMove: false };
    if (g.myDrawing === null)
      return { text: 'Draw your prompt! Nobody else sees it.', yourMove: true };
    const missing = g.players.filter((id) => !g.drawn.includes(id));
    const me = view.me?.id ?? '';
    return {
      text: `Drawing sent! ${waitingFor(missing, room?.players ?? view.seats, { you: me }) || 'Waiting'}…`,
      yourMove: false,
    };
  }
  if (!g.turn) return { text: 'Shuffling the drawings…', yourMove: false };
  return turnStatus(view, g.turn, g.stage, isHost, room, revealing);
}

/** Who the stage still waits for, as far as the viewer may know (see `TurnView.missing`). */
export function missingIds(view: SketchyView): string[] {
  const g = view.game;
  if (!g) return [];
  if (g.stage === 'draw') return g.players.filter((id) => !g.drawn.includes(id));
  return g.turn?.missing ?? [];
}

/** Whether anyone at all is still missing (counts, so it never names the artist). */
export function anyMissing(view: SketchyView): boolean {
  const g = view.game;
  if (!g) return false;
  if (g.stage === 'draw') return g.players.some((id) => !g.drawn.includes(id));
  const t = g.turn;
  return !!t && (g.stage === 'write' || g.stage === 'vote') && t.done < t.writerCount;
}
