import { PlayerTag, ProtectedImage, cn, useSecondsLeft } from '@vt/ui';
import type { CSSProperties, ReactNode } from 'react';
import type { Card } from '../logic/content.ts';
import { type DeckKind, STYLES, type StyleId, genreInfo, progress } from '../logic/genres.ts';
import { genreName } from '../logic/manifest.ts';
import { type CliffhangerView, TEAM_NAMES, type TeamId } from '../logic/types.ts';
import { artOf, boxOf, thumbOf, useArt } from './assets.ts';

const CSS = `
@keyframes cl-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
@keyframes cl-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: none } }
@keyframes cl-drain { from { transform: scaleX(1) } to { transform: scaleX(0) } }
@keyframes cl-slide { from { opacity: 0; transform: translateY(-60px) rotate(-8deg) } to { opacity: 1; transform: none } }
@keyframes cl-glow { 0%,100% { box-shadow: 0 0 0 0 rgb(250 204 21 / 0) } 50% { box-shadow: 0 0 0 6px rgb(250 204 21 / .55) } }
@keyframes cl-shake { 0%,100% { transform: none } 25% { transform: rotate(-3deg) } 75% { transform: rotate(3deg) } }
.cl-rise { animation: cl-rise .35s ease-out both }
.cl-pop { animation: cl-pop .45s cubic-bezier(.2,.8,.3,1.2) both }
.cl-drain { transform-origin: left; animation-name: cl-drain; animation-timing-function: linear; animation-fill-mode: both }
.cl-slide { animation: cl-slide .6s cubic-bezier(.2,.8,.3,1.1) both }
.cl-glow { animation: cl-glow 1s ease-in-out 3 }
.cl-shake { animation: cl-shake .3s ease-in-out 2 }
.cl-upright { writing-mode: vertical-rl; text-orientation: mixed }
@media (prefers-reduced-motion: reduce) {
  .cl-rise, .cl-pop, .cl-slide, .cl-glow, .cl-shake { animation: none }
}
`;

export function CliffhangerStyles() {
  return <style>{CSS}</style>;
}

export const nameOf = (view: CliffhangerView, id: string | null | undefined) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

/** "you" for the viewer, else the name. */
export const who = (view: CliffhangerView, id: string | null | undefined) =>
  id && id === view.me?.id ? 'you' : nameOf(view, id);

export const teamName = (t: TeamId) => TEAM_NAMES[t];
export const TEAM_EMOJI: Record<TeamId, string> = { a: '🍿', b: '🌮' };

/** A team's chip colours (the shared team tokens). */
export const TEAM_TONE: Record<TeamId, string> = {
  a: 'bg-team-a-soft text-team-a-ink ring-team-a-line dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40',
  b: 'bg-team-b-soft text-team-b-ink ring-team-b-line dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40',
};

export function TeamChip({ team, className }: { team: TeamId; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ring-1',
        TEAM_TONE[team],
        className,
      )}
    >
      <span aria-hidden>{TEAM_EMOJI[team]}</span> {teamName(team)}
    </span>
  );
}

export function Who({
  view,
  id,
  hostId,
  online,
  className,
}: {
  view: CliffhangerView;
  id: string;
  hostId: string;
  online: (id: string) => boolean;
  className?: string;
}) {
  return (
    <PlayerTag
      name={nameOf(view, id)}
      you={id === view.me?.id}
      host={id === hostId}
      offline={!online(id)}
      className={className}
    />
  );
}

