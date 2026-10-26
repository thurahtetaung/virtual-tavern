import { ProtectedImage, cn } from '@vt/ui';
import type { ReactNode } from 'react';
import { DUMMY, type TaskView } from '../logic/types.ts';
import { useArt } from './assets.tsx';
import { tokenLabel } from '../logic/onecard.ts';
import { Rich } from './Card.tsx';

export const STATE_ICON = { open: '○', done: '✓', failed: '✗' } as const;

/** One task as a chip: its text, holder, live state, progress and who fed it. */
export function TaskChip({
  task,
  name,
  showOwner = false,
  you,
  action,
  compact = false,
}: {
  task: TaskView;
  name: (id: string) => string;
  showOwner?: boolean;
  you?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  const art = useArt();
  const scan = art.taskThumb(task.key);
  const tone =
    task.state === 'done'
      ? 'bg-success-soft text-success-ink ring-success-line dark:bg-emerald-500/10 dark:text-emerald-100 dark:ring-emerald-500/30'
      : task.state === 'failed'
        ? 'bg-danger-soft text-danger-ink ring-danger-line dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30'
        : 'bg-card ring-line dark:bg-stone-800 dark:ring-stone-700';
  const prediction =
    task.check.kind === 'predict'
      ? task.prediction !== null
        ? ` · says ${task.prediction}${task.predictionSecret ? ' 🤫' : ''}`
        : task.predictionSecret && task.owner
          ? ' · 🤫 secret number'
          : ''
      : '';
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-xl px-2.5 py-1.5 text-sm ring-1',
        tone,
        compact && 'py-1 text-xs',
      )}
      data-testid="mc-task"
      data-state={task.state}
      data-owner={task.owner ?? ''}
    >
      {scan && !compact && (
        <ProtectedImage src={scan} alt="" className="h-12 w-8 shrink-0 rounded object-cover" />
      )}
      <span aria-hidden className="mt-0.5 shrink-0 font-black">
        {task.crew ? '👥' : STATE_ICON[task.state]}
      </span>
      {task.token && art.orderToken(task.token) && (
        <span
          role="img"
          aria-label={`order token ${tokenLabel(task.token)}`}
          className="size-7 shrink-0 overflow-hidden rounded-full"
          data-testid="mc-token-badge"
        >
          <ProtectedImage
            src={art.orderToken(task.token)!}
            alt=""
            className="size-full object-cover"
          />
        </span>
      )}
      {task.token && !art.orderToken(task.token) && (
        <span
          role="img"
          aria-label={`order token ${tokenLabel(task.token)}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-panel text-xs font-black ring-1 ring-line-strong dark:bg-stone-700 dark:ring-stone-500"
          data-testid="mc-token-badge"
        >
          {tokenLabel(task.token)}
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">
          <Rich text={task.text} name={name} />
          {prediction}
        </span>
        <span className="block text-xs opacity-80">
          {showOwner &&
            (task.crew
              ? 'Whole crew'
              : task.owner
                ? task.owner === you
                  ? 'Yours'
                  : task.owner === DUMMY
                    ? name(DUMMY)
                    : name(task.owner)
                : 'Not taken')}
          {task.difficulty > 0 && !compact && (
            <span aria-label={`difficulty ${task.difficulty}`}>
              {' '}
              {showOwner ? '· ' : ''}
              {'●'.repeat(task.difficulty)}
            </span>
          )}
          {task.progress && task.state === 'open' && (
            <span className="tabular-nums"> · {task.progress}</span>
          )}
          {task.state === 'done' && task.at && <span> · trick {task.at}</span>}
          {task.fedBy.length > 0 && <span> · fed by {task.fedBy.map(name).join(', ')}</span>}
        </span>
        {task.state === 'failed' && task.why && (
          <span className="block text-xs">
            <Rich text={task.why} name={name} />
          </span>
        )}
      </span>
      {task.captainCannot && !compact && (
        <span className="shrink-0 rounded-full bg-panel px-1.5 text-[11px] ring-1 ring-line dark:bg-stone-700 dark:ring-stone-600">
          {art.say('not the {captain}')}
        </span>
      )}
      {action}
    </div>
  );
}
