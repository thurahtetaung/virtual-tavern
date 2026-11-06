import type { PlaytestCreated, PlaytestGame, PlaytestStatus } from '@vt/protocol';
import {
  Button,
  Chip,
  Chips,
  FOCUS_RING,
  Icon,
  Input,
  Panel,
  Slate,
  Stepper,
  StickyBar,
  Tag,
  cn,
  useConfirm,
} from '@vt/ui';
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
  all: 'Bots',
  some: 'Some roles',
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
    <div className="space-y-3 lg:space-y-4">
      <Panel className="space-y-4 lg:p-5">
        <div>
          <h2 className="flex items-center gap-2 text-sub font-semibold">
            <Icon name="dice-5" />
            New playtest
          </h2>
          <p className="text-small text-ink-2">
            Play any game alone: each seat opens in its own tab of this browser, as its own player.
            Nothing is recorded in the stats, the night recap or the hall of fame, and nobody else
            can join.
          </p>
        </div>

        {!games ? (
          <Slate kind="loading" title="Loading games…" />
        ) : (
          <div
            role="group"
            aria-label="Game to play-test"
            className="grid grid-cols-2 gap-2 lg:grid-cols-4"
          >
            {games.map((g) => (
              <button
                key={g.id}
                type="button"
                aria-pressed={g.id === gameId}
                onClick={() => pick(g)}
                className={cn(
                  'flex min-h-14 min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-small font-semibold ring-1 transition-colors duration-[120ms]',
                  FOCUS_RING,
                  g.id === gameId
                    ? 'bg-accent-soft ring-3 ring-accent'
                    : 'bg-card ring-line hover:bg-panel',
                )}
              >
                <span
                  aria-hidden
                  className="grid size-11 shrink-0 place-items-center rounded-lg bg-sunk text-2xl"
                >
                  {icons.get(g.id) ?? '🎲'}
                </span>
                <span className="min-w-0">
                  <span className="block truncate" title={g.name}>
                    {g.name}
                  </span>
                  <span className="block text-caption font-normal text-ink-muted">
                    {g.private && (
                      <span aria-label="back room">
                        <Icon name="flame" size={14} className="-mt-0.5 mr-0.5" />
                      </span>
                    )}
                    {g.minPlayers}–{g.maxSeats} seats
                    {g.off && <span className="font-semibold text-warn-ink"> · off</span>}
                  </span>
                  <Tag tone={g.bots === 'none' ? 'neutral' : 'info'}>{BOTS_LABEL[g.bots]}</Tag>
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
              <Stepper
                label="Seats"
                value={seats.length}
                onChange={setSeats}
                min={game.minPlayers}
                max={game.maxSeats}
                fewerLabel="One seat fewer"
                moreLabel="One seat more"
              />
            </div>
            {game.botNote && (
              <p className="text-small text-ink-2">
                <span aria-hidden>🤖 </span>
                {game.botNote}
              </p>
            )}
            <ol className="divide-y divide-line">
              {seats.map((seat, i) => (
                <li key={i} className="flex min-h-12 min-w-0 items-center gap-2 py-1.5">
                  <span className="w-6 text-right text-small text-ink-muted tabular-nums">
                    {i + 1}
                  </span>
                  <Input
                    aria-label={`Seat ${i + 1} name`}
                    value={seat.name}
                    maxLength={24}
                    onChange={(e) => editSeat(i, { name: e.target.value })}
                    className="w-0 flex-1"
                  />
                  {i === 0 ? (
                    <span className="w-[9.5rem] shrink-0 text-center text-caption whitespace-nowrap text-ink-muted">
                      👑 you, host
                    </span>
                  ) : (
                    <Chips
                      label={`Seat ${i + 1}: ${seat.bot ? 'bot' : 'human'}`}
                      className="m-0 shrink-0 gap-1 p-0"
                    >
                      <Chip pressed={!seat.bot} onClick={() => editSeat(i, { bot: false })}>
                        Human
                      </Chip>
                      <Chip
                        pressed={seat.bot}
                        disabled={game.bots === 'none'}
                        onClick={() => editSeat(i, { bot: true })}
                      >
                        Bot
                      </Chip>
                    </Chips>
                  )}
                </li>
              ))}
            </ol>
            <StickyBar>
              <Button
                size="lg"
                className="w-full sm:w-auto"
                sending={starting}
                disabled={starting || seats.some((s) => !s.name.trim())}
                onClick={() => void start()}
              >
                Start playtest
              </Button>
            </StickyBar>
          </div>
        )}
      </Panel>

      <Panel className="space-y-3 lg:p-5">
        <h2 className="text-sub font-semibold">Your playtests</h2>
        {running.length === 0 ? (
          <Slate title="None running. A playtest ends when you end it, or after 15 minutes with no seat open." />
        ) : (
          <ul className="space-y-3">
            {running.map((p) => (
              <RunningPlaytest
                key={p.roomId}
                playtest={p}
                icon={icons.get(p.gameId) ?? '🎲'}
                canAddBots={games?.find((g) => g.id === p.gameId)?.bots !== 'none'}
                maxSeats={games?.find((g) => g.id === p.gameId)?.maxSeats}
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
  maxSeats,
  onEnded,
}: {
  playtest: SavedPlaytest;
  icon: string;
  canAddBots: boolean;
  /** Most seats the game takes, when the game list has loaded. */
  maxSeats: number | undefined;
  onEnded: (roomId: string) => void;
}) {
  const toast = useToast();
  const [confirm, dialog] = useConfirm();
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
    const yes = await confirm({
      title: `End this ${playtest.gameName} playtest?`,
      body: 'Its seat tabs close the room.',
      confirmLabel: 'End',
      danger: true,
    });
    if (!yes) return;
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
      className="space-y-3 rounded-xl bg-card p-4 shadow-vt-1-edge ring-1 ring-line"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 font-semibold">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-sunk text-2xl"
          >
            {icon}
          </span>
          {playtest.gameName}
          <span className="font-normal text-ink-muted">
            {' '}
            · {status?.players.length ?? playtest.seats.length} seats
            {status ? ` · ${status.phase === 'lobby' ? 'in the lobby' : status.phase}` : ''}
          </span>
        </p>
        <div className="flex items-start gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              for (const seat of humans) openSeat(seatLink(roomId, seat));
            }}
          >
            Open all
          </Button>
          <div className="grid justify-items-end gap-1">
            <Button variant="danger" size="sm" onClick={() => void end()}>
              End
            </Button>
            <p className="text-caption text-ink-muted">Its seat tabs close the room.</p>
          </div>
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
              className={cn(
                'inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line-strong bg-card px-3.5 text-small font-semibold text-accent-text hover:bg-accent-soft',
                FOCUS_RING,
              )}
            >
              Open {seat.name}
            </a>
            {status && !online.has(seat.playerId) && <Tag>offline</Tag>}
          </li>
        ))}
        {bots.map((b) => (
          <li
            key={b.id}
            className="inline-flex min-h-11 items-center gap-1 rounded-full bg-info-soft pr-0 pl-3.5 text-small font-semibold text-info-ink ring-1 ring-info-line"
          >
            <span aria-hidden>🤖</span> {b.name}
            {lobby && (
              <button
                type="button"
                aria-label={`Remove bot ${b.name}`}
                className={cn(
                  'grid size-11 place-items-center rounded-full hover:bg-card',
                  FOCUS_RING,
                )}
                onClick={() => void patch({ removeBot: b.id })}
              >
                <Icon name="x" />
              </button>
            )}
          </li>
        ))}
        {lobby && canAddBots && (maxSeats === undefined || status.players.length < maxSeats) && (
          <li>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full"
              onClick={() => void patch({ addBot: nextBotName() })}
            >
              <Icon name="plus" />
              Bot
            </Button>
          </li>
        )}
      </ul>
      {dialog}
    </li>
  );
}
