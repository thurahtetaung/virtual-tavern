import type { GameUiProps } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel } from '@vt/ui';
import { useEffect } from 'react';
import type { EchoAction, EchoView } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { GameOver, History, Stage } from './Play.tsx';
import { nameOf, startBlocker, statusFor } from './status.ts';
import { Table } from './Table.tsx';

export type EchoUiProps = GameUiProps<EchoView, EchoAction>;

/** One line on every play screen: score, cards left, who's guessing and the timer. */
function Scoreboard({ view, clockOffset }: { view: EchoView; clockOffset: number }) {
  const turn = view.turn;
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 items-center gap-3">
        <span role="img" aria-label={`Score ${view.score}`} className="font-bold tabular-nums">
          ⭐ {view.score}
        </span>
        <span className="text-stone-600 tabular-nums dark:text-stone-400">
          {view.cardsLeft} {view.cardsLeft === 1 ? 'card' : 'cards'} left
        </span>
        {turn && (
          <span className="min-w-0 truncate">
            🎯 <b>{turn.guesser === view.me?.id ? 'You' : nameOf(view, turn.guesser)}</b>
          </span>
        )}
      </div>
      <Countdown
        deadline={turn && turn.stage !== 'reveal' ? turn.deadline : null}
        clockOffset={clockOffset}
        expiredLabel={view.settings.timerMode === 'strict' ? undefined : "Time's up!"}
      />
    </div>
  );
}

export function EchoGame({ view, room, act, showGuide, setYourMove }: EchoUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
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
          view.turn && (
            <Panel>
              <Stage view={view} act={act} isHost={room.isHost} />
            </Panel>
          )
        )}
      </div>
      <aside className="space-y-3">
        <Panel className="space-y-1">
          <Table view={view} online={online} act={act} />
          <History key={view.phase} history={view.history} open={view.phase === 'over'} />
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
