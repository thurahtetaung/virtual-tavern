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
import { BotControls } from './BotControls.tsx';

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

interface SeatDraft {
  name: string;
  bot: boolean;
}

/**
 * `n` seats, keeping the ones already set up. New seats are bots where the game has them; seat 1
 * is always you, the host.
 */
const seatDrafts = (n: number, game: PlaytestGame, from: readonly SeatDraft[] = []) =>
  Array.from(
    { length: n },
    (_, i): SeatDraft =>
      from[i] ?? {
        name: SEAT_NAMES[i] ?? `Seat ${i + 1}`,
        bot: i > 0 && game.bots !== 'none',
      },
  ).map((s, i) => (i === 0 ? { ...s, bot: false } : s));

const BOTS_LABEL: Record<PlaytestGame['bots'], string> = {
  all: '🤖 Bots',
  some: '🤖 Some roles',
  none: 'No bots yet',
};

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
  const [seats, setSeatList] = useState<SeatDraft[]>([]);
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
    setSeatList((prev) =>
      seatDrafts(
        g.minPlayers,
        g,
        prev.map((s) => ({ ...s, bot: s.bot && g.bots !== 'none' })),
      ),
    );
  };
  const setSeats = (n: number) => {
    if (game) setSeatList((prev) => seatDrafts(n, game, prev));
  };
  const editSeat = (i: number, patch: Partial<SeatDraft>) =>
    setSeatList((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const start = async () => {
    if (!game) return;
    setStarting(true);
    try {
      const made = await api<PlaytestCreated>('/api/admin/playtests', {
        method: 'POST',
        body: {
          gameId: game.id,
          seats: seats.map((s) => ({ name: s.name.trim(), bot: s.bot })),
        },
      });
      setRunning(savePlaytest({ ...made, gameName: game.name, startedAt: Date.now() }));
      // Your own seat (the host) opens straight away; the others are a click each below.
      const first = made.seats[0];
      if (first?.token) openSeat(seatLink(made.roomId, { name: first.name, token: first.token }));
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
          <p className="text-sm text-ink-muted">Loading games…</p>
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
                    ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/15'
                    : 'bg-white ring-stone-200 hover:bg-stone-50 dark:bg-stone-800 dark:ring-stone-700 dark:hover:bg-stone-700/70',
                )}
              >
                <span aria-hidden className="text-2xl">
                  {icons.get(g.id) ?? '🎲'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate">{g.name}</span>
                  <span className="block text-xs font-normal text-ink-muted">
                    {g.private && <span aria-label="back room">🕯️ </span>}
                    {g.minPlayers}–{g.maxSeats} seats
                  </span>
                  <span
                    className={cn(
                      'mt-0.5 inline-block rounded-full px-1.5 text-[11px] font-semibold',
                      g.bots === 'none'
                        ? 'bg-stone-200 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
                        : 'bg-info-soft text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
                    )}
                  >
                    {BOTS_LABEL[g.bots]}
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
                  disabled={seats.length <= game.minPlayers}
                  onClick={() => setSeats(seats.length - 1)}
                >
                  −
                </Button>
                <span className="w-8 text-center text-lg font-bold tabular-nums" aria-live="polite">
                  {seats.length}
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  className="size-11 text-lg"
                  aria-label="One seat more"
                  disabled={seats.length >= game.maxSeats}
                  onClick={() => setSeats(seats.length + 1)}
                >
                  +
                </Button>
              </div>
            </div>
            {game.botNote && (
              <p className="text-sm text-stone-600 dark:text-stone-400">
                <span aria-hidden>🤖 </span>
                {game.botNote}
              </p>
            )}
            <ol className="grid gap-2 sm:grid-cols-2">
              {seats.map((seat, i) => (
                <li key={i} className="flex min-w-0 items-center gap-2">
                  <span className="w-6 text-right text-sm text-ink-muted tabular-nums">
                    {i + 1}
                  </span>
                  <input
                    aria-label={`Seat ${i + 1} name`}
                    value={seat.name}
                    maxLength={24}
                    onChange={(e) => editSeat(i, { name: e.target.value })}
                    className="h-11 w-0 min-w-0 flex-1 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
                  />
                  {i === 0 ? (
                    <span className="w-22 shrink-0 text-center text-xs whitespace-nowrap text-ink-muted">
                      👑 you, host
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Seat ${i + 1}: ${seat.bot ? 'bot' : 'human'}`}
                      aria-pressed={seat.bot}
                      disabled={game.bots === 'none'}
                      onClick={() => editSeat(i, { bot: !seat.bot })}
                      className={cn(
                        'h-11 w-22 shrink-0 rounded-lg text-sm font-semibold ring-1 disabled:opacity-50',
                        seat.bot
                          ? 'bg-info-soft text-sky-900 ring-info-line dark:bg-sky-500/20 dark:text-sky-100 dark:ring-sky-500/40'
                          : 'bg-white text-stone-700 ring-stone-300 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-600',
                      )}
                    >
                      {seat.bot ? '🤖 Bot' : '🧑 Human'}
                    </button>
                  )}
                </li>
              ))}
            </ol>
            <Button
              size="lg"
              className="w-full sm:w-auto"
              disabled={starting || seats.some((s) => !s.name.trim())}
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
          <p className="text-sm text-ink-muted">
            None running. A playtest ends when you end it, or after 15 minutes with no seat open.
          </p>
        ) : (
          <ul className="space-y-3">
            {running.map((p) => (
              <RunningPlaytest
                key={p.roomId}
                playtest={p}
                icon={icons.get(p.gameId) ?? '🎲'}
                canAddBots={games?.find((g) => g.id === p.gameId)?.bots !== 'none'}
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
  canAddBots,
  onEnded,
}: {
  playtest: SavedPlaytest;
  icon: string;
  canAddBots: boolean;
  onEnded: (roomId: string) => void;
}) {
  const toast = useToast();
  const { roomId } = playtest;
  const [status, setStatus] = useState<PlaytestStatus | null>(null);
  // Only the human seats have links; bots play on the server.
  const humans = playtest.seats.flatMap((s) => (s.token ? [{ ...s, token: s.token }] : []));
  const bots = status?.players.filter((p) => p.bot) ?? [];
  const lobby = status?.phase === 'lobby';
  const patch = async (body: { addBot?: string; removeBot?: string }) => {
    try {
      setStatus(
        await api<PlaytestStatus>(`/api/admin/playtests/${roomId}`, { method: 'PATCH', body }),
      );
    } catch (err) {
      toast((err as Error).message);
    }
  };
  const nextBotName = () => {
    const taken = new Set(status?.players.map((p) => p.name.toLowerCase()));
    return SEAT_NAMES.find((n) => !taken.has(n.toLowerCase())) ?? `Bot ${bots.length + 1}`;
  };

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
          <span className="font-normal text-ink-muted">
            {' '}
            · {status?.players.length ?? playtest.seats.length} seats
            {status ? ` · ${status.phase === 'lobby' ? 'in the lobby' : status.phase}` : ''}
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => {
              for (const seat of humans) openSeat(seatLink(roomId, seat));
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
      {status && status.playtest.bots > 0 && (
        <BotControls roomId={roomId} playtest={status.playtest} onChange={setStatus} />
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Seats">
        {humans.map((seat) => (
          <li key={seat.playerId} className="flex items-center gap-1">
            <a
              href={seatLink(roomId, seat)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-semibold text-amber-800 ring-1 ring-stone-300 hover:bg-accent-soft dark:bg-stone-900 dark:text-amber-300 dark:ring-stone-600 dark:hover:bg-stone-800"
            >
              Open {seat.name}
            </a>
            {status && !online.has(seat.playerId) && (
              <span className="rounded-full bg-stone-200 px-1.5 text-[11px] font-medium text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                offline
              </span>
            )}
          </li>
        ))}
        {bots.map((b) => (
          <li
            key={b.id}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-info-soft pr-1 pl-3 text-sm font-semibold text-sky-900 ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
          >
            <span aria-hidden>🤖</span> {b.name}
            {lobby && (
              <button
                type="button"
                aria-label={`Remove bot ${b.name}`}
                className="ml-1 size-9 rounded-full hover:bg-info-soft dark:hover:bg-sky-500/20"
                onClick={() => void patch({ removeBot: b.id })}
              >
                ✕
              </button>
            )}
          </li>
        ))}
        {lobby && canAddBots && (
          <li>
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11 rounded-full"
              onClick={() => void patch({ addBot: nextBotName() })}
            >
              ＋ Bot
            </Button>
          </li>
        )}
      </ul>
    </li>
  );
}
