import type { RoomSnapshot } from '@vt/protocol';
import { Button, PlayerDot } from '@vt/ui';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { BotControls } from './BotControls.tsx';
import { useToast } from '../lib/toast.tsx';

/**
 * The thin bar every seat tab of an admin playtest shows under the room header: which seat this
 * tab plays, after its player colour's dot, the bots' pause and speed switches, and (for the host
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
      className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl bg-stone-100 px-3 py-1.5 text-sm text-stone-900 ring-1 ring-stone-300 dark:bg-stone-800/60 dark:text-stone-100 dark:ring-stone-700"
    >
      <p className="min-w-0 truncate">
        <span aria-hidden>🧪 </span>
        <b>Playtest</b> · you are{' '}
        {me && <PlayerDot color={me.color} label={false} className="mr-1 align-middle" />}
        <b data-testid="playtest-seat">{me?.name ?? 'watching'}</b>
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
