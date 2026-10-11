import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import {
  type EnigmaAction,
  type EnigmaState,
  FIRST_INTERCEPT_ROUND,
  type HistoryEntry,
  TOKENS_TO_END,
  type Team,
} from './types.ts';

const TEAMS: readonly Team[] = ['red', 'blue'];

/**
 * The transmission a history entry was filed from: still in `after` right after the reveal
 * (transmissions are only cleared by the next round), else in `before`.
 */
function transmissionOf(before: EnigmaState, after: EnigmaState, team: Team, round: number) {
  for (const s of [after, before]) {
    if (s.round !== round) continue;
    const tx = s.transmissions.find((t) => t.team === team);
    if (tx) return tx;
  }
  return null;
}

/** Why the game ended, mirroring `winnerFrom`: tokens, the score after both or round 8, or a draw. */
function endReason(state: EnigmaState): 'intercepts' | 'misses' | 'score' | 'draw' | null {
  const winner = state.winner;
  if (!winner) return null;
  if (winner === 'draw') return 'draw';
  const loser = other(winner);
  const qualifies = (t: Team) =>
    state.teams[t].intercepts >= TOKENS_TO_END || state.teams[other(t)].misses >= TOKENS_TO_END;
  if (qualifies(loser) || !qualifies(winner)) return 'score';
  return state.teams[winner].intercepts >= TOKENS_TO_END ? 'intercepts' : 'misses';
}
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
      const tx = transmissionOf(before, after, team, entry.round);
      const encryptor: { encryptor?: string } = tx ? { encryptor: tx.encryptor } : {};
      events.push({
        type: 'decode',
        props: {
          success: entry.decoded,
          team,
          round: entry.round,
          expired: entry.clues === null,
          ...encryptor,
          voters: tx?.decodeVoters ?? [],
          guess: entry.decodeGuess ?? [],
        },
      });
      if (entry.round >= FIRST_INTERCEPT_ROUND) {
        events.push({
          type: 'intercept',
          props: {
            success: entry.intercepted,
            team: other(team),
            round: entry.round,
            ...encryptor,
            voters: tx?.interceptVoters ?? [],
          },
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
      props: {
        winner,
        round: after.round,
        redIntercepts: after.teams.red.intercepts,
        redMisses: after.teams.red.misses,
        blueIntercepts: after.teams.blue.intercepts,
        blueMisses: after.teams.blue.misses,
        ...(endReason(after) ? { reason: endReason(after)! } : {}),
      },
    });
  }
  return events;
}
