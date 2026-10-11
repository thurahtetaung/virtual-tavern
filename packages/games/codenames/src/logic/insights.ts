import type { InsightEvent, PlayerId } from '@vt/game-sdk';
import type { CodenamesAction, CodenamesState, LogEntry } from './types.ts';

/** Log entries this change added: the whole log when a new game started, else the new tail. */
function newEntries(before: CodenamesState, after: CodenamesState): LogEntry[] {
  const sameGame = after.gamesPlayed === before.gamesPlayed;
  if (sameGame && after.log.length < before.log.length) return [];
  return sameGame ? after.log.slice(before.log.length) : after.log;
}

/** What the guessing team was working from: its latest clue, and how many guesses since. */
function clueContext(log: readonly LogEntry[], index: number) {
  const entry = log[index];
  if (entry?.type !== 'guess') return null;
  let guessNo = 0;
  for (let i = index; i >= 0; i--) {
    const e = log[i]!;
    if (e.type === 'guess' && e.team === entry.team) guessNo += 1;
    else if (e.type === 'clue' && e.team === entry.team)
      return { clueWord: e.word, clueCount: e.count, guessNo };
    else if (e.type === 'end-turn' || e.type === 'clue') return null;
  }
  return null;
}

function entryEvent(
  entry: LogEntry,
  index: number,
  log: readonly LogEntry[],
  extra: { passedBy: PlayerId | null; stage: 'clue' | 'guess' | null },
): InsightEvent | null {
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
          ...clueContext(log, index),
        },
      };
    case 'end-turn': {
      // A pass (or the host's "end turn") names who pressed it; other endings name nobody.
      const presser = entry.reason === 'passed' || entry.reason === 'host' ? extra.passedBy : null;
      if (presser) extra.passedBy = null;
      return {
        type: 'end-turn',
        ...(presser ? { playerId: presser } : {}),
        props: {
          reason: entry.reason,
          team: entry.team,
          ...(extra.stage ? { stage: extra.stage } : {}),
        },
      };
    }
    case 'game-over':
      // Reported once, as `outcome`, from the phase change.
      return null;
  }
}

/** Stats only: clues, guesses, turn ends and the result, read from the game log. */
export function insights(
  before: CodenamesState,
  after: CodenamesState,
  action: CodenamesAction | null,
  by: PlayerId | null,
): InsightEvent[] {
  const added = newEntries(before, after);
  const offset = after.log.length - added.length;
  const extra = {
    passedBy: action?.type === 'end-turn' ? by : null,
    stage: before.turn?.stage ?? null,
  };
  const events = added.flatMap((e, i) => entryEvent(e, offset + i, after.log, extra) ?? []);
  if (before.phase !== 'over' && after.phase === 'over' && after.winner) {
    const winner = after.winner;
    events.push({
      type: 'outcome',
      winners: Object.entries(after.seats).flatMap(([id, s]) => (s.team === winner ? [id] : [])),
      props: {
        winner,
        winReason: after.winReason,
        // endGame already flipped it for the rematch.
        startingTeam: before.startingTeam,
        redLeft: after.board.filter((c) => c.kind === 'red' && !c.revealed).length,
        blueLeft: after.board.filter((c) => c.kind === 'blue' && !c.revealed).length,
        spymasters: Object.keys(after.keyHolders ?? {}),
      },
    });
  }
  return events;
}
