import { ProtectedImage, cn } from '@vt/ui';
import { type CSSProperties, type ReactNode, useEffect, useState } from 'react';
import { capacity, colourAt, floorPenalty } from '../logic/rules.ts';
import { COLOUR_NAME, SYMBOL } from '../logic/tiles.ts';
import {
  type Board,
  type Colour,
  FLOOR,
  type FloorItem,
  type PlayerScore,
  SIZE,
} from '../logic/types.ts';
import type { Art } from './assets.ts';

/** Whether a media query matches, following changes. */
export function useMatch(query: string) {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setMatches(m.matches);
    on();
    m.addEventListener('change', on);
    return () => {
      m.removeEventListener('change', on);
    };
  }, [query]);
  return matches;
}

/** Board sizes: one cell's width in px. */
export const CELL = { lg: 34, md: 28, sm: 18, xs: 9 } as const;
export type Size = keyof typeof CELL;

/** One tile: its face from the manifest, or a plain colour, always with its symbol. */
export function Tile({
  colour,
  art,
  size = 28,
  ghost = false,
  className,
  style,
  label,
}: {
  colour: Colour;
  art: Art;
  size?: number;
  /** The faint guide on an empty wall space. */
  ghost?: boolean;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const src = ghost ? null : art.tile(colour, size <= 48);
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('mo-tile', `mo-c-${colour}`, ghost && 'mo-ghost', className)}
      style={{ width: size, height: size, ...style }}
      data-colour={colour}
    >
      {src && (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full rounded-[inherit]" />
      )}
      {size >= 14 && (
        <span
          className={cn('mo-sym', src && 'mo-sym-corner')}
          style={{ fontSize: src ? Math.max(8, size * 0.3) : size * 0.5 }}
        >
          {SYMBOL[colour]}
        </span>
      )}
    </span>
  );
}

/** The first-player marker. */
export function Marker({
  art,
  size = 28,
  className,
}: {
  art: Art;
  size?: number;
  className?: string;
}) {
  const src = art.first(size <= 48);
  return (
    <span
      role="img"
      aria-label="First-player marker"
      className={cn('mo-tile mo-first', className)}
      style={{ width: size, height: size }}
      data-marker
    >
      {src ? (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full rounded-[inherit]" />
      ) : (
        <span className="mo-sym" style={{ fontSize: size * 0.55 }}>
          1
        </span>
      )}
    </span>
  );
}

const floorItem = (f: FloorItem, art: Art, size: number) =>
  f === 'first' ? <Marker art={art} size={size} /> : <Tile colour={f} art={art} size={size} />;

/** What the board shows while its round's wall-tiling plays (see `Tiling`). */
export interface TilingFrame {
  score: PlayerScore;
  /** Placements shown so far. */
  shown: number;
  /** Whether the floor has been charged yet. */
  floorDone: boolean;
}

/** A target the pick sheet highlights on the board. */
export interface Highlight {
  colour: Colour;
  /** Lines the colour may go in. */
  lines: number[];
  /** The line chosen so far, or the floor. */
  chosen: number | 'floor' | null;
  onPick?: (target: number | 'floor') => void;
}

/**
 * A player's board: pattern lines (right-aligned) beside the 5 × 5 wall, the floor below. With a
 * tiling frame it shows the round's end as it plays; with a highlight the lines a picked colour
 * may go in.
 */
