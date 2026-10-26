import { ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, memo } from 'react';
import { TYPES, typeOf, variantOf } from '../logic/cards.ts';
import type { Art } from './assets.ts';

/** Each colour group's band on a drawn card (the dish's own colour, as on the real cards). */
const BAND: Record<string, string> = {
  yellow: '#e2bd3f',
  maki: '#c4473d',
  temaki: '#4f8b5c',
  uramaki: '#c3c24c',
  tempura: '#c97d3a',
  sashimi: '#93b94a',
  dumpling: '#6a7fb8',
  eel: '#7a5aa6',
  tofu: '#98a28a',
  onigiri: '#4b505d',
  edamame: '#69a86b',
  miso: '#c98f4f',
  chopsticks: '#3fa1ab',
  spoon: '#8b8b99',
  menu: '#c56a9f',
  takeout: '#a07a55',
  order: '#d65c8a',
  soy: '#8a5a3a',
  tea: '#8c2f3a',
  pudding: '#de983a',
  icecream: '#6aa56b',
  fruit: '#e06757',
};

export const bandOf = (k: string) => BAND[TYPES[typeOf(k)].colour] ?? '#888';

/** What a drawn card shows under its name: points, icons, shape, fruit or its number. */
function detail(k: string): string {
  const x = variantOf(k);
  if (x.points) return `${x.points}`;
  if (x.icons) return '●'.repeat(x.icons);
  if (x.shape) return { circle: '●', triangle: '▲', square: '■', rectangle: '▬' }[x.shape];
  if (x.fruit)
    return Object.entries(x.fruit)
      .flatMap(([f, n]) => Array.from({ length: n }, () => ({ w: '🍉', p: '🍍', o: '🍊' })[f]))
      .join('');
  return '';
}

export type CardSize = 'hand' | 'tray' | 'mini' | 'big';

const SIZES: Record<CardSize, string> = {
  big: 'w-40 sm:w-48',
  hand: 'w-[4.6rem] sm:w-24',
  tray: 'w-12 sm:w-14',
  mini: 'w-8',
};

/**
 * One card: its art (the small copy unless `full`) or, without the manifest, a drawn face from
 * its dish, name and points. Face-down cards show the back (or 🥡 2).
 */
export const CardFace = memo(function CardFace({
  k,
  art,
  size = 'hand',
  flipped,
  full,
  className,
  children,
}: {
  k: string;
  art: Art;
  size?: CardSize;
  flipped?: boolean;
  full?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const name = art.names.card(k);
  const src = flipped ? art.back(full) : art.card(k, full);
  const no = variantOf(k).no;
  return (
    <span
      className={cn(
        'relative inline-flex aspect-[440/690] shrink-0 flex-col overflow-hidden rounded-[7%] bg-card shadow-sm ring-1 ring-line select-none dark:bg-stone-800 dark:ring-stone-600',
        SIZES[size],
        className,
      )}
      title={flipped ? `${name} (face down: 2 points)` : name}
    >
      {src ? (
        <ProtectedImage
          src={src}
          alt={flipped ? `${name}, face down` : name}
          className="h-full w-full object-cover"
        />
      ) : flipped ? (
        <span className="flex h-full flex-col items-center justify-center gap-0.5 bg-stone-300 text-stone-700 dark:bg-stone-700 dark:text-stone-200">
          <span aria-hidden className={size === 'mini' ? 'text-xs' : 'text-lg'}>
            🥡
          </span>
          <span className="text-[0.6rem] font-bold">2</span>
          <span className="sr-only">{name}, face down</span>
        </span>
      ) : (
        <>
          <span aria-hidden className="h-[18%] w-full" style={{ background: bandOf(k) }} />
          <span className="flex flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-center">
            <span
              aria-hidden
              className={size === 'mini' ? 'text-sm' : size === 'tray' ? 'text-xl' : 'text-3xl'}
            >
              {TYPES[typeOf(k)].emoji}
            </span>
            {size !== 'mini' && (
              <span className="text-[0.6rem] leading-tight font-semibold sm:text-[0.7rem]">
                {name}
              </span>
            )}
            {size !== 'mini' && detail(k) && (
              <span className="text-[0.6rem] font-bold text-ink-muted dark:text-stone-300">
                {detail(k)}
              </span>
            )}
          </span>
          {no !== undefined && size !== 'mini' && (
            <span className="absolute right-1 bottom-1 rounded-full bg-stone-900/70 px-1 text-[0.55rem] font-bold text-white">
              {no}
            </span>
          )}
        </>
      )}
      {children}
    </span>
  );
});

/** The shared animations (each turns itself off for reduced motion). */
export function ConveyorStyles() {
  return (
    <style>{`
@keyframes cv-flip { from { transform: perspective(600px) rotateY(90deg); opacity: .2 } to { transform: none; opacity: 1 } }
@keyframes cv-rise { from { transform: translateY(6px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes cv-pop { 0% { transform: scale(.8); opacity: 0 } 60% { transform: scale(1.06); opacity: 1 } 100% { transform: none } }
.cv-flip { animation: cv-flip .45s ease-out both }
.cv-rise { animation: cv-rise .3s ease-out both }
.cv-pop { animation: cv-pop .4s ease-out both }
@media (prefers-reduced-motion: reduce) { .cv-flip, .cv-rise, .cv-pop { animation: none } }
`}</style>
  );
}
