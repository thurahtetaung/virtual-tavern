import type { GameRoomInfo, GameUiProps } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  RefusalSlot,
  clock,
  cn,
  useSecondsLeft,
  useSpectatorPrompt,
  useConfirm,
  useAbandonGame,
  NameDot,
} from '@vt/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AWAY_SECONDS,
  type PsychicView,
  REVEAL_SECONDS,
  type SeanceAction,
  type SeanceView,
} from '../logic/types.ts';
import { type Content, contentFor, useManifest } from './assets.ts';
import { Compare, SendPreview } from './Compare.tsx';
import { EndScreen } from './End.tsx';
import { Lineup, SharedPicker, type SharedDraft, SharedRow, VoteBar } from './Final.tsx';
import { GhostHand, GhostPsychics, SilentNote } from './Ghost.tsx';
import { Lobby } from './Lobby.tsx';
import { type CompareSpec, HourClock, MineTab, OthersTab, ReadyBar } from './Psychic.tsx';
import {
  type Step,
  atTable,
  awayPsychics,
  isEmpty,
  myPsychic,
  nameOf,
  roman,
  statusFor,
  stepOf,
  waitingForVision,
} from './status.ts';
import { TableTab, Verdicts } from './Table.tsx';
import { ReadyNoteContext, useReadyNote } from './ready-note.ts';

export type SeanceUiProps = GameUiProps<SeanceView, SeanceAction>;
type Act = SeanceUiProps['act'];
type Tab = 'main' | 'others' | 'table';

/** Buzzes once each time it becomes the viewer's move (a new key). */
function useTurnBuzz(key: string | null) {
  useEffect(() => {
    if (key === null) return;
    if ('vibrate' in navigator) navigator.vibrate([150, 80, 150]);
  }, [key]);
}

