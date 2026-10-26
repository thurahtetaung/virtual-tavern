import { type GameRoomInfo, type GameUiProps, listNames, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  Standings,
  Superlatives,
  revealElement,
  useAbandonGame,
  useSecondsLeft,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect } from 'react';
import { MAX_PLAYERS, type SketchyAction, type SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';
import { Draw } from './Draw.tsx';
import { Lobby } from './Lobby.tsx';
import { anyMissing, missingIds, nameOf, points, startBlocker, statusFor } from './status.ts';
import { SEAT_CONTROL_ID, Scores, Table } from './Table.tsx';
import { TurnStage, useReveal } from './Turn.tsx';

export type SketchyUiProps = GameUiProps<SketchyView, SketchyAction>;

const CLOCK_LABEL = { draw: 'to draw', write: 'to write a title', vote: 'to pick' } as const;
const AT_ZERO = {
  draw: 'whatever is drawn is sent',
  write: 'picking starts without the missing titles',
  vote: 'missing picks score nothing',
} as const;

/** One line on every play screen: the round, the drawing, the viewer's score and the timer. */
function Header({ view, clockOffset }: { view: SketchyView; clockOffset: number }) {
  const g = view.game!;
  const mine = view.scores.find((s) => s.id === view.me?.id);
  const stage = g.stage === 'reveal' ? null : g.stage;
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="font-semibold tabular-nums">
          Round {g.round}/{g.rounds}
        </span>
        {g.turn && g.stage !== 'draw' && (
          <span className="text-ink-muted tabular-nums">
            Drawing {g.turn.number}/{g.turn.of}
          </span>
        )}
        {mine && g.stage !== 'reveal' && (
          <span
            role="img"
            aria-label={`Your score ${mine.score}`}
            className="font-bold tabular-nums"
          >
            ⭐ {points(mine.score)}
          </span>
        )}
      </div>
      {stage && (
        <Countdown
          deadline={g.deadline}
          clockOffset={clockOffset}
          label={CLOCK_LABEL[stage]}
          soft={view.settings.timerMode !== 'strict'}
          expiredHint="Just a reminder: the game waits for everyone."
          atZero={`then ${AT_ZERO[stage]}`}
        />
      )}
    </div>
  );
}

/**
 * The host's way out when the game waits on someone who isn't coming: once time is up (or straight
 * away when everyone named as missing is offline), the stage ends as a strict timeout would.
 */
function ContinueWithout({
  view,
  room,
  act,
  online,
}: {
  view: SketchyView;
  room: GameRoomInfo;
  act: Act;
  online: (id: string) => boolean;
}) {
  const g = view.game;
  const left = useSecondsLeft(g?.deadline ?? null, room.clockOffset);
  if (!room.isHost || view.phase !== 'playing' || !g || g.stage === 'reveal' || !anyMissing(view))
    return null;
  const missing = missingIds(view);
  const timeUp = left === 0;
  if (!timeUp && !(missing.length > 0 && missing.every((id) => !online(id)))) return null;
  const names =
    missing.length === 0 || missing.length > 3
      ? 'the players still missing'
      : listNames(missing.map((id) => nameOf(view, id)));
  return (
    <Panel className="space-y-2 text-center" data-testid="continue-without">
      <p className="text-sm">
        {timeUp ? '⏰ Time’s up. ' : '📴 '}Still waiting for {names}. Continue, and the game moves
        on without them.
      </p>
      <Button size="lg" className="w-full" onClick={() => void act({ type: 'continue-without' })}>
        Continue without {names}
      </Button>
    </Panel>
  );
}

