import {
  type ActOptions,
  type AbandonGame,
  type SpectatorPrompt,
  type Superlative,
  type WordListSummary,
  setStorageSeat,
} from '@vt/game-sdk';
import type { Ack, LockReason, PlayerColor, RecapTone, RoomInfo, RoomSnapshot } from '@vt/protocol';
import {
  Badge,
  Button,
  Modal,
  Panel,
  BotNames,
  PlayerColors,
  PlayerDot,
  RefusalProvider,
  SuperlativesNote,
  clock,
  cn,
  useConfirm,
  useRefusals,
  useSecondsLeft,
} from '@vt/ui';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ColorChoice } from '../components/ColorChoice.tsx';
import { Drawer } from '../components/Drawer.tsx';
import { GuideIntro } from '../components/GuideIntro.tsx';
import { GameGuideView, type GuideFocus } from '../components/GuideView.tsx';
import { Layout, LoadingStep, PageLoading } from '../components/Layout.tsx';
import { NameForm } from '../components/NameForm.tsx';
import { PlaytestBar } from '../components/PlaytestBar.tsx';
import {
  type ClientGame,
  findGame,
  loadGame,
  roomGame,
  usePrivateGames,
} from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { retryOnce } from '../lib/retry.ts';
import { offlineFor } from '../lib/presence.ts';
import { forgetLastRoom, saveLastRoom, saveName, savedName } from '../lib/identity.ts';
import { type Seat, adoptSeat, clearSeat, confirmSeat, seatFor } from '../lib/seat.ts';
import { useToast } from '../lib/toast.tsx';
import { roomTitle, usePageTitle } from '../lib/title.ts';
import { useRoom } from '../lib/useRoom.ts';
import { type CardContext, RecapSheet, recapHeading } from '../recap/RecapSheet.tsx';
import { resolveText } from '../recap/resolve.ts';
import { NextTableBanner, SameCrewPicker } from '../recap/SameCrew.tsx';
import { useRecap } from '../recap/useRecap.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import { fetchWordLists, noteVersions } from '../lib/games.ts';

type RoomLookup =
  | { kind: 'loading' }
  /** `seat`: this tab's playtest seat (only ever set in a playtest room). */
  | { kind: 'found'; room: RoomInfo; seat: Seat | null }
  | { kind: 'missing' }
  /** The server answered with an error, or didn't answer at all. */
  | { kind: 'failed'; message: string };

export function RoomPage() {
  const { roomId = '' } = useParams();
  // A fresh page per room: "Same crew, new game" moves straight from one room to the next.
  return <RoomLookupPage key={roomId} roomId={roomId} />;
}

/** How long the room lookup may take before it is tried again (then the error screen). */
const LOOKUP_TIMEOUT_MS = 10_000;
/** When loading a game's code says it's still at it (and offers a reload). */
const CODE_SLOW_MS = 12_000;