function TabBar({
  tabs,
  tab,
  onChange,
  alert,
}: {
  tabs: { id: Tab; icon: string; label: string }[];
  tab: Tab;
  onChange: (t: Tab) => void;
  alert: Tab | null;
}) {
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-20 grid border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
      style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}
    >
      {tabs.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={tab === it.id ? 'page' : undefined}
          onClick={() => onChange(it.id)}
          className={cn(
            'flex flex-col items-center gap-0.5 py-1.5 text-xs font-semibold',
            tab === it.id ? 'text-violet-700 dark:text-violet-300' : 'text-ink-muted',
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

/** How long a psychic is away before the host is offered what to do about the seat. */
const AWAY_GRACE_MS = 60_000;

/** The away psychics (by colour) who have been away for at least `ms`, as seen from here. */
function useLongAway(colors: readonly string[], ms: number): string[] {
  const key = colors.join(',');
  const [long, setLong] = useState<string[]>([]);
  const [seenKey, setSeenKey] = useState(key);
  if (seenKey !== key) {
    // Someone came back (or dropped): their clock starts again.
    setSeenKey(key);
    setLong(long.filter((c) => colors.includes(c)));
  }
  useEffect(() => {
    const timers = key
      .split(',')
      .filter(Boolean)
      .map((c) => setTimeout(() => setLong((l) => (l.includes(c) ? l : [...l, c])), ms));
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [key, ms]);
  return long.filter((c) => colors.includes(c));
}

/** "Hal is away: counts as empty in 2:10", then that the seat counts as empty until they're back. */
function AwayNote({ p, clockOffset }: { p: PsychicView; clockOffset: number }) {
  const left = useSecondsLeft(p.awayUntil, clockOffset);
  return (
    <p className="text-xs text-ink-muted">
      💤 {p.name} is away:{' '}
      {p.absent || left === 0
        ? 'their seat counts as empty until they’re back.'
        : `counts as empty in ${clock(left ?? AWAY_SECONDS)}`}
    </p>
  );
}

/** The ghost's seat when the ghost is away or gone, other empty seats, and the latest notice. */
function Banners({ view, room, act }: { view: SeanceView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const [seen, setSeen] = useState(0);
  const [confirm, confirmDialog] = useConfirm();
  const playing = view.phase === 'playing';
  const ghostAway =
    g.ghost !== null && room.players.find((p) => p.id === g.ghost)?.connected === false;
  const inGame = g.myRole === 'ghost' || g.myRole === 'psychic';
  const candidates = view.seats.filter(
    (s) => s.id !== g.ghost && !g.psychics.some((p) => p.id === s.id),
  );
  const latest = g.notices.at(-1);
  // A notice belongs to the step it arrived in: the next hour (or the final) clears it, so "the
  // ghost revealed the verdicts" never lingers into the next discussion.
  const stepKey = `${g.stage}-${g.hour}`;
  const [arrived, setArrived] = useState(() => latest && { id: latest.id, key: stepKey });
  if (latest && arrived?.id !== latest.id) setArrived({ id: latest.id, key: stepKey });
  const current = !!latest && arrived?.id === latest.id && arrived.key === stepKey;
  // The verdicts say what ended the hour themselves.
  const lockNotice =
    g.stage === 'reveal' &&
    g.deadline !== null &&
    latest?.at === g.deadline - REVEAL_SECONDS * 1000;
  const gone = atTable(g).filter((p) => p.gone);
  const away = awayPsychics(g, room.players);
  const longAway = useLongAway(
    away.map((p) => p.color),
    AWAY_GRACE_MS,
  );
  const stuck = away.filter((p) => longAway.includes(p.color) && p.step < 3);
  const canRetire =
    room.isHost && (g.stage === 'visions' || g.stage === 'reveal') && atTable(g).length > 1;
  const awayNotes = playing
    ? atTable(g).filter((p) => !p.gone && (p.absent || (p.awayUntil !== null && away.includes(p))))
    : [];
  return (
    <div className="space-y-1.5">
      {confirmDialog}
      {awayNotes.map((p) => (
        <AwayNote key={p.color} p={p} clockOffset={room.clockOffset} />
      ))}
      {playing && (g.ghost === null || ghostAway) && (
        <div
          role="alert"
          className="space-y-1.5 rounded-xl bg-accent-soft px-3 py-2 text-sm ring-1 ring-accent dark:ring-amber-400 dark:bg-amber-500/15"
        >
          <p>
            ⏸{' '}
            {g.ghost === null
              ? 'The ghost’s seat is empty: the séance waits.'
              : `Waiting for the ghost (${nameOf(view, g.ghost)}, offline).`}{' '}
            Only someone watching can take over: a psychic would see the answers.
          </p>
          <div className="flex flex-wrap gap-2">
            {g.ghost === null && !inGame && view.me && (
              <Button size="sm" onClick={() => void act({ type: 'claim-ghost' })}>
                👻 Take the ghost’s seat
              </Button>
            )}
            {room.isHost &&
              candidates.map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void (async () => {
                      if (
                        await confirm({
                          title: `Make ${c.name} the ghost?`,
                          body: 'They will see every answer.',
                          confirmLabel: 'Hand the ghost over',
                        })
                      )
                        void act({ type: 'hand-ghost', to: c.id });
                    })()
                  }
                >
                  Hand the ghost to {c.id === view.me?.id ? 'me' : c.name}
                  <NameDot name={c.name} className="order-first" />
                </Button>
              ))}
            {room.isHost && !candidates.length && (
              <span className="text-xs">
                Nobody is watching yet: invite someone with the room link.
              </span>
            )}
          </div>
        </div>
      )}
      {playing && !inGame && view.me && gone.length > 0 && g.myRole !== 'former-ghost' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-info-soft px-3 py-1.5 text-sm ring-1 ring-info-line dark:bg-sky-500/10 dark:ring-sky-500/30">
          <span className="flex-1">A psychic’s seat is free.</span>
          {gone.map((p) => (
            <Button
              key={p.color}
              size="sm"
              onClick={() => void act({ type: 'take-seat', color: p.color })}
            >
              Take over {p.name}’s seat
            </Button>
          ))}
        </div>
      )}
      {room.isHost &&
        playing &&
        stuck.length > 0 &&
        (g.stage === 'visions' || g.stage === 'reveal') && (
          <div
            role="alert"
            className="space-y-1 rounded-xl bg-warn-soft px-3 py-2 text-sm ring-1 ring-warn-line dark:bg-orange-500/10 dark:ring-orange-500/30"
          >
            {stuck.map((p) => (
              <p key={p.color} className="font-semibold">
                {p.name} left: let someone watching take their seat, or retire it.
              </p>
            ))}
            <p className="text-xs">
              Their device dropped, so the seat is still theirs. The hour waits for them for{' '}
              {AWAY_SECONDS / 60} minutes, then their seat counts as empty until they’re back. If
              they aren’t coming back, remove them from the room (Players › Remove): then someone
              watching can take the seat, or you can retire it here.
            </p>
          </div>
        )}
      {canRetire && gone.length > 0 && (
        <div className="space-y-1.5 rounded-xl bg-warn-soft px-3 py-2 text-sm ring-1 ring-warn-line dark:bg-orange-500/10 dark:ring-orange-500/30">
          <p>
            An empty seat isn’t sent visions or judged, so the line-up can’t start while it waits
            for someone to take it over. If nobody will, retire it: its cards go back on the table.
          </p>
          <div className="flex flex-wrap gap-2">
            {gone.map((p) => (
              <Button
                key={p.color}
                size="sm"
                variant="secondary"
                onClick={() =>
                  void (async () => {
                    if (
                      await confirm({
                        title: `Retire ${p.name}’s seat?`,
                        body: 'Nobody can take it over afterwards, and the game goes on without it.',
                        confirmLabel: 'Retire the seat',
                        danger: true,
                      })
                    )
                      void act({ type: 'retire-seat', color: p.color });
                  })()
                }
              >
                Retire {p.name}’s seat
              </Button>
            ))}
          </div>
        </div>
      )}
      {latest && current && latest.id > seen && g.stage !== 'done' && !lockNotice && (
        <p className="flex items-center gap-2 rounded-xl bg-stone-100 px-3 py-1 text-sm dark:bg-stone-800">
          <span className="flex-1">📣 {latest.text}</span>
          <button type="button" className="text-xs font-bold" onClick={() => setSeen(latest.id)}>
            OK
          </button>
        </p>
      )}
    </div>
  );
}

const STEPS: { id: Step['id']; title: string }[] = [
  { id: 'visions', title: 'Visions' },
  { id: 'discussion', title: 'Discussion' },
  { id: 'verdicts', title: 'Verdicts' },
];
const FINAL_STEPS: { id: Step['id']; title: string }[] = [
  { id: 'lineup', title: 'Line-up' },
  { id: 'vote', title: 'Silent vote' },
];

/** Where the hour (or the final) stands: the steps in order, the current one lit and explained. */
function StepBar({ view, room, act }: { view: SeanceView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const step = stepOf(g);
  const final = step.id === 'lineup' || step.id === 'vote';
  const steps = final ? FINAL_STEPS : STEPS;
  // From hour II everyone knows the steps: their explanation folds to one line, "?" opens it.
  const brief = !final && g.hour > 1;
  const [more, setMore] = useState(false);
  // The ghost's status line already says what to do; after hour I the paragraph only repeats it.
  const silent = brief && g.myRole === 'ghost';
  return (
    <section
      aria-label={`Step: ${step.title}`}
      className="rounded-xl bg-white/70 px-3 py-2 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:ring-stone-800"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-xs font-semibold text-ink-muted">
          {final ? 'The final' : `Hour ${roman(g.hour)}`}
        </span>
        <ol className="flex flex-1 flex-wrap items-center gap-1 text-xs font-semibold">
          {steps.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === step.id ? 'step' : undefined}
              className={cn(
                'rounded-full px-2 py-0.5',
                s.id === step.id
                  ? 'bg-special dark:bg-violet-700 text-white'
                  : 'bg-stone-100 text-ink-muted dark:bg-stone-800',
              )}
            >
              {i + 1}. {s.title}
            </li>
          ))}
        </ol>
      </div>
      {silent ? null : brief ? (
        <div className="mt-1 flex items-start gap-1">
          <p
            className={cn(
              'min-w-0 flex-1 text-xs text-stone-600 dark:text-stone-400',
              !more && 'truncate',
            )}
          >
            {step.text}
          </p>
          <button
            type="button"
            aria-expanded={more}
            aria-label={more ? 'Show less' : 'What happens in this step?'}
            onClick={() => setMore(!more)}
            className="-my-1 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold text-ink-muted ring-1 ring-line hover:bg-panel dark:ring-stone-700 dark:hover:bg-stone-800"
          >
            {more ? '▴' : '?'}
          </button>
        </div>
      ) : (
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-400">{step.text}</p>
      )}
      {(g.stage === 'visions' || step.id === 'discussion') && (
        // The clock and who the hour waits for share one row.
        <div className="mt-1.5 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 border-t border-stone-200 pt-1.5 dark:border-stone-800">
          {g.stage === 'visions' && <WaitingLine view={view} room={room} act={act} />}
          {step.id === 'discussion' && <HourClock view={view} room={room} />}
        </div>
      )}
    </section>
  );
}

