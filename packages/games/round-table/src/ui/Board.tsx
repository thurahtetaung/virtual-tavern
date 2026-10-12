import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, cn } from '@vt/ui';
import { MAX_REJECTIONS, type RoundTableAction, type RoundTableView } from '../logic/types.ts';
import { LadyMark } from './Emblem.tsx';
import type { Suspicions } from './storage.ts';
import { nameOf, waitingOn } from './status.ts';

type Act = (a: RoundTableAction) => Promise<boolean>;

/** The five quests: team size, the two-Fail mark, results, the one in play. */
export function QuestTrack({
  view,
  onPick,
}: {
  view: RoundTableView;
  /** Targeting: the leader taps a quest to attempt it. */
  onPick?: (slot: number) => void;
}) {
  const g = view.game!;
  return (
    <ol aria-label="Quests" className="grid grid-cols-5 gap-1.5 sm:gap-3">
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
                'flex aspect-square w-full max-w-16 items-center justify-center rounded-full text-lg font-bold ring-2 sm:text-xl',
                result?.success && 'bg-blue-600 text-white ring-blue-700 dark:bg-blue-500',
                result && !result.success && 'bg-red-600 text-white ring-red-700 dark:bg-red-500',
                !result &&
                  (current
                    ? 'bg-amber-100 text-amber-950 ring-4 ring-amber-500 dark:bg-amber-500/20 dark:text-amber-100'
                    : 'bg-white text-stone-700 ring-stone-300 dark:bg-stone-900 dark:text-stone-200 dark:ring-stone-700'),
                locked && 'opacity-50',
              )}
            >
              {result
                ? result.success
                  ? '✓'
                  : `✕${result.fails > 1 ? result.fails : ''}`
                : q.size}
            </span>
            <span className="text-[0.65rem] leading-tight text-stone-600 sm:text-xs dark:text-stone-400">
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
              <span aria-label={label} className="flex w-full flex-col items-center gap-0.5">
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
export function VoteTrack({ view }: { view: RoundTableView }) {
  const n = view.game!.rejections;
  return (
    <div
      className="flex items-center justify-center gap-2 text-xs text-stone-600 dark:text-stone-400"
      aria-label={`${n} of ${MAX_REJECTIONS} teams rejected in a row`}
      role="img"
    >
      <span>Rejected:</span>
      <span className="flex gap-1" aria-hidden>
        {Array.from({ length: MAX_REJECTIONS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-3 rounded-full ring-1',
              i < n
                ? 'bg-red-500 ring-red-600'
                : i === MAX_REJECTIONS - 1
                  ? 'bg-red-100 ring-red-400 dark:bg-red-950'
                  : 'bg-stone-200 ring-stone-300 dark:bg-stone-800 dark:ring-stone-700',
            )}
          />
        ))}
      </span>
      <span>5th rejection: Evil wins</span>
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
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  pick: SeatPick | null;
  marks: Suspicions;
  onMark: (id: string) => void;
}) {
  const g = view.game!;
  const team =
    view.stage === 'propose'
      ? g.draft
      : view.stage === 'vote'
        ? g.vote!.team
        : view.stage === 'quest'
          ? g.quest!.team
          : [];
  const known = new Map((view.role?.known ?? []).map((k) => [k.id, k.as]));
  const waiting = waitingOn(view);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const deck = g.deck;
  const magic =
    deck.includes('merlin') && deck.includes('morgana')
      ? 'Merlin?'
      : deck.includes('merlin')
        ? 'Merlin'
        : 'Morgana';
  return (
    <ul aria-label="Seats" className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
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
                'flex min-h-12 w-full flex-col items-start justify-center rounded-xl py-1 pr-9 pl-2.5 text-left',
                selected
                  ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/15'
                  : waiting.includes(p.id)
                    ? 'bg-white ring-2 ring-sky-400 dark:bg-stone-900 dark:ring-sky-500'
                    : 'bg-white ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-700',
                selectable && !selected && 'hover:bg-stone-50 dark:hover:bg-stone-800',
                pick && !selectable && 'opacity-60',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-1 text-sm font-semibold">
                <span className={cn('truncate', !online(p.id) && 'opacity-60')}>{p.name}</span>
                {me && <span className="text-xs font-normal text-stone-500">(you)</span>}
                {g.leader === p.id && view.phase === 'playing' && (
                  <span title="Leader: picks the team" aria-label="leader">
                    👑
                  </span>
                )}
                {g.hammer === p.id &&
                  (view.stage === 'propose' || view.stage === 'vote') &&
                  g.leader !== p.id && (
                    <span title="5th proposal: if rejected, Evil wins" aria-label="fifth proposal">
                      🔨
                    </span>
                  )}
                {g.lady?.holder === p.id && (
                  <span
                    title="Holds the Lady of the Lake"
                    aria-label="holds the Lady"
                    className="text-sky-600 dark:text-sky-400"
                  >
                    <LadyMark className="size-4" />
                  </span>
                )}
              </span>
              <span className="flex flex-wrap items-center gap-1 text-[0.7rem] leading-tight">
                {k === 'evil' && (
                  <span className="rounded-full bg-red-600 px-1.5 font-bold text-white">Evil</span>
                )}
                {k === 'magic' && (
                  <span className="rounded-full bg-violet-600 px-1.5 font-bold text-white">
                    {magic}
                  </span>
                )}
                {onTeam && view.stage !== 'propose' && (
                  <span className="rounded-full bg-amber-200 px-1.5 font-semibold text-amber-950">
                    on team
                  </span>
                )}
                {state && <span className="text-emerald-700 dark:text-emerald-400">{state}</span>}
                {p.left ? (
                  <span className="text-stone-500">left · auto-played</span>
                ) : (
                  !online(p.id) && <span className="text-stone-500">offline</span>
                )}
              </span>
            </button>
            <button
              type="button"
              onClick={() => onMark(p.id)}
              aria-label={`Your private mark on ${p.name}: ${mark === 'trust' ? 'trusted' : mark === 'doubt' ? 'suspected' : 'none'}`}
              title="Your private note: ⭐ trust, ✕ suspect (only you see it)"
              className="absolute top-0 right-0 flex size-11 items-center justify-center text-base"
            >
              <span
                aria-hidden
                className={cn(
                  'flex size-6 items-center justify-center rounded-full text-sm ring-1',
                  mark === 'trust' && 'bg-amber-300 text-amber-950 ring-amber-500',
                  mark === 'doubt' && 'bg-stone-700 text-white ring-stone-800',
                  !mark && 'text-stone-400 ring-stone-300 dark:ring-stone-600',
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
  const ids = waitingOn(view);
  if (!ids.length || view.phase !== 'playing') return null;
  const g = view.game!;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs" data-testid="waiting-on">
      <span className="font-semibold text-stone-600 dark:text-stone-400">Waiting on:</span>
      {ids.map((id) => {
        const online = room.players.find((p) => p.id === id)?.connected ?? false;
        const left = g.players.find((p) => p.id === id)?.left;
        return (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-100"
          >
            {id === view.me?.id ? 'you' : nameOf(view, id)}
            {!online && !left && <span className="font-normal opacity-70">(offline)</span>}
            {room.isHost && !online && !left && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-xs"
                onClick={() => {
                  if (
                    window.confirm(
                      `Act for ${nameOf(view, id)}? A missing vote counts as Approve, a missing quest card is Success, and a team or pick is chosen at random.`,
                    )
                  )
                    void act({ type: 'skip', player: id });
                }}
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
