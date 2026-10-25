import { storageKey } from '@vt/game-sdk';
import { ProtectedImage, cn } from '@vt/ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { GROUPS, GROUP_EMOJI, GROUP_LABELS, type Group, iconsOf } from '../logic/board.ts';
import { type Board, CUBE_CAP, SETS, type SetId } from '../logic/types.ts';
import { GAP_X, GAP_Y, GROUP_GAP, LABEL, fitBoard } from '../logic/fit.ts';
import type { Art } from './assets.ts';

/** Each set's symbol, so a set never depends on its colour alone. */
export const SET_LABEL: Record<SetId, string> = {
  main: '?',
  sub1: '!1',
  sub2: '!2',
  sub3: '!3',
  sub4: '!4',
};

export const SET_NAME: Record<SetId, string> = {
  main: 'Green ?',
  sub1: 'Blue !1',
  sub2: 'Red !2',
  sub3: 'Yellow !3',
  sub4: 'Black !4',
};

// vt-palette: the five clue sets' colours are the pieces themselves, not decoration.
export const SET_CHIP: Record<SetId, string> = {
  main: 'bg-emerald-600 text-white', // vt-palette
  sub1: 'bg-sky-600 text-white', // vt-palette
  sub2: 'bg-red-600 text-white', // vt-palette
  sub3: 'bg-amber-300 text-stone-950', // vt-palette
  sub4: 'bg-stone-900 text-white ring-1 ring-stone-400 dark:ring-stone-300',
};

/** A clue piece as a chip: the set's symbol, then its order and stack. */
export function PieceChip({
  set,
  order,
  n = 1,
  marker = false,
  size = 'sm',
  className,
}: {
  set: SetId;
  order?: number;
  n?: number;
  marker?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-bold leading-none tabular-nums shadow-sm',
        size === 'sm' ? 'h-[18px] min-w-[18px] px-1 text-[11px]' : 'h-7 min-w-7 px-1.5 text-sm',
        marker ? 'rounded-full' : 'rounded-[4px]',
        SET_CHIP[set],
        className,
      )}
    >
      {SET_LABEL[set]}
      {order !== undefined && <sub className="ml-px text-[0.75em] font-semibold">{order}</sub>}
      {n > 1 && <span className="ml-0.5 text-[0.85em]">×{n}</span>}
    </span>
  );
}

/** What sits on one icon: each set's marker and cubes there. */
export interface OnIcon {
  set: SetId;
  marker: boolean;
  /** 1-based place among the set's cubes, and the stack's size. */
  order?: number;
  n?: number;
}

export function piecesByIcon(board: Board): Map<number, OnIcon[]> {
  const out = new Map<number, OnIcon[]>();
  const add = (icon: number, p: OnIcon) => out.set(icon, [...(out.get(icon) ?? []), p]);
  for (const set of SETS) {
    const c = board[set];
    if (c.marker !== null) add(c.marker, { set, marker: true });
    c.cubes.forEach((cube, i) => add(cube.icon, { set, marker: false, order: i + 1, n: cube.n }));
  }
  return out;
}

/** The icon's picture, or a numbered placeholder tile. */
export function IconFace({ icon, art, className }: { icon: number; art: Art; className?: string }) {
  const src = art.icon(icon);
  if (src)
    return (
      <ProtectedImage
        src={src}
        alt=""
        draggable={false}
        className={cn('size-full select-none rounded-[18%] object-contain', className)}
      />
    );
  return (
    <span
      className={cn(
        'flex size-full select-none flex-col items-center justify-center rounded-[18%] bg-panel text-center font-semibold text-stone-600 ring-1 ring-line-strong dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
        className,
      )}
    >
      <span className="text-[9px] uppercase tracking-wide opacity-70">Icon</span>
      <span className="text-base leading-none">{icon}</span>
    </span>
  );
}

const LONG_PRESS_MS = 450;

