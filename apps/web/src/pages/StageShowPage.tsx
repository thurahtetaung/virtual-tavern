import type { GameRoomInfo } from '@vt/game-sdk';
import type { RoomInfo } from '@vt/protocol';
import { BotNames, Button, PlayerColors } from '@vt/ui';
import { useShowProfile } from '@vt/ui/show';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { LoadingStep } from '../components/Layout.tsx';
import { type ClientGame, loadGame, roomGame } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { retryOnce } from '../lib/retry.ts';
import { usePageTitle } from '../lib/title.ts';
import { useUnchanged } from '../lib/unchanged.ts';
import { useRoom } from '../lib/useRoom.ts';
import { GenericStage } from '../stage/GenericStage.tsx';
import { ShellScene, StageFrame, useWakeLock } from '../stage/StageFrame.tsx';
import { showStarted, startShow } from '../stage/start.ts';

const LOOKUP_TIMEOUT_MS = 10_000;

export function StageShowPage() {
  const { roomId = '' } = useParams();
  return <StageShow key={roomId} roomId={roomId} />;
}

/** A full-screen message on the table screen, with a way back to pairing. */
function Notice({ icon, heading, body }: { icon: string; heading: string; body: string }) {
  const navigate = useNavigate();
  usePageTitle(heading);
  return (
    <ShellScene>
      <div className="flex h-full flex-col items-center justify-center gap-6 p-16 text-center">
        <p className="text-8xl" aria-hidden>
          {icon}
        </p>
        <h1 className="text-5xl font-bold">{heading}</h1>
        <p className="max-w-3xl text-2xl text-ink-muted dark:text-stone-400">{body}</p>
        <Button size="lg" className="h-16 px-8 text-xl" onClick={() => void navigate('/stage')}>
          Pair again
        </Button>
      </div>
    </ShellScene>
  );
}

/**
 * The table screen of one room (on this browser's pass): the game's `Stage`, or the generic one,
 * from the spectator view, full screen. It never acts.
 */
function StageShow({ roomId }: { roomId: string }) {
  const [game, setGame] = useState<ClientGame | null | 'missing' | 'unpaired'>(null);
  const [started, setStarted] = useState(showStarted);
  const conn = useRoom(roomId, '', undefined, game !== null && typeof game === 'object', true);
  const { snapshot, status, clockOffset } = conn;
  useWakeLock();
  usePageTitle(game && typeof game === 'object' ? `📺 ${game.name}` : 'Table screen');

  useEffect(() => {
    let stale = false;
    retryOnce(
      () => api<RoomInfo>(`/api/rooms/${roomId}`, { timeoutMs: LOOKUP_TIMEOUT_MS }),
      (err) => !(err instanceof ApiFailure),
    )
      .then(async (room) => {
        const found = await loadGame(room.gameId);
        const named = found ? await roomGame(found, room.title) : null;
        await named?.stage?.preload().catch(() => {});
        if (!stale) setGame(named ?? 'missing');
      })
      .catch((err: unknown) => {
        if (!stale) setGame(err instanceof ApiFailure ? 'unpaired' : 'missing');
      });
    return () => {
      stale = true;
    };
  }, [roomId]);

  const players = useUnchanged(snapshot?.players);
  const view = useUnchanged(snapshot?.game);
  const present = snapshot?.stage?.present === true;
  const stage = useMemo(() => ({ present }), [present]);
  const { profile } = useShowProfile(stage, true);
  const gameName = game && typeof game === 'object' ? game.name : '';
  const hostId = snapshot?.hostId;
  const room = useMemo(
    (): GameRoomInfo | null =>
      players && hostId !== undefined
        ? {
            you: '',
            hostId,
            isHost: false,
            players,
            clockOffset,
            wordLists: [],
            gameName,
            stage,
          }
        : null,
    [players, hostId, clockOffset, gameName, stage],
  );
  const colors = useMemo(
    () => new Map((players ?? []).map((p) => [p.name, p.color] as const)),
    [players],
  );
  const bots = useMemo(
    () => new Set((players ?? []).filter((p) => p.bot).map((p) => p.name)),
    [players],
  );

  if (game === 'unpaired' || status === 'locked' || status === 'error')
    return (
      <Notice
        icon="🔌"
        heading="This screen isn't paired any more"
        body="The host removed it, paired another screen, or the room's door changed. Ask the host for a new code."
      />
    );
  if (game === 'missing')
    return (
      <Notice icon="🕯️" heading="No such room" body="This room does not exist or has expired." />
    );
  if (status === 'closed')
    return <Notice icon="🚪" heading="The room has closed" body="Thanks for playing!" />;

  if (!started)
    return (
      <ShellScene>
        <div className="flex h-full flex-col items-center justify-center gap-8 p-16 text-center">
          <p className="text-8xl" aria-hidden>
            📺
          </p>
          <h1 className="text-5xl font-bold">{gameName || 'Table screen'}</h1>
          <Button
            size="lg"
            className="h-24 px-12 text-3xl"
            autoFocus
            onClick={() => {
              startShow();
              setStarted(true);
            }}
          >
            ▶ Start the show
          </Button>
          <p className="text-xl text-ink-muted dark:text-stone-400">
            One tap lets the show play its sound and fill the screen.
          </p>
        </div>
      </ShellScene>
    );

  if (!game || !room || view === undefined)
    return (
      <ShellScene>
        <div className="grid h-full place-items-center text-3xl">
          <LoadingStep label="Opening the door…" />
        </div>
      </ShellScene>
    );

  const Stage = game.stage;
  const Shell = Stage ? StageFrame : ShellScene;
  return (
    <Shell>
      {status === 'reconnecting' && (
        <p
          role="status"
          className="absolute inset-x-0 top-0 z-10 bg-accent-soft py-2 text-center text-xl font-semibold text-amber-950 dark:bg-amber-200"
        >
          Connection lost. Reconnecting…
        </p>
      )}
      <BotNames.Provider value={bots}>
        <PlayerColors.Provider value={colors}>
          {Stage ? (
            <Suspense fallback={<LoadingStep label="Setting up the table…" />}>
              <Stage
                view={view}
                room={room}
                act={() => Promise.resolve(false)}
                showGuide={() => {}}
                profile={profile}
              />
            </Suspense>
          ) : (
            <GenericStage room={room} icon={game.icon} roomId={roomId} />
          )}
        </PlayerColors.Provider>
      </BotNames.Provider>
    </Shell>
  );
}
