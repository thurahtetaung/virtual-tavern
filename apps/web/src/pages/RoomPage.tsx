import type { WordListSummary } from '@vt/game-sdk';
import type { RoomInfo, RoomSnapshot } from '@vt/protocol';
import { Badge, Button, Panel, cn } from '@vt/ui';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Drawer } from '../components/Drawer.tsx';
import { GuideView } from '../components/GuideView.tsx';
import { Layout } from '../components/Layout.tsx';
import { NameForm } from '../components/NameForm.tsx';
import { type ClientGame, findGame } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { saveName, savedName } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';
import { useRoom } from '../lib/useRoom.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

export function RoomPage() {
  const { roomId = '' } = useParams();
  const [info, setInfo] = useState<RoomInfo | null | 'missing'>(null);
  const [name, setName] = useState<string | null>(() => savedName() || null);

  useEffect(() => {
    api<RoomInfo>(`/api/rooms/${roomId}`)
      .then(setInfo)
      .catch((err: unknown) =>
        setInfo(err instanceof ApiFailure && err.status === 404 ? 'missing' : null),
      );
  }, [roomId]);

  if (info === 'missing')
    return <NotFoundPage message="This room does not exist or has expired. Ask for a new link!" />;
  const game = info ? findGame(info.gameId) : undefined;
  if (info && !game)
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

  const act = useCallback(
    async (action: unknown) => {
      const res = await call('game:action', action);
      if (!res.ok) toast(res.error.message);
      return res.ok;
    },
    [call, toast],
  );

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

  const isHost = snapshot !== null && snapshot.hostId === snapshot.you;
  const Game = game.Component;

  return (
    <Layout wide>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">
          <span aria-hidden>{game.icon}</span> {game.name}
        </h1>
        <div className="flex flex-wrap gap-2">
          <InviteButton />
          <Button variant="secondary" size="sm" onClick={() => setPeopleOpen(true)}>
            👥 Players {snapshot ? `(${snapshot.players.filter((p) => p.connected).length})` : ''}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setGuideOpen(true)}>
            ❓ Rules
          </Button>
        </div>
      </div>

      {status === 'reconnecting' && (
        <p className="mb-3 rounded-xl bg-amber-200 px-4 py-2 text-center text-sm font-semibold text-amber-950">
          Connection lost. Reconnecting…
        </p>
      )}

      {!snapshot ? (
        <p className="py-16 text-center text-stone-500">Opening the door…</p>
      ) : (
        <Suspense
          fallback={<p className="py-16 text-center text-stone-500">Setting up the table…</p>}
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
              void navigate('/');
            }}
          />
        )}
      </Drawer>
    </Layout>
  );
}

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
    } catch {
      toast(`Copy this link: ${url}`, 'info');
    }
  };
  return (
    <Button size="sm" onClick={() => void copy()}>
      {copied ? '✓ Link copied' : '🔗 Invite friends'}
    </Button>
  );
}

function People({
  snapshot,
  isHost,
  call,
  onRename,
  onLeave,
}: {
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
      <p className="text-sm text-stone-500">
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
