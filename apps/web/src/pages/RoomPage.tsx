import type { WordListSummary } from '@vt/game-sdk';
import type { RoomInfo, RoomSnapshot } from '@vt/protocol';
import { Badge, Button, Panel, cn } from '@vt/ui';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Drawer } from '../components/Drawer.tsx';
import { GuideView } from '../components/GuideView.tsx';
import { Layout } from '../components/Layout.tsx';
import { NameForm } from '../components/NameForm.tsx';
import { type ClientGame, loadGame } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { forgetLastRoom, saveLastRoom, saveName, savedName } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';
import { useRoom } from '../lib/useRoom.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

type RoomLookup =
  | { kind: 'loading' }
  | { kind: 'found'; room: RoomInfo }
  | { kind: 'missing' }
  /** The server answered with an error, or didn't answer at all. */
  | { kind: 'failed'; message: string };

export function RoomPage() {
  const { roomId = '' } = useParams();
  const navigate = useNavigate();
  const [lookup, setLookup] = useState<RoomLookup>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [game, setGame] = useState<ClientGame | null | 'missing'>(null);
  const [name, setName] = useState<string | null>(() => savedName() || null);

  useEffect(() => {
    let stale = false;
    api<RoomInfo>(`/api/rooms/${roomId}`)
      .then(async (room) => {
        if (stale) return;
        setLookup({ kind: 'found', room });
        setGame((await loadGame(room.gameId)) ?? 'missing');
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
    return <NotFoundPage message="This room does not exist or has expired. Ask for a new link!" />;
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

  if (!game) return <Layout wide>{null}</Layout>;
  return <Room roomId={roomId} game={game} name={name} onRename={setName} />;
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
  const { snapshot, clockOffset, status, error, call, leave } = useRoom(roomId, name);
  const [guideOpen, setGuideOpen] = useState(false);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [wordLists, setWordLists] = useState<WordListSummary[]>([]);

  useEffect(() => {
    const load = () =>
      void api<WordListSummary[]>('/api/word-lists')
        .then(setWordLists)
        .catch(() => {});
    load();
    window.addEventListener('focus', load);
    return () => window.removeEventListener('focus', load);
  }, []);

  useEffect(() => {
    document.title = `${game.name} · Virtual Tavern`;
    return () => {
      document.title = 'Virtual Tavern';
    };
  }, [game.name]);

  // Remember this room for "Rejoin your last room" on the landing page.
  useEffect(() => {
    if (status === 'joined') saveLastRoom({ id: roomId, game: game.name });
    if (status === 'kicked' || status === 'left') forgetLastRoom(roomId);
  }, [status, roomId, game.name]);

  const act = useCallback(
    async (action: unknown) => {
      const res = await call('game:action', action);
      if (!res.ok && res.error.code === 'backroom-locked') {
        // The password changed mid-game: send the player back to the door.
        void navigate(`/backroom?next=${encodeURIComponent(`/r/${roomId}`)}`);
      } else if (!res.ok) toast(res.error.message);
      return res.ok;
    },
    [call, toast, navigate, roomId],
  );

  useEffect(() => {
    if (status === 'locked') void navigate(`/backroom?next=${encodeURIComponent(`/r/${roomId}`)}`);
  }, [status, navigate, roomId]);

  const isHost = snapshot !== null && snapshot.hostId === snapshot.you;

  // Say so when the host role lands on you (the previous host went away, or handed it over).
  const wasHost = useRef<boolean | null>(null);
  useEffect(() => {
    if (!snapshot) return;
    if (wasHost.current === false && isHost) toast("You're the host now", 'info');
    wasHost.current = isHost;
  }, [snapshot, isHost, toast]);

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

  if (status === 'kicked' || status === 'left') {
    return (
      <NotFoundPage
        message={
          status === 'kicked'
            ? 'The host removed you from this room.'
            : 'You left the room. See you next time!'
        }
      />
    );
  }
  if (status === 'error') return <NotFoundPage message={error ?? 'Could not join this room.'} />;

  const Game = game.Component;
  const online = snapshot ? snapshot.players.filter((p) => p.connected).length : 0;

  return (
    <Layout wide>
      {/* One compact row on phones (icon buttons), full labels from sm up. */}
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
            👥<span className="hidden sm:inline">Players</span>
            {snapshot ? ` ${online}` : ''}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={HEADER_BUTTON}
            aria-label="Rules"
            onClick={() => setGuideOpen(true)}
          >
            ❓<span className="hidden sm:inline">Rules</span>
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
            }}
            act={act}
            showGuide={() => setGuideOpen(true)}
          />
        </Suspense>
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
            isHost={isHost}
            call={call}
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
              void navigate('/');
            }}
          />
        )}
      </Drawer>
    </Layout>
  );
}

/** Room header buttons: compact on desktop, but a full 44 px tap target on phones. */
const HEADER_BUTTON = 'min-h-11 sm:min-h-0';

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
      {copied ? '✓' : '🔗'}
      <span className="hidden sm:inline">{copied ? 'Link copied' : 'Invite friends'}</span>
    </Button>
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
  isHost,
  call,
  onRename,
  onLeave,
}: {
  roomId: string;
  snapshot: RoomSnapshot;
  isHost: boolean;
  call: ReturnType<typeof useRoom>['call'];
  onRename: (name: string) => void;
  onLeave: () => Promise<void>;
}) {
  const toast = useToast();
  const [renaming, setRenaming] = useState(false);
  const me = snapshot.players.find((p) => p.id === snapshot.you);

  const run = async (event: 'room:kick' | 'room:make-host' | 'room:rename', arg: string) => {
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
              {!p.connected && <span className="text-xs">away</span>}
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
      <p className="text-sm text-stone-500 dark:text-stone-400">
        The host can change settings and start games. If the host is away for two minutes, someone
        else takes over.
      </p>
      <div className="space-y-2">
        {renaming ? (
          <NameForm
            initial={me?.name}
            submitLabel="Save"
            onSubmit={(n) =>
              void run('room:rename', n).then((ok) => {
                if (ok) {
                  onRename(n);
                  setRenaming(false);
                }
              })
            }
          />
        ) : (
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setRenaming(true)}>
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
