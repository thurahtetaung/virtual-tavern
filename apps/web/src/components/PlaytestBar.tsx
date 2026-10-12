import type { RoomSnapshot } from '@vt/protocol';
import { Button, cn } from '@vt/ui';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { BotControls } from './BotControls.tsx';
import { useToast } from '../lib/toast.tsx';

/** One colour per seat (by join order), so seat tabs look different at a glance. */
const SEAT_COLOURS = [
  'bg-violet-100 text-violet-950 ring-violet-300 dark:bg-violet-500/15 dark:text-violet-100 dark:ring-violet-500/40',
  'bg-sky-100 text-sky-950 ring-sky-300 dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40',
  'bg-emerald-100 text-emerald-950 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/40',
  'bg-rose-100 text-rose-950 ring-rose-300 dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40',
  'bg-amber-100 text-amber-950 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40',
  'bg-teal-100 text-teal-950 ring-teal-300 dark:bg-teal-500/15 dark:text-teal-100 dark:ring-teal-500/40',
  'bg-fuchsia-100 text-fuchsia-950 ring-fuchsia-300 dark:bg-fuchsia-500/15 dark:text-fuchsia-100 dark:ring-fuchsia-500/40',
  'bg-lime-100 text-lime-950 ring-lime-300 dark:bg-lime-500/15 dark:text-lime-100 dark:ring-lime-500/40',
];

/**
 * The thin bar every seat tab of an admin playtest shows under the room header: which seat this
 * tab plays, in the seat's own colour, the bots' pause and speed switches, and (for the host
 * seat) a way to end the playtest.
 */
export function PlaytestBar({ roomId, snapshot }: { roomId: string; snapshot: RoomSnapshot }) {
  const toast = useToast();
  const [ending, setEnding] = useState(false);
  const seatNo = Math.max(
    0,
    snapshot.players.findIndex((p) => p.id === snapshot.you),
  );
  const me = snapshot.players[seatNo];
  const isHost = snapshot.hostId === snapshot.you;
  const playtest = snapshot.meta?.playtest;

  const end = async () => {
    if (!window.confirm('End this playtest? Every seat tab closes its room.')) return;
    setEnding(true);
    try {
      await api(`/api/admin/playtests/${roomId}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
      setEnding(false);
    }
  };

  return (
    <section
      aria-label="Playtest"
      className={cn(
        'mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl px-3 py-1.5 text-sm ring-1',
        SEAT_COLOURS[seatNo % SEAT_COLOURS.length],
      )}
    >
      <p className="min-w-0 truncate">
        <span aria-hidden>🧪 </span>
        <b>Playtest</b> · you are <b data-testid="playtest-seat">{me?.name ?? 'watching'}</b>
        <span className="hidden sm:inline"> · nothing here is recorded</span>
      </p>
      {playtest?.stuck && (
        <p role="status" className="w-full font-semibold sm:order-last">
          Bots paused: they got stuck. Resume them when the table can move on.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {playtest && playtest.bots > 0 && <BotControls roomId={roomId} playtest={playtest} />}
        {isHost && (
          <Button
            size="sm"
            variant="ghost"
            className="min-h-9 px-2"
            disabled={ending}
            onClick={() => void end()}
          >
            End playtest
          </Button>
        )}
      </div>
    </section>
  );
}