/** The podium, the awards, every drawing's title, then Play again. */
function GameOver({ view, room, act }: { view: SketchyView; room: GameRoomInfo; act: Act }) {
  const ranked = view.scores;
  const top = (pick: (s: (typeof ranked)[number]) => number) => {
    const best = Math.max(0, ...ranked.map(pick));
    return best > 0 ? { ids: ranked.filter((s) => pick(s) === best).map((s) => s.id), best } : null;
  };
  const liar = top((s) => s.fooled);
  const liked = top((s) => s.likes);
  const names = (ids: string[]) => listNames(ids.map((id) => nameOf(view, id)));
  const history = view.game?.history ?? [];
  return (
    <Panel className="space-y-4 text-center" data-testid="sketchy-over">
      {view.endReason === 'too-few' && (
        <p className="font-semibold">Too few players left: final scores so far.</p>
      )}
      <Standings
        entries={ranked.map((s) => ({
          id: s.id,
          name: s.left ? `${s.name} (left)` : s.name,
          score: s.score,
        }))}
        you={view.me?.id}
        scoreLabel={(n) => `${points(n)} pts`}
        className="text-left"
      />
      {room.superlatives?.length ? (
        <Superlatives lines={room.superlatives} />
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-danger-soft px-3 py-2 dark:bg-rose-500/10">
            <dt className="font-semibold">🎭 Best liar</dt>
            <dd>{liar ? `${names(liar.ids)}: fooled ${liar.best}` : 'Nobody fooled anyone!'}</dd>
          </div>
          <div className="rounded-xl bg-special-soft px-3 py-2 dark:bg-violet-500/10">
            <dt className="font-semibold">👍 Most liked</dt>
            <dd>{liked ? `${names(liked.ids)}: ${liked.best} likes` : 'No likes this game.'}</dd>
          </div>
        </dl>
      )}
      {history.length > 0 && (
        <details className="text-left text-sm">
          <summary className="flex h-11 cursor-pointer items-center font-semibold">
            🖼️ Every drawing ({history.length})
          </summary>
          <ul className="space-y-1" data-testid="sketchy-history">
            {history.map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold">{nameOf(view, h.artist)}</span> drew “{h.prompt}”
                </span>
                <span className="shrink-0 text-ink-muted tabular-nums">
                  {h.found}/{h.voters} found
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {room.isHost ? (
        <div className="grid gap-2 sm:flex sm:justify-center">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change setup
          </Button>
        </div>
      ) : (
        <p>{waitingForHost(room, 'start the next game')}</p>
      )}
    </Panel>
  );
}

export function SketchyGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: SketchyUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const blocker = startBlocker(view);
  const turn =
    view.phase === 'playing' && view.game?.stage === 'reveal' ? (view.game.turn ?? null) : null;
  const reveal = useReveal(turn, room.clockOffset);
  const revealing = reveal.progress !== null;
  const status = statusFor(view, room.isHost, blocker, room, revealing);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

  const seats = view.seats.filter((s) => s.playing).length;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? seats < MAX_PLAYERS
        ? {
            text:
              view.phase === 'playing'
                ? 'Take a seat to play from the next round.'
                : 'Take a seat to play.',
            action: () => revealElement(SEAT_CONTROL_ID),
          }
        : { text: 'The table is full for now.' }
      : null,
  );

  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby') {
    return (
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        blocker={blocker}
        online={online}
        showGuide={showGuide}
      />
    );
  }
  const g = view.game;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-3">
        {view.phase === 'playing' && g && <Header view={view} clockOffset={room.clockOffset} />}
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        {view.phase === 'over' ? (
          <GameOver view={view} room={room} act={act} />
        ) : (
          g && (
            <>
              <ContinueWithout view={view} room={room} act={act} online={online} />
              {g.stage === 'draw' ? (
                <Draw view={view} room={room} act={act} />
              ) : (
                g.turn && (
                  <Panel>
                    <TurnStage view={view} act={act} isHost={room.isHost} reveal={reveal} />
                  </Panel>
                )
              )}
            </>
          )
        )}
      </div>
      <aside className="space-y-3">
        <Panel className="space-y-3">
          <Scores view={view} revealing={revealing} />
          <Table view={view} online={online} act={act} hostId={room.hostId} />
        </Panel>
      </aside>
    </div>
  );
}
