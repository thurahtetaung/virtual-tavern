import { type GameUiProps, storageKey } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  cn,
  revealElement,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useState } from 'react';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import { MAX_PLAYERS, type StampedeAction, type StampedeView } from '../logic/types.ts';
import { Lobby } from './Lobby.tsx';
import { CowCount, StampedeStyles, useNames } from './parts.tsx';
import { GameOver, Stage } from './Play.tsx';
import { RoundLog, SEAT_CONTROL_ID, Scoreboard, Table } from './Scores.tsx';
import { nameOf, startBlocker, statusFor } from './status.ts';

export type StampedeUiProps = GameUiProps<StampedeView, StampedeAction>;

/** How long a moo shows on the slow player's screen. */
const MOO_SHOW_MS = 6_000;

/** The newest moo aimed at the viewer, while it's fresh. */
function useMoo(view: StampedeView, clockOffset: number): string | null {
  const me = view.me?.id;
  const latest = view.moos.findLast((m) => me !== undefined && m.to.includes(me));
  // The time of the last moo that has had its moment (a moo is known by its time).
  const [expired, setExpired] = useState(0);
  const at = latest?.at ?? 0;
  useEffect(() => {
    if (!at) return;
    const left = at + MOO_SHOW_MS - (Date.now() + clockOffset);
    const t = setTimeout(
      () => {
        setExpired(at);
      },
      Math.max(0, left),
    );
    return () => {
      clearTimeout(t);
    };
  }, [at, clockOffset]);
  const waiting = view.round?.stage === 'answer' && view.round.myAnswer === null;
  return latest && expired !== at && waiting ? nameOf(view, latest.from) : null;
}

const TIPS_KEY = 'stampede.tips.v1';

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips({ names }: { names: Names }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  const f = (s: string) => fillNames(s, names);
  return (
    <aside
      data-testid="tips"
      className="sp-rise flex flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
    >
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Don’t write your favourite: write what you think most people here will say.</li>
        <li>
          {f('The biggest group of matching answers wins a {cow} each. A tie scores nobody.')}
        </li>
        <li>
          {f(
            'Alone with your answer? You may get the {pink}, and you can’t win while you hold it.',
          )}
        </li>
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => {
          try {
            localStorage.setItem(storageKey(TIPS_KEY), '1');
          } catch {
            // Storage blocked: the tips just close for now.
          }
          setSeen(true);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}

/** One line over the play screen: the round, the target, the viewer's cows and the clock. */
function TopBar({
  view,
  clockOffset,
  names,
}: {
  view: StampedeView;
  clockOffset: number;
  names: Names;
}) {
  const round = view.round;
  const mine = view.scores.find((s) => s.id === view.me?.id);
  const strict = view.settings.timerMode === 'strict';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 items-center gap-3">
        {round && <span className="font-semibold tabular-nums">Round {round.number}</span>}
        <span className="text-ink-muted">first to {cowCount(names, view.target)}</span>
        {mine && <CowCount n={mine.cows} names={names} />}
      </div>
      <Countdown
        deadline={round?.stage === 'answer' ? round.deadline : null}
        clockOffset={clockOffset}
        label="to answer"
        soft={!strict}
        expiredHint="Just a reminder: the host can continue without anyone still writing."
        atZero="then the answers lock"
      />
    </div>
  );
}

type Tab = 'play' | 'scores';

export function StampedeGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: StampedeUiProps) {
  const names = useNames();
  const title = room.gameName ?? names.title;
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const status = statusFor(view, room, names, title);
  const moo = useMoo(view, room.clockOffset);
  const [tab, setTab] = useState<Tab>('play');
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
                ? 'Take a seat to play from the next question.'
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
        blocker={startBlocker(view, title)}
        online={online}
        showGuide={showGuide}
        names={names}
        title={title}
      />
    );
  }

  const mine = view.scores.find((s) => s.id === view.me?.id);
  const props = { view, room, act, names, online };
  return (
    <div className="space-y-3">
      <StampedeStyles />
      {/* Phones: one screen at a time. Desktop: the scores sit beside the game. */}
      <div
        role="tablist"
        aria-label="Show"
        className="grid grid-cols-2 gap-1 rounded-xl bg-card p-1 ring-1 ring-line lg:hidden dark:bg-stone-800 dark:ring-0"
      >
        {(['play', 'scores'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            data-testid={`tab-${t}`}
            onClick={() => setTab(t)}
            className={cn(
              'h-10 rounded-lg text-sm font-semibold',
              tab === t ? 'bg-panel shadow-sm dark:bg-stone-900' : 'text-ink-muted',
            )}
          >
            {t === 'play' ? 'Play' : `Scores${mine ? ` · 🐄 ${mine.cows}` : ''}`}
            {t === 'scores' && view.pinkCow === view.me?.id && ' 🩷'}
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div className={cn('min-w-0 space-y-3', tab !== 'play' && 'hidden lg:block')}>
          <TopBar view={view} clockOffset={room.clockOffset} names={names} />
          {moo && (
            <p
              role="alert"
              data-testid="mooed"
              className="rounded-xl bg-warn-soft px-3 py-2 text-center font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40"
            >
              <span className="sp-moo">🐮</span> {moo} mooed at you! Hurry up!
            </p>
          )}
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && <Tips names={names} />}
          {view.phase === 'over' ? (
            <GameOver {...props} />
          ) : (
            <Panel>
              <Stage {...props} />
            </Panel>
          )}
        </div>
        <aside className={cn('space-y-3', tab !== 'scores' && 'hidden lg:block')}>
          <Panel className="space-y-3">
            <Scoreboard view={view} names={names} />
            <RoundLog view={view} names={names} />
          </Panel>
          <Panel>
            <Table view={view} online={online} act={act} hostId={room.hostId} names={names} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
