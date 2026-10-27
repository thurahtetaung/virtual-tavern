import type { GameUiProps } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  revealElement,
  useSecondsLeft,
  useSpectatorPrompt,
  useAbandonGame,
  cn,
  useWideScreen,
} from '@vt/ui';
import { useEffect } from 'react';
import { type HoodwinkAction, type HoodwinkView, MAX_PLAYERS } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { GameOver, Stage } from './Play.tsx';
import { useReveal } from './Reveal.tsx';
import {
  listNames,
  missingIds,
  nameOf,
  points,
  shownScores,
  startBlocker,
  statusFor,
} from './status.ts';
import { SEAT_CONTROL_ID, Scores, Table } from './Table.tsx';

export type HoodwinkUiProps = GameUiProps<HoodwinkView, HoodwinkAction>;

/** One line on every play screen: the round, the viewer's score and the timer. */
function Scoreboard({
  view,
  clockOffset,
  revealing,
}: {
  view: HoodwinkView;
  clockOffset: number;
  revealing: boolean;
}) {
  const round = view.round;
  const mine = shownScores(view, revealing).find((s) => s.id === view.me?.id);
  const strict = view.settings.timerMode === 'strict';
  const writing = round?.stage === 'write';
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 items-center gap-3">
        {round && (
          <span className="font-semibold tabular-nums">
            Round {round.number}/{round.rounds}
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
        label={writing ? 'to write a lie' : 'to vote'}
        soft={!strict}
        expiredHint="Just a reminder: the round waits for everyone."
        atZero={
          writing
            ? 'then missing lies are filled in where the question has spares'
            : 'then missing votes score nothing'
        }
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
  // The host who is still to write or vote just does it: never a button to skip themself.
  if (missing.length === 0 || missing.includes(room.you)) return null;
  const timeUp = left === 0;
  if (!timeUp && !missing.every((id) => !online(id))) return null;
  // Plain names here: the panel already says they're away.
  const names =
    missing.length > 3
      ? `${missing.length} more players`
      : listNames(missing.map((id) => nameOf(view, id)));
  return (
    <Panel
      className="space-y-2 text-center max-lg:space-y-1.5 max-lg:p-3"
      data-testid="continue-without"
    >
      <p className="text-sm max-lg:text-xs">
        {timeUp ? '⏰ Time’s up. ' : '📴 '}
        {round.stage === 'write'
          ? `Still waiting for ${names}. Continue, and the game picks a lie for them if it can.`
          : `Still waiting for ${names}. Continue, and they simply don’t vote.`}
      </p>
      <Button
        size="lg"
        className="w-full max-lg:h-11"
        onClick={() => void act({ type: 'continue-without' })}
      >
        <span className="truncate">Continue without {names}</span>
      </Button>
    </Panel>
  );
}

export function HoodwinkGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: HoodwinkUiProps) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const blocker = startBlocker(view, room.gameName ?? 'Hoodwink');
  const reveal = useReveal(view.phase === 'playing' ? view.round : null, room.clockOffset);
  // While the answers are turned over one by one, nothing gives away who scored.
  const revealing = reveal.progress !== null;
  const wide = useWideScreen();
  const phoneEnd = view.phase === 'over' && !wide;
  const status = statusFor(view, room.isHost, blocker, room, revealing);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

  // Watchers get the shell's "You're watching" banner, leading to the Play button.
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
        <Scoreboard view={view} clockOffset={room.clockOffset} revealing={revealing} />
        {view.phase === 'playing' && view.round?.double && (
          <p
            data-testid="final-round"
            className="rounded-xl bg-danger-soft px-3 py-2 text-center text-sm font-bold text-rose-900 ring-1 ring-danger-line dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40"
          >
            🔥 Final round: every point counts double!
          </p>
        )}
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        {view.phase === 'over' ? (
          <GameOver
            view={view}
            act={act}
            isHost={room.isHost}
            room={room}
            players={
              phoneEnd && <Table view={view} online={online} act={act} hostId={room.hostId} />
            }
          />
        ) : (
          view.round && (
            <>
              <ContinueWithout view={view} room={room} act={act} online={online} />
              <Panel>
                <Stage view={view} act={act} isHost={room.isHost} reveal={reveal} />
              </Panel>
            </>
          )
        )}
      </div>
      <aside className={cn('space-y-3', phoneEnd && 'hidden')}>
        <Panel className="space-y-3">
          <Scores view={view} revealing={revealing} />
          <Table view={view} online={online} act={act} hostId={room.hostId} />
        </Panel>
      </aside>
    </div>
  );
}
