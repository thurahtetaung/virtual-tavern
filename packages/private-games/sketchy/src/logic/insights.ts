import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { Game, SketchyAction, SketchyState, Turn } from './types.ts';
import { rankedScores } from './view.ts';

/** The drawing this change revealed, if any. */
function revealedTurn(before: SketchyState, after: SketchyState): Turn | null {
  const g = after.game;
  if (after.gamesPlayed !== before.gamesPlayed || g?.stage !== 'reveal' || !g.turn) return null;
  const was = before.game;
  const same = was?.stage === 'reveal' && was.round === g.round && was.at === g.at;
  return same ? null : g.turn;
}

function revealEvents(g: Game, turn: Turn): InsightEvent[] {
  const pickedBy = (i: number) =>
    Object.entries(turn.votes).flatMap(([id, pick]) => (pick === i ? [id] : []));
  const truth = turn.options.findIndex((o) => o.truth);
  const lies: InsightEvent[] = turn.options.flatMap((o, i) =>
    o.truth || o.house
      ? []
      : [
          {
            type: 'lie',
            playerId: o.authors[0] ?? null,
            words: [{ kind: 'guess' as const, word: o.text }],
            props: {
              fooled: pickedBy(i).length,
              authors: o.authors,
              auto: o.auto.length > 0,
              artist: turn.artist,
            },
          },
        ],
  );
  const votes: InsightEvent[] = Object.entries(turn.votes).map(([voter, pick]) => ({
    type: 'vote',
    playerId: voter,
    props: {
      foundTruth: pick === truth,
      authors: turn.options[pick]?.authors ?? [],
      house: turn.options[pick]?.house ?? false,
      artist: turn.artist,
      streak: g.streaks[voter] ?? 0,
    },
  }));
  const found = truth < 0 ? 0 : pickedBy(truth).length;
  return [
    ...lies,
    ...votes,
    {
      type: 'drawing',
      playerId: turn.artist,
      props: {
        round: g.round,
        found,
        voters: turn.voters.length,
        lies: lies.length,
        house: turn.options.filter((o) => o.house).length,
        hidden: g.hidden.includes(turn.artist),
        points: turn.points[turn.artist] ?? 0,
      },
    },
  ];
}

/** The likes of a drawing once it is closed: who liked whose lie, and whether it was its artist. */
function likeEvents(g: Game, before: SketchyState): InsightEvent[] {
  const turn = before.game?.turn;
  if (!turn) return [];
  return Object.entries(turn.likes).flatMap(([liker, picks]) =>
    picks.flatMap((i) => {
      const o = turn.options[i];
      if (!o || o.truth || o.house || o.authors.includes(liker)) return [];
      return [
        {
          type: 'like',
          playerId: liker,
          props: { authors: o.authors, byArtist: liker === turn.artist, round: g.round },
        },
      ];
    }),
  );
}

/**
 * Stats only: at each reveal every lie (with how many it fooled), every vote and the drawing
 * itself; when a drawing is closed, its likes; at the end, the top scorers. A game that ends for
 * lack of players credits nobody.
 */
export function insights(
  before: SketchyState,
  after: SketchyState,
  _action: SketchyAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const g = after.game;
  const closed =
    g &&
    before.game &&
    after.gamesPlayed === before.gamesPlayed &&
    g.history.length > before.game.history.length;
  if (closed) events.push(...likeEvents(g, before));
  const turn = revealedTurn(before, after);
  if (turn && g) events.push(...revealEvents(g, turn));
  if (before.phase !== 'over' && after.phase === 'over') {
    const ranked = rankedScores(after);
    const best = ranked[0]?.score ?? 0;
    events.push({
      type: 'outcome',
      winners:
        after.endReason === 'finished' && best > 0
          ? ranked.filter((s) => s.score === best).map((s) => s.id)
          : [],
      props: {
        drawings: g?.history.length ?? 0,
        endReason: after.endReason,
        ranking: ranked.map((s) => s.id),
        scores: ranked.map((s) => s.score),
        fooled: ranked.map((s) => s.fooled),
        truths: ranked.map((s) => s.truths),
        likes: ranked.map((s) => s.likes),
      },
    });
  }
  return events;
}
