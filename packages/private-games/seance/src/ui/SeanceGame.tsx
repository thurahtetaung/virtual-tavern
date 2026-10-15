import type { GameRoomInfo, GameUiProps } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  cn,
  useSpectatorPrompt,
  useConfirm,
  useAbandonGame,
} from '@vt/ui';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { PILLARS } from '../logic/cards.ts';
import type { SeanceAction, SeanceView } from '../logic/types.ts';
import { type Content, contentFor, useManifest } from './assets.ts';
import { Compare } from './Compare.tsx';
import { EndScreen } from './End.tsx';
import { Lineup, SharedPicker, type SharedDraft, SharedRow, VoteBar } from './Final.tsx';
import { GhostHand, GhostPsychics, SilentNote } from './Ghost.tsx';
import { Lobby } from './Lobby.tsx';
import { type CompareSpec, MineTab, OthersTab, ReadyBar } from './Psychic.tsx';
import {
  type Step,
  atTable,
  myPsychic,
  nameOf,
  roman,
  statusFor,
  stepOf,
  waitingForVision,
} from './status.ts';
import { TableTab, Verdicts } from './Table.tsx';

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
  const gone = atTable(g).filter((p) => p.gone);
  const canRetire =
    room.isHost && (g.stage === 'visions' || g.stage === 'reveal') && atTable(g).length > 1;
  return (
    <div className="space-y-1.5">
      {confirmDialog}
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
      {latest && latest.id > seen && g.stage !== 'done' && (
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
function StepBar({ view, room }: { view: SeanceView; room: GameRoomInfo }) {
  const g = view.game!;
  const step = stepOf(g);
  const final = step.id === 'lineup' || step.id === 'vote';
  const steps = final ? FINAL_STEPS : STEPS;
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
      <div className="mt-1 flex items-start gap-2">
        <p className="flex-1 text-xs text-stone-600 dark:text-stone-400">{step.text}</p>
        {step.id === 'discussion' && (myPsychic(view)?.step ?? 3) >= 3 && (
          <Countdown
            deadline={g.deadline}
            clockOffset={room.clockOffset}
            label="to discuss"
            soft={view.settings.timerMode !== 'strict'}
            atZero={view.settings.timerMode === 'strict' ? 'then guesses lock' : undefined}
            expiredHint={
              view.settings.timerMode === 'strict' ? undefined : 'The host can lock the guesses in.'
            }
          />
        )}
      </div>
    </section>
  );
}

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

export function SeanceGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: SeanceUiProps) {
  const manifest = useManifest();
  const content = useMemo(() => contentFor(manifest), [manifest]);
  const g = view.game;
  const status = statusFor(view, room.isHost, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const [spec, setSpec] = useState<CompareSpec | null>(null);
  const [sendCards, setSendCards] = useState<number[]>([]);
  const [draft, setDraft] = useState<SharedDraft>({ group: null, cards: [], tags: {} });
  const [tableScreen, setTableScreen] = useState(false);
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
        <EndScreen view={view} room={room} act={act} content={content} compare={compare} />
        {overlay}
      </>
    );

  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');
  const openTable = (kind: (typeof PILLARS)[number], n: number) =>
    compare({ title: content.cardLabel(kind, n), pinned: { kind, cards: [n] }, mode: 'view' });

  const tabs: { id: Tab; icon: string; label: string }[] = ghost
    ? [
        { id: 'main', icon: finalStage ? '🗳️' : '👥', label: finalStage ? 'Final' : 'Psychics' },
        { id: 'others', icon: '🃏', label: 'Hand' },
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
      <VoteBar view={view} room={room} act={act} />
      <Panel className="space-y-3 p-3">
        <SharedRow g={g} content={content} tags={ghost} />
        <Lineup
          view={view}
          act={act}
          content={content}
          draft={ghost ? draft : undefined}
          setDraft={ghost ? setDraft : undefined}
          compare={compare}
        />
      </Panel>
    </div>
  );

  const main = finalStage ? (
    finalPanel
  ) : ghost ? (
    <GhostPsychics view={view} content={content} compare={compare} />
  ) : me ? (
    <MineTab view={view} room={room} act={act} content={content} compare={compare} />
  ) : null;
  const second = ghost ? (
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
        <RevealPanel view={view} room={room} act={act} content={content} />
        <div className="grid gap-4 xl:grid-cols-2">
          <TableTab view={view} content={content} onOpen={openTable} />
          {finalPanel || second}
        </div>
        {overlay}
      </div>
    );

  return (
    <div className="space-y-2 pb-16 lg:pb-0">
      {ghost && <SilentNote />}
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <StepBar view={view} room={room} />
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
            onClick={() => void act({ type: 'lock-now' })}
          >
            🔒 Lock the guesses in now
          </Button>
        </div>
      )}
      <div
        className={cn(
          'grid gap-3',
          ghost
            ? 'lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)_minmax(0,4fr)]'
            : 'lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)_minmax(0,4fr)]',
        )}
      >
        {main && <div className={cn('min-w-0 space-y-2', onTab('main'))}>{main}</div>}
        <div className={cn('min-w-0', onTab('others'))}>{second}</div>
        <div className={cn('min-w-0 space-y-2', onTab('table'))}>
          <TableTab view={view} content={content} onOpen={openTable} />
        </div>
      </div>
      <TabBar tabs={tabs} tab={tab} onChange={setTab} alert={alert} />
      {overlay}
    </div>
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
  let selected: number[] = [];
  let onToggle: ((c: number) => void) | undefined;
  let footer = null;
  if (spec.mode === 'guess' && me && g.stage === 'visions') {
    selected = me.intuition !== null ? [me.intuition] : [];
    onToggle = (c) =>
      void act(
        { type: 'intuition', card: me.intuition === c ? null : c },
        { anchor: 'seance-ready' },
      );
    footer = <ReadyBar view={view} room={room} act={act} content={content} />;
  } else if (spec.mode === 'send' && spec.to) {
    const p = g.psychics.find((x) => x.color === spec.to);
    const live = sendCards.filter((c) => g.hand?.includes(c));
    selected = live;
    onToggle = (c) => setSendCards(live.includes(c) ? live.filter((x) => x !== c) : [...live, c]);
    footer = (
      <Button
        size="lg"
        className="w-full"
        disabled={!live.length || g.stage !== 'visions' || g.sent.includes(spec.to)}
        onClick={() =>
          void act({ type: 'send', to: spec.to!, cards: live }).then((ok) => {
            if (ok) onClose();
          })
        }
      >
        {live.length
          ? `👻 Send ${live.length} card${live.length === 1 ? '' : 's'} to ${p?.name ?? 'them'}`
          : 'Tap the cards to send'}
      </Button>
    );
  } else if (spec.mode === 'shared') {
    const live = draft.cards.filter((c) => g.hand?.includes(c));
    selected = live;
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
    />
  );
}
