import type { GameUiProps } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel } from '@vt/ui';
import { useEffect } from 'react';
import type { HoodwinkAction, HoodwinkView } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { GameOver, Stage } from './Play.tsx';
import { points, startBlocker, statusFor } from './status.ts';
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

export function HoodwinkGame({ view, room, act, showGuide, setYourMove }: HoodwinkUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const blocker = startBlocker(view);
  const status = statusFor(view, room.isHost, blocker);

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
          <GameOver view={view} act={act} isHost={room.isHost} />
        ) : (
          view.round && (
            <Panel>
              <Stage view={view} act={act} isHost={room.isHost} />
            </Panel>
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
