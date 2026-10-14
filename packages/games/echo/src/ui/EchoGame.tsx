import type { GameUiProps } from '@vt/game-sdk';
import { Button, Countdown, Hint, Panel, useSpectatorPrompt } from '@vt/ui';
import { useEffect } from 'react';
import { type EchoAction, type EchoView, MAX_PLAYERS, type TurnView } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { GameOver, History, Stage } from './Play.tsx';
import { nameOf, startBlocker, statusFor } from './status.ts';
import { Table } from './Table.tsx';

export type EchoUiProps = GameUiProps<EchoView, EchoAction>;

/** What the clock times, and what a strict timer does at 0:00. */
const CLOCK: Record<Exclude<TurnView['stage'], 'reveal'>, { label: string; atZero: string }> = {
  pick: { label: 'to pick a word', atZero: 'then a word is picked at random' },
  clues: { label: 'to write clues', atZero: 'then late clues are skipped' },
  guess: { label: 'to guess', atZero: 'then it counts as a pass' },
};

/** One line on every play screen: score, cards left, who's guessing and the timer. */
function Scoreboard({ view, clockOffset }: { view: EchoView; clockOffset: number }) {
  const turn = view.turn;
  // Cards passed or lost to a wrong guess (a wrong guess costs the next card too).
  const missed = Math.max(0, view.settings.deckSize - view.score - view.cardsLeft);
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 items-center gap-3">
        <span role="img" aria-label={`Score ${view.score}`} className="font-bold tabular-nums">
          ⭐ {view.score} {view.score === 1 ? 'point' : 'points'}
        </span>
        {view.phase === 'playing' && (
          <span className="text-stone-600 tabular-nums dark:text-stone-400">
            {view.cardsLeft} {view.cardsLeft === 1 ? 'card' : 'cards'} left
            {missed > 0 && ` · ${missed} missed`}
          </span>
        )}
        {turn && (
          <span className="min-w-0 truncate">
            <span className="text-stone-600 dark:text-stone-400">Guesser: </span>
            <b>{turn.guesser === view.me?.id ? 'You' : nameOf(view, turn.guesser)}</b>
          </span>
        )}
      </div>
      {turn && turn.stage !== 'reveal' && (
        <Countdown
          deadline={turn.deadline}
          clockOffset={clockOffset}
          label={CLOCK[turn.stage].label}
          soft={view.settings.timerMode !== 'strict'}
          atZero={CLOCK[turn.stage].atZero}
          expiredHint="Only a reminder: nothing is skipped."
        />
      )}
    </div>
  );
}

export function EchoGame({ view, room, act, showGuide, setYourMove, setSpectator }: EchoUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);

  // Watchers get the shell's "You're watching" banner, with a seat when there's one free.
  const seatFree = view.seats.filter((s) => s.playing).length < MAX_PLAYERS;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? seatFree
        ? {
            text:
              view.phase === 'playing'
                ? 'Take a seat to play from the next card.'
                : 'Take a seat to play.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: `The table is full (${MAX_PLAYERS} players).` }
      : null,
  );

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
          <GameOver view={view} act={act} room={room} />
        ) : (
          view.turn && (
            <Panel>
              <Stage view={view} act={act} room={room} />
            </Panel>
          )
        )}
      </div>
      <aside className="space-y-3">
        <Panel className="space-y-1">
          <Table view={view} online={online} act={act} hostId={room.hostId} />
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
