import { type GameRoomInfo, type GameUiProps, namesWithPresence } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  FitArea,
  Hint,
  NameDot,
  Panel,
  RefusalSlot,
  clock,
  cn,
  useSecondsLeft,
  useSpectatorPrompt,
  useConfirm,
  useAbandonGame,
  TabBar,
  type TabBarItem,
  tabPanelProps,
  useWideScreen,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import type { EventKind } from '../logic/content.ts';
import { lastRoundText } from '../logic/names.ts';
import type { InquestAction, InquestView } from '../logic/types.ts';
import { contentFor, useManifest, type Content } from './assets.ts';
import { Lobby } from './Lobby.tsx';
import { useMarks } from './marks.ts';
import {
  FlipPanel,
  ForensicLine,
  MeTab,
  NightPanel,
  OverScreen,
  ReversalPanel,
  SolutionPin,
  SolveButton,
} from './Panels.tsx';
import { AlliesPanel } from './Allies.tsx';
import { FinalList } from './Final.tsx';
import { LatestBullets, Scene, TimelineFold } from './Scene.tsx';
import { TableEndScreen, TableScreen } from './TableScreen.tsx';
import { CardView, EventCard, SolveSheet } from './Sheets.tsx';
import { endDiscussionLabel, nameOf, statusFor, waitingOn } from './status.ts';
import { AllSuspects, CrimePeek, type OpenCard, Suspects } from './Suspects.tsx';

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

const TABS_ID = 'inquest-sections';
const TABS: readonly Omit<TabBarItem<Tab>, 'badge'>[] = [
  { id: 'scene', icon: 'map-pin', label: 'Scene' },
  { id: 'suspects', icon: 'users', label: 'Suspects' },
  { id: 'me', icon: 'hand', label: 'Me' },
];

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
        'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-2 py-1.5 ring-1',
        mine ? 'bg-accent-soft ring-2 ring-accent' : 'bg-card/90 ring-line',
      )}
    >
      <div className="min-w-0 flex-[1_1_9rem] leading-tight">
        <p className="truncate text-sm font-bold">
          🎙️{' '}
          {mine ? 'Your turn to present' : `${nameOf(view, speaker)}${offline ? ' (offline)' : ''}`}
        </p>
        <p className="text-xs text-ink-muted">
          {g.round >= g.finalRound ? 'Last chance · ' : `Round ${g.round} · `}
          {next ? `Up next: ${next === view.me?.id ? 'you' : nameOf(view, next)}` : 'Last speaker'}
        </p>
      </div>
      {/* The clock and buttons stay together, and drop under the name when space runs out. */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
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
    </div>
  );
}

/** Accuser, clock, Accuse, Skip and the running list, always in reach in the final accusations. */
export function FinalBar({
  view,
  room,
  act,
  content,
  onSolve,
}: {
  view: InquestView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  onSolve: () => void;
}) {
  const [confirm, confirmDialog] = useConfirm();
  const g = view.game!;
  const f = g.final;
  if (g.stage !== 'final' || !f) return null;
  const accuser = f.order[f.index]!;
  const mine = accuser === view.me?.id;
  const next = f.order[f.index + 1];
  const soft = view.settings.presentMode === 'soft';
  const canSkip = room.isHost || g.myRole === 'forensic';
  const offline = room.players.find((x) => x.id === accuser)?.connected === false;
  return (
    <Panel
      role="region"
      aria-label="Final accusations"
      className={cn(
        'space-y-1.5 px-2 py-1.5',
        mine ? 'bg-accent-soft ring-2 ring-accent' : 'ring-1 ring-danger',
      )}
    >
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 flex-[1_1_9rem] leading-tight">
          <p className="text-sm font-bold">
            ⚖️{' '}
            {mine
              ? 'Final accusations: your turn'
              : `Final accusations: ${nameOf(view, accuser)}${offline ? ' (offline)' : ''} is accusing…`}
          </p>
          <p className="text-xs text-ink-muted">
            {f.index + 1} of {f.order.length} ·{' '}
            {next ? `Up next: ${next === view.me?.id ? 'you' : nameOf(view, next)}` : 'Last one'}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <Countdown
            deadline={f.deadline}
            clockOffset={room.clockOffset}
            soft={soft}
            expiredHint={soft ? (mine ? 'Make your accusation' : 'The host can skip') : undefined}
          />
          {mine ? (
            <SolveButton view={view} onSolve={onSolve} compact label="⚖️ Accuse" />
          ) : canSkip ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() =>
                void (async () => {
                  if (
                    await confirm({
                      title: `Skip ${nameOf(view, accuser)}’s final accusation?`,
                      confirmLabel: 'Skip',
                    })
                  )
                    void act({ type: 'skip-speaker' });
                })()
              }
            >
              Skip
            </Button>
          ) : null}
        </div>
      </div>
      <FinalList view={view} content={content} />
    </Panel>
  );
}

