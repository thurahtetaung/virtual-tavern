import type { GameUiProps } from '@vt/game-sdk';
import { Countdown, Hint, Panel, cn, useSpectatorPrompt, useAbandonGame } from '@vt/ui';
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
    <div className="flex items-center justify-between gap-2 text-small sm:text-body">
      <div className="flex min-w-0 items-center gap-3">
        <span role="img" aria-label={`Score ${view.score}`} className="font-bold tabular-nums">
          ⭐ {view.score} {view.score === 1 ? 'point' : 'points'}
        </span>
        {view.phase === 'playing' && (
          <span className="shrink-0 text-ink-muted tabular-nums">
            {view.cardsLeft} {view.cardsLeft === 1 ? 'card' : 'cards'} left
            {missed > 0 && ` · ${missed} missed`}
          </span>
        )}
        {turn && (
          <span className="min-w-0 truncate">
            <span className="text-ink-muted">Guesser: </span>
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

export function EchoGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: EchoUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const wordCount = room.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, wordCount);
  const status = statusFor(view, room.isHost, blocker, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

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
    <div
      className={cn(
        'grid gap-4',
        view.phase !== 'over' && 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-6',
      )}
    >
      <div className="min-w-0 space-y-3">
        {/* At the end the score shows once, big, in the result. */}
        {view.phase !== 'over' && <Scoreboard view={view} clockOffset={room.clockOffset} />}
        <Hint dense tone={status.yourMove ? 'action' : 'neutral'}>
          {status.text}
        </Hint>
        {view.phase === 'over' ? (
          <GameOver
            view={view}
            act={act}
            room={room}
            players={
              <Panel>
                <Table view={view} online={online} act={act} hostId={room.hostId} />
              </Panel>
            }
          />
        ) : (
          view.turn && (
            // Wide screens: the card sits in the middle of the free height, not a strip at the top.
            <Panel className="lg:flex lg:min-h-[max(26rem,calc(100dvh-17rem))] lg:flex-col lg:justify-center lg:px-10">
              <Stage view={view} act={act} room={room} />
            </Panel>
          )
        )}
      </div>
      {/* The end holds the players and the cards as its own parts. */}
      {view.phase !== 'over' && (
        <aside className="space-y-3">
          <Panel className="space-y-1">
            <Table view={view} online={online} act={act} hostId={room.hostId} />
            <History history={view.history} />
          </Panel>
        </aside>
      )}
    </div>
  );
}