/** One icon of the board: tap to place, long-press (or right-click) to take a piece off. */
function Tile({
  icon,
  art,
  pieces,
  active,
  onPlace,
  onRemove,
}: {
  icon: number;
  art: Art;
  pieces: OnIcon[];
  active: SetId | null;
  onPlace?: (icon: number) => void;
  onRemove?: (icon: number) => void;
}) {
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A press in progress, and whether its long press already took a piece off.
  const pressing = useRef(false);
  const fired = useRef(false);
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  const name = art.name(icon);
  const markers = pieces.filter((p) => p.marker);
  const cubes = pieces.filter((p) => !p.marker);
  const label = [
    name,
    ...pieces.map((p) =>
      p.marker
        ? `${SET_NAME[p.set]} marker`
        : `${SET_NAME[p.set]} cube ${p.order}${(p.n ?? 1) > 1 ? `, ${p.n} stacked` : ''}`,
    ),
  ].join(', ');
  const interactive = !!onPlace && active !== null;
  const down = (e: PointerEvent) => {
    if (!interactive || e.button !== 0) return;
    pressing.current = true;
    fired.current = false;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      fired.current = true;
      onRemove?.(icon);
    }, LONG_PRESS_MS);
  };
  const up = () => {
    clearTimeout(timer.current);
    if (interactive && pressing.current && !fired.current) onPlace?.(icon);
    pressing.current = false;
  };
  const cancel = () => {
    clearTimeout(timer.current);
    pressing.current = false;
  };
  const key = (e: KeyboardEvent) => {
    if (!interactive) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPlace?.(icon);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove?.(icon);
    }
  };
  const body = (
    <>
      <IconFace icon={icon} art={art} />
      {markers.length > 0 && (
        <span className="pointer-events-none absolute -left-1 -top-1 flex gap-px">
          {markers.map((m) =>
            art.marker(m.set) ? (
              <ProtectedImage
                key={m.set}
                src={art.marker(m.set)!}
                alt=""
                className="ic-pop size-7 drop-shadow"
              />
            ) : (
              <PieceChip
                key={m.set}
                set={m.set}
                marker
                size="md"
                className="ic-pop size-6 min-w-6 px-0"
              />
            ),
          )}
        </span>
      )}
      {cubes.length > 0 && (
        <span className="pointer-events-none absolute inset-x-0 -bottom-1 flex flex-wrap justify-center gap-px">
          {cubes.map((c) => (
            <PieceChip key={c.set} set={c.set} order={c.order} n={c.n} className="ic-pop" />
          ))}
        </span>
      )}
    </>
  );
  if (!interactive)
    return (
      <div role="img" aria-label={label} title={name} className="relative aspect-square">
        {body}
      </div>
    );
  return (
    <button
      type="button"
      aria-label={label}
      title={name}
      data-icon={icon}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onContextMenu={(e) => {
        e.preventDefault();
        const already = fired.current;
        cancel();
        fired.current = false;
        // A touch long press already took one off; a right-click takes one now.
        if (!already) onRemove?.(icon);
      }}
      onKeyDown={key}
      className="relative aspect-square touch-manipulation select-none rounded-[18%] transition-transform focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-95 [-webkit-touch-callout:none]"
    >
      {body}
    </button>
  );
}

const TAB_KEY = 'iconic.tab';

/**
 * The board: on phones one group at a time behind tabs (with how many pieces each group holds),
 * on wider screens the whole board, column by column as printed.
 */
export function BoardView({
  board,
  art,
  active = null,
  onPlace,
  onRemove,
}: {
  board: Board;
  art: Art;
  active?: SetId | null;
  onPlace?: (icon: number) => void;
  onRemove?: (icon: number) => void;
}) {
  const [tab, setTab] = useState<Group>(() => {
    try {
      const saved = localStorage.getItem(storageKey(TAB_KEY));
      return (GROUPS as readonly string[]).includes(saved ?? '') ? (saved as Group) : 'things';
    } catch {
      return 'things';
    }
  });
  const pick = (g: Group) => {
    setTab(g);
    try {
      localStorage.setItem(storageKey(TAB_KEY), g);
    } catch {
      // Storage blocked: the tab just isn't remembered.
    }
  };
  const pieces = piecesByIcon(board);
  const inGroup = (g: Group) => iconsOf(g).filter((n) => pieces.has(n)).length;
  const tile = (n: number) => (
    <Tile
      key={n}
      icon={n}
      art={art}
      pieces={pieces.get(n) ?? []}
      active={active}
      {...(onPlace && { onPlace })}
      {...(onRemove && { onRemove })}
    />
  );
  return (
    <div className="flex flex-col gap-2">
      <div className="md:hidden" data-testid="ic-board-phone">
        <div role="tablist" aria-label="Icon groups" className="grid grid-cols-5 gap-1">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              role="tab"
              aria-selected={tab === g}
              onClick={() => pick(g)}
              className={cn(
                'relative flex flex-col items-center rounded-lg px-0.5 py-1 text-[11px] font-semibold ring-1 transition-colors',
                tab === g
                  ? 'bg-accent-soft text-accent-text ring-accent-line dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-500/50'
                  : 'bg-panel text-stone-600 ring-line dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
              )}
            >
              <span aria-hidden className="text-base leading-none">
                {GROUP_EMOJI[g]}
              </span>
              {GROUP_LABELS[g]}
              {inGroup(g) > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full bg-accent px-1 text-[10px] text-accent-fg dark:bg-amber-500 dark:text-stone-950">
                  {inGroup(g)}
                </span>
              )}
            </button>
          ))}
        </div>
        <div
          role="tabpanel"
          aria-label={GROUP_LABELS[tab]}
          className="mt-2 grid grid-cols-5 gap-x-2 gap-y-2.5 px-1"
        >
          {iconsOf(tab).map(tile)}
        </div>
      </div>
      <FullBoard tile={tile} />
    </div>
  );
}

/**
 * The room the board has on screen: its box's width, and the window's height below the box's top
 * (as when the page is scrolled to the top), so the whole board shows without scrolling.
 */
