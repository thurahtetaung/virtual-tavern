import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import {
  type EnigmaAction,
  type EnigmaState,
  FIRST_INTERCEPT_ROUND,
  type HistoryEntry,
  type Team,
} from './types.ts';

const TEAMS: readonly Team[] = ['red', 'blue'];
const other = (team: Team): Team => (team === 'red' ? 'blue' : 'red');

/** Revealed transmissions this change filed for `team` (none when a game started or ended). */
function newHistory(before: EnigmaState, after: EnigmaState, team: Team): HistoryEntry[] {
  if (after.gamesPlayed !== before.gamesPlayed) return [];
  const old = before.teams[team]?.history ?? [];
  const now = after.teams[team]?.history ?? [];
  return now.length > old.length ? now.slice(old.length) : [];
}

/**
 * Stats only: clues sent, decode and intercept results, and the result. Team chat and notes are
 * private to each team and never reported.
 */
export function insights(
  before: EnigmaState,
  after: EnigmaState,
  _action: EnigmaAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events: InsightEvent[] = [];
  const sameRound =
    after.phase === 'playing' &&
    after.gamesPlayed === before.gamesPlayed &&
    after.round === before.round;

  if (sameRound) {
    for (const tx of after.transmissions) {
      const was = before.transmissions.find((t) => t.team === tx.team);
      if (!tx.clues || !was || was.clues) continue;
      events.push({
        type: 'clues',
        playerId: tx.encryptor,
        words: tx.clues.map((word) => ({ kind: 'clue' as const, word })),
        props: { clues: tx.clues, team: tx.team, round: after.round },
      });
    }
  }

  for (const team of TEAMS) {
    for (const entry of newHistory(before, after, team)) {
      events.push({
        type: 'decode',
        props: {
          success: entry.decoded,
          team,
          round: entry.round,
          expired: entry.clues === null,
        },
      });
      if (entry.round >= FIRST_INTERCEPT_ROUND) {
        events.push({
          type: 'intercept',
          props: { success: entry.intercepted, team: other(team), round: entry.round },
        });
      }
    }
  }

  if (before.phase !== 'over' && after.phase === 'over' && after.winner) {
    const winner = after.winner;
    events.push({
      type: 'outcome',
      winners:
        winner === 'draw'
          ? []
          : Object.entries(after.seats).flatMap(([id, s]) => (s.team === winner ? [id] : [])),
      props: { winner, round: after.round },
    });
  }
  return events;
}
