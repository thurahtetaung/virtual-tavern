import type { PlayerId } from '@vt/game-sdk';
import { canLike, missingPlayers } from './game.ts';
import {
  DEFAULT_SOUND,
  type Game,
  type GameView,
  type OptionView,
  type Role,
  type ScoreView,
  type SketchyState,
  type SketchyView,
  type Turn,
  type TurnView,
} from './types.ts';

// What each viewer may see. This is the security boundary: the prompts, who drew what, who wrote
// which lie and who picked what stay on the server until the reveal says so.

function roleOf(state: SketchyState, viewer: PlayerId | null): Role {
  if (viewer === null || !state.seats[viewer]?.playing) return 'spectator';
  const g = state.game;
  if (state.phase !== 'playing' || !g) return 'player';
  return g.players.includes(viewer) ? 'player' : 'waiting';
}

function lieShared(turn: Turn, id: PlayerId): boolean {
  const mine = turn.lies[id];
  if (mine === undefined) return false;
  return turn.writers.some((p) => p !== id && turn.lies[p] === mine);
}

function turnView(
  state: SketchyState,
  g: Game,
  turn: Turn,
  viewer: PlayerId | null,
  now: number,
): TurnView {
  const revealed = g.stage === 'reveal';
  const mine = viewer !== null && turn.artist === viewer;
  const writing = viewer !== null && !mine && turn.writers.includes(viewer);
  const voting = g.stage === 'vote' || revealed;
  const group = voting ? turn.voters : turn.writers;
  const missing = missingPlayers(g);
  // Naming who is missing before anyone is in would name everyone but the artist.
  const named = missing.length < group.length && missing.length > 0 ? missing : null;
  const voterIds = (i: number) =>
    Object.entries(turn.votes).flatMap(([id, v]) => (v === i ? [id] : []));
  const likeCount = (i: number) => Object.values(turn.likes).filter((l) => l.includes(i)).length;
  const options: OptionView[] = turn.options.map((o, i) => ({
    index: i,
    text: o.text,
    mine: viewer !== null && o.authors.includes(viewer),
    truth: revealed ? o.truth : null,
    authors: revealed ? o.authors : null,
    voters: revealed ? voterIds(i) : null,
    house: revealed ? o.house : null,
    likes: revealed ? likeCount(i) : null,
  }));
  const hidden = g.hidden.includes(turn.artist);
  return {
    number: g.at + 1,
    of: g.order.length,
    mine,
    artist: revealed ? turn.artist : null,
    prompt: revealed || mine ? g.sketches[turn.artist]!.prompt.text : null,
    drawing: hidden ? null : (g.sketches[turn.artist]?.drawing ?? null),
    hidden,
    writerCount: group.length,
    writing,
    missing: g.stage === 'write' || g.stage === 'vote' ? named : null,
    done:
      g.stage === 'write'
        ? turn.writers.filter((id) => turn.lies[id] !== undefined).length
        : turn.voters.filter((id) => turn.votes[id] !== undefined).length,
    titles: turn.writers.filter((id) => turn.lies[id] !== undefined).length,
    myLie: writing ? (turn.lies[viewer] ?? null) : null,
    myLieShared: writing && lieShared(turn, viewer),
    options,
    myVote: viewer === null ? null : (turn.votes[viewer] ?? null),
    myLikes: viewer === null ? [] : (turn.likes[viewer] ?? []),
    canLike: viewer !== null && canLike(state, viewer, now),
    voteTimedOut: turn.voteTimedOut,
    points: revealed ? turn.points : null,
    streakBonus: revealed ? turn.streakBonus : null,
    revealAt: revealed && !turn.revealSkipped ? turn.revealedAt : null,
  };
}

function gameView(state: SketchyState, g: Game, viewer: PlayerId | null): GameView {
  // The moment the reveal began: likes read as open through it (see `view`).
  const now = g.turn?.revealedAt ?? 0;
  const own = viewer === null ? undefined : g.sketches[viewer];
  const drawing = g.stage === 'draw' && state.phase === 'playing';
  const inRound = viewer !== null && g.players.includes(viewer);
  return {
    round: g.round,
    rounds: g.rounds,
    stage: g.stage,
    players: g.players,
    drawn: state.phase === 'playing' ? g.players.filter((id) => g.sketches[id]?.drawing) : [],
    myPrompt: drawing && inRound && own ? own.prompt.text : null,
    myDrawing: drawing && inRound && own ? own.drawing : null,
    sentDrawing: state.phase === 'playing' && inRound && !!own?.drawing,
    canReroll:
      drawing &&
      inRound &&
      !!own &&
      !own.drawing &&
      !g.rerolled.includes(viewer) &&
      g.pool.length > 0,
    rerolled: viewer !== null && g.rerolled.includes(viewer),
    turn:
      state.phase === 'playing' && g.turn && g.stage !== 'draw'
        ? turnView(state, g, g.turn, viewer, now)
        : null,
    streaks: g.streaks,
    history: g.history,
    deadline: state.phase === 'playing' ? g.deadline : null,
    since: g.since ?? 0,
  };
}

export function rankedScores(state: SketchyState): ScoreView[] {
  return Object.entries(state.scores)
    .map(([id, s]) => ({ id, ...s, left: !state.seats[id] }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
}

/**
 * What `viewer` may see. `view` has no clock, so it reports likes open for the whole one-by-one
 * reveal; the UI closes them when the reveal ends on screen, and the server refuses later ones.
 */
export function view(state: SketchyState, viewer: PlayerId | null): SketchyView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  return {
    phase: state.phase,
    settings: { ...DEFAULT_SOUND, ...state.settings },
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    role: roleOf(state, viewer),
    packs: state.packs,
    game: state.phase !== 'lobby' && state.game ? gameView(state, state.game, viewer) : null,
    scores: rankedScores(state),
    endReason: state.endReason,
  };
}
