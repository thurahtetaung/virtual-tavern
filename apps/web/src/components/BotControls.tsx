import type { PlaytestMeta, PlaytestSpeed, PlaytestStatus } from '@vt/protocol';
import { cn } from '@vt/ui';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';

const SPEEDS: { id: PlaytestSpeed; icon: string; label: string }[] = [
  { id: 'slow', icon: '🐢', label: 'Slow' },
  { id: 'normal', icon: '▶', label: 'Normal' },
  { id: 'fast', icon: '⚡', label: 'Fast' },
];

/** A playtest's bot switches: pause or resume, and how fast they play. */
export function BotControls({
  roomId,
  playtest,
  onChange,
  className,
}: {
  roomId: string;
  playtest: PlaytestMeta;
  /** The playtest as the server now has it (the room's own snapshot updates by itself). */
  onChange?: (status: PlaytestStatus) => void;
  className?: string;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const send = async (body: { paused?: boolean; speed?: PlaytestSpeed }) => {
    setBusy(true);
    try {
      // Not inside `onChange?.(…)`: with no onChange, that would skip the request itself.
      const status = await api<PlaytestStatus>(`/api/admin/playtests/${roomId}`, {
        method: 'PATCH',
        body,
      });
      onChange?.(status);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const chip =
    'inline-flex min-h-9 items-center justify-center rounded-lg px-2 text-sm font-semibold ring-1 ring-black/10 disabled:opacity-50 dark:ring-white/15';
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <button
        type="button"
        disabled={busy}
        className={cn(chip, 'bg-white/70 dark:bg-black/20')}
        onClick={() => void send({ paused: !playtest.paused })}
      >
        {playtest.paused ? '▶ Resume bots' : '⏸ Pause bots'}
      </button>
      <div role="radiogroup" aria-label="Bot speed" className="flex gap-1">
        {SPEEDS.map((s) => (
          <button
            key={s.id}
            type="button"
            role="radio"
            aria-checked={playtest.speed === s.id}
            aria-label={`${s.label} bots`}
            title={`${s.label} bots`}
            disabled={busy}
            className={cn(
              chip,
              'w-9',
              playtest.speed === s.id
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'bg-white/70 dark:bg-black/20',
            )}
            onClick={() => void send({ speed: s.id })}
          >
            <span aria-hidden>{s.icon}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
