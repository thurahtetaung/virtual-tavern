import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, NameDot, cn, useConfirm } from '@vt/ui';
import { MAX_REJECTIONS, type RoundTableAction, type RoundTableView } from '../logic/types.ts';
import { LadyMark } from './Emblem.tsx';
import type { Suspicions } from './storage.ts';
import { nameOf, waitingOn } from './status.ts';

type Act = (a: RoundTableAction) => Promise<boolean>;

/** The five quests: team size, the two-Fail mark, results, the one in play. */
export function QuestTrack({
  view,
  onPick,
  compact = false,
}: {
  view: RoundTableView;
  /** Targeting: the leader taps a quest to attempt it. */
  onPick?: (slot: number) => void;
  /** Phones in play: one 44 px strip, the vote marks beside it. */
  compact?: boolean;
}) {
  const g = view.game!;
  return (
    <ol
      aria-label="Quests"
      className={cn('grid grid-cols-5', compact ? 'min-w-0 flex-1 gap-1' : 'gap-1.5 sm:gap-3')}
    >
      {g.quests.map((q, slot) => {
        const result = g.results.find((r) => r.slot === slot);
        const current = g.slot === slot && !result && view.phase === 'playing';
        const locked = !result && slot === 4 && !g.questFiveOpen;
        const label = result
          ? `Quest ${slot + 1}: ${result.success ? 'succeeded' : 'sunk'}, ${result.fails} Fail ${result.fails === 1 ? 'card' : 'cards'}`
          : `Quest ${slot + 1}: team of ${q.size}${q.failsNeeded > 1 ? ', needs 2 Fails to sink' : ''}${locked ? ', locked until two quests succeed' : ''}`;
        const body = (
          <>
            <span
              className={cn(
                'flex items-center justify-center rounded-full font-bold ring-2',
                compact ? 'size-8 text-small' : 'aspect-square w-full max-w-16 text-lg sm:text-xl',
                result?.success && 'bg-team-b text-on-fill ring-team-b',
                result && !result.success && 'bg-team-a text-on-fill ring-team-a',
                !result &&
                  (current
                    ? 'bg-accent-soft text-accent-text ring-[3px] ring-accent'
                    : 'bg-card text-ink-2 ring-line-strong'),
                locked && 'opacity-50',
              )}
            >
              {result
                ? result.success
                  ? '✓'
                  : `✕${result.fails > 1 ? result.fails : ''}`
                : q.size}
            </span>
            <span
              className={cn(
                'text-caption text-ink-muted',
                compact ? 'leading-none whitespace-nowrap' : 'leading-tight',
              )}
            >
              {locked ? '🔒 later' : q.failsNeeded > 1 ? '2 fails' : `Quest ${slot + 1}`}
            </span>
          </>
        );
        return (
          <li key={slot} className="flex justify-center">
            {onPick && !result && !locked ? (
              <button
                type="button"
                aria-label={`Attempt quest ${slot + 1} (team of ${q.size})`}
                aria-pressed={current}
                onClick={() => onPick(slot)}
                className="flex w-full flex-col items-center gap-0.5"
              >
                {body}
              </button>
            ) : (
              <span
                role="img"
                aria-label={label}
                className="flex w-full flex-col items-center gap-0.5"
              >
                {body}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Rejected teams in a row this round: five, and Evil wins. */
export function VoteTrack({ view, compact = false }: { view: RoundTableView; compact?: boolean }) {
  const n = view.game!.rejections;
  return (
    <div
      className={cn(
        'flex items-center justify-center text-caption text-ink-muted',
        compact ? 'shrink-0 flex-col gap-1 leading-none' : 'gap-2',
      )}
      aria-label={`${n} of ${MAX_REJECTIONS} teams rejected in a row`}
      role="img"
    >
      <span>Rejected:</span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: MAX_REJECTIONS }, (_, i) => (
          <span
            key={i}
            className={cn(
              compact ? 'size-2.5 rounded-full ring-1' : 'size-3 rounded-full ring-1',
              i < n
                ? 'bg-team-a ring-team-a'
                : i === MAX_REJECTIONS - 1
                  ? 'bg-team-a-soft ring-team-a'
                  : 'bg-sunk ring-line-strong',
            )}
          />
        ))}
      </span>
      {/* Phones: the strip has no room; the label above says what the marks count. */}
      {!compact && <span>5th rejection: Evil wins</span>}
    </div>
  );
}

/** A seat's state in the current stage: picked, voted, played, ready. */
function seatState(view: RoundTableView, id: string): string | null {
  const g = view.game!;
  switch (view.stage) {
    case 'reveal':
      return g.ready.includes(id) ? '✓ ready' : null;
    case 'vote':
      return g.vote!.voted.includes(id) ? '✓ voted' : null;
    case 'quest':
      return g.quest!.played.includes(id) ? '✓ played' : null;
    default:
      return null;
  }
}

export interface SeatPick {
  /** What tapping a seat does right now (the leader's team, the Lady, the Assassin). */
  label: (name: string) => string;
  selected: (id: string) => boolean;
  disabled: (id: string) => boolean;
  onPick: (id: string) => void;
}

/** Everyone at the table, with their badges, what you know, and your private marks. */
export function Seats({
  view,
  room,
  pick,
  marks,
  onMark,
  showKnown,
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  pick: SeatPick | null;
  marks: Suspicions;
  onMark: (id: string) => void;
  /** What you know is on show (KnowledgePeek): only then do the seats carry its badges. */
  showKnown: boolean;
}) {
  const g = view.game!;
  const team =
    view.stage === 'propose' || view.stage === 'discuss'
      ? g.draft
      : view.stage === 'vote'
        ? g.vote!.team
        : view.stage === 'quest'
          ? g.quest!.team
          : [];
  const known = new Map((showKnown ? (view.role?.known ?? []) : []).map((k) => [k.id, k.as]));
  const waiting = waitingOn(view);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const deck = g.deck;
  const magic =
    deck.includes('merlin') && deck.includes('morgana')
      ? 'Merlin?'
      : deck.includes('merlin')
        ? 'Merlin'
        : 'Morgana';
  // Big tables get a third column on phones, so every seat stays above the pinned action panel.
  const compact = g.players.length > 6;
  return (
    <ul
      aria-label="Seats"
      className={cn('grid gap-1.5 sm:grid-cols-3', compact ? 'grid-cols-3' : 'grid-cols-2')}
    >
      {g.players.map((p) => {
        const me = p.id === view.me?.id;
        const onTeam = team.includes(p.id);
        const state = seatState(view, p.id);
        const k = known.get(p.id);
        const mark = marks[p.id];
        const selectable = pick !== null && !pick.disabled(p.id);
        const selected = pick?.selected(p.id) ?? onTeam;
        return (
          <li key={p.id} className="relative">
            <button
              type="button"
              disabled={!selectable}
              aria-pressed={pick ? selected : undefined}
              aria-label={pick ? pick.label(p.name) : p.name}
              onClick={() => pick?.onPick(p.id)}
              className={cn(
                'flex w-full flex-col items-start justify-center rounded-xl py-1 text-left',
                compact
                  ? 'min-h-11 pr-7 pl-2 sm:min-h-12 sm:pr-9 sm:pl-2.5'
                  : 'min-h-12 pr-9 pl-2.5',
                selected
                  ? 'bg-accent-soft ring-[3px] ring-accent ring-offset-2 ring-offset-page'
                  : waiting.includes(p.id)
                    ? 'bg-card ring-2 ring-team-b'
                    : 'bg-card ring-1 ring-line',
                selectable && !selected && 'hover:bg-panel',
                pick && !selectable && 'opacity-60',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-1 text-small font-semibold">
                <span className={cn('truncate', !online(p.id) && 'opacity-60')}>{p.name}</span>
                <NameDot name={p.name} className="order-first" />
                {me && (
                  <span
                    className={cn(
                      'text-caption font-normal text-ink-muted',
                      compact && 'hidden sm:inline',
                    )}
                  >
                    (you)
                  </span>
                )}
                {g.leader === p.id && view.phase === 'playing' && (
                  <span role="img" title="Leader: picks the team" aria-label="leader">
                    👑
                  </span>
                )}
                {g.hammer === p.id &&
                  (view.stage === 'propose' || view.stage === 'discuss' || view.stage === 'vote') &&
                  g.leader !== p.id && (
                    <span
                      role="img"
                      title="5th proposal: if rejected, Evil wins"
                      aria-label="fifth proposal"
                    >
                      🔨
                    </span>
                  )}
                {g.lady?.holder === p.id && (
                  <span
                    role="img"
                    title="Holds the Lady of the Lake"
                    aria-label="holds the Lady"
                    className="text-team-b-ink"
                  >
                    <LadyMark className="size-4" />
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-caption leading-tight">
                {me && compact && <span className="text-ink-muted sm:hidden">you</span>}
                {k === 'evil' && (
                  <span className="rounded-full bg-team-a px-1.5 font-bold text-on-fill">Evil</span>
                )}
                {k === 'magic' && (
                  <span className="rounded-full bg-special px-1.5 font-bold text-on-fill">
                    {magic}
                  </span>
                )}
                {onTeam && view.stage !== 'propose' && (
                  <span className="rounded-full bg-accent-soft px-1.5 font-semibold text-accent-text">
                    on team
                  </span>
                )}
                {state && <span className="text-success-ink">{state}</span>}
                {p.left ? (
                  <span className="text-ink-muted">left · auto-played</span>
                ) : (
                  !online(p.id) && <span className="text-ink-muted">offline</span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onMark(p.id)}
              aria-label={`Your private mark on ${p.name}: ${mark === 'trust' ? 'trusted' : mark === 'doubt' ? 'suspected' : 'none'}`}
              title="Your private note: ⭐ trust, ✕ suspect (only you see it)"
              className={cn(
                'absolute top-0 right-0 flex items-center justify-center text-base',
                compact ? 'size-9 sm:size-11' : 'size-11',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'flex items-center justify-center rounded-full ring-1',
                  compact ? 'size-5 text-caption sm:size-6 sm:text-small' : 'size-6 text-small',
                  mark === 'trust' && 'bg-accent-soft text-accent-text ring-accent',
                  mark === 'doubt' && 'bg-ink text-page ring-ink',
                  !mark && 'text-ink-muted ring-line-strong',
                )}
              >
                {mark === 'trust' ? '⭐' : mark === 'doubt' ? '✕' : '☆'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** "Waiting on: Ana, Ben (offline)" as chips, with Skip for the host when someone is away. */
export function WaitingChips({
  view,
  room,
  act,
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  act: Act;
}) {
  const [confirm, confirmDialog] = useConfirm();
  const ids = waitingOn(view);
  if (!ids.length || view.phase !== 'playing') return null;
  const g = view.game!;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-caption" data-testid="waiting-on">
      {confirmDialog}
      <span className="font-semibold text-ink-muted">Waiting on:</span>
      {ids.map((id) => {
        const online = room.players.find((p) => p.id === id)?.connected ?? false;
        const left = g.players.find((p) => p.id === id)?.left;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-team-b-soft px-2 py-0.5 font-semibold text-team-b-ink"
          >
            {id === view.me?.id ? 'you' : nameOf(view, id)}
            <NameDot name={nameOf(view, id)} className="order-first" />
            {!online && !left && <span className="font-normal opacity-70">(offline)</span>}
            {room.isHost && !online && !left && (
              <Button
                variant="quiet"
                size="sm"
                className="h-6 px-1.5 text-caption"
                onClick={() =>
                  void (async () => {
                    if (
                      await confirm({
                        title: `Act for ${nameOf(view, id)}?`,
                        body: 'A missing vote counts as Approve, a missing quest card is Success, and a team or pick is chosen at random.',
                        confirmLabel: `Act for ${nameOf(view, id)}`,
                      })
                    )
                      void act({ type: 'skip', player: id });
                  })()
                }
              >
                Skip
              </Button>
            )}
          </span>
        );
      })}
    </div>
  );
}
