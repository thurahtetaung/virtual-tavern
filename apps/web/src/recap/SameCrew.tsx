import type { CreateRoomResponse, NextTable } from '@vt/protocol';
import { Button, Modal } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { findGame, loadPrivateGames } from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { playerToken } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';
import type { GameInfo } from './copyText.ts';
import { fetchGames } from '../lib/games.ts';

interface Choice extends GameInfo {
  id: string;
}

/** The games this browser may open: the public ones, and the back room's once it is unlocked. */
async function choices(): Promise<Choice[]> {
  const offered = await fetchGames();
  const known = offered.some((g) => g.private) ? await loadPrivateGames({ known: true }) : [];
  return offered.map((g) => ({
    id: g.id,
    name: g.title ?? g.name,
    icon: findGame(g.id)?.icon ?? known.find((k) => k.id === g.id)?.icon ?? '🎲',
  }));
}

/**
 * "Same crew, new game": pick a game for the next table. The new room continues tonight's night,
 * so its recap and this one become one, and everyone here is told where the crew went.
 */
export function SameCrewPicker({
  open,
  onClose,
  nightKey,
}: {
  open: boolean;
  onClose: () => void;
  nightKey: string;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [games, setGames] = useState<Choice[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void choices()
      .then((list) => {
        if (live) setGames(list);
      })
      .catch(() => {
        if (live) setGames([]);
      });
    return () => {
      live = false;
    };
  }, [open]);

  const create = async (gameId: string) => {
    setBusy(gameId);
    try {
      const { roomId } = await api<CreateRoomResponse>('/api/rooms', {
        method: 'POST',
        body: { gameId, token: playerToken(), nightKey },
      });
      onClose();
      void navigate(`/r/${roomId}`);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="🎲 Same crew, new game">
      <p className="mb-3 text-sm text-stone-600 dark:text-stone-400">
        Opens a new table for tonight. Everyone here gets a nudge to follow, and both tables share
        one night recap.
      </p>
      {!games ? (
        <p className="py-6 text-center text-ink-muted">Setting tables…</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {games.map((g) => (
            <li key={g.id}>
              <Button
                variant="secondary"
                className="min-h-12 w-full justify-start"
                disabled={busy !== null}
                onClick={() => void create(g.id)}
              >
                <span aria-hidden>{g.icon}</span> {busy === g.id ? 'Opening…' : g.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Someone here opened the next table: a banner to follow them there. */
export function NextTableBanner({
  next,
  who,
  onDismiss,
}: {
  next: NextTable;
  who: string;
  onDismiss: () => void;
}) {
  const [game, setGame] = useState<GameInfo | null>(() => findGame(next.gameId) ?? null);
  useEffect(() => {
    let live = true;
    if (!findGame(next.gameId)) {
      // A back-room table: only announced to unlocked browsers, so its registry loads.
      void loadPrivateGames({ known: true }).then((list) => {
        const g = list.find((p) => p.id === next.gameId);
        if (live && g) setGame(g);
      });
    }
    return () => {
      live = false;
    };
  }, [next.gameId]);
  return (
    <div
      role="status"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent-soft px-4 py-2 text-sm text-amber-950 ring-1 ring-accent-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
    >
      <span>
        🎲 <b>{who}</b> opened a new table
        {game ? (
          <>
            : {game.icon} {game.name}
          </>
        ) : null}
        . Same crew, new game!
      </span>
      <span className="flex gap-2">
        <Link
          to={`/r/${next.roomId}`}
          className="inline-flex min-h-9 items-center rounded-lg bg-accent px-3 font-semibold text-white hover:bg-accent-hover dark:hover:bg-amber-500 dark:bg-amber-500 dark:text-stone-950"
        >
          Join them
        </Link>
        <Button variant="ghost" size="sm" className="min-h-9" onClick={onDismiss}>
          Not now
        </Button>
      </span>
    </div>
  );
}
