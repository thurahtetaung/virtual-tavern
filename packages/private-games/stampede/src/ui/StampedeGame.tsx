import { type GameUiProps, storageKey } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Fold,
  Hint,
  Panel,
  TabBar,
  type TabBarItem,
  cn,
  tabPanelProps,
  revealElement,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
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
function Tips({ names, open }: { names: Names; open: boolean }) {
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
    <Fold
      testId="tips"
      open={open}
      summary="New here? Three things to know"
      className="bg-info-soft text-info-ink ring-info-line"
      bodyClassName="flex flex-col gap-2 text-sm"
    >
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
        variant="quiet"
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
    </Fold>
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

type Tab = 'play' | 'herd' | 'rounds';

const TABS_ID = 'stampede-tabs';
const TABS: readonly TabBarItem<Tab>[] = [
  { id: 'play', label: 'Play', icon: 'gamepad-2' },
  { id: 'herd', label: 'Herd', icon: 'users' },
  { id: 'rounds', label: 'Rounds', icon: 'list-ordered' },
];

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
  const status = statusFor(view, room, names);
  const moo = useMoo(view, room.clockOffset);
  const [tab, setTab] = useState<Tab>('play');
  const wide = useWideScreen();
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
        blocker={startBlocker(view)}
        online={online}
        showGuide={showGuide}
        names={names}
        title={title}
      />
    );
  }

  const props = { view, room, act, names, online };
  return (
    <div className="space-y-3">
      <StampedeStyles />
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div
          className={cn('min-w-0 space-y-3', tab !== 'play' && 'hidden lg:block')}
          {...(!wide && tab === 'play' && tabPanelProps(TABS_ID, 'play'))}
        >
          <Hint tone={status.yourMove ? 'action' : 'neutral'} dense>
            {status.text}
          </Hint>
          {/* At the end the herds show once, in the standings. */}
          {view.phase !== 'over' && (
            <TopBar view={view} clockOffset={room.clockOffset} names={names} />
          )}
          {moo && (
            <p
              role="alert"
              data-testid="mooed"
              className="rounded-xl bg-warn-soft px-3 py-2 text-center font-semibold text-warn-ink ring-1 ring-warn-line"
            >
              <span className="sp-moo">🐮</span> {moo} mooed at you! Hurry up!
            </p>
          )}
          {/* Wide screens keep the tips in the rail, beside the question. */}
          {view.phase === 'playing' && !wide && <Tips names={names} open={false} />}
          {view.phase === 'over' ? (
            <GameOver {...props} />
          ) : (
            <Panel>
              <Stage {...props} />
            </Panel>
          )}
        </div>
        <aside className={cn('space-y-3', tab === 'play' && 'hidden lg:block')}>
          {view.phase === 'playing' && wide && <Tips names={names} open />}
          <Panel
            className={cn('space-y-3', tab === 'rounds' && 'max-lg:hidden')}
            {...(!wide && tab === 'herd' && tabPanelProps(TABS_ID, 'herd'))}
          >
            <Scoreboard view={view} names={names} />
            {wide && <RoundLog view={view} names={names} />}
          </Panel>
          {!wide && (
            <Panel
              className={cn(tab !== 'rounds' && 'hidden')}
              {...(tab === 'rounds' && tabPanelProps(TABS_ID, 'rounds'))}
            >
              <RoundLog view={view} names={names} />
            </Panel>
          )}
          <Panel className={cn(tab === 'rounds' && 'max-lg:hidden')}>
            <Table view={view} online={online} act={act} hostId={room.hostId} names={names} />
          </Panel>
        </aside>
      </div>
      {!wide && (
        <TabBar
          id={TABS_ID}
          label="Stampede"
          items={TABS}
          value={tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
    </div>
  );
}