/**
 * The discussion after each round's bullets: a soft clock everyone sees (red at 0, nothing happens
 * by itself), and the Forensic Scientist's button to move on (the presentations, the next round
 * or the final accusations). The host gets it too when they're away.
 */
function DiscussBar({
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
  const left = useSecondsLeft(g.stage === 'discuss' ? g.deadline : null, room.clockOffset);
  if (g.stage !== 'discuss') return null;
  const fs = g.fs === view.me?.id;
  const fsAway = room.players.find((p) => p.id === g.fs)?.connected === false;
  const canStart = fs || (room.isHost && fsAway);
  const late = left === 0;
  return (
    <div
      role="region"
      aria-label="Discussion"
      className={cn(
        'space-y-1 rounded-xl px-2 py-1.5 ring-1',
        fs && late ? 'bg-danger-soft ring-2 ring-danger' : 'bg-card/90 ring-accent',
      )}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="min-w-0 flex-[1_1_9rem] leading-tight">
          <p className="text-sm font-bold">💬 Discuss the evidence</p>
          <p className="text-xs text-ink-muted">
            {g.round >= g.finalRound ? 'Last round' : `Round ${g.round}`} · new bullets highlighted
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {left !== null && (
            <span
              role="timer"
              aria-label={late ? 'Discussion time is up' : `${left} seconds of discussion left`}
              className={cn(
                'rounded-lg px-2 py-1 font-bold tabular-nums',
                late ? 'bg-danger text-on-fill' : 'bg-sunk font-mono text-lg text-ink',
              )}
            >
              ⏱ {late ? 'Time’s up' : clock(left)}
            </span>
          )}
          {canStart ? (
            <Button
              size="md"
              // Time's up: a ring, not a pulse, so the label never fades below its contrast.
              className={cn(late && 'ring-2 ring-accent ring-offset-2 ring-offset-card')}
              onClick={() => void act({ type: 'end-discussion' }, { anchor: 'inquest-discuss' })}
            >
              {endDiscussionLabel(view)}
            </Button>
          ) : (
            <SolveButton view={view} onSolve={onSolve} compact />
          )}
        </div>
      </div>
      {!fs && canStart && (
        <p className="text-xs text-ink-muted">
          The Forensic Scientist is away, so you can move on as the host.
        </p>
      )}
      <RefusalSlot anchor="inquest-discuss" />
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
  const [confirm, confirmDialog] = useConfirm();
  const fsAway = room.players.find((p) => p.id === g.fs)?.connected === false;
  const waiting = waitingOn(view);
  const handover = g.notices.findLast((n) => n.text.includes('is now the Forensic Scientist'));
  // Events have their own card, so the notice line skips them.
  const latest = g.notices.findLast((n) => !n.text.startsWith('Event:'));
  const playing = view.phase === 'playing';
  return (
    <div className="space-y-1.5">
      {confirmDialog}
      {playing &&
        g.countdown &&
        (g.stage === 'collect' || g.stage === 'discuss' || g.stage === 'present') && (
          <p
            role="status"
            className="rounded-xl bg-danger px-3 py-1.5 text-center text-sm font-semibold text-on-fill"
          >
            ⏳ {content.eventName('countdown')}: this is the last round.{' '}
            {lastRoundText(view.settings).replace(/^a/, 'A')}.
          </p>
        )}
      {playing && g.myRole === 'forensic' && g.perfect.some((p) => p.switched) && (
        <p
          role="status"
          className="rounded-xl bg-rose-950 px-3 py-1.5 text-center text-sm font-semibold text-rose-50 ring-1 ring-danger"
        >
          🎭 Secret: you peeked at an event, so you now win with the Murderer’s side. Keep answering
          truthfully, but your bullets may mislead.
        </p>
      )}
      {playing && fsAway && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-2 rounded-xl bg-accent-soft px-3 py-1.5 text-sm ring-1 ring-accent"
        >
          <span className="flex-1">
            ⏸ Waiting for the Forensic Scientist ({nameOf(view, g.fs)}, offline).
          </span>
          {room.isHost && (
            <Button
              size="sm"
              onClick={() =>
                void (async () => {
                  if (
                    await confirm({
                      title: 'Hand the case to a random Investigator?',
                      body: 'They will see the answer.',
                      confirmLabel: 'Hand over',
                    })
                  )
                    void act({ type: 'hand-over' });
                })()
              }
            >
              Hand over
            </Button>
          )}
        </div>
      )}
      {handover && g.stage !== 'done' && (
        <p className="rounded-xl bg-info-soft px-3 py-1.5 text-sm ring-1 ring-info-line">
          🔁 {handover.text}
        </p>
      )}
      {latest && latest.id > seenNotice && latest !== handover && g.stage !== 'done' && (
        <p className="flex items-center gap-2 rounded-xl bg-sunk px-3 py-1 text-sm">
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
      {playing && waiting && !yourMove && g.stage !== 'present' && g.stage !== 'final' && (
        <p
          className="flex flex-wrap items-center gap-1 text-xs text-ink-muted"
          aria-label="Waiting on"
        >
          Waiting on:
          {waiting.label && (
            <span className="rounded-full bg-sunk px-2 py-0.5 font-semibold">{waiting.label}</span>
          )}
          {waiting.ids.map((id) => (
            <span
              key={id}
              className="flex min-w-0 items-center gap-1 rounded-full bg-sunk px-2 py-0.5 font-semibold"
            >
              <span className="truncate">
                {id === view.me?.id
                  ? 'you'
                  : namesWithPresence([id], room.players) || nameOf(view, id)}
              </span>
              <NameDot name={nameOf(view, id)} className="order-first" />
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
  setAbandon,
}: InquestUiProps) {
  const manifest = useManifest();
  const content = useMemo(() => contentFor(manifest), [manifest]);
  const g = view.game;
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const secondsLeft = useSecondsLeft(
    g?.stage === 'present'
      ? (g.present?.deadline ?? null)
      : g?.stage === 'final'
        ? (g.final?.deadline ?? null)
        : g?.stage === 'discuss'
          ? g.deadline
          : null,
    room.clockOffset,
  );
  const status = statusFor(view, room.isHost, room, secondsLeft);
  const [marks, setMark] = useMarks(`${view.table}.${view.gameNo}`);
  const [open, setOpen] = useState<OpenCard | null>(null);
  const [solving, setSolving] = useState(false);
  const [crimeShown, setCrimeShown] = useState(false);
  // Events this screen has shown a card for, per game (it starts at whatever has already happened,
  // so a reload doesn't replay old ones). Several events can land in one change: one card each.
  const [eventsSeen, setEventsSeen] = useState({
    game: view.gameNo,
    n: view.game?.events.length ?? 0,
  });
  const [tableScreen, setTableScreen] = useState(false);
  const wide = useWideScreen();

  // The tab: each new step opens where it's needed, but the player's own choice sticks within it.
  const stepKey = `${view.gameNo}-${g?.stage}-${g?.round}-${g?.step?.kind}-${g?.event?.kind}`;
  const defaultTab: Tab =
    !g ||
    g.stage === 'night' ||
    g.stage === 'allies' ||
    g.stage === 'reversal' ||
    g.stage === 'done'
      ? 'me'
      : g.myRole === 'forensic' || g.stage === 'collect' || g.stage === 'discuss'
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
      ? `${view.gameNo}:${g.stage}:${g.round}:${g.present?.index ?? ''}:${g.final?.index ?? ''}:${g.event?.kind ?? ''}:${g.event?.kind === 'ruled-out' ? g.event.index : ''}`
      : null,
  );

  // A plain-language card for each event as it comes up.
  const seen = eventsSeen.game === view.gameNo ? eventsSeen.n : 0;
  const eventKind: EventKind | null =
    g && g.stage !== 'done' && seen < g.events.length ? (g.events[seen] ?? null) : null;

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
  const fs = g.myRole === 'forensic' || g.myRole === 'former-forensic';
  const common = { view, content, marks, setMark, onOpen: setOpen, showCrime: fs || crimeShown };
  const alert: Tab | null =
    status.yourMove && g.stage !== 'present' && g.stage !== 'discuss' && g.stage !== 'final'
      ? g.stage === 'collect' && g.event?.kind !== 'ruled-out'
        ? 'scene'
        : 'me'
      : null;

  // A watcher's table screen stays up at the end, with the result at poster size.
  if (g.stage === 'done' && !inGame && tableScreen)
    return <TableEndScreen view={view} content={content} onExit={() => setTableScreen(false)} />;
  if (g.stage === 'done') {
    return (
      <div className="mx-auto max-w-3xl space-y-3 lg:max-w-6xl">
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
      <AlliesPanel view={view} content={content} act={act} room={room} />
      <FlipPanel view={view} content={content} act={act} room={room} />
      <ReversalPanel view={view} act={act} room={room} />
    </>
  );

  return (
    <div className="space-y-2">
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
      <ForensicLine view={view} />
      <Banners view={view} room={room} act={act} content={content} yourMove={status.yourMove} />
      <DiscussBar view={view} room={room} act={act} onSolve={() => setSolving(true)} />
      <PresentBar view={view} room={room} act={act} onSolve={() => setSolving(true)} />
      <FinalBar
        view={view}
        room={room}
        act={act}
        content={content}
        onSolve={() => setSolving(true)}
      />
      {(g.stage === 'present' || g.stage === 'discuss' || g.stage === 'final') && (
        <LatestBullets g={g} content={content} />
      )}
      {(g.myRole === 'forensic' || g.myRole === 'former-forensic') && (
        <SolutionPin view={view} content={content} />
      )}
      {/* Phones: what is left of the screen holds the panels and the open tab, and scrolls inside
          when a panel (the Murderer's crime choice) leaves the tab too little room. */}
      <FitArea on={!wide} resetKey={`${stepKey}-${tab}`} className="space-y-2">
        {solvePanel}
        {/* Desktops: the suspects' cards across the full width at the top, large, then the
            scene's tiles in one row (three across on narrower desktops) with your role beside
            them, so what players study to solve (or to name the Witness) is on one screen. */}
        <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div
            className={cn('min-w-0 lg:col-start-1 lg:row-start-2', onTab('scene'))}
            {...(!wide && tabPanelProps(TABS_ID, 'scene'))}
          >
            <Scene view={view} content={content} act={act} />
            {/* Phones, while the Forensic Scientist lays out the first tiles: the suspects' cards
                under the wait, to study instead of an empty tab. */}
            {!wide && !fs && g.slots.length === 0 && g.stage === 'collect' && (
              <div className="mt-2">
                <Suspects {...common} />
              </div>
            )}
          </div>
          <div
            className={cn('min-w-0 lg:col-start-2 lg:row-start-2', onTab('me'))}
            {...(!wide && tabPanelProps(TABS_ID, 'me'))}
          >
            <MeTab
              view={view}
              content={content}
              showGuide={showGuide}
              onSolve={() => setSolving(true)}
            />
            {wide && g.bullets.length > 0 && (
              <TimelineFold g={g} content={content} className="mt-3" />
            )}
          </div>
          <div
            className={cn(
              'min-w-0 space-y-2 lg:col-span-2 lg:col-start-1 lg:row-start-1',
              onTab('suspects'),
            )}
            {...(!wide && tabPanelProps(TABS_ID, 'suspects'))}
          >
            {!fs && g.solution && <CrimePeek onShownChange={setCrimeShown} />}
            <div className="lg:hidden">
              <Suspects {...common} />
            </div>
            <div className="hidden lg:block">
              <AllSuspects {...common} />
            </div>
          </div>
        </div>
      </FitArea>
      {!wide && (
        <TabBar
          id={TABS_ID}
          label="Game sections"
          value={tab}
          onChange={setTab}
          // The "needs you" dot: on the tab holding your move, while another tab is open.
          items={TABS.map((t) => ({ ...t, badge: alert === t.id && tab !== t.id ? 'dot' : 0 }))}
        />
      )}
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
        onClose={() => {
          // The dialog's own close event fires again once it hides: only count a shown card.
          if (eventKind) setEventsSeen({ game: view.gameNo, n: seen + 1 });
        }}
        onSolve={() => setSolving(true)}
      />
    </div>
  );
}