export function BoardView({
  board,
  art,
  size = 'md',
  frame,
  highlight,
  owner,
  className,
}: {
  board: Board;
  art: Art;
  size?: Size;
  frame?: TilingFrame | null;
  highlight?: Highlight | null;
  /** For tests and flights: whose board. */
  owner?: string;
  className?: string;
}) {
  const cell = CELL[size];
  const gap = size === 'xs' ? 1 : size === 'sm' ? 2 : 3;
  // During the tiling: the lines that are still to tile show full, their wall tiles not yet there.
  const pending = frame ? frame.score.placed.slice(frame.shown) : [];
  const lines = board.lines.map((l, row) => {
    const p = pending.find((x) => x.row === row);
    return p ? { colour: p.colour, count: capacity(row) } : l;
  });
  const hidden = new Set(pending.map((p) => `${p.row}:${p.col}`));
  const latest = frame && frame.shown > 0 ? frame.score.placed[frame.shown - 1] : undefined;
  const glow = new Set<string>();
  if (latest) {
    const w = board.wall;
    const mark = (dr: number, dc: number) => {
      for (
        let r = latest.row + dr, c = latest.col + dc;
        w[r]?.[c] && !hidden.has(`${r}:${c}`);
        r += dr, c += dc
      )
        glow.add(`${r}:${c}`);
    };
    if (latest.across) {
      mark(0, -1);
      mark(0, 1);
    }
    if (latest.down) {
      mark(-1, 0);
      mark(1, 0);
    }
    glow.add(`${latest.row}:${latest.col}`);
  }
  const floor = frame && !frame.floorDone ? frame.score.floor : board.floor;
  const pick = highlight?.onPick;
  return (
    <div
      className={cn('mo-board inline-flex flex-col', className)}
      style={{ '--mo-cell': `${cell}px`, '--mo-gap': `${gap}px` } as CSSProperties}
      data-board={owner}
    >
      <div className="flex" style={{ gap: gap * 3 }}>
        <div className="flex flex-col" style={{ gap }} role="group" aria-label="Pattern lines">
          {lines.map((l, row) => {
            const can = highlight?.lines.includes(row);
            const chosen = highlight?.chosen === row;
            const body = Array.from({ length: SIZE }, (_, i) => {
              const slot = SIZE - 1 - i;
              if (slot >= capacity(row))
                return <span key={i} style={{ width: cell, height: cell }} />;
              const filled = slot < l.count;
              return filled && l.colour ? (
                <Tile key={i} colour={l.colour} art={art} size={cell} />
              ) : (
                <span key={i} className="mo-slot" style={{ width: cell, height: cell }} />
              );
            });
            const label = `Line ${row + 1}: ${l.count} of ${capacity(row)}${l.colour ? ` ${COLOUR_NAME[l.colour]}` : ''}`;
            const cls = cn(
              'flex rounded-md',
              can && 'mo-can',
              chosen && 'mo-chosen',
              highlight && !can && 'opacity-50',
            );
            return pick && can ? (
              <button
                key={row}
                type="button"
                className={cn(cls, 'focus-visible:outline-2 focus-visible:outline-accent')}
                style={{ gap }}
                onClick={() => pick(row)}
                aria-label={`${label}: put them here`}
                data-line={row}
              >
                {body}
              </button>
            ) : (
              <div
                key={row}
                className={cls}
                style={{ gap }}
                aria-label={label}
                role="img"
                data-line={row}
              >
                {body}
              </div>
            );
          })}
        </div>
        <div
          className="grid"
          style={{ gridTemplateColumns: `repeat(${SIZE}, ${cell}px)`, gap }}
          role="group"
          aria-label="Wall"
          data-wall
        >
          {board.wall.flatMap((row, r) =>
            row.map((t, c) => {
              const key = `${r}:${c}`;
              const show = t && !hidden.has(key);
              const isNew = latest && latest.row === r && latest.col === c;
              return (
                <span
                  key={key}
                  className={cn('relative', glow.has(key) && 'mo-glow')}
                  style={{ width: cell, height: cell }}
                  data-cell={key}
                >
                  {show ? (
                    <Tile
                      colour={t}
                      art={art}
                      size={cell}
                      className={cn(isNew && 'mo-pop')}
                      label={`${COLOUR_NAME[t]}, row ${r + 1}`}
                    />
                  ) : (
                    <Tile colour={colourAt(r, c)} art={art} size={cell} ghost />
                  )}
                  {isNew && (
                    <span className="mo-plus" aria-hidden>
                      +{latest.points}
                    </span>
                  )}
                </span>
              );
            }),
          )}
        </div>
      </div>
      <FloorLine
        floor={floor}
        art={art}
        cell={cell}
        gap={gap}
        cracked={!!frame?.floorDone && frame.score.floor.length > 0}
        crackedItems={frame?.score.floor}
        chosen={highlight?.chosen === 'floor'}
        {...(pick && { onPick: () => pick('floor') })}
      />
    </div>
  );
}

function FloorLine({
  floor,
  art,
  cell,
  gap,
  cracked,
  crackedItems,
  chosen,
  onPick,
}: {
  floor: FloorItem[];
  art: Art;
  cell: number;
  gap: number;
  cracked: boolean;
  crackedItems?: FloorItem[] | undefined;
  chosen?: boolean;
  onPick?: () => void;
}) {
  const shown = cracked && crackedItems ? crackedItems : floor;
  const cost = floorPenalty(shown);
  const body: ReactNode = (
    <>
      {FLOOR.map((n, i) => (
        <span key={i} className="flex flex-col items-center" style={{ width: cell }}>
          {shown[i] ? (
            <span className={cn(cracked && 'mo-crack')}>{floorItem(shown[i], art, cell)}</span>
          ) : (
            <span className="mo-slot mo-floor-slot" style={{ width: cell, height: cell }} />
          )}
          {cell >= 14 && (
            <span className="text-[10px] leading-tight tabular-nums text-ink-muted dark:text-stone-400">
              {n}
            </span>
          )}
        </span>
      ))}
      <span
        className={cn(
          'ml-1 self-center font-bold tabular-nums',
          cell < 14 ? 'text-xs' : 'text-sm',
          cost ? 'text-danger-ink dark:text-rose-300' : 'text-ink-muted dark:text-stone-500',
          cracked && cost !== 0 && 'mo-pop',
        )}
      >
        {cost || '0'}
      </span>
    </>
  );
  const cls = cn('mt-1 flex items-start rounded-md', chosen && 'mo-chosen');
  const label = `Floor: ${floor.length} of 7, ${cost} points`;
  return onPick ? (
    <button
      type="button"
      className={cn(cls, 'mo-can focus-visible:outline-2 focus-visible:outline-accent')}
      style={{ gap }}
      onClick={onPick}
      aria-label={`${label}: put them on the floor`}
      data-floor
    >
      {body}
    </button>
  ) : (
    <div className={cls} style={{ gap }} role="img" aria-label={label} data-floor>
      {body}
    </div>
  );
}

