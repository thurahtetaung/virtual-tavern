import type { ActOptions, SpectatorPrompt, WordListSummary } from '@vt/game-sdk';
import type { RecapTone, RoomInfo, RoomSnapshot } from '@vt/protocol';
import {
  Badge,
  Button,
  Panel,
  RefusalProvider,
  clock,
  cn,
  useRefusals,
  useSecondsLeft,
} from '@vt/ui';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Drawer } from '../components/Drawer.tsx';
import { GuideView } from '../components/GuideView.tsx';
import { Layout, PageLoading } from '../components/Layout.tsx';
import { NameForm } from '../components/NameForm.tsx';
import { type ClientGame, findGame, loadGame, withTitle } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { awayFor } from '../lib/presence.ts';
import { forgetLastRoom, saveLastRoom, saveName, savedName } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';
import { roomTitle, usePageTitle } from '../lib/title.ts';
import { useRoom } from '../lib/useRoom.ts';
import { type CardContext, RecapSheet, recapHeading } from '../recap/RecapSheet.tsx';
import { NextTableBanner, SameCrewPicker } from '../recap/SameCrew.tsx';
import { useRecap } from '../recap/useRecap.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

type RoomLookup =
  | { kind: 'loading' }
  | { kind: 'found'; room: RoomInfo }
  | { kind: 'missing' }
  /** The server answered with an error, or didn't answer at all. */
  | { kind: 'failed'; message: string };

export function RoomPage() {
  const { roomId = '' } = useParams();
  // A fresh page per room: "Same crew, new game" moves straight from one room to the next.
  return <RoomLookupPage key={roomId} roomId={roomId} />;
}

