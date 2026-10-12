import { type GameRoomInfo, type GameUiProps, namesWithPresence } from '@vt/game-sdk';
import { Button, Countdown, Hint, cn, useSecondsLeft, useSpectatorPrompt } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import type { EventKind } from '../logic/content.ts';
import type { InquestAction, InquestView } from '../logic/types.ts';
import { contentFor, useManifest, type Content } from './assets.ts';
import { Lobby } from './Lobby.tsx';
import { useMarks } from './marks.ts';
import {
  FlipPanel,
  MeTab,
  NightPanel,
  OverScreen,
  ReversalPanel,
  SolutionPin,
  SolveButton,
} from './Panels.tsx';
import { LatestBullets, Scene } from './Scene.tsx';
import { TableScreen } from './TableScreen.tsx';
import { CardView, EventCard, SolveSheet } from './Sheets.tsx';
import { nameOf, statusFor, waitingOn } from './status.ts';
import { AllSuspects, type OpenCard, Suspects } from './Suspects.tsx';

export type InquestUiProps = GameUiProps<InquestView, InquestAction>;
type Act = InquestUiProps['act'];
type Tab = 'scene' | 'suspects' | 'me';

/** Buzzes once each time it becomes the viewer's turn (a new key), like Nightfall's wake-up. */
function useTurnBuzz(key: string | null) {
  useEffect(() => {
    if (key === null) return;
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }, [key]);
}

function TabBar({
  tab,
  onChange,
  alert,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  alert: Tab | null;
}) {
  const items: { id: Tab; icon: string; label: string }[] = [
    { id: 'scene', icon: '🧩', label: 'Scene' },
    { id: 'suspects', icon: '🗂️', label: 'Suspects' },
    { id: 'me', icon: '🪪', label: 'Me' },
  ];
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={tab === it.id ? 'page' : undefined}
          onClick={() => onChange(it.id)}
          className={cn(
            'flex flex-col items-center gap-0.5 py-1.5 text-xs font-semibold',
            tab === it.id ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500',
          )}
        >
          <span className="flex items-center gap-1 text-lg leading-none">
            {it.icon}
            {alert === it.id && tab !== it.id && (
              <span className="size-2.5 rounded-full bg-amber-500" />
            )}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/** Speaker, clock, Done, Skip and Solve, always in reach during presentations. */
function PresentBar({
  view,
  room,
  act,
  onSolve,
}: {
  view: InquestView;
  room: GameRoomInfo;
  act: Act;
  onSolve: () => void;
}) {
  const g = view.game!;
  const p = g.present;
  if (g.stage !== 'present' || !p) return null;
  const speaker = p.order[p.index]!;
  const mine = speaker === view.me?.id;
  const next = p.order[p.index + 1];
  const soft = view.settings.presentMode === 'soft';
  const canSkip = room.isHost || g.myRole === 'forensic';
  const offline = room.players.find((x) => x.id === speaker)?.connected === false;
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl px-2 py-1.5 ring-1',
        mine
          ? 'bg-amber-100 ring-2 ring-amber-500 dark:bg-amber-500/20'
          : 'bg-white/90 ring-stone-200 dark:bg-stone-900/90 dark:ring-stone-700',
      )}
    >
      <div className="min-w-0 flex-1 leading-tight">
        <p className="truncate text-sm font-bold">
          🎙️{' '}
          {mine ? 'Your turn to present' : `${nameOf(view, speaker)}${offline ? ' (offline)' : ''}`}
        </p>
        <p className="truncate text-xs text-stone-600 dark:text-stone-400">
          {g.round >= g.finalRound ? 'Last chance · ' : `Round ${g.round} · `}
          {next ? `Up next: ${next === view.me?.id ? 'you' : nameOf(view, next)}` : 'Last speaker'}
        </p>
      </div>
      <Countdown
        deadline={p.deadline}
        clockOffset={room.clockOffset}
        soft={soft}
        expiredHint={soft ? (mine ? 'Wrap up and tap Done' : 'The host can skip') : undefined}
      />
      {mine ? (
        <Button size="md" onClick={() => void act({ type: 'done-presenting' })}>
          Done
        </Button>
      ) : canSkip ? (
        <Button size="sm" variant="secondary" onClick={() => void act({ type: 'skip-speaker' })}>
          Skip
        </Button>
      ) : null}
      {!mine && <SolveButton view={view} onSolve={onSolve} compact />}
    </div>
  );
}