/**
 * What the hour waits for, always in sight: the ghost's visions, then each psychic still
 * searching (Ready or not), then the ghost's reveal (the ghost gets the button).
 */
function WaitingLine({ view, room, act }: { view: SeanceView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const away = awayPsychics(g, room.players);
  const searching = atTable(g).filter((p) => !isEmpty(p) && p.step < 3);
  const ghost = g.myRole === 'ghost';
  const unsent = waitingForVision(g);
  let body;
  if (!g.sent.length || unsent.length) {
    const all = g.sent.length + unsent.length;
    body = (
      <p>
        Waiting for the ghost: {g.sent.length} of {all} vision{all === 1 ? '' : 's'} sent
        {away.length > 0 && (
          <span className="font-normal text-ink-muted">
            {' '}
            · {away.map((p) => p.name).join(', ')} away
          </span>
        )}
      </p>
    );
  } else if (g.canReveal && ghost) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1">Everyone’s ready. Reveal the verdicts when you are.</p>
        <Button size="sm" onClick={() => void act({ type: 'reveal' }, { anchor: 'seance-reveal' })}>
          👻 Reveal the verdicts
        </Button>
      </div>
    );
  } else if (g.canReveal) {
    body = <p>Everyone’s ready: waiting for the ghost to reveal.</p>;
  } else {
    body = (
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5" aria-label="Who is ready">
        {atTable(g).map((p) => (
          <li key={p.color} className={cn(!searching.includes(p) && 'text-ink-muted')}>
            {p.step >= 3
              ? `${p.name}: done`
              : p.gone
                ? `${p.name} (left)`
                : p.absent
                  ? `💤 ${p.name} away (seat empty)`
                  : away.includes(p) && !p.ready
                    ? `💤 ${p.name} away, not ready`
                    : `${p.ready ? '✓' : '✗'} ${p.name} ${p.ready ? 'ready' : 'not ready'}`}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <div role="status" aria-label="Waiting for" className="min-w-0 flex-1 text-xs font-semibold">
      {body}
      <RefusalSlot anchor="seance-reveal" />
    </div>
  );
}

const LOCKED_BY = {
  ghost: '👻 The ghost revealed the verdicts',
  host: '🔒 The host locked the guesses in',
  timer: '⏱ Time ran out',
} as const;

/** The verdicts, held for a few seconds; the ghost or host can move the clock on. */
function RevealPanel({
  view,
  room,
  act,
  content,
}: {
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
}) {
  const g = view.game!;
  if (g.stage !== 'reveal') return null;
  const canGo = room.isHost || g.myRole === 'ghost';
  const last = g.hour >= 7;
  const allDone = atTable(g).every((p) => p.step >= 3);
  return (
    <Panel
      role="region"
      className="space-y-2 p-3 ring-2 ring-special dark:ring-violet-400"
      aria-label="The ghost answers"
    >
      {g.lockedHow && <p className="text-sm font-semibold">{LOCKED_BY[g.lockedHow]}</p>}
      <Verdicts view={view} content={content} />
      <div className="flex flex-wrap items-center gap-2">
        <p className="flex-1 text-xs text-ink-muted">
          {allDone
            ? 'Everyone has their three cards: the final comes next.'
            : last
              ? 'That was the last hour.'
              : `Hour ${roman(g.hour + 1)} next.`}
        </p>
        <Countdown
          deadline={g.deadline}
          clockOffset={room.clockOffset}
          label="until the clock moves"
          soft
          expiredLabel="Moving on…"
          expiredHint=""
        />
        {canGo && (
          <Button size="sm" onClick={() => void act({ type: 'continue' })}>
            {allDone ? 'To the final' : last ? 'See the end' : 'Next hour'}
          </Button>
        )}
      </div>
    </Panel>
  );
}

function SeanceTable({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: SeanceUiProps) {
  const manifest = useManifest();
  const g = view.game;
  const third = g?.third ?? view.settings.third ?? 'object';
  const content = useMemo(() => contentFor(manifest, third), [manifest, third]);
  const status = statusFor(view, room.isHost, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const [spec, setSpec] = useState<CompareSpec | null>(null);
  const [sendCards, setSendCards] = useState<number[]>([]);
  const [draft, setDraft] = useState<SharedDraft>({ group: null, cards: [], tags: {} });
  const [tableScreen, setTableScreen] = useState(false);
  const [confirmLock, confirmLockDialog] = useConfirm();
  const compare = useCallback((s: CompareSpec) => {
    setSendCards([]);
    setSpec(s);
  }, []);

  const role = g?.myRole ?? null;
  const ghost = role === 'ghost';
  const me = view.game ? myPsychic(view) : null;
  const finalStage = g?.stage === 'shared' || g?.stage === 'vote';
  const stepKey = `${view.gameNo}-${g?.stage}-${g?.hour}`;
  const defaultTab: Tab = !me && !ghost && !finalStage ? 'others' : 'main';
  const [picked, setPicked] = useState<{ tab: Tab; key: string }>({
    tab: defaultTab,
    key: stepKey,
  });
  const tab = picked.key === stepKey ? picked.tab : defaultTab;
  const setTab = (t: Tab) => setPicked({ tab: t, key: stepKey });

  const inGame = ghost || !!me;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing && view.phase !== 'playing'
      ? {
          text: 'Take a seat to play.',
          actionLabel: 'Take a seat',
          action: () => void act({ type: 'sit', playing: true }),
        }
      : view.phase === 'playing' && !inGame
        ? g?.ghost === null
          ? {
              text: 'The ghost’s seat is empty.',
              actionLabel: 'Be the ghost',
              action: () => void act({ type: 'claim-ghost' }),
            }
          : { text: 'You’re watching this séance; you can join the next one.' }
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
      ? `${view.gameNo}:${g.stage}:${g.hour}:${g.final?.revealed ?? ''}:${me ? g.sent.includes(me.color) : ''}`
      : null,
  );

  if (view.phase === 'lobby' || !g)
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

  const overlay = spec && (
    <CompareOverlay
      spec={spec}
      view={view}
      room={room}
      act={act}
      content={content}
      sendCards={sendCards}
      setSendCards={setSendCards}
      draft={draft}
      setDraft={setDraft}
      onClose={() => setSpec(null)}
    />
  );

  if (g.stage === 'done')
    return (
      <>
        <EndScreen view={view} room={room} act={act} content={content} />
        {overlay}
      </>
    );

  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');

  // In the final the ghost's hand is in the shared-vision picker, so no Hand tab or column.
  const ghostFinal = ghost && finalStage;
  const tabs: { id: Tab; icon: string; label: string }[] = ghost
    ? [
        { id: 'main', icon: finalStage ? '🗳️' : '👥', label: finalStage ? 'Final' : 'Psychics' },
        ...(ghostFinal ? [] : [{ id: 'others' as Tab, icon: '🃏', label: 'Hand' }]),
        { id: 'table', icon: '🕰️', label: 'Table' },
      ]
    : me
      ? [
          { id: 'main', icon: finalStage ? '🗳️' : '🔮', label: finalStage ? 'Final' : 'My vision' },
          { id: 'others', icon: '🧿', label: 'Others' },
          { id: 'table', icon: '🕰️', label: 'Table' },
        ]
      : [
          ...(finalStage ? [{ id: 'main' as Tab, icon: '🗳️', label: 'Final' }] : []),
          { id: 'others', icon: '🧿', label: 'Psychics' },
          { id: 'table', icon: '🕰️', label: 'Table' },
        ];
  const alert: Tab | null = status.yourMove ? 'main' : null;

  const finalPanel = finalStage && (
    <div className="space-y-2">
      <VoteBar view={view} room={room} act={act} />
      {/* The ghost picks beside the line-up (below it on phones), whose groups step 1 names. */}
      <div
        className={cn(
          'grid gap-2',
          ghost && g.stage === 'shared' && 'lg:grid-cols-2 lg:items-start',
        )}
      >
        <Panel className="space-y-3 p-3">
          <SharedRow g={g} content={content} tags={ghost} />
          <Lineup
            view={view}
            act={act}
            content={content}
            draft={ghost ? draft : undefined}
            setDraft={ghost ? setDraft : undefined}
          />
        </Panel>
        {ghost && g.stage === 'shared' && (
          <SharedPicker
            view={view}
            act={act}
            content={content}
            draft={draft}
            setDraft={setDraft}
            compare={compare}
          />
        )}
      </div>
    </div>
  );

  const main = finalStage ? (
    finalPanel
  ) : ghost ? (
    <GhostPsychics
      view={view}
      content={content}
      compare={compare}
      away={awayPsychics(g, room.players).map((p) => p.color)}
    />
  ) : me ? (
    <MineTab view={view} room={room} act={act} content={content} compare={compare} />
  ) : null;
  const second = ghostFinal ? null : ghost ? (
    <GhostHand view={view} act={act} content={content} />
  ) : (
    <OthersTab view={view} act={act} content={content} compare={compare} />
  );

  if (!inGame && tableScreen)
    return (
      <div className="space-y-3" aria-label="Table screen">
        <div className="flex items-center gap-3 rounded-xl bg-stone-900 px-4 py-2 text-stone-50">
          <p className="flex-1 text-xl font-semibold">{status.text}</p>
          <Button variant="secondary" size="sm" onClick={() => setTableScreen(false)}>
            Leave table screen
          </Button>
        </div>
        <StepBar view={view} room={room} act={act} />
        <RevealPanel view={view} room={room} act={act} content={content} />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableTab view={view} content={content} />
          {finalPanel || second}
        </div>
        {overlay}
      </div>
    );

  return (
    <div className="space-y-2 pb-[calc(5rem+env(safe-area-inset-bottom))] lg:pb-0">
      {ghost && <SilentNote />}
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <StepBar view={view} room={room} act={act} />
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
      <Banners view={view} room={room} act={act} />
      <RevealPanel view={view} room={room} act={act} content={content} />
      {room.isHost && g.stage === 'visions' && g.sent.length > 0 && !waitingForVision(g).length && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="ghost"
            className={cn(tab !== 'table' && 'hidden lg:inline-flex')}
            onClick={() =>
              void (async () => {
                if (
                  await confirmLock({
                    title: 'Lock the guesses in now?',
                    body: 'Every guess is judged as it stands, without waiting for Ready or the ghost’s reveal.',
                    confirmLabel: 'Lock them in',
                  })
                )
                  void act({ type: 'lock-now' });
              })()
            }
          >
            🔒 Lock the guesses in now
          </Button>
        </div>
      )}
      <div
        className={cn(
          'grid gap-3',
          ghostFinal
            ? 'lg:grid-cols-[minmax(0,12fr)_minmax(0,4fr)]'
            : ghost
              ? 'lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)_minmax(0,4fr)]'
              : 'lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)_minmax(0,4fr)]',
        )}
      >
        {main && <div className={cn('min-w-0 space-y-2', onTab('main'))}>{main}</div>}
        {second && <div className={cn('min-w-0', onTab('others'))}>{second}</div>}
        <div className={cn('min-w-0 space-y-2', onTab('table'))}>
          <TableTab view={view} content={content} />
        </div>
      </div>
      <TabBar tabs={tabs} tab={tab} onChange={setTab} alert={alert} />
      {overlay}
      {confirmLockDialog}
    </div>
  );
}

export function SeanceGame(props: SeanceUiProps) {
  const readyNote = useReadyNote(props.view);
  return (
    <ReadyNoteContext.Provider value={readyNote}>
      <SeanceTable {...props} />
    </ReadyNoteContext.Provider>
  );
}

/** The compare view, wired to what the viewer can do with it. */
function CompareOverlay({
  spec,
  view,
  room,
  act,
  content,
  sendCards,
  setSendCards,
  draft,
  setDraft,
  onClose,
}: {
  spec: CompareSpec;
  view: SeanceView;
  room: GameRoomInfo;
  act: Act;
  content: Content;
  sendCards: number[];
  setSendCards: (c: number[]) => void;
  draft: SharedDraft;
  setDraft: (d: SharedDraft) => void;
  onClose: () => void;
}) {
  const g = view.game!;
  const me = myPsychic(view);
  const [previewing, setPreviewing] = useState(false);
  let selected: number[] = [];
  let onToggle: ((c: number) => void) | undefined;
  let footer = null;
  let pickLabel = 'Pick';
  let pickedLabel = '✓ Picked';
  let canPick: ((c: number) => boolean) | undefined;
  if (spec.mode === 'guess' && me && g.stage === 'visions') {
    selected = me.intuition !== null ? [me.intuition] : [];
    pickLabel = 'Guess';
    pickedLabel = '✓ Your guess';
    onToggle = (c) =>
      void act(
        { type: 'intuition', card: me.intuition === c ? null : c },
        { anchor: 'seance-ready' },
      );
    footer = <ReadyBar view={view} room={room} act={act} content={content} clock />;
  } else if (spec.mode === 'send' && spec.to) {
    const p = g.psychics.find((x) => x.color === spec.to);
    const live = sendCards.filter((c) => g.hand?.includes(c));
    const closed = g.stage !== 'visions' || g.sent.includes(spec.to);
    const target = spec.pinned.cards[0];
    if (previewing && live.length && target !== undefined)
      return (
        <SendPreview
          name={p?.name ?? 'them'}
          target={{ kind: spec.pinned.kind, n: target }}
          cards={live}
          content={content}
          disabled={closed}
          onBack={() => setPreviewing(false)}
          onSend={() =>
            void act({ type: 'send', to: spec.to!, cards: live }).then((ok) => {
              if (ok) onClose();
            })
          }
        />
      );
    selected = live;
    onToggle = (c) => setSendCards(live.includes(c) ? live.filter((x) => x !== c) : [...live, c]);
    footer = (
      <Button
        size="lg"
        className="w-full"
        disabled={!live.length || closed}
        onClick={() => setPreviewing(true)}
      >
        {live.length
          ? `Preview ${live.length} card${live.length === 1 ? '' : 's'} for ${p?.name ?? 'them'} →`
          : 'Pick the cards to send'}
      </Button>
    );
  } else if (spec.mode === 'shared') {
    const live = draft.cards.filter((c) => g.hand?.includes(c));
    selected = live;
    canPick = () => live.length < 3;
    onToggle = (c) =>
      setDraft({
        ...draft,
        cards: live.includes(c)
          ? live.filter((x) => x !== c)
          : live.length < 3
            ? [...live, c]
            : live,
      });
    footer = (
      <Button size="lg" className="w-full" onClick={onClose}>
        {live.length === 3 ? 'Done: tag them and send' : `Picked ${live.length} of 3 · Done`}
      </Button>
    );
  }
  return (
    <Compare
      title={spec.title}
      pinned={spec.pinned}
      pinnedLabel={spec.pinnedLabel}
      strip={spec.strip}
      stripLabel={spec.stripLabel}
      selected={selected}
      onToggle={onToggle}
      footer={footer}
      content={content}
      onClose={onClose}
      start={spec.start}
      pickLabel={pickLabel}
      pickedLabel={pickedLabel}
      canPick={canPick}
    />
  );
}
