import { cn } from '@vt/ui';
import { CAUSE_TILE, LOCATION_TILES } from '../logic/content.ts';
import type { Content } from './assets.ts';

/** The bullet marker: a small brass round, drawn here rather than taken from the art. */
export function BulletIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 24" aria-hidden className={cn('inline-block h-4 w-2', className)}>
      <path
        d="M6 1 C10 4 10.5 8 10.5 11 V22 H1.5 V11 C1.5 8 2 4 6 1 Z"
        fill="#c9952b"
        stroke="#7a5512"
        strokeWidth="1"
      />
      <rect x="1.5" y="17" width="9" height="1.4" fill="#7a5512" />
    </svg>
  );
}

const accent = (tile: number) =>
  tile === CAUSE_TILE
    ? 'text-fuchsia-300'
    : LOCATION_TILES.includes(tile)
      ? 'text-emerald-300'
      : 'text-amber-300';

interface Props {
  tile: number;
  bullet: number | null;
  content: Content;
  /** Tapping an item (placing or moving a bullet). */
  onItem?: (item: number) => void;
  /** The item tapped but not yet confirmed. */
  pending?: number | null;
  /** The newest bullet: it pulses. */
  fresh?: boolean;
  /** Tapping the whole tile (choosing which tile to replace, or a Location). */
  onTile?: () => void;
  selected?: boolean;
  /** Dimmed (cannot be chosen right now). */
  dim?: boolean;
  /** Its place in the bullet order, shown by the marker. */
  order?: number | null;
  /** The table slot it sits in (a stable hook for tests). */
  slot?: number;
  className?: string;
}

/** A scene tile in our own style: its title and six items, with the bullet on one of them. */
export function Tile({
  tile,
  bullet,
  content,
  onItem,
  pending,
  fresh,
  onTile,
  selected,
  dim,
  order,
  slot,
  className,
}: Props) {
  const title = content.tileTitle(tile);
  const items = Array.from({ length: 6 }, (_, i) => i);
  const body = (
    <>
      <h4
        className={cn(
          'truncate px-1 text-center text-[11px] font-black tracking-wide uppercase',
          accent(tile),
        )}
      >
        {title}
      </h4>
      <ol className="mt-0.5">
        {items.map((i) => {
          const marked = bullet === i;
          const isPending = pending === i;
          const text = content.tileItem(tile, i);
          const row = (
            <>
              <span className="min-w-0 flex-1 truncate">{text}</span>
              {marked && (
                <span
                  className={cn(
                    'flex items-center gap-0.5',
                    fresh && 'animate-pulse motion-reduce:animate-none',
                  )}
                >
                  {order ? (
                    <span className="text-[9px] font-bold text-amber-200">{order}</span>
                  ) : null}
                  <BulletIcon />
                </span>
              )}
            </>
          );
          const cls = cn(
            'flex w-full items-center gap-1 rounded px-1.5 py-px text-left text-[12px] leading-tight',
            marked
              ? 'bg-amber-500/25 font-bold text-amber-50 ring-1 ring-amber-400/70'
              : 'text-stone-200',
            isPending && 'bg-sky-500/30 ring-2 ring-sky-300',
          );
          return (
            <li key={i}>
              {onItem ? (
                <button
                  type="button"
                  className={cn(cls, 'min-h-6 hover:bg-white/10')}
                  aria-pressed={isPending}
                  data-item={i}
                  data-marked={marked}
                  aria-label={`${title}: ${text}${marked ? ' (bullet)' : ''}`}
                  onClick={() => onItem(i)}
                >
                  {row}
                </button>
              ) : (
                <div className={cls} aria-label={marked ? `${text} (bullet)` : undefined}>
                  {row}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </>
  );
  const cls = cn(
    'block w-full rounded-xl bg-stone-900 p-1.5 text-left shadow ring-1 ring-stone-700 dark:bg-stone-950',
    fresh && 'ring-2 ring-amber-400',
    selected && 'ring-4 ring-sky-400',
    dim && 'opacity-50',
    className,
  );
  return onTile ? (
    <button
      type="button"
      data-tile={tile}
      data-slot={slot}
      className={cn(cls, 'cursor-pointer hover:ring-sky-400')}
      onClick={onTile}
      aria-pressed={selected}
      aria-label={`Tile: ${title}`}
    >
      {body}
    </button>
  ) : (
    <section aria-label={`Tile: ${title}`} className={cls}>
      {body}
    </section>
  );
}
