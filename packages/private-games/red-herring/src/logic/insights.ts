import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { RedHerringAction, RedHerringState } from './types.ts';

/**
 * Stats and the recap: each round when it is revealed (`round`, about the word-picker; `vote`,
 * one per voter; `conspirator`, about the Conspirator) and the result (`outcome`). Only facts
 * that are public by the reveal.
 */
export function insights(
  before: RedHerringState,
  after: RedHerringState,
  _action: RedHerringAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const g = after.game;
  const done = g?.history.length ?? 0;
  const sameGame = before.gamesPlayed === after.gamesPlayed;
  const had = sameGame ? (before.game?.history.length ?? 0) : 0;
  if (g && done > had) {
    for (const rec of g.history.slice(had)) {
      const points = rec.points;
      events.push({
        type: 'round',
        playerId: rec.picker,
        words: rec.word ? [{ kind: 'clue', word: rec.word }] : [],
        props: {
          round: rec.no,
          word: rec.word,
          conspirator: rec.conspirator,
          against: rec.against,
          caught: rec.caught,
          voters: Object.keys(rec.votes).length,
          pickerPoints: points[rec.picker] ?? 0,
          players: g.players.length,
        },
      });
      events.push({
        type: 'conspirator',
        playerId: rec.conspirator,
        props: {
          round: rec.no,
          against: rec.against,
          caught: rec.caught,
          points: points[rec.conspirator] ?? 0,
          // Votes cast on players who weren't the Conspirator.
          misled: Object.entries(rec.votes).filter(
            ([v, t]) => v !== rec.conspirator && t !== rec.conspirator,
          ).length,
        },
      });
      for (const [voter, target] of Object.entries(rec.votes)) {
        events.push({
          type: 'vote',
          playerId: voter,
          props: {
            round: rec.no,
            target,
            right: target === rec.conspirator,
            asConspirator: voter === rec.conspirator,
            points: points[voter] ?? 0,
          },
        });
      }
    }
  }
  if (before.phase !== 'over' && after.phase === 'over' && g) {
    const total = (id: PlayerId) => (g.tokens[id] ?? []).reduce((a, b) => a + b, 0);
    const ranking = [...g.players].sort((a, b) => total(b) - total(a));
    events.push({
      type: 'outcome',
      winners: after.winners,
      props: {
        endReason: after.endReason,
        rounds: g.history.length,
        players: g.players.length,
        scoring: after.settings.scoring,
        caught: g.history.filter((h) => h.caught).length,
        ranking,
        scores: ranking.map(total),
      },
    });
  }
  return events;
}
