import { type GameRoomInfo, type GameUiProps, namesWithPresence } from '@vt/game-sdk';
import { Button, Countdown, Hint, cn, useRefusalWording, useSpectatorPrompt } from '@vt/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COPY, type CopyKey } from '../logic/copy.ts';
import {
  LEADER_ZONE,
  NUDGE_MS,
  type HydraAction,
  type HydraView,
  type Notice,
} from '../logic/types.ts';
import { type Content, GAME_ID, contentFor, useManifest } from './assets.ts';
import { Board, DeckChip, MiniTracks, ScoreLegend } from './Boards.tsx';
import { PolicyBack } from './Cards.tsx';
import { Dock, TaskSheet, secretTask } from './Dock.tsx';
import { End } from './End.tsx';
import { playSfx, prefersReducedMotion, useBuzz } from './fx.ts';
import { Lobby } from './Lobby.tsx';
import { PlayerRecord, Timeline } from './Log.tsx';
import { MeTab } from './Me.tsx';
import { Chaos, LeaderCheck, MomentView, useMoments } from './Moments.tsx';
import { type SeatPick, Seats, whyText } from './Seats.tsx';
import {
  useMomentsSetting,
  useNotes,
  usePlainHeadings,
  useSoundSetting,
  useSuspicions,
  useTips,
} from './storage.ts';
import { HydraStyles } from './styles.tsx';
import { amAlive, nameOf, statusFor, waitingOn } from './status.ts';
import { ThemeRoot } from './theme.tsx';

export type HydraUiProps = GameUiProps<HydraView, HydraAction> & {
  /** The edition's game id (its manifest and art); Hydra's own by default. */
  edition?: string;
};
type Act = HydraUiProps['act'];
type Tab = 'table' | 'log' | 'me';

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
    { id: 'table', icon: '🏛️', label: 'Table' },
    { id: 'log', icon: '📜', label: 'Log' },
    { id: 'me', icon: '🎭', label: 'Me' },
  ];
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
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
              <span className="size-2.5 rounded-full bg-accent dark:bg-amber-500" />
            )}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

/** Always on top: both tracks, the tracker, who's next, the clock, sound and your role. */
function HeaderStrip({
  view,
  room,
  c,
  sound,
  setSound,
  onRole,
  legend,
  onLegend,
}: {
  view: HydraView;
  room: GameRoomInfo;
  c: Content;
  sound: boolean;
  setSound: (on: boolean) => void;
  onRole: () => void;
  /** The scoreboard's legend is open. */
  legend: boolean;
  onLegend: () => void;
}) {
  const g = view.game!;
  const strict = view.settings.timerMode === 'strict';
  const claim = view.stage === 'claim';
  const deadline = claim ? g.claimDeadline : g.deadline;
  const timed = deadline !== null && view.stage !== 'leader-check' && view.stage !== 'chaos';
  return (
    <div className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-sky-950 via-stone-900 to-red-950 px-2.5 py-1.5 text-white shadow-md">
      <button
        type="button"
        className="-m-1 flex min-w-0 shrink-0 items-center rounded-lg p-1 hover:bg-white/10"
        aria-expanded={legend}
        aria-label={c.copy('legend.button')}
        onClick={onLegend}
        data-testid="scoreboard"
      >
        <MiniTracks g={g} c={c} />
      </button>
      <span
        className="min-w-0 flex-1 truncate text-right text-[0.7rem] leading-tight text-white/80"
        data-testid="next-president"
      >
        {view.phase === 'playing' && (
          <>
            <span className="hidden sm:inline">Next </span>
            <span aria-label={c.t('Next {president}')}>🎩</span>{' '}
            <b className="text-white">{nameOf(view, g.nextPresident)}</b>
          </>
        )}
      </span>
      {timed && (
        <span className="[&_[role=timer]]:min-w-0 [&_[role=timer]]:px-1.5 [&_[role=timer]]:py-0 [&_span]:text-xs">
          <Countdown
            deadline={deadline}
            clockOffset={room.clockOffset}
            {...(claim || !strict
              ? { soft: true, expiredHint: claim ? 'The host may skip' : 'Time’s up' }
              : {})}
          />
        </span>
      )}
      <button
        type="button"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm"
        aria-label={sound ? 'Sound on (tap to mute)' : 'Sound off (tap to turn on)'}
        aria-pressed={sound}
        onClick={() => {
          setSound(!sound);
          if (!sound) playSfx('flip');
        }}
      >
        {sound ? '🔊' : '🔇'}
      </button>
      {view.role && (
        <button
          type="button"
          onClick={onRole}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-sm"
          aria-label="My role"
        >
          🎭
        </button>
      )}
    </div>
  );
}

