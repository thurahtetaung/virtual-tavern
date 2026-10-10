import { cn } from '@vt/ui';
import { useEffect, useRef } from 'react';
import type { CodenamesView, EndTurnReason, LogEntry } from '../logic/types.ts';
import { KIND_LABEL, TEAM_LABEL, TEAM_TEXT } from './theme.ts';

const END_REASON: Record<EndTurnReason, string> = {
  passed: 'ended their turn',
  'wrong-guess': 'turn over (wrong guess)',
  'out-of-guesses': 'turn over (no guesses left)',
  timeout: "turn over (time's up)",
};

function Entry({ entry, name }: { entry: LogEntry; name: (id: string) => string }) {
  switch (entry.type) {
    case 'clue':
      return (
        <>
          <b className={TEAM_TEXT[entry.team]}>{name(entry.by)}</b> gave the clue{' '}
          <b className="uppercase">{entry.word}</b> · {entry.count ?? '∞'}
        </>
      );
    case 'guess':
      return (
        <>
          <b className={TEAM_TEXT[entry.team]}>{name(entry.by)}</b> guessed{' '}
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
        <span className="text-stone-500">
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

export function GameLog({ view }: { view: CodenamesView }) {
  const end = useRef<HTMLLIElement>(null);
  const names = new Map(view.seats.map((s) => [s.id, s.name]));
  const name = (id: string) => names.get(id) ?? 'Someone who left';
  useEffect(() => {
    // Block body: newer browsers return a Promise from scrollIntoView, which React would treat as a cleanup.
    void end.current?.scrollIntoView({ block: 'nearest' });
  }, [view.log.length]);

  return (
    <ol className="max-h-72 space-y-1.5 overflow-y-auto pr-1 text-sm lg:max-h-[28rem]">
      {view.log.length === 0 && (
        <li className="text-stone-500 italic">Clues and guesses will appear here.</li>
      )}
      {view.log.map((entry, i) => (
        <li
          key={i}
          className={cn(
            entry.type === 'clue' &&
              'mt-2 border-t border-stone-200 pt-2 first:mt-0 first:border-0 first:pt-0 dark:border-stone-800',
          )}
        >
          <Entry entry={entry} name={name} />
        </li>
      ))}
      <li ref={end} aria-hidden />
    </ol>
  );
}