function RoomLookupPage({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<RoomLookup>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [game, setGame] = useState<ClientGame | null | 'missing'>(null);
  // A playtest seat link's fragment is taken off the address bar at once (see `seat.ts`).
  const [seatLink] = useState(() => {
    adoptSeat(roomId);
    return seatFor(roomId) !== null;
  });
  const [savedAs, setName] = useState<string | null>(() => savedName() || null);
  const seat = lookup.kind === 'found' ? lookup.seat : null;
  // A seat tab plays under the seat's name and never asks for one.
  const name = seat?.name ?? savedAs;
  // The socket opens alongside the lookup, and the join goes out once the name is known. A seat
  // link waits for the lookup: only a playtest honours its seat.
  const conn = useRoom(roomId, name, seat?.token, !seatLink || lookup.kind === 'found');
  // Inside the room, the room names the tab itself (and marks "Your turn").
  usePageTitle(
    lookup.kind === 'failed'
      ? "Couldn't open the room"
      : !name && !seatLink && game !== 'missing'
        ? `Join ${game?.name ?? 'a game'}`
        : null,
  );

  // A game this app doesn't have: hang up rather than sit in the room the socket may have joined.
  const { close } = conn;
  useEffect(() => {
    if (game === 'missing') close();
  }, [game, close]);

  useEffect(() => {
    let stale = false;
    // A lookup that gets no answer (or no connection) is tried once more before the error screen;
    // the server's own answers (no such room, the back room's door) are final.
    retryOnce(
      () => api<RoomInfo>(`/api/rooms/${roomId}`, { timeoutMs: LOOKUP_TIMEOUT_MS }),
      (err) => !(err instanceof ApiFailure),
    )
      .then(async (room) => {
        if (stale) return;
        noteVersions(room.versions);
        // Only a playtest honours a seat; anywhere else a stored one is wiped.
        setLookup({ kind: 'found', room, seat: confirmSeat(roomId, room.playtest === true) });
        const found = await loadGame(room.gameId);
        // The game's code loads while the socket joins, and the room shows once it's in (a failed
        // load is left to the room, as before).
        const [named] = found
          ? await Promise.all([
              roomGame(found, room.title),
              found.Component.preload().catch(() => {}),
            ])
          : [];
        if (stale) return;
        setGame(named ?? 'missing');
      })
      .catch((err: unknown) => {
        if (stale) return;
        // A back-room game: knock first, then come straight back here.
        if (err instanceof ApiFailure && err.code === 'backroom-locked') {
          void navigate(`/backroom?next=${encodeURIComponent(`/r/${roomId}`)}`, { replace: true });
        } else if (err instanceof ApiFailure && err.status === 404) {
          forgetLastRoom(roomId);
          clearSeat(roomId);
          setLookup({ kind: 'missing' });
        } else {
          setLookup({
            kind: 'failed',
            message:
              err instanceof ApiFailure
                ? err.message
                : "We couldn't reach the tavern. Check your connection and try again.",
          });
        }
      });
    return () => {
      stale = true;
    };
  }, [roomId, navigate, attempt]);

  if (lookup.kind === 'missing')
    return (
      <NotFoundPage
        heading="No such room"
        message="This room does not exist or has expired. Ask for a new link!"
      />
    );
  if (lookup.kind === 'failed') {
    return (
      <Layout>
        <Panel className="mx-auto mt-10 max-w-md space-y-4 text-center">
          <p className="text-5xl" aria-hidden>
            🫗
          </p>
          <h1 className="text-2xl font-bold">Couldn't open the room</h1>
          <p className="text-stone-600 dark:text-stone-400">{lookup.message}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              size="lg"
              onClick={() => {
                setLookup({ kind: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
            <Link
              to="/"
              className="inline-flex h-12 items-center rounded-lg px-4 font-semibold text-amber-700 hover:bg-accent-soft dark:text-amber-400 dark:hover:bg-stone-800"
            >
              Back to the tavern
            </Link>
          </div>
        </Panel>
      </Layout>
    );
  }
  if (game === 'missing')
    return <NotFoundPage message="This room is for a game we don't have any more." />;

  if (!name) {
    // A seat tab waits for the room (and its seat) instead of asking for a name.
    if (seatLink && lookup.kind === 'loading')
      return <PageLoading wide label="Finding your room…" />;
    return (
      <Layout>
        <Panel className="mx-auto mt-10 max-w-md space-y-4 text-center">
          <p className="text-5xl" aria-hidden>
            {game?.icon ?? '🍺'}
          </p>
          <h1 className="text-2xl font-bold">
            You're invited{game ? ` to play ${game.name}` : ''}!
          </h1>
          <p className="text-stone-600 dark:text-stone-400">
            Pick a name so your friends know who you are.
          </p>
          <NameForm
            submitLabel="Join"
            onSubmit={(n) => {
              saveName(n);
              setName(n);
            }}
          />
        </Panel>
      </Layout>
    );
  }

  if (lookup.kind === 'loading') return <PageLoading wide label="Finding your room…" />;
  if (!game)
    return (
      <PageLoading
        wide
        label="Setting up the table…"
        slowLabel="Still setting up the table…"
        slowAfterMs={CODE_SLOW_MS}
      />
    );
  return (
    <RefusalProvider>
      <Room
        roomId={roomId}
        game={game}
        name={name}
        onRename={setName}
        conn={conn}
        playtest={lookup.kind === 'found' && lookup.room.playtest === true}
        wordListsVersion={lookup.kind === 'found' ? lookup.room.versions?.wordLists : undefined}
      />
    </RefusalProvider>
  );
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
const listNames = (names: string[]) =>
  names.length <= 1
    ? (names[0] ?? '')
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** How long arrivals and departures are collected before one toast reports them. */
const PRESENCE_TOAST_DELAY_MS = 1500;

function Room({
  roomId,
  game,
  name,
  onRename,
  conn,
  playtest,
  wordListsVersion,
}: {
  roomId: string;
  game: ClientGame;
  name: string;
  onRename: (n: string) => void;
  /** The live connection, opened by the page while it looked the room up. */
  conn: ReturnType<typeof useRoom>;
  /** An admin playtest room: nothing is recorded, and nobody can be invited. */
  playtest: boolean;
  /** The word lists' version from the room lookup, so the first load may come from the cache. */
  wordListsVersion: string | undefined;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const refusals = useRefusals();
  const [confirm, confirmDialog] = useConfirm();
  const {
    snapshot,
    clockOffset,
    status,
    catchingUp,
    lockReason,
    error,
    call,
    leave,
    wraps,
    next,
    dismissNext,
    playtestAwards,
  } = conn;
  // A playtest seat keeps its own marks, notes and tips (set before the game reads them).
  setStorageSeat(playtest ? (snapshot?.you ?? null) : null);
  useEffect(() => {
    return () => {
      setStorageSeat(null);
    };
  }, []);
  /** The admin session ran out mid-playtest: the seat can't play until they sign in again. */
  const [adminLost, setAdminLost] = useState(false);
  const [spectator, setSpectator] = useState<SpectatorPrompt | null>(null);
  // The game under way, as the host may abandon it (the game says when there is one).
  const [abandon, setAbandon] = useState<AbandonGame | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideFocus, setGuideFocus] = useState<GuideFocus>();
  // Each opening starts afresh on Learn (or at the card a game asked for).
  const [guideOpens, setGuideOpens] = useState(0);
  // A game may name a role to open at (a click handler passes its event, which isn't one).
  const showGuide = useCallback((topic?: unknown) => {
    setGuideFocus(typeof topic === 'string' ? { topic, n: Date.now() } : undefined);
    setGuideOpens((n) => n + 1);
    setGuideOpen(true);
  }, []);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const night = useRecap({ call, snapshot, game, wraps });
  const [sameCrewOpen, setSameCrewOpen] = useState(false);
  // Games on the card: this room's, a linked table's (public, or named by the server).
  const nightGameNames = night.recap?.games;
  // Back-room games keep their own emoji on the card, for a browser that has the back room.
  const privateGames = usePrivateGames(recapOpen || wraps > 0);
  const cardCtx = useMemo((): CardContext => {
    const gameInfo = (id: string) => {
      if (id === game.id) return game;
      const known = findGame(id) ?? privateGames.find((g) => g.id === id);
      // The server names each game (a back-room game by its title, where one is set).
      const name = nightGameNames?.find((g) => g.gameId === id)?.name ?? known?.name ?? 'A game';
      return { name, icon: known?.icon ?? '🎲' };
    };
    return { gameInfo, names: night.names, labels: night.labels };
  }, [game, nightGameNames, privateGames, night.names, night.labels]);

  // The host wrapped up the night: the recap opens on every device (anyone can close it).
  const [wrapsSeen, setWrapsSeen] = useState(0);
  const recapShown = recapOpen || wraps > wrapsSeen;
  const closeRecap = () => {
    setRecapOpen(false);
    setWrapsSeen(wraps);
  };
  const { opened: recapOpened, closed: recapClosed } = night;
  useEffect(() => {
    if (recapShown) recapOpened();
    else recapClosed();
  }, [recapShown, recapOpened, recapClosed]);
  const [wordLists, setWordLists] = useState<WordListSummary[]>([]);

  // Only the lists tagged for this game; the server enforces the same filter on play. The first
  // load asks for the version the room lookup named (kept by the browser); coming back to the
  // tab revalidates, so an admin's edit made meanwhile shows.
  useEffect(() => {
    const load = (version?: string) =>
      void fetchWordLists(game.id, version)
        .then(setWordLists)
        .catch(() => {});
    const reload = () => load();
    load(wordListsVersion);
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [game.id, wordListsVersion]);

  // The game reports when it's the viewer's move; the tab title says so, and phones buzz once.
  const [yourMove, setYourMove] = useState(false);
  const wasYourMove = useRef(false);
  // In a playtest the seat's name goes in too, so the tab strip shows whose move it is.
  const seatName = playtest ? snapshot?.players.find((p) => p.id === snapshot.you)?.name : null;
  useEffect(() => {
    document.title = roomTitle(seatName ? `${seatName} · ${game.name}` : game.name, yourMove);
    if (yourMove && !wasYourMove.current && 'vibrate' in navigator) navigator.vibrate(50);
    wasYourMove.current = yourMove;
  }, [game.name, yourMove, seatName]);
  useEffect(() => {
    return () => {
      document.title = 'Virtual Tavern';
    };
  }, []);

  // Remember this room for "Rejoin your last room" on the landing page.
  const backroomGame = isBackroomGame(game);
  // Not a playtest: it is no room to come back to.
  useEffect(() => {
    if (playtest) {
      if (status === 'kicked' || status === 'left' || status === 'closed') clearSeat(roomId);
      return;
    }
    if (status === 'joined') {
      saveLastRoom({ id: roomId, game: game.name, ...(backroomGame && { private: true }) });
    }
    if (status === 'kicked' || status === 'left') forgetLastRoom(roomId);
  }, [status, roomId, game.name, backroomGame, playtest]);

  const act = useCallback(
    async (action: unknown, options?: ActOptions) => {
      const res = await call('game:action', action);
      if (res.ok) refusals.clearAll();
      else if (res.error.code === 'backroom-locked') {
        // The password changed or the admin signed out mid-game: send the player back to the
        // door. In a playtest it was the admin session that ran out.
        if (playtest) setAdminLost(true);
        else void navigate(backToTheDoor(roomId, res.error.reason ?? 'none'));
      } else if (!refusals.show(options?.anchor, res.error.message)) {
        // No spot next to the control that sent it (or none on screen): say it up top.
        toast(refusals.format(res.error.message));
      }
      return res.ok;
    },
    [call, toast, navigate, roomId, refusals, playtest],
  );

  useEffect(() => {
    if (status === 'locked' && !playtest) void navigate(backToTheDoor(roomId, lockReason));
  }, [status, lockReason, navigate, roomId, playtest]);

  const isHost = snapshot !== null && snapshot.hostId === snapshot.you;

  const tz = () => new Date().getTimezoneOffset();
  const wrapUp = async () => {
    const yes = await confirm({
      title: 'Wrap up the night?',
      body: 'Everyone sees the night recap.',
      confirmLabel: 'Wrap up',
    });
    if (!yes) return;
    const res = await call('room:wrap', tz());
    if (!res.ok) toast(res.error.message);
  };
  const setTone = async (tone: RecapTone) => {
    const res = await call('room:recap-tone', tone, tz());
    if (!res.ok) toast(res.error.message);
  };
  const nightGames = night.recap?.games.length ?? 0;
  const canWrap =
    isHost &&
    night.enabled &&
    snapshot?.meta?.phase !== 'playing' &&
    night.recap?.status === 'live' &&
    nightGames > 0 &&
    !night.recap.running;
  const canSameCrew =
    isHost &&
    night.enabled &&
    snapshot?.meta?.phase !== 'playing' &&
    nightGames > 0 &&
    !!night.recap?.nightKey;

  // Tell everyone who hosts now when the role moves (the host went away, left or handed it over).
  const lastHost = useRef<string | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    const before = lastHost.current;
    lastHost.current = snapshot.hostId;
    if (before === null || before === snapshot.hostId) return;
    if (isHost) toast("You're the host now", 'info');
    else {
      const host = snapshot.players.find((p) => p.id === snapshot.hostId);
      if (host) toast(`${host.name} is the host now`, 'info');
    }
  }, [snapshot, isHost, toast]);

  // Someone in the room already had this name, so the server numbered it ("Kim 2"). Say so once.
  const myName = snapshot?.players.find((p) => p.id === snapshot.you)?.name;
  const toldName = useRef<string | null>(null);
  useEffect(() => {
    if (!myName || myName === name || toldName.current === myName) return;
    toldName.current = myName;
    toast(`Someone here is already called ${name}, so you're ${myName} in this room.`, 'info');
  }, [myName, name, toast]);

  // Arrivals and departures, collected briefly so a group joining at once makes one toast. Only in
  // the lobby: during a game the Players count shows them, and a toast would cover the board.
  const knownPlayers = useRef<Map<string, string> | null>(null);
  const presence = useRef<{ joined: string[]; left: string[]; timer: number | null }>({
    joined: [],
    left: [],
    timer: null,
  });
  useEffect(() => {
    if (!snapshot) return;
    const now = new Map(snapshot.players.map((p) => [p.id, p.name]));
    const before = knownPlayers.current;
    knownPlayers.current = now;
    if (!before) return; // The first snapshot: everyone already here is not "joining".
    if (snapshot.meta && snapshot.meta.phase !== 'lobby') return;
    const p = presence.current;
    for (const [id, playerName] of now)
      if (!before.has(id) && id !== snapshot.you) p.joined.push(playerName);
    for (const [id, playerName] of before)
      if (!now.has(id) && id !== snapshot.you) p.left.push(playerName);
    if (p.timer !== null || p.joined.length + p.left.length === 0) return;
    p.timer = window.setTimeout(() => {
      const parts = [];
      if (p.joined.length) parts.push(`${listNames(p.joined)} joined`);
      if (p.left.length) parts.push(`${listNames(p.left)} left`);
      presence.current = { joined: [], left: [], timer: null };
      toast(parts.join(' · '), 'info');
    }, PRESENCE_TOAST_DELAY_MS);
  }, [snapshot, toast]);
  useEffect(() => {
    const p = presence.current;
    return () => {
      if (p.timer !== null) clearTimeout(p.timer);
    };
  }, []);

  // A playtest's award strip is worked out in memory for its end screen, and never saved.
  const { names: nightNames, labels: nightLabels } = night;
  const previewLines = useMemo((): Superlative[] | undefined => {
    if (!playtest || snapshot?.meta?.phase !== 'over' || !playtestAwards?.length) return undefined;
    return playtestAwards.map((l) => ({
      emoji: l.emoji,
      title: l.title,
      text: resolveText(l.text, nightNames, nightLabels),
    }));
  }, [playtest, snapshot?.meta?.phase, playtestAwards, nightNames, nightLabels]);
  const superlatives = playtest ? previewLines : night.superlatives;
  // Playtest bots get a 🤖 in every player list (names are unique in a room).
  const botKey = snapshot?.players
    .filter((p) => p.bot)
    .map((p) => p.name)
    .join('\n');
  const botNames = useMemo(() => new Set(botKey ? botKey.split('\n') : []), [botKey]);
  // Every player list shows each player's colour (names are unique in a room).
  const colorKey = snapshot?.players.map((p) => `${p.color} ${p.name}`).join('\n');
  const playerColors = useMemo(
    () =>
      new Map(
        (colorKey ? colorKey.split('\n') : []).map((line) => {
          const at = line.indexOf(' ');
          return [line.slice(at + 1), line.slice(0, at) as PlayerColor] as const;
        }),
      ),
    [colorKey],
  );
  const [colorOpen, setColorOpen] = useState(false);
  const recolor = useCallback((color: PlayerColor) => call('room:recolor', color), [call]);
  const openColor = useCallback(() => setColorOpen(true), []);

  // Where "back" goes: back-room players return to the back room, not the public tavern.
  const home = playtest
    ? { backTo: '/tavern-keeper/playtest', backLabel: 'Back to Playtest' }
    : backroomGame
      ? { backTo: '/backroom', backLabel: 'Back to the back room' }
      : {};
  if (status === 'closed') {
    return (
      <NotFoundPage
        heading="This playtest has ended"
        icon="🧪"
        message="The room is gone, and nothing it did was recorded."
        {...home}
      />
    );
  }
  if (playtest && (status === 'locked' || adminLost)) {
    return (
      <NotFoundPage
        heading="Sign in to keep playing"
        icon="🔑"
        message="Playtests are for the tavern keeper. Sign in again, then reopen this seat."
        backTo="/tavern-keeper"
        backLabel="Sign in"
      />
    );
  }
  if (status === 'kicked') {
    return (
      <NotFoundPage
        heading="You were removed"
        icon="🚪"
        message="The host removed you from this room."
        {...home}
      />
    );
  }
  if (status === 'left') {
    return (
      <NotFoundPage
        heading="You left the room"
        icon="👋"
        message="See you next time! The same link brings you back."
        {...home}
      />
    );
  }
  if (status === 'error') {
    return (
      <NotFoundPage
        heading="Couldn't join"
        icon="🪑"
        message={error ?? 'Could not join this room.'}
        {...home}
      />
    );
  }

  const Game = game.Component;
  const online = snapshot ? snapshot.players.filter((p) => p.connected).length : 0;

  return (
    <Layout wide>
      {/* One compact row: on phones each button is an icon over a one-word label. On phones a long
          title gets its own line, and buttons that leave a title too little room wrap below it. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-4">
        <h1
          className={cn(
            'line-clamp-2 min-w-0 flex-[1_1_9.5rem] text-xl leading-tight font-bold [overflow-wrap:anywhere] sm:text-2xl',
            game.name.length > 16 && 'max-sm:basis-full',
          )}
        >
          <span aria-hidden>{game.icon}</span> {game.name}
        </h1>
        <div className="ml-auto flex shrink-0 gap-1.5 sm:gap-2">
          {/* Nobody can be invited to a playtest: it is the admin's alone. */}
          {!playtest && <InviteButton />}
          <Button
            variant="secondary"
            size="sm"
            className={HEADER_BUTTON}
            aria-label={`Players (${online} online)`}
            onClick={() => setPeopleOpen(true)}
          >
            <span aria-hidden>
              👥{snapshot ? <span className="sm:hidden"> {online}</span> : null}
            </span>
            <span className={HEADER_LABEL}>Players</span>
            {snapshot ? <span className="-ml-1 hidden sm:inline">{online}</span> : null}
          </Button>
          {night.enabled && nightGames > 0 && (
            <Button
              variant="secondary"
              size="sm"
              className={HEADER_BUTTON}
              aria-label={`Night recap (${nightGames} ${nightGames === 1 ? 'game' : 'games'})`}
              onClick={() => setRecapOpen(true)}
            >
              <span aria-hidden>🍻 {nightGames}</span>
              <span className={HEADER_LABEL}>Night</span>
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            className={HEADER_BUTTON}
            aria-label="Rules"
            onClick={() => showGuide()}
          >
            <span aria-hidden>❓</span>
            <span className={HEADER_LABEL}>Rules</span>
          </Button>
        </div>
      </div>

      {playtest && snapshot && <PlaytestBar roomId={roomId} snapshot={snapshot} />}

      {(status === 'reconnecting' || (catchingUp && status === 'joined')) && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-accent-soft dark:bg-amber-200 px-4 py-2 text-center text-sm font-semibold text-amber-950"
        >
          {snapshot ? 'Connection lost. Reconnecting…' : "Can't reach the tavern. Retrying…"}
        </p>
      )}

      {snapshot && next && (
        <NextTableBanner
          next={next}
          who={snapshot.players.find((p) => p.id === next.by)?.name ?? 'Someone'}
          onDismiss={dismissNext}
        />
      )}
      {snapshot && <HostAway snapshot={snapshot} clockOffset={clockOffset} />}
      {snapshot && spectator && <SpectatorBanner prompt={spectator} />}

      {!snapshot ? (
        <LoadingStep label="Opening the door…" />
      ) : (
        <Suspense
          fallback={
            <LoadingStep
              label="Setting up the table…"
              slowLabel="Still setting up the table…"
              slowAfterMs={CODE_SLOW_MS}
            />
          }
        >
          {snapshot.meta?.phase === 'lobby' && !playtest && (
            <GuideIntro game={game} onRules={() => showGuide()} />
          )}
          <BotNames.Provider value={botNames}>
            <PlayerColors.Provider value={playerColors}>
              <SuperlativesNote.Provider value={playtest ? '🧪 Playtest preview: not saved' : null}>
                <Game
                  view={snapshot.game}
                  room={{
                    you: snapshot.you,
                    hostId: snapshot.hostId,
                    isHost,
                    players: snapshot.players,
                    clockOffset,
                    wordLists,
                    gameName: game.name,
                    ...(superlatives && { superlatives }),
                  }}
                  act={act}
                  showGuide={showGuide}
                  setYourMove={setYourMove}
                  setSpectator={setSpectator}
                  setAbandon={setAbandon}
                  pickColor={openColor}
                />
              </SuperlativesNote.Provider>
            </PlayerColors.Provider>
          </BotNames.Provider>
        </Suspense>
      )}

      {(canWrap || canSameCrew) && snapshot?.meta?.phase === 'over' && (
        // Room below on phones, so a game's fixed bottom tabs never cover it.
        <div className="mt-3 mb-20 flex scroll-mb-24 flex-wrap justify-center gap-2 lg:mb-0">
          {canWrap && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => void wrapUp()}
            >
              🍻 Wrap up the night
            </Button>
          )}
          {canSameCrew && (
            <Button
              variant="secondary"
              size="sm"
              className="min-h-11"
              onClick={() => setSameCrewOpen(true)}
            >
              🎲 Same crew, new game
            </Button>
          )}
        </div>
      )}

      <Drawer open={recapShown} onClose={closeRecap} title={`🍻 ${recapHeading(night.recap)}`}>
        <RecapSheet
          open={recapShown}
          recap={night.recap}
          ctx={cardCtx}
          isHost={isHost}
          onTone={(t) => void setTone(t)}
          onWrap={() => void wrapUp()}
          onShared={(how) => void call('room:recap-shared', how)}
          {...(canSameCrew && { onSameCrew: () => setSameCrewOpen(true) })}
          hall={night.hall}
          pastNight={night.pastNight}
        />
      </Drawer>
      {night.recap?.nightKey && (
        <SameCrewPicker
          open={sameCrewOpen}
          onClose={() => setSameCrewOpen(false)}
          nightKey={night.recap.nightKey}
        />
      )}

      <Drawer
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title={`How to play ${game.name}`}
      >
        {/* Only while open: a closed <dialog> must not hold the viewer's room context. */}
        {guideOpen && (
          <GameGuideView
            key={guideOpens}
            game={game}
            compact
            {...(snapshot && { room: { view: snapshot.game, you: snapshot.you } })}
            {...(guideFocus && { focus: guideFocus })}
            done={
              <Button size="sm" className="min-h-11" onClick={() => setGuideOpen(false)}>
                Back to the game
              </Button>
            }
          />
        )}
        <Link
          to={`/rules/${game.id}`}
          target="_blank"
          className="mt-6 block text-sm text-amber-700 underline dark:text-amber-400"
        >
          Open the rules in a new tab
        </Link>
      </Drawer>

      <Modal open={colorOpen} onClose={() => setColorOpen(false)} title="Your colour" size="sm">
        {snapshot && colorOpen && (
          <ColorChoice
            snapshot={snapshot}
            recolor={recolor}
            heading={false}
            onDone={() => setColorOpen(false)}
          />
        )}
      </Modal>

      <Drawer open={peopleOpen} onClose={() => setPeopleOpen(false)} title="Players">
        {snapshot && (
          <People
            roomId={roomId}
            snapshot={snapshot}
            clockOffset={clockOffset}
            isHost={isHost}
            call={call}
            recolor={recolor}
            playtest={playtest}
            onWrap={canWrap ? () => void wrapUp() : undefined}
            onAbandon={
              isHost && abandon
                ? () => {
                    setPeopleOpen(false);
                    abandon.run();
                  }
                : undefined
            }
            onRename={(n) => {
              saveName(n);
              onRename(n);
            }}
            onLeave={async () => {
              const yes = await confirm({
                title: 'Leave this room?',
                body: 'You can come back with the same link.',
                confirmLabel: 'Leave',
              });
              if (!yes) return;
              await leave();
              // Done here as well as in the status effect: the navigation unmounts the room in
              // the same render as the 'left' status, so that effect may never run.
              if (playtest) clearSeat(roomId);
              else forgetLastRoom(roomId);
              toast('You left the room.', 'info');
              void navigate(
                playtest ? '/tavern-keeper/playtest' : backroomGame ? '/backroom' : '/',
              );
            }}
          />
        )}
      </Drawer>
      {confirmDialog}
    </Layout>
  );
}

/** Back-room games are the ones the public registry doesn't know. */
const isBackroomGame = (game: ClientGame) => !findGame(game.id);

/** The door, for a player whose unlock stopped working inside a room, saying why. */
const backToTheDoor = (roomId: string, reason: LockReason) =>
  `/backroom?next=${encodeURIComponent(`/r/${roomId}`)}&locked=${reason}`;

/**
 * Room header buttons: compact on desktop; on phones a full 44 px tap target with the icon over a
 * one-word label, so nobody has to guess what 🔗, 👥 and ❓ do.
 */
const HEADER_BUTTON =
  'min-h-11 flex-col gap-0 px-2 leading-none sm:min-h-0 sm:flex-row sm:gap-2 sm:px-3';
const HEADER_LABEL = 'text-[11px] font-semibold sm:text-sm';

function InviteButton() {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const url = window.location.href;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: 'Join my game', url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast('Link copied. Send it to your friends!', 'info');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      // Closing the share sheet without sharing is not a failure.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      toast("Couldn't copy the link. Copy it from the address bar.", 'info');
    }
  };
  return (
    <Button
      size="sm"
      variant="soft"
      className={HEADER_BUTTON}
      aria-label={copied ? 'Link copied' : 'Invite friends'}
      onClick={() => void copy()}
    >
      <span aria-hidden>{copied ? '✓' : '🔗'}</span>
      <span className={HEADER_LABEL}>
        <span className="sm:hidden">{copied ? 'Copied' : 'Invite'}</span>
        <span className="hidden sm:inline">{copied ? 'Link copied' : 'Invite friends'}</span>
      </span>
    </Button>
  );
}

/** "Ana (host) is away. Someone takes over in 1:45", for everyone while the host is offline. */
function HostAway({ snapshot, clockOffset }: { snapshot: RoomSnapshot; clockOffset: number }) {
  const until = snapshot.hostAwayUntil ?? null;
  const left = useSecondsLeft(until, clockOffset);
  const host = snapshot.players.find((p) => p.id === snapshot.hostId);
  if (until === null || left === null || !host || host.connected) return null;
  return (
    <p
      role="status"
      className="mb-3 rounded-xl bg-stone-100 px-4 py-2 text-center text-sm text-stone-700 ring-1 ring-stone-200 dark:bg-stone-800/70 dark:text-stone-200 dark:ring-stone-700"
    >
      <span aria-hidden>💤 </span>
      <b>{host.name}</b> (host) is away.{' '}
      {left > 0 ? (
        <>
          Someone else takes over in <span className="font-mono tabular-nums">{clock(left)}</span>.
        </>
      ) : (
        'Handing the host role to someone who is here…'
      )}
    </p>
  );
}

/** "You're watching" for members without a seat, with the game's own way to take one. */
function SpectatorBanner({ prompt }: { prompt: SpectatorPrompt }) {
  return (
    <div
      role="status"
      aria-label="You're watching"
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-info-soft px-4 py-2 text-sm text-sky-950 ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
    >
      <p>
        <span aria-hidden>👀 </span>
        <b>You're watching.</b> {prompt.text ?? 'Take a seat to play.'}
      </p>
      {prompt.action && (
        <Button
          size="sm"
          variant="secondary"
          className="min-h-11 sm:min-h-0"
          onClick={prompt.action}
        >
          {prompt.actionLabel ?? 'Take a seat'}
        </Button>
      )}
    </div>
  );
}

/** The room's code, for friends who'd rather hear it than get a link. */
function RoomCode({ roomId }: { roomId: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast(`The room code is ${roomId}`, 'info');
    }
  };
  return (
    <div className="rounded-xl bg-stone-100 p-3 ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700">
      <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase dark:text-stone-400">
        Room code
      </p>
      <div className="mt-1 flex items-center justify-between gap-2">
        {/* Wraps after a hyphen when it must, never inside a word. */}
        <code className="font-mono font-bold break-words sm:text-lg">{roomId}</code>
        <Button
          variant="secondary"
          size="sm"
          className="shrink-0"
          aria-label={copied ? 'Room code copied' : 'Copy room code'}
          onClick={() => void copy()}
        >
          {copied ? '✓ Copied' : 'Copy'}
        </Button>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Read it out: friends can type it on the home page instead of opening a link.
      </p>
    </div>
  );
}

function People({
  roomId,
  snapshot,
  clockOffset,
  isHost,
  call,
  recolor,
  playtest,
  onRename,
  onLeave,
  onWrap,
  onAbandon,
}: {
  roomId: string;
  snapshot: RoomSnapshot;
  clockOffset: number;
  isHost: boolean;
  call: ReturnType<typeof useRoom>['call'];
  recolor: (color: PlayerColor) => Promise<Ack>;
  /** A playtest: no room code to share, and seats keep their names (but may change colour). */
  playtest: boolean;
  onRename: (name: string) => void;
  onLeave: () => Promise<void>;
  /** The host's "Wrap up the night", when there is a night to wrap. */
  onWrap?: () => void;
  /** The host's "Abandon game", while a game is under way. */
  onAbandon?: () => void;
}) {
  const toast = useToast();
  const [confirm, confirmDialog] = useConfirm();
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const me = snapshot.players.find((p) => p.id === snapshot.you);
  // Ticks while the drawer is open, so "offline 3 min" keeps up.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (event: 'room:kick' | 'room:make-host', arg: string) => {
    const res = await call(event, arg);
    if (!res.ok) toast(res.error.message);
    return res.ok;
  };
  const remove = async (player: { id: string; name: string }) => {
    const yes = await confirm({
      title: `Remove ${player.name}?`,
      body: 'They leave the room and are told the host removed them.',
      confirmLabel: `Remove ${player.name}`,
      danger: true,
    });
    if (yes) await run('room:kick', player.id);
  };
  const abandon = async () => {
    const yes = await confirm({
      title: 'Abandon this game?',
      body: 'It ends for everyone and the table goes back to the lobby.',
      confirmLabel: 'Abandon game',
      danger: true,
    });
    if (yes) onAbandon?.();
  };

  return (
    <div className="space-y-6">
      {confirmDialog}
      {!playtest && <RoomCode roomId={roomId} />}
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {snapshot.players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className={cn('flex items-center gap-2', !p.connected && 'opacity-50')}>
              <span className="font-medium">{p.name}</span>
              {/* After the name, so screen readers say "Leo, teal"; shown before it. */}
              <PlayerDot color={p.color} className="order-first size-3" />
              {p.id === snapshot.hostId && <Badge>👑 host</Badge>}
              {p.id === snapshot.you && <Badge>you</Badge>}
              {p.bot && <Badge>🤖 bot</Badge>}
              {!p.connected && (
                <span className="text-xs">{offlineFor(p.awaySince, now + clockOffset)}</span>
              )}
            </span>
            {isHost && p.id !== snapshot.you && (
              <span className="flex gap-2">
                {!p.bot && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="min-h-11"
                    onClick={() => void run('room:make-host', p.id)}
                  >
                    Make host
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="min-h-11 text-danger-ink hover:bg-danger-soft dark:text-rose-300 dark:hover:bg-rose-500/15"
                  onClick={() => void remove(p)}
                >
                  Remove
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {(onWrap || onAbandon) && (
        <div className="flex flex-wrap gap-2">
          {onWrap && (
            <Button variant="secondary" className="min-h-11" onClick={onWrap}>
              🍻 Wrap up the night
            </Button>
          )}
          {onAbandon && (
            <Button variant="danger" className="min-h-11" onClick={() => void abandon()}>
              Abandon game
            </Button>
          )}
        </div>
      )}
      <p className="text-sm text-ink-muted">
        The host can change settings and start games. If the host is away for two minutes, someone
        else takes over.
      </p>
      <div className="space-y-2">
        {renaming ? (
          <>
            {!playtest && (
              <NameForm
                initial={me?.name}
                submitLabel="Save"
                onSubmit={(n) =>
                  void call('room:rename', n).then((res) => {
                    if (res.ok) {
                      onRename(n);
                      setRenaming(false);
                      setRenameError(null);
                    } else setRenameError(res.error.message);
                  })
                }
              />
            )}
            {renameError && (
              <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">
                {renameError}
              </p>
            )}
            <ColorChoice snapshot={snapshot} recolor={recolor} />
            {/* Sticky, so Done stays reachable under a refusal on a small phone. */}
            <div className="sticky bottom-0 -mx-4 border-t border-stone-200 bg-stone-50 px-4 py-2 dark:border-stone-800 dark:bg-stone-900">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setRenaming(false)}
              >
                Done
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRenameError(null);
                setRenaming(true);
              }}
            >
              {playtest ? 'Change my colour' : 'Change name or colour'}
            </Button>
            <Button variant="danger" onClick={() => void onLeave()}>
              Leave room
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
