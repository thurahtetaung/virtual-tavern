import type { GameRoomInfo } from '@vt/game-sdk';
import { cn } from '@vt/ui';
import type { HydraView, Ineligible } from '../logic/types.ts';
import type { Content } from './assets.ts';
import type { Suspicions } from './storage.ts';
import { waitingOn } from './status.ts';

export interface SeatPick {
  /** What tapping a seat does right now ("Nominate Ana"). */
  label: (name: string) => string;
  selected: (id: string) => boolean;
  /** Why a seat can't be picked, or null. */
  why: (id: string) => string | null;
  onPick: (id: string) => void;
}

/** Why a seat can't be picked ("was the last elected Chancellor…"), worded by the edition. */
export const whyText = (c: Content, why: Ineligible) => c.copy(`why.${why}`);

/** Everyone at the table: placards, votes, what's known about them, and your private marks. */
export function Seats({
  view,
  room,
  c,
  pick,
  marks,
  onMark,
  onOpen,
  onWhy,
  ids,
  columns,
  showKnown,
}: {
  view: HydraView;
  room: GameRoomInfo;
  c: Content;
  pick: SeatPick | null;
  marks: Suspicions;
  onMark: (id: string) => void;
  /** Opens a player's record (voting history, notes). */
  onOpen: (id: string) => void;
  /** Tapped a seat that can't be picked: say why. */
  onWhy: (text: string) => void;
  /** A subset (the desktop splits the table in two rows); all players by default. */
  ids?: string[];
  columns?: number;
  /** Your role card is up: only then do your known teammates get their badges. */
  showKnown: boolean;
}) {
  const g = view.game!;
  const known = new Map((showKnown ? (view.role?.known ?? []) : []).map((k) => [k.id, k.role]));
  const waiting = waitingOn(view);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const players = ids ? g.players.filter((p) => ids.includes(p.id)) : g.players;
  // Big tables get a third column on phones, so every seat stays above the action dock.
  const compact = g.players.length > 6;
  const last = g.rounds.at(-1);
  const showVotes =
    view.stage === 'nominate' &&
    last &&
    last.elected !== null &&
    Object.keys(last.votes).length > 0;
  const nominee = view.stage === 'vote' || view.stage === 'leader-check' ? g.chancellor : null;
  const inGov =
    view.stage === 'legislate-president' ||
    view.stage === 'legislate-chancellor' ||
    view.stage === 'veto-response' ||
    view.stage === 'claim' ||
    view.stage === 'power';
  return (
    <ul
      aria-label="Seats"
      className={cn(
        'grid gap-1.5',
        !columns && (compact ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3'),
      )}
      style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
    >
      {players.map((p) => {
        const me = p.id === view.me?.id;
        const k = known.get(p.id);
        const mark = marks[p.id];
        const why = pick?.why(p.id) ?? null;
        const selected = pick?.selected(p.id) ?? false;
        const president = g.president === p.id && view.phase === 'playing';
        const chancellor = g.chancellor === p.id && (inGov || nominee === p.id);
        const vote = showVotes ? last.votes[p.id] : undefined;
        const cleared = g.cleared.includes(p.id);
        const investigated = g.investigated.includes(p.id);
        const ballotDone = view.stage === 'vote' && g.voted.includes(p.id);
        const offline = !online(p.id) && !p.left;
        return (
          <li key={p.id} className="relative">
            <button
              type="button"
              aria-pressed={pick ? selected : undefined}
              aria-disabled={pick ? why !== null : undefined}
              aria-label={
                pick
                  ? why
                    ? `${p.name}: ${why}`
                    : pick.label(p.name)
                  : `${p.name}${me ? ' (you)' : ''}: voting record and notes`
              }
              onClick={() => {
                if (!pick) return onOpen(p.id);
                if (why) return onWhy(`${p.name} ${why}`);
                pick.onPick(p.id);
              }}
              className={cn(
                // A card that looks like something to tap: its own surface, an edge and a shadow.
                'flex w-full flex-col items-start justify-center rounded-xl py-1 text-left shadow transition active:scale-[0.98]',
                compact ? 'min-h-[2.9rem] pr-7 pl-2' : 'min-h-[3.4rem] pr-9 pl-2.5',
                p.dead
                  ? 'bg-stone-200 opacity-60 grayscale ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-700'
                  : selected
                    ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/15'
                    : pick && !why
                      ? // Yours to pick: an accent ring that pulses gently (still under reduced motion).
                        'hy-pickable bg-white ring-2 ring-accent dark:bg-stone-800 dark:ring-amber-400'
                      : president || chancellor
                        ? 'bg-accent-soft/70 ring-2 ring-accent/80 dark:ring-amber-400/80 dark:bg-amber-500/10'
                        : waiting.includes(p.id)
                          ? 'bg-white ring-2 ring-sky-400 dark:bg-stone-800 dark:ring-sky-500'
                          : 'bg-white ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600',
                pick && !why && !selected && 'hover:bg-accent-soft dark:hover:bg-stone-700',
                pick && why && 'opacity-45',
              )}
            >
              <span className="flex w-full min-w-0 items-center gap-1 text-sm font-semibold">
                {p.dead && <span aria-label="executed">✝</span>}
                {/* An initial, so every card reads as a person's seat. */}
                <span
                  aria-hidden
                  className={cn(
                    'size-5 shrink-0 items-center justify-center rounded-full bg-stone-700 text-[0.6rem] font-black text-white uppercase dark:bg-stone-300 dark:text-stone-900',
                    compact ? 'hidden sm:flex' : 'flex',
                  )}
                >
                  {[...p.name][0] ?? '?'}
                </span>
                <span className={cn('truncate', offline && 'opacity-60')}>{p.name}</span>
                {me && (
                  <span
                    className={cn(
                      'text-xs font-normal text-stone-500',
                      compact && 'hidden sm:inline',
                    )}
                  >
                    (you)
                  </span>
                )}
              </span>
              <span className="flex min-h-4 flex-wrap items-center gap-0.5 text-[0.62rem] leading-tight font-bold">
                {president && (
                  <Placard kind="president" c={c} special={g.special} compact={compact} />
                )}
                {chancellor && (
                  <Placard kind="chancellor" c={c} drop={nominee === p.id} compact={compact} />
                )}
                {k && (
                  <span
                    className="rounded bg-red-700 px-1 text-white"
                    title="Your teammate (only you see this)"
                  >
                    {c.roleName(k)}
                  </span>
                )}
                {vote && (
                  <span
                    className={cn(
                      'rounded px-1',
                      vote === 'yes'
                        ? 'bg-white text-stone-900 ring-1 ring-stone-400'
                        : 'bg-stone-800 text-white',
                    )}
                  >
                    {c.ballotName(vote)}
                  </span>
                )}
                {ballotDone && (
                  <span className="text-emerald-700 dark:text-emerald-400">✓ voted</span>
                )}
                {cleared && !p.dead && (
                  <span
                    className="rounded bg-success dark:bg-emerald-600 px-1 text-white"
                    title={c.t('Confirmed: not {leader}')}
                  >
                    {c.copy('moment.cleared.stamp')}
                  </span>
                )}
                {investigated && <span title="Investigated">🔍</span>}
                {p.left ? (
                  <span className="font-normal text-stone-500">left</span>
                ) : (
                  offline && <span className="font-normal text-stone-500">offline</span>
                )}
                {pick && why && !compact && <span className="font-normal text-stone-500">🔒</span>}
              </span>
            </button>
            {!p.dead && (
              <button
                type="button"
                onClick={() => onMark(p.id)}
                aria-label={`Your private mark on ${p.name}: ${mark === 'trust' ? 'trusted' : mark === 'doubt' ? 'suspected' : 'none'}`}
                title="Your private note: ⭐ trust, ✕ suspect (only you see it)"
                className={cn(
                  'absolute top-0 right-0 flex items-center justify-center',
                  compact ? 'size-8' : 'size-10',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex items-center justify-center rounded-full ring-1',
                    compact ? 'size-5 text-[0.65rem]' : 'size-6 text-xs',
                    mark === 'trust' &&
                      'bg-accent-line dark:bg-amber-300 text-amber-950 ring-accent dark:ring-amber-500',
                    mark === 'doubt' && 'bg-stone-700 text-white ring-stone-800',
                    !mark && 'text-stone-400 ring-stone-300 dark:ring-stone-600',
                  )}
                >
                  {mark === 'trust' ? '⭐' : mark === 'doubt' ? '✕' : '☆'}
                </span>
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The President / Chancellor placard on a seat: the full office name, or its short form on a
 * big table's phone seats, never smaller than 11 px.
 */
export function Placard({
  kind,
  c,
  drop,
  special,
  compact,
}: {
  kind: 'president' | 'chancellor';
  c: Content;
  drop?: boolean;
  special?: boolean;
  compact?: boolean;
}) {
  const label =
    kind === 'president'
      ? c.t(special ? '{President} (special)' : '{President}')
      : c.t('{Chancellor}');
  const full = kind === 'president' ? c.t('{President}') : c.t('{Chancellor}');
  const short = kind === 'president' ? c.names.presidentShort : c.names.chancellorShort;
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded px-1 text-[0.6875rem] leading-4 font-bold',
        kind === 'president' ? 'bg-teal-800 text-teal-50' : 'bg-orange-800 text-orange-50',
        drop && 'hy-drop',
      )}
      title={label}
      aria-label={label}
    >
      <span aria-hidden className="truncate">
        {compact ? (
          <>
            <span className="sm:hidden">{short}</span>
            <span className="hidden sm:inline">{full}</span>
          </>
        ) : (
          full
        )}
        {kind === 'president' && special ? ' ★' : ''}
      </span>
    </span>
  );
}
