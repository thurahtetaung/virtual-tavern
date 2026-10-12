import type { PlaytestCreated, PlaytestGame, PlaytestStatus } from '@vt/protocol';
import { Button, Panel, cn } from '@vt/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { clientGames, loadPrivateGames } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import {
  type SavedPlaytest,
  forgetPlaytest,
  savePlaytest,
  savedPlaytests,
} from '../lib/playtests.ts';
import { seatLink } from '../lib/seat.ts';
import { useToast } from '../lib/toast.tsx';

/** Ready-made seat names (self-written, short, easy to tell apart in a tab strip). */
const SEAT_NAMES = [
  'Ana',
  'Ben',
  'Cy',
  'Dee',
  'Eli',
  'Fay',
  'Gus',
  'Hal',
  'Ivy',
  'Jo',
  'Kit',
  'Lu',
  'Max',
  'Ned',
  'Oz',
  'Pia',
];

const seatNames = (n: number, from: readonly string[] = []) =>
  Array.from({ length: n }, (_, i) => from[i] ?? SEAT_NAMES[i] ?? `Seat ${i + 1}`);

/** Opens a seat in a new tab; links stay on the page for when a popup blocker says no. */
const openSeat = (url: string) => {
  window.open(url, '_blank', 'noopener');
};

/** The admin's Playtest tab: start a playtest of any game, and reopen or end running ones. */
export function PlaytestAdmin() {
  const toast = useToast();
  const [games, setGames] = useState<PlaytestGame[] | null>(null);
  const [icons, setIcons] = useState<Map<string, string>>(
    () => new Map(clientGames.map((g) => [g.id, g.icon])),
  );
  const [gameId, setGameId] = useState<string | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState<SavedPlaytest[]>(savedPlaytests);

  useEffect(() => {
    void api<PlaytestGame[]>('/api/admin/playtest/games')
      .then(setGames)
      .catch((e: Error) => toast(e.message));
    // Back-room icons live with the back-room code, which the admin may load.
    void loadPrivateGames().then((list) =>
      setIcons((m) => new Map([...m, ...list.map((g) => [g.id, g.icon] as const)])),
    );
  }, [toast]);

  const game = games?.find((g) => g.id === gameId) ?? null;
  const pick = (g: PlaytestGame) => {
    setGameId(g.id);
    setNames((prev) => seatNames(g.minPlayers, prev));
  };
  const setSeats = (n: number) => setNames((prev) => seatNames(n, prev));

  const start = async () => {
    if (!game) return;
    setStarting(true);
    try {
      const made = await api<PlaytestCreated>('/api/admin/playtests', {
        method: 'POST',
        body: { gameId: game.id, seats: names.map((name) => ({ name: name.trim() })) },
      });
      setRunning(savePlaytest({ ...made, gameName: game.name, startedAt: Date.now() }));
      // Your own seat (the host) opens straight away; the others are a click each below.
      const first = made.seats[0];
      if (first) openSeat(seatLink(made.roomId, first));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const ended = useCallback((roomId: string) => setRunning(forgetPlaytest(roomId)), []);

  return (
    <div className="space-y-6">
      <Panel className="space-y-4">
        <div>
          <h2 className="text-xl font-bold">🧪 New playtest</h2>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Play any game alone: each seat opens in its own tab of this browser, as its own player.
            Nothing is recorded in the stats, the night recap or the hall of fame, and nobody else
            can join.
          </p>
        </div>

        {!games ? (
          <p className="text-sm text-stone-500">Loading games…</p>
        ) : (
          <div
            role="radiogroup"
            aria-label="Game to play-test"
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
          >
            {games.map((g) => (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={g.id === gameId}
                onClick={() => pick(g)}
                className={cn(
                  'flex min-h-14 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold ring-1 transition-colors',
                  g.id === gameId
                    ? 'bg-amber-100 ring-2 ring-amber-500 dark:bg-amber-500/15'
                    : 'bg-white ring-stone-200 hover:bg-stone-50 dark:bg-stone-800 dark:ring-stone-700 dark:hover:bg-stone-700/70',
                )}
              >
                <span aria-hidden className="text-2xl">
                  {icons.get(g.id) ?? '🎲'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{g.name}</span>
                  <span className="block text-xs font-normal text-stone-500 dark:text-stone-400">
                    {g.private && <span aria-label="back room">🕯️ </span>}
                    {g.minPlayers}–{g.maxSeats} seats
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {game && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold" id="playtest-seats">
                Seats
              </span>
              <div
                className="flex items-center gap-2"
                role="group"
                aria-labelledby="playtest-seats"
              >
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-11 text-lg"
                  aria-label="One seat fewer"
                  disabled={names.length <= game.minPlayers}
                  onClick={() => setSeats(names.length - 1)}
                >
                  −
                </Button>
                <span className="w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">
                  {names.length}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-11 text-lg"
                  aria-label="One seat more"
                  disabled={names.length >= game.maxSeats}
                  onClick={() => setSeats(names.length + 1)}
                >
                  +
                </Button>
              </div>
            </div>
            <ol className="grid gap-2 sm:grid-cols-2">
              {names.map((name, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="w-6 text-right text-sm text-stone-500 tabular-nums">
                    {i + 1}
                  </span>
                  <input
                    aria-label={`Seat ${i + 1} name`}
                    value={name}
                    maxLength={24}
                    onChange={(e) =>
                      setNames((prev) => prev.map((n, j) => (j === i ? e.target.value : n)))
                    }
                    className="h-11 min-w-0 flex-1 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
                  />
                  {i === 0 && (
                    <span className="text-xs whitespace-nowrap text-stone-500 dark:text-stone-400">
                      👑 host
                    </span>
                  )}
                </li>
              ))}
            </ol>
            <Button
              size="lg"
              className="w-full sm:w-auto"
              disabled={starting || names.some((n) => !n.trim())}
              onClick={() => void start()}
            >
              Start playtest
            </Button>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3">
        <h2 className="text-xl font-bold">Your playtests</h2>
        {running.length === 0 ? (
          <p className="text-sm text-stone-500 dark:text-stone-400">
            None running. A playtest ends when you end it, or after 15 minutes with no seat open.
          </p>
        ) : (
          <ul className="space-y-3">
            {running.map((p) => (
              <RunningPlaytest
                key={p.roomId}
                playtest={p}
                icon={icons.get(p.gameId) ?? '🎲'}
                onEnded={ended}
              />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function RunningPlaytest({
  playtest,
  icon,
  onEnded,
}: {
  playtest: SavedPlaytest;
  icon: string;
  onEnded: (roomId: string) => void;
}) {
  const toast = useToast();
  const { roomId } = playtest;
  const [status, setStatus] = useState<PlaytestStatus | null>(null);

  // Who is in, refreshed when the admin comes back to this tab.
  useEffect(() => {
    let live = true;
    const load = () =>
      void api<PlaytestStatus>(`/api/admin/playtests/${roomId}`)
        .then((s) => {
          if (live) setStatus(s);
        })
        .catch((err: unknown) => {
          if (live && err instanceof ApiFailure && err.status === 404) onEnded(roomId);
        });
    load();
    window.addEventListener('focus', load);
    return () => {
      live = false;
      window.removeEventListener('focus', load);
    };
  }, [roomId, onEnded]);

  const online = useMemo(
    () => new Set(status?.players.filter((p) => p.connected).map((p) => p.id)),
    [status],
  );

  const end = async () => {
    if (!window.confirm(`End this ${playtest.gameName} playtest? Its seat tabs close the room.`))
      return;
    try {
      await api(`/api/admin/playtests/${roomId}`, { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiFailure && err.status === 404)) {
        toast((err as Error).message);
        return;
      }
    }
    onEnded(roomId);
    toast('Playtest ended.', 'info');
  };

  return (
    <li
      aria-label={`${playtest.gameName} playtest`}
      className="space-y-2 rounded-xl bg-stone-50 p-3 ring-1 ring-stone-200 dark:bg-stone-800/60 dark:ring-stone-700"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          <span aria-hidden>{icon} </span>
          {playtest.gameName}
          <span className="font-normal text-stone-500 dark:text-stone-400">
            {' '}
            · {playtest.seats.length} seats
            {status ? ` · ${status.phase === 'lobby' ? 'in the lobby' : status.phase}` : ''}
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => {
              for (const seat of playtest.seats) openSeat(seatLink(roomId, seat));
            }}
          >
            Open all
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => void end()}
          >
            End
          </Button>
        </div>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Seats">
        {playtest.seats.map((seat) => (
          <li key={seat.playerId}>
            <a
              href={seatLink(roomId, seat)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-amber-800 ring-1 ring-stone-300 hover:bg-amber-50 dark:bg-stone-900 dark:text-amber-300 dark:ring-stone-600 dark:hover:bg-stone-800"
            >
              <span
                aria-hidden
                className={cn(
                  'size-2 rounded-full',
                  online.has(seat.playerId) ? 'bg-emerald-500' : 'bg-stone-400',
                )}
              />
              Open {seat.name}
            </a>
          </li>
        ))}
      </ul>
    </li>
  );
}
