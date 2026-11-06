import type { PlaytestMeta, PlaytestSpeed, PlaytestStatus } from '@vt/protocol';
import { Button, Chip, Chips, cn } from '@vt/ui';
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
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Button
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void send({ paused: !playtest.paused })}
      >
        {playtest.paused ? '▶ Resume bots' : '⏸ Pause bots'}
      </Button>
      <Chips label="Bot speed" className="m-0 gap-1 overflow-visible p-0">
        {SPEEDS.map((s) => (
          <Chip
            key={s.id}
            pressed={playtest.speed === s.id}
            aria-label={`${s.label} bots`}
            title={`${s.label} bots`}
            disabled={busy}
            onClick={() => void send({ speed: s.id })}
          >
            <span aria-hidden>{s.icon}</span>
          </Chip>
        ))}
      </Chips>
    </div>
  );
}