/** Banners: the last round, a missing Forensic Scientist, handovers and who we wait on. */
function Banners({
  view,
  room,
  act,
  content,
  yourMove,
}: {
  view: InquestView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  yourMove: boolean;
}) {
  const g = view.game!;
  const [seenNotice, setSeenNotice] = useState(0);
  const fsAway = room.players.find((p) => p.id === g.fs)?.connected === false;
  const waiting = waitingOn(view);
  const handover = g.notices.findLast((n) => n.text.includes('is now the Forensic Scientist'));
  // Events have their own card, so the notice line skips them.
  const latest = g.notices.findLast((n) => !n.text.startsWith('Event:'));
  const playing = view.phase === 'playing';
  return (
    <div className="space-y-1.5">
      {playing && g.countdown && (g.stage === 'collect' || g.stage === 'present') && (
        <p
          role="status"
          className="rounded-xl bg-rose-600 px-3 py-1.5 text-center text-sm font-semibold text-white"
        >
          ⏳ {content.eventName('countdown')}: this is the last round of presentations. The game
          ends when everyone has presented.
        </p>
      )}
      {playing && fsAway && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-100 px-3 py-1.5 text-sm ring-1 ring-amber-400 dark:bg-amber-500/15"
        >
          <span className="flex-1">
            ⏸ Waiting for the Forensic Scientist ({nameOf(view, g.fs)}, offline).
          </span>
          {room.isHost && (
            <Button
              size="sm"
              onClick={() => {
                if (
                  window.confirm(
                    'Hand the case to a random Investigator? They will see the answer.',
                  )
                )
                  void act({ type: 'hand-over' });
              }}
            >
              Hand over
            </Button>
          )}
        </div>
      )}
      {handover && g.stage !== 'done' && (
        <p className="rounded-xl bg-sky-50 px-3 py-1.5 text-sm ring-1 ring-sky-200 dark:bg-sky-500/10 dark:ring-sky-500/30">
          🔁 {handover.text}
        </p>
      )}
      {latest && latest.id > seenNotice && latest !== handover && g.stage !== 'done' && (
        <p className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-1 text-sm dark:bg-stone-800">
          <span className="flex-1">📣 {latest.text}</span>
          <button
            type="button"
            className="text-xs font-bold"
            onClick={() => setSeenNotice(latest.id)}
          >
            OK
          </button>
        </p>
      )}
      {playing && waiting && !yourMove && g.stage !== 'present' && (
        <p
          className="flex flex-wrap items-center gap-1 text-xs text-stone-600 dark:text-stone-400"
          aria-label="Waiting on"
        >
          Waiting on:
          {waiting.label && (
            <span className="rounded-full bg-stone-200 px-2 py-0.5 font-semibold dark:bg-stone-800">
              {waiting.label}
            </span>
          )}
          {waiting.ids.map((id) => (
            <span
              key={id}
              className="rounded-full bg-stone-200 px-2 py-0.5 font-semibold dark:bg-stone-800"
            >
              {id === view.me?.id
                ? 'you'
                : namesWithPresence([id], room.players) || nameOf(view, id)}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

export function InquestGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: InquestUiProps) {
  const manifest = useManifest();
  const content = useMemo(() => contentFor(manifest), [manifest]);
  const g = view.game;
  const secondsLeft = useSecondsLeft(
    g?.stage === 'present' ? (g.present?.deadline ?? null) : null,
    room.clockOffset,
  );
  const status = statusFor(view, room.isHost, room, secondsLeft);
  const [marks, setMark] = useMarks(`${view.table}.${view.gameNo}`);
  const [open, setOpen] = useState<OpenCard | null>(null);
  const [solving, setSolving] = useState(false);
  const [eventSeen, setEventSeen] = useState('');
  const [tableScreen, setTableScreen] = useState(false);

  // The tab: each new step opens where it's needed, but the player's own choice sticks within it.
  const stepKey = `${view.gameNo}-${g?.stage}-${g?.round}-${g?.step?.kind}-${g?.event?.kind}`;
  const defaultTab: Tab =
    !g || g.stage === 'night' || g.stage === 'reversal' || g.stage === 'done'
      ? 'me'
      : g.myRole === 'forensic' || g.stage === 'collect'
        ? 'scene'
        : 'suspects';
  const [picked, setPicked] = useState<{ tab: Tab; key: string }>({
    tab: defaultTab,
    key: stepKey,
  });
  const tab = picked.key === stepKey ? picked.tab : defaultTab;
  const setTab = (t: Tab) => setPicked({ tab: t, key: stepKey });

  const inGame = !!g?.players.some((p) => p.id === view.me?.id);
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing && view.phase !== 'playing'
      ? {
          text: 'Take a seat to play.',
          actionLabel: 'Take a seat',
          action: () => void act({ type: 'sit', playing: true }),
        }
      : view.phase === 'playing' && !inGame
        ? { text: 'You’re watching this case; you can join the next one.' }
        : null,
  );

  const yourMove = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(yourMove);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, yourMove]);
  useTurnBuzz(
    yourMove && g
      ? `${view.gameNo}:${g.stage}:${g.round}:${g.present?.index ?? ''}:${g.event?.kind ?? ''}:${g.event?.kind === 'ruled-out' ? g.event.index : ''}`
      : null,
  );

  // A plain-language card for each event as it comes up.
  const eventKey = g?.events.length ? `${view.gameNo}:${g.events.length}` : '';
  const eventKind: EventKind | null =
    g && eventKey && eventKey !== eventSeen && g.stage !== 'done'
      ? (g.events.at(-1) ?? null)
      : null;

  if (view.phase === 'lobby' || !g) {
    return (
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        content={content}
        showGuide={showGuide}
      />
    );
  }

  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');
  const common = { view, content, marks, setMark, onOpen: setOpen };
  const alert: Tab | null =
    status.yourMove && g.stage !== 'present'
      ? g.stage === 'collect' && g.event?.kind !== 'ruled-out'
        ? 'scene'
        : 'me'
      : null;

  if (g.stage === 'done') {
    return (
      <div className="mx-auto max-w-3xl space-y-3">
        <OverScreen view={view} content={content} room={room} act={act} />
        <CardView
          open={open}
          view={view}
          content={content}
          marks={marks}
          setMark={setMark}
          onClose={() => setOpen(null)}
        />
      </div>
    );
  }

  // Watchers can lay the public table out big for a shared screen (a TV or laptop at the table).
  if (!inGame && tableScreen)
    return (
      <TableScreen view={view} room={room} content={content} onExit={() => setTableScreen(false)} />
    );

  const solvePanel = (
    <>
      {g.stage === 'night' && <NightPanel view={view} content={content} act={act} room={room} />}
      <FlipPanel view={view} content={content} act={act} room={room} />
      <ReversalPanel view={view} act={act} room={room} />
    </>
  );

  return (
    <div className="space-y-2 pb-16 lg:pb-0">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {!inGame && (
        <Button
          variant="secondary"
          size="sm"
          className="hidden lg:inline-flex"
          onClick={() => setTableScreen(true)}
        >
          📺 Table screen
        </Button>
      )}
      <Banners view={view} room={room} act={act} content={content} yourMove={status.yourMove} />
      <PresentBar view={view} room={room} act={act} onSolve={() => setSolving(true)} />
      {g.stage === 'present' && <LatestBullets g={g} content={content} />}
      {(g.myRole === 'forensic' || g.myRole === 'former-forensic') && (
        <SolutionPin view={view} content={content} />
      )}
      {solvePanel}
      <div className="grid gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="min-w-0 space-y-3">
          <div className={onTab('scene')}>
            <Scene view={view} content={content} act={act} />
          </div>
          <div className={onTab('me')}>
            <MeTab
              view={view}
              content={content}
              showGuide={showGuide}
              onSolve={() => setSolving(true)}
            />
          </div>
        </div>
        <div className={cn('min-w-0', onTab('suspects'))}>
          <div className="lg:hidden">
            <Suspects {...common} />
          </div>
          <div className="hidden lg:block">
            <AllSuspects {...common} />
          </div>
        </div>
      </div>
      {room.isHost && (
        <Button
          variant="ghost"
          size="sm"
          className={cn('w-full', tab !== 'me' && 'hidden lg:inline-flex')}
          onClick={() => {
            if (window.confirm('End this case for everyone and go back to the lobby?'))
              void act({ type: 'back-to-lobby' });
          }}
        >
          Abandon game
        </Button>
      )}
      <TabBar tab={tab} onChange={setTab} alert={alert} />
      <CardView
        open={open}
        view={view}
        content={content}
        marks={marks}
        setMark={setMark}
        onClose={() => setOpen(null)}
      />
      <SolveSheet
        open={solving}
        view={view}
        content={content}
        act={act}
        onClose={() => setSolving(false)}
      />
      <EventCard
        kind={eventKind}
        view={view}
        content={content}
        onClose={() => setEventSeen(eventKey)}
      />
    </div>
  );
}