/** "Waiting on" chips: nudge anyone, and the host can act for an absent player or skip a claim. */
function WaitingChips({
  view,
  room,
  act,
  now,
}: {
  view: HydraView;
  room: GameRoomInfo;
  act: Act;
  now: number;
}) {
  const ids = waitingOn(view);
  const g = view.game!;
  if (!ids.length || view.phase !== 'playing' || view.stage === 'reveal') return null;
  const claimDue = view.stage === 'claim' && g.claimDeadline !== null && now >= g.claimDeadline;
  // One line that scrolls sideways, so a big table's vote never pushes the seats under the dock.
  return (
    <div
      className="flex items-center gap-1.5 overflow-x-auto text-xs whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      data-testid="waiting-on"
    >
      <span className="shrink-0 font-semibold text-stone-600 dark:text-stone-400">
        Waiting on{ids.length > 3 ? ` (${ids.length})` : ''}:
      </span>
      {ids.map((id) => {
        const online = room.players.find((p) => p.id === id)?.connected ?? false;
        const mine = id === view.me?.id;
        const recently = (g.nudges[id] ?? 0) + NUDGE_MS > now;
        return (
          <span
            key={id}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sky-100 py-0.5 pr-1 pl-2 font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-100"
          >
            {mine ? 'you' : namesWithPresence([id], room.players) || nameOf(view, id)}
            {!mine && online && view.role && (
              <button
                type="button"
                disabled={recently}
                className="rounded-full px-1 disabled:opacity-40"
                aria-label={`Nudge ${nameOf(view, id)}`}
                title="Nudge: buzz their phone"
                onClick={() => void act({ type: 'nudge', player: id })}
              >
                👋
              </button>
            )}
            {room.isHost && !mine && view.stage === 'claim' && claimDue && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  if (
                    window.confirm(
                      `Skip ${nameOf(view, id)}’s claim? It’s logged as “no claim, skipped by host”.`,
                    )
                  )
                    void act({ type: 'skip-claim', player: id });
                }}
              >
                Skip claim
              </Button>
            )}
            {room.isHost && !mine && !online && view.stage !== 'claim' && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  if (
                    window.confirm(
                      `Act for ${nameOf(view, id)}? A random legal move is played (a vote isn’t counted), and everyone is told.`,
                    )
                  )
                    void act({ type: 'act-for', player: id });
                }}
              >
                Act for
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** The first-time tip for this moment, if the viewer hasn't dismissed it. */
function tipFor(
  view: HydraView,
  c: Content,
  fresh: (id: string) => boolean,
): [string, string] | null {
  const g = view.game;
  if (!g || view.phase !== 'playing' || !view.role) return null;
  const mine = view.stage === 'nominate' && g.president === view.me?.id;
  const tips: [
    'nominate' | 'scoreboard' | 'marks' | 'term' | 'tracker' | 'claims' | 'danger',
    boolean,
  ][] = [
    ['nominate', mine],
    ['scoreboard', view.stage === 'nominate'],
    ['marks', view.stage === 'nominate'],
    ['term', mine],
    ['tracker', g.tracker > 0],
    ['claims', view.stage === 'claim'],
    ['danger', g.enacted.red >= LEADER_ZONE],
  ];
  const tip = tips.find(([id, when]) => when && fresh(id));
  return tip ? [tip[0], c.copy(`tip.${tip[0]}`)] : null;
}

/** Phones show one board at a time (swipe), jumping to the one that just changed. */
function BoardCarousel({ view, c }: { view: HydraView; c: Content }) {
  const g = view.game!;
  const ref = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(0);
  const last = useRef(g.enacted);
  useEffect(() => {
    const el = ref.current;
    const prev = last.current;
    last.current = g.enacted;
    if (!el) return;
    const to = g.enacted.blue > prev.blue ? 1 : g.enacted.red > prev.red ? 0 : null;
    if (to !== null) el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
  }, [g.enacted]);
  return (
    <div className="space-y-1">
      <div
        ref={ref}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) =>
          setAt(Math.round(e.currentTarget.scrollLeft / Math.max(1, e.currentTarget.clientWidth)))
        }
        aria-label="Boards (swipe)"
      >
        <div className="w-full shrink-0 snap-center">
          <Board team="red" g={g} c={c} compact />
        </div>
        <div className="w-full shrink-0 snap-center">
          <Board team="blue" g={g} c={c} compact />
        </div>
      </div>
      <div className="flex items-center justify-center gap-1.5" aria-hidden>
        {[0, 1].map((i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 rounded-full transition-all',
              at === i ? 'w-4 bg-accent dark:bg-amber-500' : 'w-1.5 bg-stone-300 dark:bg-stone-700',
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The desktop table: seats around both boards, the deck and the discard pile beside them. */
function TableRing({
  view,
  c,
  seats,
}: {
  view: HydraView;
  c: Content;
  seats: (ids: string[], columns: number) => React.ReactNode;
}) {
  const g = view.game!;
  const ids = g.players.map((p) => p.id);
  const half = Math.ceil(ids.length / 2);
  const top = ids.slice(0, half);
  const bottom = ids.slice(half).reverse();
  return (
    <div className="space-y-3">
      {seats(top, half)}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_4.5rem] items-center gap-3 rounded-3xl bg-gradient-to-b from-emerald-950 to-stone-900 p-4 shadow-inner">
        <Pile label="Deck" count={g.deckCount} c={c} />
        <div className="space-y-2">
          <Board team="red" g={g} c={c} />
          <Board team="blue" g={g} c={c} />
        </div>
        <Pile label="Discard" count={g.discardCount} c={c} />
      </div>
      {seats(bottom, Math.max(1, ids.length - half))}
    </div>
  );
}

/**
 * The players' seats as their own bounded, tinted surface with a "The table" heading, so they read
 * as seats at a glance; when it's your pick, it says so and the edge lights up.
 */
function SeatsPanel({
  c,
  picking,
  panelRef,
  className,
  children,
}: {
  c: Content;
  picking: boolean;
  panelRef: React.Ref<HTMLElement>;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={panelRef}
      aria-label={c.copy('seats.heading')}
      className={cn(
        'scroll-mt-20 rounded-2xl bg-stone-200/70 p-2 shadow-inner ring-1 ring-stone-300 lg:p-3 dark:bg-stone-900 dark:ring-stone-700',
        picking && 'ring-2 ring-accent dark:ring-amber-500/70',
        className,
      )}
      data-testid="seats-panel"
    >
      <h3 className="mb-1.5 flex items-center justify-between px-0.5 text-xs font-bold tracking-wide text-stone-600 uppercase lg:mb-2 lg:text-sm dark:text-stone-400">
        <span>👥 {c.copy('seats.heading')}</span>
        {picking && (
          <span className="hy-breathe text-amber-700 normal-case dark:text-amber-400">
            {c.copy('seats.pick')} 👇
          </span>
        )}
      </h3>
      {children}
    </section>
  );
}

function Pile({ label, count, c }: { label: string; count: number; c: Content }) {
  return (
    <div className="flex flex-col items-center gap-1 text-center text-xs font-semibold text-white/80">
      <div className="relative w-14">
        {count > 1 && (
          <span className="absolute top-1.5 left-1.5 w-14 opacity-50">
            <PolicyBack c={c} />
          </span>
        )}
        {count > 0 ? (
          <span className="relative block w-14">
            <PolicyBack c={c} />
          </span>
        ) : (
          <span className="block aspect-[2/3] w-14 rounded-lg border-2 border-dashed border-white/30" />
        )}
      </div>
      <span>
        {label} <b className="text-white">{count}</b>
      </span>
    </div>
  );
}

export function HydraGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  edition = GAME_ID,
}: HydraUiProps) {
  const manifest = useManifest(edition);
  const c = useMemo(() => contentFor(manifest, edition), [manifest, edition]);
  const [plain, setPlain] = usePlainHeadings();
  const [legend, setLegend] = useState(false);
  const seatsRef = useRef<HTMLElement>(null);
  const deskSeatsRef = useRef<HTMLElement>(null);
  // The server words its refusals with name tokens ("Only the {president} discards now.").
  useRefusalWording(c.t);
  const g = view.game;
  const status = statusFor(view, c);
  const [sound, setSound] = useSoundSetting();
  const [marks, cycleMark] = useSuspicions(`${view.table}.${view.gamesPlayed}`);
  const [notes, setNote] = useNotes(`${view.table}.${view.gamesPlayed}`);
  const [fresh, dismissTip] = useTips();
  const [why, setWhy] = useState<{ text: string; at: number } | null>(null);
  const [record, setRecord] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now() + room.clockOffset);
  const [momentsOn, setMomentsOn] = useMomentsSetting();
  const { current: moment, skip } = useMoments(view, sound, momentsOn);

  // A clock for the claim reminder and nudges.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() + room.clockOffset), 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [room.clockOffset]);

  const stageKey = `${view.gamesPlayed}:${g?.rounds.length ?? 0}:${view.stage}:${g?.power ?? ''}`;
  const [picked, setPicked] = useState<{ key: string; id: string | null }>({ key: '', id: null });
  const target = picked.key === stageKey ? picked.id : null;

  // The tab: each stage opens where it's needed, but the player's own choice sticks within it.
  const defaultTab: Tab = view.stage === 'reveal' ? 'me' : 'table';
  const [tabPick, setTabPick] = useState<{ tab: Tab; key: string }>({
    tab: defaultTab,
    key: stageKey,
  });
  const tab = tabPick.key === stageKey ? tabPick.tab : defaultTab;
  const setTab = (t: Tab) => setTabPick({ tab: t, key: stageKey });

  const task = g ? secretTask(view) : null;

  // Your turn to pick a seat (nominate, or a power on a player): bring the seats into view.
  const myPick =
    !!g &&
    view.phase === 'playing' &&
    amAlive(view) &&
    g.president === view.me?.id &&
    (view.stage === 'nominate' || (view.stage === 'power' && !!g.power && g.power !== 'peek'));
  const pickKey = myPick ? stageKey : null;
  // The seats panel on screen: the phone's, or the desktop's around the board.
  const seatsOnScreen = useCallback(
    () => [seatsRef.current, deskSeatsRef.current].find((el) => el && el.offsetParent !== null),
    [],
  );
  const showSeats = useCallback(() => {
    const el = seatsOnScreen();
    if (!el) return;
    el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  }, [seatsOnScreen]);
  useEffect(() => {
    const el = seatsOnScreen();
    if (!pickKey || !el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.55) showSeats();
  }, [pickKey, showSeats, seatsOnScreen]);
  const taskKey = `${stageKey}:${g?.needs.length ?? 0}:${g?.vetoRefused ?? ''}`;
  const [closedTask, setClosedTask] = useState('');
  const sheetOpen = !!task && !moment && closedTask !== taskKey;

  const inGame = !!g?.players.some((p) => p.id === view.me?.id);
  useSpectatorPrompt(
    setSpectator,
    view.phase === 'lobby'
      ? view.me && !view.me.playing
        ? {
            text: 'Take a seat to play.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : null
      : !inGame
        ? { text: c.copy('spectator') }
        : null,
  );

  const yourMove = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(yourMove);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, yourMove]);
  const turnKey = yourMove ? taskKey : null;
  useBuzz(turnKey);
  const nudged = g && view.me ? (g.nudges[view.me.id] ?? null) : null;
  useBuzz(nudged !== null ? `nudge:${nudged}` : null);
  useEffect(() => {
    if (turnKey && sound) playSfx('turn');
  }, [turnKey, sound]);

  if (view.phase === 'lobby' || !g)
    return (
      <ThemeRoot c={c} plain={plain}>
        <HydraStyles />
        <Lobby
          view={view}
          room={room}
          c={c}
          act={act}
          showGuide={showGuide}
          plain={plain}
          setPlain={setPlain}
        />
      </ThemeRoot>
    );

  const me = view.me?.id;
  let pick: SeatPick | null = null;
  if (view.phase === 'playing' && amAlive(view)) {
    if (view.stage === 'nominate' && g.president === me) {
      pick = {
        label: (n) => c.t(`Nominate ${n} as {chancellor}`),
        selected: (id) => target === id,
        why: (id) => (g.ineligible[id] ? whyText(c, g.ineligible[id]) : null),
        onPick: (id) => setPicked({ key: stageKey, id }),
      };
    } else if (view.stage === 'power' && g.president === me && g.power && g.power !== 'peek') {
      const power = g.power;
      pick = {
        label: (n) => `${c.powerName(power)}: ${n}`,
        selected: (id) => target === id,
        why: (id) => {
          const p = g.players.find((x) => x.id === id)!;
          if (id === me) return whyText(c, 'self');
          if (p.dead) return whyText(c, 'dead');
          if (power === 'investigate' && g.investigated.includes(id))
            return whyText(c, 'investigated');
          return null;
        },
        onPick: (id) => setPicked({ key: stageKey, id }),
      };
    }
  }

  const tip = tipFor(view, c, fresh);
  const seatGrid = (ids?: string[], columns?: number) => (
    <Seats
      view={view}
      room={room}
      c={c}
      pick={pick}
      marks={marks}
      onMark={cycleMark}
      onOpen={setRecord}
      onWhy={(text) => setWhy({ text, at: Date.now() + room.clockOffset })}
      ids={ids}
      columns={columns}
    />
  );
  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');
  // The rulebook's discussion windows: before the vote, and after a session (claims) until the
  // next nomination. Each one is prompted explicitly.
  const talkNow =
    view.phase !== 'playing'
      ? null
      : view.stage === 'vote'
        ? c.copy('talk.vote')
        : view.stage === 'claim' ||
            (view.stage === 'nominate' && (g.rounds.at(-1)?.claims.length ?? 0) > 0)
          ? c.copy('talk.claims')
          : null;
  const latest = g.notices.at(-1);
  const showWhy = why && now - why.at < 6000;
  const alert: Tab | null = task
    ? null
    : view.stage === 'reveal'
      ? 'me'
      : yourMove
        ? 'table'
        : null;

  if (view.phase === 'over') {
    return (
      <ThemeRoot c={c} plain={plain} className="space-y-3 pb-4">
        <HydraStyles />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <End view={view} room={room} c={c} act={act} />
          <Timeline view={view} c={c} />
        </div>
        <MomentView view={view} c={c} moment={moment} onSkip={skip} sound={sound} />
      </ThemeRoot>
    );
  }

  return (
    <ThemeRoot c={c} plain={plain} className="space-y-2 pb-20 lg:pb-4">
      <HydraStyles />
      <HeaderStrip
        view={view}
        room={room}
        c={c}
        sound={sound}
        setSound={setSound}
        onRole={() => setTab('me')}
        legend={legend}
        onLegend={() => {
          setLegend(!legend);
          dismissTip('scoreboard');
        }}
      />
      {legend && <ScoreLegend g={g} c={c} onClose={() => setLegend(false)} />}
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {talkNow && (
        <p className="hy-rise rounded-xl bg-special-soft px-3 py-1.5 text-center text-sm font-semibold text-violet-950 ring-1 ring-special-line dark:bg-violet-500/15 dark:text-violet-100 dark:ring-violet-500/40">
          🗣️ {talkNow}
        </p>
      )}
      {latest && now - latest.at < 20_000 && (
        <p
          className="rounded-xl bg-stone-100 px-3 py-1 text-center text-sm dark:bg-stone-800"
          role="status"
        >
          📣 {noticeText(c, latest)}
        </p>
      )}
      {nudged !== null && now - nudged < NUDGE_MS && status.yourMove && (
        <p className="hy-pop rounded-xl bg-accent-line dark:bg-amber-400 px-3 py-1 text-center text-sm font-bold text-stone-950">
          👋 {c.copy('nudged')}
        </p>
      )}
      <WaitingChips view={view} room={room} act={act} now={now} />
      {showWhy && (
        <p
          role="alert"
          className="rounded-xl bg-danger-soft px-3 py-1.5 text-center text-sm text-rose-900 ring-1 ring-danger-line dark:ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100"
        >
          🔒 {why.text}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1.3fr)]">
        <div className="min-w-0 space-y-2">
          {view.stage === 'reveal' && inGame ? (
            <div className={cn('space-y-3', onTab('me'))}>
              <MeTab
                view={view}
                c={c}
                showGuide={showGuide}
                big
                moments={momentsOn}
                setMoments={setMomentsOn}
                plain={plain}
                setPlain={setPlain}
              />
            </div>
          ) : (
            <>
              <div className={cn('space-y-2', onTab('table'))}>
                <div className="lg:hidden">
                  <BoardCarousel view={view} c={c} />
                  <DeckChip g={g} c={c} className="mt-1" />
                </div>
                <SeatsPanel c={c} picking={!!pick} panelRef={seatsRef} className="lg:hidden">
                  {seatGrid()}
                </SeatsPanel>
                <div className="hidden lg:block">
                  <SeatsPanel c={c} picking={!!pick} panelRef={deskSeatsRef}>
                    <TableRing view={view} c={c} seats={(ids, cols) => seatGrid(ids, cols)} />
                  </SeatsPanel>
                  <DeckChip g={g} c={c} className="mt-2" />
                </div>
              </div>
              <div className={cn('lg:hidden', onTab('me'))}>
                <MeTab
                  view={view}
                  c={c}
                  showGuide={showGuide}
                  moments={momentsOn}
                  setMoments={setMomentsOn}
                  plain={plain}
                  setPlain={setPlain}
                />
              </div>
            </>
          )}
          {/* Tips sit under the table, so they never push a seat under the dock. */}
          {tip && (
            <div className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
              <span className="flex-1">💡 {tip[1]}</span>
              <button
                type="button"
                className="text-xs font-bold"
                onClick={() => dismissTip(tip[0])}
              >
                Got it
              </button>
            </div>
          )}
          <Dock
            view={view}
            c={c}
            act={act}
            target={target}
            onClearTarget={() => setPicked({ key: stageKey, id: null })}
            onOpenTask={() => setClosedTask('')}
            onShowSeats={showSeats}
          />
        </div>
        <aside className={cn('min-w-0 space-y-3', onTab('log'))}>
          {view.stage !== 'reveal' && (
            <div className="hidden lg:block">
              <MeTab
                view={view}
                c={c}
                showGuide={showGuide}
                moments={momentsOn}
                setMoments={setMomentsOn}
                plain={plain}
                setPlain={setPlain}
              />
            </div>
          )}
          <Timeline view={view} c={c} />
          {room.isHost && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                if (window.confirm('End this game for everyone and go back to the lobby?'))
                  void act({ type: 'back-to-lobby' });
              }}
            >
              Abandon game
            </Button>
          )}
        </aside>
      </div>
      <TabBar tab={tab} onChange={setTab} alert={alert} />
      <TaskSheet
        view={view}
        c={c}
        act={act}
        open={sheetOpen}
        onClose={() => setClosedTask(taskKey)}
      />
      <PlayerRecord
        view={view}
        c={c}
        id={record}
        onClose={() => setRecord(null)}
        marks={marks}
        onMark={cycleMark}
        notes={notes}
        setNote={setNote}
      />
      {view.stage === 'leader-check' && <LeaderCheck view={view} c={c} />}
      {view.stage === 'chaos' && <Chaos c={c} />}
      <MomentView view={view} c={c} moment={moment} onSkip={skip} sound={sound} />
    </ThemeRoot>
  );
}

/** A notice in the edition's words (older notices without a key keep their own text). */
function noticeText(c: Content, n: Notice): string {
  const key = n.key && n.key in COPY ? (n.key as CopyKey) : null;
  return key ? c.copy(key, n.vars ?? {}) : c.t(n.text);
}
