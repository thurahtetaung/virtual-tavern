import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { CodenamesAction, CodenamesState, LogEntry } from './types.ts';

/** Log entries this change added: the whole log when a new game started, else the new tail. */
function newEntries(before: CodenamesState, after: CodenamesState): LogEntry[] {
  const sameGame = after.gamesPlayed === before.gamesPlayed;
  if (sameGame && after.log.length < before.log.length) return [];
  return sameGame ? after.log.slice(before.log.length) : after.log;
}

function entryEvent(entry: LogEntry): InsightEvent | null {
  switch (entry.type) {
    case 'clue':
      return {
        type: 'clue',
        playerId: entry.by,
        words: [{ kind: 'clue', word: entry.word }],
        props: { word: entry.word, count: entry.count, team: entry.team },
      };
    case 'guess':
      return {
        type: 'guess',
        playerId: entry.by,
        words: [
          { kind: 'guess', word: entry.word },
          ...(entry.kind === 'assassin' ? [{ kind: 'assassin' as const, word: entry.word }] : []),
        ],
        props: {
          word: entry.word,
          kind: entry.kind,
          correct: entry.kind === entry.team,
          team: entry.team,
        },
      };
    case 'end-turn':
      return { type: 'end-turn', props: { reason: entry.reason, team: entry.team } };
    case 'game-over':
      // Reported once, as `outcome`, from the phase change.
      return null;
  }
}

/** Stats only: clues, guesses, turn ends and the result, read from the game log. */
export function insights(
  before: CodenamesState,
  after: CodenamesState,
  _action: CodenamesAction | null,
  _by: PlayerId | null,
): InsightEvent[] {
  const events = newEntries(before, after).flatMap((e) => entryEvent(e) ?? []);
  if (before.phase !== 'over' && after.phase === 'over' && after.winner) {
    const winner = after.winner;
    events.push({
      type: 'outcome',
      winners: Object.entries(after.seats).flatMap(([id, s]) => (s.team === winner ? [id] : [])),
      props: { winner, winReason: after.winReason },
    });
  }
  return events;
}
