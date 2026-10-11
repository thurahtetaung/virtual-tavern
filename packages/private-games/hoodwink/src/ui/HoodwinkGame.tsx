import { type GameUiProps, hostNameOf } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel, useSecondsLeft } from '@vt/ui';
import { useEffect } from 'react';
import type { HoodwinkAction, HoodwinkView } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { GameOver, Stage } from './Play.tsx';
import { missingIds, missingText, points, startBlocker, statusFor } from './status.ts';
import { Scores, Table } from './Table.tsx';

export type HoodwinkUiProps = GameUiProps<HoodwinkView, HoodwinkAction>;

/** One line on every play screen: the round, the viewer's score and the timer. */
function Scoreboard({ view, clockOffset }: { view: HoodwinkView; clockOffset: number }) {
  const round = view.round;
  const mine = view.scores.find((s) => s.id === view.me?.id);
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 items-center gap-3">
        {round && (
          <span className="font-semibold tabular-nums">
            Round {round.number}/{round.rounds}
          </span>
        )}
        {round?.double && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-xs font-bold text-rose-800 dark:bg-rose-500/20 dark:text-rose-200">
            ×2 points
          </span>
        )}
        {mine && (
          <span
            role="img"
            aria-label={`Your score ${mine.score}`}
            className="font-bold tabular-nums"
          >
            ⭐ {points(mine.score)}
          </span>
        )}
      </div>
      <Countdown
        deadline={round && round.stage !== 'reveal' ? round.deadline : null}
        clockOffset={clockOffset}
        expiredLabel={view.settings.timerMode === 'strict' ? undefined : "Time's up!"}
      />
    </div>
  );
}

/**
 * The host's way out when the round waits on someone who isn't coming: once time is up (or
 * straight away when everyone missing is offline), the stage ends as a strict timeout would.
 */
function ContinueWithout({
  view,
  room,
  act,
  online,
}: {
  view: HoodwinkView;
  room: HoodwinkUiProps['room'];
  act: HoodwinkUiProps['act'];
  online: (id: string) => boolean;
}) {
  const round = view.round;
  const left = useSecondsLeft(round?.deadline ?? null, room.clockOffset);
  if (!room.isHost || view.phase !== 'playing' || !round || round.stage === 'reveal') return null;
  const missing = missingIds(round);
  if (missing.length === 0) return null;
  const timeUp = left === 0;
  if (!timeUp && !missing.every((id) => !online(id))) return null;
  const names = missingText(view, missing);
  return (
    <Panel className="space-y-2 text-center" data-testid="continue-without">
      <p className="text-sm">
        {timeUp ? '⏰ Time’s up. ' : '📴 '}
        {round.stage === 'write'
          ? `Still waiting for ${names}. Continue, and the game picks a lie for them if it can.`
          : `Still waiting for ${names}. Continue, and they simply don’t vote.`}
      </p>
      <Button size="lg" className="w-full" onClick={() => void act({ type: 'continue-without' })}>
        Continue without {names}
      </Button>
    </Panel>
  );
}

export function HoodwinkGame({ view, room, act, showGuide, setYourMove }: HoodwinkUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const blocker = startBlocker(view);
  const hostName = hostNameOf(room);
  const status = statusFor(view, room.isHost, blocker, { hostName, online });

  // Mark the tab when it's your move in a game (the lobby doesn't count).
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

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-3">
        <Scoreboard view={view} clockOffset={room.clockOffset} />
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        {view.phase === 'over' ? (
          <GameOver view={view} act={act} isHost={room.isHost} hostName={hostName} />
        ) : (
          view.round && (
            <>
              <ContinueWithout view={view} room={room} act={act} online={online} />
              <Panel>
                <Stage view={view} act={act} isHost={room.isHost} />
              </Panel>
            </>
          )
        )}
      </div>
      <aside className="space-y-3">
        <Panel className="space-y-3">
          <Scores view={view} />
          <Table view={view} online={online} act={act} />
        </Panel>
        {room.isHost && view.phase === 'playing' && (
          <Button
            variant="ghost"
            className="h-11 w-full"
            onClick={() => {
              if (window.confirm('End this game for everyone and go back to the lobby?')) {
                void act({ type: 'back-to-lobby' });
              }
            }}
          >
            Abandon game
          </Button>
        )}
      </aside>
    </div>
  );
}