/** A 5 × 5 dot picture of a wall, for opponents' chips. */
export function MiniWall({ wall }: { wall: (Colour | null)[][] }) {
  return (
    <span
      aria-hidden
      className="grid shrink-0"
      style={{ gridTemplateColumns: `repeat(${SIZE}, 6px)`, gap: 1 }}
    >
      {wall.flatMap((row, r) =>
        row.map((t, c) => (
          <span
            key={`${r}:${c}`}
            className={cn('size-1.5 rounded-[1px]', t ? `mo-c-${t} mo-dot` : 'mo-dot-empty')}
          />
        )),
      )}
    </span>
  );
}

/** Tile colours, a rim so dark tiles show on dark pages and light ones on light pages, motion. */
const CSS = `
.mo-tile { position: relative; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; border-radius: 18%; line-height: 1; font-weight: 800; box-shadow: 0 0 0 1px rgba(28,25,23,.35), 0 1px 2px rgba(28,25,23,.25); user-select: none; }
[data-theme='dark'] .mo-tile { box-shadow: 0 0 0 1px rgba(245,245,244,.4), 0 1px 2px rgba(0,0,0,.5); }
.mo-c-blue { background: #2361b8; color: #fff; }
.mo-c-yellow { background: #e9b824; color: #3b2a00; }
.mo-c-red { background: #c4362c; color: #fff; }
.mo-c-black { background: #26262a; color: #f5f5f4; }
.mo-c-aqua { background: #8fd0dc; color: #0f3940; }
.mo-first { background: #f4efe6; color: #1c1917; }
.mo-sym { position: relative; pointer-events: none; }
.mo-sym-corner { position: absolute; right: 1px; bottom: 0; padding: 0 2px; border-radius: 4px; background: rgba(255,255,255,.82); color: #1c1917; line-height: 1.15; }
.mo-ghost { opacity: .22; box-shadow: none; }
[data-theme='dark'] .mo-ghost { opacity: .28; box-shadow: none; }
.mo-slot { display: inline-block; border-radius: 18%; border: 1px dashed rgba(120,113,108,.55); }
.mo-floor-slot { border-style: solid; background: rgba(190,60,50,.07); }
.mo-dot { display: inline-block; }
.mo-dot-empty { display: inline-block; background: rgba(120,113,108,.25); }
.mo-can { outline: 2px dashed rgba(234,138,0,.7); outline-offset: 1px; }
.mo-chosen { outline: 3px solid #ea8a00; outline-offset: 1px; }
.mo-glow > .mo-tile { box-shadow: 0 0 0 2px #f6c343, 0 0 10px 2px rgba(246,195,67,.8); }
.mo-plus { position: absolute; left: 50%; top: -2px; transform: translate(-50%, -100%); font-size: 13px; font-weight: 900; color: #15803d; text-shadow: 0 0 3px #fff; animation: mo-float .9s ease-out both; pointer-events: none; z-index: 2; }
[data-theme='dark'] .mo-plus { color: #6ee7b7; text-shadow: 0 0 3px #000; }
@keyframes mo-pop { 0% { transform: scale(.4); opacity: 0 } 60% { transform: scale(1.18); opacity: 1 } 100% { transform: none } }
@keyframes mo-float { from { opacity: 0; transform: translate(-50%, -40%) } 30% { opacity: 1 } to { opacity: 1; transform: translate(-50%, -110%) } }
@keyframes mo-crack { 0% { transform: none } 20% { transform: rotate(-8deg) } 40% { transform: rotate(7deg) } 60% { transform: rotate(-4deg); opacity: .8 } 100% { transform: none; opacity: .45 } }
@keyframes mo-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes mo-settle { 0% { transform: translateY(-6px) scale(1.1) } 70% { transform: translateY(1px) } 100% { transform: none } }
.mo-pop { animation: mo-pop .5s ease-out both; }
.mo-crack { display: inline-flex; animation: mo-crack .6s ease-out both; }
.mo-rise { animation: mo-rise .3s ease-out both; }
.mo-settle { animation: mo-settle .35s ease-out both; }
.mo-flight { position: fixed; z-index: 60; pointer-events: none; }
@media (prefers-reduced-motion: reduce) {
  .mo-pop, .mo-crack, .mo-rise, .mo-settle, .mo-plus { animation: none; }
}
`;

export function MosaicStyles() {
  return <style>{CSS}</style>;
}
