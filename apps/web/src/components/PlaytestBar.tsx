import type { RoomSnapshot } from '@vt/protocol';
import { Button, Icon, Modal, PlayerDot, useConfirm } from '@vt/ui';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { BotControls } from './BotControls.tsx';
import { useToast } from '../lib/toast.tsx';

/**
 * The thin bar every seat tab of an admin playtest shows under the room header: which seat this
 * tab plays, after its player colour's dot, the bots' pause and speed switches, and (for the host
 * seat) a way to end the playtest. On phones it is one 44 px line, and its controls open in a
 * sheet from its "Bots" button, so the game below still fits the screen.
 */
export function PlaytestBar({ roomId, snapshot }: { roomId: string; snapshot: RoomSnapshot }) {
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
  const [sheet, setSheet] = useState(false);
  const [ending, setEnding] = useState(false);
  const seatNo = Math.max(
    0,
    snapshot.players.findIndex((p) => p.id === snapshot.you),
  );
  const me = snapshot.players[seatNo];
  const isHost = snapshot.hostId === snapshot.you;
  const playtest = snapshot.meta?.playtest;
  const bots = !!playtest && playtest.bots > 0;

  const end = async () => {
    setSheet(false);
    const yes = await confirm({
      title: 'End this playtest?',
      body: 'Every seat tab closes its room.',
      confirmLabel: 'End playtest',
      danger: true,
    });
    if (!yes) return;
    setEnding(true);
    try {
      await api(`/api/admin/playtests/${roomId}`, { method: 'DELETE' });
    } catch (err) {
      toast((err as Error).message);
      setEnding(false);
    }
  };

  const controls = (
    <>
      {bots && <BotControls roomId={roomId} playtest={playtest} />}
      {isHost && (
        <Button
          size="sm"
          variant="quiet"
          className="text-danger-ink hover:bg-danger-soft"
          disabled={ending}
          onClick={() => void end()}
        >
          End playtest
        </Button>
      )}
    </>
  );

  return (
    <section
      aria-label="Playtest"
      className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-sunk px-3 text-small text-ink ring-1 ring-line ring-inset"
    >
      <p className="flex min-h-11 min-w-0 flex-1 items-center gap-1">
        <Icon name="dice-5" size={16} className="text-ink-2" />
        <span className="truncate">
          <b>Playtest</b> · you are{' '}
          {me && <PlayerDot color={me.color} label={false} className="mr-1 align-middle" />}
          <b data-testid="playtest-seat">{me?.name ?? 'watching'}</b>
          <span className="hidden sm:inline"> · nothing here is recorded</span>
        </span>
      </p>
      {(bots || isHost) && (
        <Button variant="secondary" size="sm" className="sm:hidden" onClick={() => setSheet(true)}>
          Bots
        </Button>
      )}
      {playtest?.stuck && (
        <p role="status" className="w-full pb-1.5 font-semibold sm:order-last">
          Bots paused: they got stuck. Resume them when the table can move on.
        </p>
      )}
      <div className="hidden flex-wrap items-center gap-2 py-1 sm:flex">{controls}</div>
      <Modal open={sheet} onClose={() => setSheet(false)} title="Bots" size="sm">
        <div className="flex flex-wrap items-center gap-2">{controls}</div>
      </Modal>
      {dialog}
    </section>
  );
}