/** A style's name (the manifest's words), with its emoji. */
export function StyleName({ style, className }: { style: StyleId; className?: string }) {
  const { names } = useArt();
  return (
    <span className={cn('font-black tracking-wide uppercase', className)}>
      <span aria-hidden>{STYLES[style].emoji}</span> {names.styles[style]}
    </span>
  );
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const boxStyle = ([x, y, w, h]: [number, number, number, number]): CSSProperties => ({
  left: pct(x),
  top: pct(y),
  width: pct(w),
  height: pct(h),
});

/** The fallback tape's label and band, where the art's would be. */
const PLAIN_LABEL: [number, number, number, number] = [0.25, 0.19, 0.5, 0.6];
const PLAIN_BAND: [number, number, number, number] = [0.03, 0.05, 0.14, 0.9];

/**
 * A card as a tape, portrait: the genre's original tape with the title printed on its label,
 * turned 90° clockwise as on the real cards (and our genre name on a blanked band), or a plain
 * tape in the genre's colour without art. `card` null is a hidden card: a dark tape with a "?".
 */
export function Tape({
  card,
  deck,
  className,
  full = false,
  got,
  label,
}: {
  card: Card | null;
  deck: DeckKind;
  /** Size: give it a height (`h-40`); the width follows the tape's shape. */
  className?: string;
  /** Load the full picture (a big tape), not the small copy. */
  full?: boolean;
  /** Who got it: a tick over the tape. */
  got?: TeamId | null;
  /** Read out instead of the title (hidden cards). */
  label?: string;
}) {
  const { tape, names } = useArt();
  const base =
    'relative aspect-[538/740] shrink-0 overflow-hidden rounded-md shadow-md select-none [container-type:size]';
  if (!card) {
    return (
      <div
        role="img"
        aria-label={label ?? 'A hidden card'}
        className={cn(
          base,
          'grid place-items-center bg-stone-800 ring-1 ring-stone-600',
          className,
        )}
      >
        <span className="text-3xl font-black text-stone-300" aria-hidden>
          ?
        </span>
      </div>
    );
  }
  const info = genreInfo(card.genre, deck);
  const art = tape(card.genre, deck);
  const src = art ? (full ? artOf(art.tape) : thumbOf(art.tape, art.thumb)) : null;
  const labelBox = boxOf(art?.labelBox) ?? PLAIN_LABEL;
  const genreBox = src ? boxOf(art?.genreBox) : PLAIN_BAND;
  const genre = genreName(names, card.genre, deck);
  return (
    <div
      role="img"
      aria-label={`${card.title}, ${genre}${got ? `, got by ${teamName(got)}` : ''}`}
      className={cn(base, !src && 'ring-1 ring-black/20', className)}
      style={src ? undefined : { backgroundColor: info.colour }}
    >
      {src && (
        <ProtectedImage src={src} alt="" className="absolute inset-0 h-full w-full object-fill" />
      )}
      {!src && (
        <div className="absolute rounded-sm bg-white/95" style={boxStyle(labelBox)} aria-hidden />
      )}
      {genreBox && (
        <div
          aria-hidden
          className="cl-upright absolute flex items-center justify-center overflow-hidden font-black tracking-wide whitespace-nowrap text-white uppercase"
          style={{
            ...boxStyle(genreBox),
            // One line along the band: long names get smaller.
            fontSize: `clamp(5px, ${Math.min(9, (genreBox[3] * 100) / (0.75 * genre.length)).toFixed(2)}cqh, 40px)`,
            textShadow: '0 1px 2px rgb(0 0 0 / .6)',
          }}
        >
          {genre}
        </div>
      )}
      <div
        aria-hidden
        className="cl-upright absolute flex items-center justify-center overflow-hidden p-[4%] text-center leading-tight font-black text-stone-900"
        style={{ ...boxStyle(labelBox), fontSize: titleSize(card.title) }}
      >
        <span className="line-clamp-3">{card.title}</span>
      </div>
      {got && (
        <span
          aria-hidden
          className="cl-pop absolute right-1 bottom-1 grid h-[22%] max-h-10 min-h-5 place-items-center rounded-full bg-success px-1.5 text-[min(4cqh,1.5rem)] font-black text-white shadow dark:bg-emerald-700"
          style={{ aspectRatio: '1' }}
        >
          ✓
        </span>
      )}
    </div>
  );
}

/** The title's size on the label, in container units: long titles smaller. */
function titleSize(title: string): string {
  const n = title.length;
  const h = n <= 10 ? 9 : n <= 18 ? 7.5 : n <= 28 ? 6 : 5;
  return `clamp(7px, ${h}cqh, 64px)`;
}

/** A team's collection as the goal's genres: filled ones in colour, the rest faint. */
export function GenreRace({
  view,
  team,
  compact = false,
  className,
}: {
  view: CliffhangerView;
  team: TeamId;
  compact?: boolean;
  className?: string;
}) {
  const { names } = useArt();
  const deck = view.settings.deck;
  const goal = view.target;
  const genres = view.collections[team].map((c) => c.genre);
  const p = progress(genres, goal);
  const count = (g: string) => genres.filter((x) => x === g).length;
  const atPoint = p.need - p.have === 1;
  return (
    <div className={cn('min-w-0', className)} data-testid={`race-${team}`}>
      <div className="flex items-center justify-between gap-2 text-sm">
        <TeamChip team={team} />
        <span className="font-bold tabular-nums" aria-label={`${p.have} of ${p.need}`}>
          {atPoint && view.phase === 'playing' && (
            <span className="mr-1 rounded bg-warn-soft px-1 text-xs text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40">
              match point
            </span>
          )}
          {p.have}/{p.need}
        </span>
      </div>
      <ul className={cn('mt-1 flex flex-wrap gap-1', compact && 'gap-0.5')}>
        {goal.genres.map((g) => {
          const info = genreInfo(g, deck);
          const n = Math.min(goal.each, count(g));
          const name = genreName(names, g, deck);
          return (
            <li
              key={g}
              title={name}
              aria-label={`${name}: ${n} of ${goal.each}`}
              className={cn(
                'flex items-center gap-0.5 rounded-md px-1 py-0.5 text-sm ring-1',
                n >= goal.each
                  ? 'text-white ring-black/10'
                  : 'bg-page text-ink-muted opacity-60 ring-line dark:bg-stone-800 dark:ring-stone-700',
                compact && 'text-xs',
              )}
              style={n >= goal.each ? { backgroundColor: info.colour } : undefined}
            >
              <span aria-hidden>{info.emoji}</span>
              {goal.each > 1 && <span className="tabular-nums">{n}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * The clock as a full-width bar draining to the deadline, with the seconds; red in the last 5 s.
 * `total` is the clock's full length (the bar starts where it would be now).
 */
export function ClockBar({
  deadline,
  total,
  clockOffset,
  label,
  big = false,
  paused,
}: {
  deadline: number | null;
  total: number;
  clockOffset: number;
  label?: ReactNode;
  big?: boolean;
  /** Frozen at this many ms left (a paused face-off). */
  paused?: number | null;
}) {
  const left = useSecondsLeft(deadline, clockOffset);
  const frozen = paused !== undefined && paused !== null;
  const seconds = frozen ? Math.ceil(paused / 1000) : (left ?? 0);
  const remaining =
    // eslint-disable-next-line react-hooks/purity -- the bar's starting point, read once per deadline
    deadline === null ? (paused ?? 0) : Math.max(0, deadline - (Date.now() + clockOffset));
  const urgent = !frozen && deadline !== null && seconds <= 5;
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-semibold">{label}</span>
        <span
          role="timer"
          aria-label={`${seconds} seconds left${frozen ? ', paused' : ''}`}
          className={cn(
            'font-mono font-black tabular-nums',
            big ? 'text-3xl' : 'text-xl',
            urgent && 'text-danger dark:text-rose-400',
          )}
        >
          {frozen && '⏸ '}0:{String(seconds).padStart(2, '0')}
        </span>
      </div>
      <div
        className={cn(
          'overflow-hidden rounded-full bg-stone-300 dark:bg-stone-700',
          big ? 'h-4' : 'h-2.5',
        )}
      >
        <div
          key={`${deadline}:${paused}`}
          className={cn(
            'h-full rounded-full',
            !frozen && deadline !== null && 'cl-drain',
            urgent ? 'bg-danger dark:bg-rose-500' : 'bg-accent dark:bg-amber-500',
          )}
          style={
            frozen || deadline === null
              ? {
                  transform: `scaleX(${total ? Math.min(1, (paused ?? 0) / total) : 0})`,
                  transformOrigin: 'left',
                }
              : {
                  animationDuration: `${total}ms`,
                  animationDelay: `-${Math.max(0, total - remaining)}ms`,
                }
          }
        />
      </div>
    </div>
  );
}