function RoomLookupPage({ roomId }: { roomId: string }) {
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<RoomLookup>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [game, setGame] = useState<ClientGame | null | 'missing'>(null);
  const [name, setName] = useState<string | null>(() => savedName() || null);
  // Inside the room, the room names the tab itself (and marks "Your turn").
  usePageTitle(
    lookup.kind === 'failed'
      ? "Couldn't open the room"
      : !name && game !== 'missing'
        ? `Join ${game?.name ?? 'a game'}`
        : null,
  );

  useEffect(() => {
    let stale = false;
    api<RoomInfo>(`/api/rooms/${roomId}`)
      .then(async (room) => {
        if (stale) return;
        setLookup({ kind: 'found', room });
        const found = await loadGame(room.gameId);
        setGame(found ? withTitle(found, room.title) : 'missing');
      })
      .catch((err: unknown) => {
        if (stale) return;
        // A back-room game: knock first, then come straight back here.
        if (err instanceof ApiFailure && err.code === 'backroom-locked') {
          void navigate(`/backroom?next=${encodeURIComponent(`/r/${roomId}`)}`, { replace: true });
        } else if (err instanceof ApiFailure && err.status === 404) {
          forgetLastRoom(roomId);
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
              className="inline-flex h-12 items-center rounded-lg px-4 font-semibold text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-stone-800"
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

  if (!game) return <PageLoading wide />;
  return (
    <RefusalProvider>
      <Room roomId={roomId} game={game} name={name} onRename={setName} />
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
}: {
  roomId: string;
  game: ClientGame;
  name: string;
  onRename: (n: string) => void;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const refusals = useRefusals();
  const { snapshot, clockOffset, status, error, call, leave, wraps, next, dismissNext } = useRoom(
    roomId,
    name,
  );
  const [spectator, setSpectator] = useState<SpectatorPrompt | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const night = useRecap({ call, snapshot, game, wraps });
  const [sameCrewOpen, setSameCrewOpen] = useState(false);
  // Games on the card: this room's, a linked table's (public, or named by the server).
  const nightGameNames = night.recap?.games;
  const cardCtx = useMemo((): CardContext => {
    const gameInfo = (id: string) => {
      if (id === game.id) return game;
      const known = findGame(id);
      if (known) return known;
      return { name: nightGameNames?.find((g) => g.gameId === id)?.name ?? 'A game', icon: '🎲' };
    };
    return { gameInfo, names: night.names, labels: night.labels };
  }, [game, nightGameNames, night.names, night.labels]);

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

  // Only the lists tagged for this game; the server enforces the same filter on play.
  useEffect(() => {
    const load = () =>
      void api<WordListSummary[]>(`/api/word-lists?game=${encodeURIComponent(game.id)}`)
        .then(setWordLists)
        .catch(() => {});
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, [game.id]);

  // The game reports when it's the viewer's move; the tab title says so, and phones buzz once.
  const [yourMove, setYourMove] = useState(false);
  const wasYourMove = useRef(false);
  useEffect(() => {
    document.title = roomTitle(game.name, yourMove);
    if (yourMove && !wasYourMove.current && 'vibrate' in navigator) navigator.vibrate(50);
    wasYourMove.current = yourMove;
  }, [game.name, yourMove]);
  useEffect(() => {
    return () => {
      document.title = 'Virtual Tavern';
    };
  }, []);

  // Remember this room for "Rejoin your last room" on the landing page.
  const backroomGame = isBackroomGame(game);
  useEffect(() => {
    if (status === 'joined') {
      saveLastRoom({ id: roomId, game: game.name, ...(backroomGame && { private: true }) });
    }
    if (status === 'kicked' || status === 'left') forgetLastRoom(roomId);
  }, [status, roomId, game.name, backroomGame]);

  const act = useCallback(
    async (action: unknown, options?: ActOptions) => {
      const res = await call('game:action', action);
      if (res.ok) refusals.clear(options?.anchor);
      else if (res.error.code === 'backroom-locked') {
        // The password changed mid-game: send the player back to the door.
        void navigate(backToTheDoor(roomId));
      } else if (!refusals.show(options?.anchor, res.error.message)) {
        // No spot next to the control that sent it (or none on screen): say it up top.
        toast(res.error.message);
      }
      return res.ok;
    },
    [call, toast, navigate, roomId, refusals],
  );

  useEffect(() => {
    if (status === 'locked') void navigate(backToTheDoor(roomId));
  }, [status, navigate, roomId]);

  const isHost = snapshot !== null && snapshot.hostId === snapshot.you;

  const tz = () => new Date().getTimezoneOffset();
  const wrapUp = async () => {
    if (!window.confirm('Wrap up the night? Everyone sees the night recap.')) return;
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

  // Arrivals and departures, collected briefly so a group joining at once makes one toast.
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

  // Where "back" goes: back-room players return to the back room, not the public tavern.
  const home = backroomGame ? { backTo: '/backroom', backLabel: 'Back to the back room' } : {};
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
      {/* One compact row: on phones each button is an icon over a one-word label. */}
      <div className="mb-3 flex items-center justify-between gap-2 sm:mb-4">
        <h1 className="truncate text-xl font-bold sm:text-2xl">
          <span aria-hidden>{game.icon}</span> {game.name}
        </h1>
        <div className="flex shrink-0 gap-1.5 sm:gap-2">
          <InviteButton />
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
            onClick={() => setGuideOpen(true)}
          >
            <span aria-hidden>❓</span>
            <span className={HEADER_LABEL}>Rules</span>
          </Button>
        </div>
      </div>

      {status === 'reconnecting' && (
        <p
          role="status"
          className="mb-3 rounded-xl bg-amber-200 px-4 py-2 text-center text-sm font-semibold text-amber-950"
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
        <p className="py-16 text-center text-stone-500 dark:text-stone-400">Opening the door…</p>
      ) : (
        <Suspense
          fallback={
            <p className="py-16 text-center text-stone-500 dark:text-stone-400">
              Setting up the table…
            </p>
          }
        >
          <Game
            view={snapshot.game}
            room={{
              you: snapshot.you,
              hostId: snapshot.hostId,
              isHost,
              players: snapshot.players,
              clockOffset,
              wordLists,
              ...(night.superlatives && { superlatives: night.superlatives }),
            }}
            act={act}
            showGuide={() => setGuideOpen(true)}
            setYourMove={setYourMove}
            setSpectator={setSpectator}
          />
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
        <GuideView guide={game.guide} compact />
        <Link
          to={`/rules/${game.id}`}
          target="_blank"
          className="mt-6 block text-sm text-amber-700 underline dark:text-amber-400"
        >
          Open the rules in a new tab
        </Link>
      </Drawer>

      <Drawer open={peopleOpen} onClose={() => setPeopleOpen(false)} title="Players">
        {snapshot && (
          <People
            roomId={roomId}
            snapshot={snapshot}
            clockOffset={clockOffset}
            isHost={isHost}
            call={call}
            onWrap={canWrap ? () => void wrapUp() : undefined}
            onRename={(n) => {
              saveName(n);
              onRename(n);
            }}
            onLeave={async () => {
              if (!window.confirm('Leave this room? You can come back with the same link.')) return;
              await leave();
              // Done here as well as in the status effect: the navigation unmounts the room in
              // the same render as the 'left' status, so that effect may never run.
              forgetLastRoom(roomId);
              toast('You left the room.', 'info');
              void navigate(backroomGame ? '/backroom' : '/');
            }}
          />
        )}
      </Drawer>
    </Layout>
  );
}

/** Back-room games are the ones the public registry doesn't know. */
const isBackroomGame = (game: ClientGame) => !findGame(game.id);

/** The door, for a player whose unlock stopped working inside a room: they need the new word. */
const backToTheDoor = (roomId: string) =>
  `/backroom?next=${encodeURIComponent(`/r/${roomId}`)}&changed=1`;

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
      toast(`Copy this link: ${url}`, 'info');
    }
  };
  return (
    <Button
      size="sm"
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
      className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 px-4 py-2 text-sm text-sky-950 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
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
      <p className="text-xs font-semibold tracking-wide text-stone-500 uppercase dark:text-stone-400">
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
      <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
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
  onRename,
  onLeave,
  onWrap,
}: {
  roomId: string;
  snapshot: RoomSnapshot;
  clockOffset: number;
  isHost: boolean;
  call: ReturnType<typeof useRoom>['call'];
  onRename: (name: string) => void;
  onLeave: () => Promise<void>;
  /** The host's "Wrap up the night", when there is a night to wrap. */
  onWrap?: () => void;
}) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const me = snapshot.players.find((p) => p.id === snapshot.you);
  // Ticks while the drawer is open, so "away 3 min" keeps up.
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

  return (
    <div className="space-y-6">
      <RoomCode roomId={roomId} />
      <ul className="divide-y divide-stone-200 dark:divide-stone-800">
        {snapshot.players.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 py-2">
            <span className={cn('flex items-center gap-2', !p.connected && 'opacity-50')}>
              <span
                aria-hidden
                className={cn(
                  'size-2.5 rounded-full',
                  p.connected ? 'bg-emerald-500' : 'bg-stone-400',
                )}
              />
              <span className="font-medium">{p.name}</span>
              {p.id === snapshot.hostId && <Badge>👑 host</Badge>}
              {p.id === snapshot.you && <Badge>you</Badge>}
              {!p.connected && (
                <span className="text-xs">{awayFor(p.awaySince, now + clockOffset)}</span>
              )}
            </span>
            {isHost && p.id !== snapshot.you && (
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => void run('room:make-host', p.id)}>
                  Make host
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    window.confirm(`Remove ${p.name} from the room?`) && void run('room:kick', p.id)
                  }
                >
                  Remove
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {onWrap && (
        <Button variant="secondary" className="min-h-11" onClick={onWrap}>
          🍻 Wrap up the night
        </Button>
      )}
      <p className="text-sm text-stone-500 dark:text-stone-400">
        The host can change settings and start games. If the host is away for two minutes, someone
        else takes over.
      </p>
      <div className="space-y-2">
        {renaming ? (
          <>
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
            {renameError && (
              <p role="alert" className="text-sm font-medium text-rose-700 dark:text-rose-300">
                {renameError}
              </p>
            )}
          </>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setRenameError(null);
                setRenaming(true);
              }}
            >
              Change my name
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
