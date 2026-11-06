import { Row, Rows, cn } from '@vt/ui';
import { useEffect, useRef } from 'react';
import type { CodenamesView, EndTurnReason, LogEntry } from '../logic/types.ts';
import { KIND_LABEL, TEAM_LABEL, TEAM_TEXT } from './theme.ts';

const END_REASON: Record<EndTurnReason, string> = {
  passed: 'ended their turn',
  'wrong-guess': 'turn over (wrong guess)',
  'out-of-guesses': 'turn over (no guesses left)',
  timeout: "turn over (time's up)",
  forfeit: 'forfeited the turn (nobody left to play it)',
  host: 'turn ended by the host',
};

function Entry({
  entry,
  name,
}: {
  entry: LogEntry;
  name: (id: string, fallback?: string) => string;
}) {
  switch (entry.type) {
    case 'clue':
      return (
        <>
          <b className={TEAM_TEXT[entry.team]}>{name(entry.by, entry.name)}</b> gave the clue{' '}
          <b className="uppercase">{entry.word}</b> · {entry.count}
        </>
      );
    case 'guess':
      return (
        <>
          <b className={TEAM_TEXT[entry.team]}>{name(entry.by, entry.name)}</b> guessed{' '}
          <b className="uppercase">{entry.word}</b>:{' '}
          <span
            className={entry.kind === 'red' || entry.kind === 'blue' ? TEAM_TEXT[entry.kind] : ''}
          >
            {KIND_LABEL[entry.kind]}
          </span>
          {entry.kind === entry.team ? ' ✓' : ''}
        </>
      );
    case 'end-turn':
      return (
        <span className="text-ink-muted">
          {TEAM_LABEL[entry.team]} {END_REASON[entry.reason]}
        </span>
      );
    case 'game-over':
      return (
        <b className={TEAM_TEXT[entry.winner]}>
          {TEAM_LABEL[entry.winner]} wins
          {entry.reason === 'assassin' ? ' (the other team found the assassin)' : '!'}
        </b>
      );
  }
}

/** The row's team dot: the team that gave the clue, guessed, ended its turn or won. */
const dot = (entry: LogEntry) =>
  (entry.type === 'game-over' ? entry.winner : entry.team) === 'red' ? 'bg-team-a' : 'bg-team-b';

export function GameLog({ view }: { view: CodenamesView }) {
  const end = useRef<HTMLDivElement>(null);
  const names = new Map(view.seats.map((s) => [s.id, s.name]));
  // Someone who left keeps the name they had (older logs lack it).
  const name = (id: string, fallback?: string) =>
    names.get(id) ?? (fallback ? `${fallback} (left)` : 'Someone who left');
  useEffect(() => {
    // Block body: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
    void end.current?.scrollIntoView({ block: 'nearest' });
  }, [view.log.length]);

  return (
    <div className="max-h-72 overflow-y-auto pr-1 text-small lg:max-h-[28rem]">
      <Rows>
        {view.log.length === 0 && (
          <Row className="text-ink-muted italic">Clues and guesses will appear here.</Row>
        )}
        {view.log.map((entry, i) => (
          <Row
            key={i}
            className={cn('min-h-9 items-baseline gap-2', entry.type === 'clue' && 'pt-2')}
          >
            <span aria-hidden className={cn('size-2 shrink-0 rounded-full', dot(entry))} />
            <span className="min-w-0">
              <Entry entry={entry} name={name} />
            </span>
          </Row>
        ))}
      </Rows>
      <div ref={end} aria-hidden />
    </div>
  );
}