function useBoardRoom(ref: RefObject<HTMLDivElement | null>) {
  const [room, setRoom] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      const top = box.top + window.scrollY;
      const next = {
        width: Math.round(box.width),
        height: Math.max(0, Math.round(window.innerHeight - top - 16)),
      };
      setRoom((r) => (r.width === next.width && r.height === next.height ? r : next));
    };
    measure();
    // Whatever moves the board's top (a tip closing, a status line wrapping) resizes the page.
    const seen = new ResizeObserver(measure);
    seen.observe(el);
    seen.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      seen.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ref]);
  return room;
}

/** The whole board on wider screens, column by column as printed, sized to fit the window. */
function FullBoard({ tile }: { tile: (n: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { width, height } = useBoardRoom(ref);
  const fit = fitBoard(width, height);
  return (
    <div ref={ref} className="hidden w-full md:block" data-testid="ic-board-full">
      {width > 0 && (
        <div className="flex justify-center" style={{ gap: GROUP_GAP }}>
          {GROUPS.map((g) => (
            <section key={g} aria-label={GROUP_LABELS[g]} className="flex flex-col">
              <h4
                className="text-center text-xs font-semibold text-ink-muted dark:text-stone-400"
                style={{ height: LABEL }}
              >
                {GROUP_LABELS[g]}
              </h4>
              <div
                className="grid"
                style={{
                  gridTemplateColumns: `repeat(${g === 'colours' ? fit.colourCols : fit.cols}, ${fit.tile}px)`,
                  columnGap: GAP_X,
                  rowGap: GAP_Y,
                }}
              >
                {iconsOf(g).map(tile)}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every placed piece, set by set, in plain words: the clue at a glance, pinned on phones. */
export function ClueStrip({ board, art }: { board: Board; art: Art }) {
  const used = SETS.filter((s) => board[s].marker !== null || board[s].cubes.length > 0);
  return (
    <section
      aria-label="Clue so far"
      className="sticky top-0 z-10 -mx-1 flex flex-col gap-1 rounded-xl bg-card/95 px-2 py-1.5 text-sm shadow-sm ring-1 ring-line backdrop-blur dark:bg-stone-900/95 dark:ring-stone-700"
      data-testid="ic-clue-strip"
    >
      {used.length === 0 ? (
        <p className="py-1 text-center text-ink-muted dark:text-stone-400">
          No pieces on the board yet.
        </p>
      ) : (
        used.map((s) => {
          const c = board[s];
          return (
            <p key={s} className="flex flex-wrap items-center gap-x-1.5 gap-y-1" data-set={s}>
              <PieceChip set={s} marker />
              {c.marker !== null ? (
                <IconWord icon={c.marker} art={art} strong />
              ) : (
                <span className="italic text-ink-muted dark:text-stone-400">(marker off)</span>
              )}
              {c.cubes.map((cube, i) => (
                <span key={cube.icon} className="inline-flex items-center gap-1">
                  <span aria-hidden className="text-ink-muted">
                    ·
                  </span>
                  <span className="text-[11px] text-ink-muted dark:text-stone-400">{i + 1}</span>
                  <IconWord icon={cube.icon} art={art} />
                  {cube.n > 1 && <span className="text-xs font-semibold">×{cube.n}</span>}
                </span>
              ))}
            </p>
          );
        })
      )}
    </section>
  );
}

/** An icon as a small picture and its name. */
export function IconWord({ icon, art, strong }: { icon: number; art: Art; strong?: boolean }) {
  const src = art.icon(icon);
  return (
    <span
      className="inline-flex items-center gap-1"
      title={art.meanings(icon).join(', ') || undefined}
    >
      {src && <ProtectedImage src={src} alt="" className="size-5 rounded" />}
      <span className={strong ? 'font-semibold' : undefined}>{art.name(icon)}</span>
    </span>
  );
}

/** The set chips: which set the next tap places, with pieces left in each. */
export function SetPicker({
  board,
  active,
  onPick,
}: {
  board: Board;
  active: SetId;
  onPick: (set: SetId) => void;
}) {
  const mainDown = board.main.marker !== null;
  return (
    <div role="radiogroup" aria-label="Set to place" className="flex flex-wrap gap-1.5">
      {SETS.map((s) => {
        const c = board[s];
        const left = CUBE_CAP[s] - c.cubes.reduce((n, x) => n + x.n, 0);
        const locked = s !== 'main' && !mainDown;
        return (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={active === s}
            disabled={locked}
            onClick={() => onPick(s)}
            title={locked ? 'Place the ? marker first' : SET_NAME[s]}
            className={cn(
              'flex items-center gap-1 rounded-full py-0.5 pl-0.5 pr-2 text-xs font-semibold ring-1 transition',
              active === s
                ? 'bg-accent-soft text-accent-text ring-2 ring-accent dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-400'
                : 'bg-panel text-stone-700 ring-line dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-700',
              locked && 'opacity-40',
            )}
          >
            <PieceChip set={s} marker size="md" />
            <span>{c.marker === null ? 'marker' : `${left} left`}</span>
          </button>
        );
      })}
    </div>
  );
}
