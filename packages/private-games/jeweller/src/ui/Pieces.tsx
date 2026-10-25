import { ProtectedImage, cn } from '@vt/ui';
import { memo } from 'react';
import { cardOf, nobleOf } from '../logic/cards.ts';
import { LEVEL_NAME, TOKEN_NAME } from '../logic/gems.ts';
import { costAfter } from '../logic/rules.ts';
import { GEMS, type Gem, type Level, type Token } from '../logic/types.ts';
import type { Art } from './assets.ts';

/** Each piece's own colour: the game's identity, in both themes. */
export const TOKEN_FILL: Record<Token, string> = {
  white: 'bg-stone-50 text-stone-800 ring-stone-400 dark:bg-stone-100',
  // vt-palette: gem colours
  blue: 'bg-blue-600 text-white ring-blue-800',
  // vt-palette: gem colours
  green: 'bg-emerald-600 text-white ring-emerald-800',
  // vt-palette: gem colours
  red: 'bg-red-600 text-white ring-red-800',
  black: 'bg-stone-900 text-white ring-stone-600 dark:ring-stone-400',
  // vt-palette: gem colours
  gold: 'bg-amber-400 text-stone-900 ring-amber-600',
};

/** A card's colour band. */
export const BAND: Record<Gem, string> = {
  white: 'bg-stone-200 dark:bg-stone-300',
  // vt-palette: gem colours
  blue: 'bg-blue-600/85',
  // vt-palette: gem colours
  green: 'bg-emerald-600/85',
  // vt-palette: gem colours
  red: 'bg-red-600/85',
  black: 'bg-stone-800',
};

const BAND_TEXT: Record<Gem, string> = {
  white: 'text-stone-900',
  blue: 'text-white',
  green: 'text-white',
  red: 'text-white',
  black: 'text-white',
};

/** One piece (or a pile of them): the manifest's art, else a coloured chip, with a count. */
export const TokenChip = memo(function TokenChip({
  token,
  art,
  count,
  size = 28,
  className,
  dim,
}: {
  token: Token;
  art: Art;
  count?: number | string;
  size?: number;
  className?: string;
  dim?: boolean;
}) {
  const src = size <= 60 ? art.tokenThumb(token) : art.token(token);
  return (
    <span
      role="img"
      aria-label={count === undefined ? TOKEN_NAME[token] : `${count} ${TOKEN_NAME[token]}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center rounded-full font-black tabular-nums shadow-sm ring-2',
        TOKEN_FILL[token],
        dim && 'opacity-35',
        className,
      )}
    >
      {src && (
        <ProtectedImage
          src={src}
          alt=""
          className="absolute inset-0 size-full rounded-full object-cover"
        />
      )}
      {count !== undefined && (
        <span
          className={cn(
            'relative',
            src && 'rounded-full bg-black/55 px-1 text-white dark:bg-black/60',
          )}
        >
          {count}
        </span>
      )}
    </span>
  );
});

/** A small cost pip: the colour and how many. */
function Pip({
  gem,
  n,
  covered,
  short,
}: {
  gem: Gem;
  n: number;
  /** Fully paid by the viewer's discounts. */
  covered: boolean;
  /** The viewer lacks pieces for it. */
  short: boolean;
}) {
  return (
    <span
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-full text-[10px] leading-none font-black tabular-nums ring-1 sm:size-5 sm:text-xs',
        TOKEN_FILL[gem],
        covered && 'opacity-30',
        short && 'ring-2 ring-offset-1 ring-offset-card dark:ring-offset-stone-900',
      )}
    >
      {covered ? '✓' : n}
    </span>
  );
}

export interface CardHints {
  bonuses: Record<Gem, number>;
  tokens: Record<Token, number>;
}

export type Afford = 'yes' | 'gold' | 'no' | null;

/**
 * A development card drawn from its numbers: points and colour on the band, the cost as pips.
 * With `hints` (the viewer's discounts and pieces), each pip shows what the viewer still pays
 * in it, covered colours are ticked, and the card glows when it can be bought.
 */
export const CardTile = memo(function CardTile({
  id,
  art,
  hints,
  afford = null,
  onClick,
  className,
  size = 'sm',
  fresh,
}: {
  id: string;
  art: Art;
  hints?: CardHints;
  afford?: Afford;
  onClick?: () => void;
  className?: string;
  /** `sm` for the market, `lg` for a sheet. */
  size?: 'sm' | 'lg';
  /** Just arrived: plays the deal. */
  fresh?: boolean;
}) {
  const card = cardOf(id);
  const after = hints ? costAfter(card, hints.bonuses) : card.cost;
  const src = size === 'lg' ? art.card(id) : art.cardThumb(id);
  const pips = GEMS.filter((g) => card.cost[g] > 0);
  const label = `Level ${LEVEL_NAME[card.level]} ${TOKEN_NAME[card.bonus]} card, ${card.points} ${card.points === 1 ? 'point' : 'points'}, costs ${pips.map((g) => `${card.cost[g]} ${TOKEN_NAME[g]}`).join(', ')}${afford === 'yes' ? ': you can buy it' : afford === 'gold' ? ': you can buy it with gold' : ''}`;
  const body = (
    <>
      {src ? (
        <ProtectedImage
          src={src}
          alt=""
          className="pointer-events-none absolute inset-0 size-full object-cover object-[50%_60%]"
        />
      ) : (
        size === 'lg' && (
          <span
            aria-hidden
            className="absolute inset-0 flex items-center justify-center opacity-20"
          >
            <TokenChip token={card.bonus} art={art} size={80} />
          </span>
        )
      )}
      <span
        className={cn(
          'relative flex items-center justify-between px-1.5',
          size === 'lg' ? 'h-12 text-3xl' : 'h-5 text-sm sm:h-7 sm:text-lg',
          BAND[card.bonus],
          BAND_TEXT[card.bonus],
        )}
      >
        <span className="font-black tabular-nums drop-shadow-sm">{card.points || ''}</span>
        <TokenChip
          token={card.bonus}
          art={art}
          size={size === 'lg' ? 34 : 16}
          className={card.bonus === 'white' ? 'ring-stone-500' : 'ring-white/80'}
        />
      </span>
      <span
        className={cn(
          'relative mt-auto flex flex-wrap-reverse content-end gap-0.5 p-1',
          size === 'lg' && 'gap-1.5 p-2',
        )}
      >
        {pips.map((g) => (
          <Pip
            key={g}
            gem={g}
            n={after[g]}
            covered={!!hints && after[g] === 0}
            short={!!hints && after[g] > hints.tokens[g]}
          />
        ))}
      </span>
    </>
  );
  const box = cn(
    'relative flex flex-col overflow-hidden rounded-lg bg-card text-left shadow-sm ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
    size === 'lg' ? 'h-64 w-44' : 'aspect-[6/5] w-full sm:aspect-[4/5]',
    afford === 'yes' && 'ring-[3px] ring-success dark:ring-emerald-400',
    afford === 'gold' && 'ring-[3px] ring-warn dark:ring-amber-400',
    fresh && 'jw-deal',
    className,
  );
  return onClick ? (
    <button
      type="button"
      className={cn(
        box,
        'transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-accent',
      )}
      onClick={onClick}
      aria-label={label}
      data-card={id}
    >
      {body}
    </button>
  ) : (
    <span role="img" aria-label={label} className={box} data-card={id}>
      {body}
    </span>
  );
});

/** A face-down card: a deck, or a reserved card the viewer may not see. */
export function CardBack({
  level,
  art,
  count,
  onClick,
  className,
  label,
}: {
  level: Level;
  art: Art;
  count?: number;
  onClick?: () => void;
  className?: string;
  label?: string;
}) {
  const src = art.backThumb(level);
  const name =
    label ?? `Level ${LEVEL_NAME[level]} deck${count !== undefined ? `, ${count} left` : ''}`;
  const body = (
    <>
      {src && (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full object-cover" />
      )}
      <span className="relative text-sm font-black tracking-widest text-ink drop-shadow dark:text-stone-100">
        {'•'.repeat(level)}
      </span>
      {count !== undefined && (
        <span className="relative rounded bg-card/80 px-1 text-[11px] font-bold tabular-nums text-ink dark:bg-stone-900/80 dark:text-stone-100">
          {count}
        </span>
      )}
    </>
  );
  const box = cn(
    'relative flex flex-col items-center justify-center gap-0.5 overflow-hidden rounded-lg bg-panel shadow-sm ring-1 ring-line dark:bg-stone-700 dark:ring-stone-600',
    className,
  );
  return onClick ? (
    <button
      type="button"
      className={cn(box, 'focus-visible:outline-2 focus-visible:outline-accent')}
      onClick={onClick}
      aria-label={name}
      data-deck={level}
    >
      {body}
    </button>
  ) : (
    <span role="img" aria-label={name} className={box}>
      {body}
    </span>
  );
}

/** A noble: their portrait (or crown), 3 points and the cards they want, with progress. */
export const NobleTile = memo(function NobleTile({
  id,
  art,
  bonuses,
  size = 'sm',
  onClick,
  className,
  fresh,
}: {
  id: string;
  art: Art;
  /** The viewer's discounts, to show progress. */
  bonuses?: Record<Gem, number>;
  size?: 'sm' | 'lg';
  onClick?: () => void;
  className?: string;
  fresh?: boolean;
}) {
  const noble = nobleOf(id);
  const src = size === 'lg' ? art.noble(id) : art.nobleThumb(id);
  const wants = GEMS.filter((g) => noble.requires[g] > 0);
  const ready = !!bonuses && wants.every((g) => bonuses[g] >= noble.requires[g]);
  const label = `${art.nobleName(id)}: ${noble.points} points for ${wants.map((g) => `${noble.requires[g]} ${TOKEN_NAME[g]}`).join(', ')} cards${bonuses ? ` (you have ${wants.map((g) => Math.min(bonuses[g], noble.requires[g])).join(', ')})` : ''}`;
  const body = (
    <>
      {src ? (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span aria-hidden className="absolute top-1 right-1 text-sm opacity-70">
          👑
        </span>
      )}
      <span className="relative self-start rounded-br-md bg-card/85 px-1 text-sm font-black dark:bg-stone-900/85">
        {noble.points}
      </span>
      <span className="relative mt-auto flex flex-col items-start gap-0.5 p-1">
        {wants.map((g) => (
          <span key={g} className="flex items-center gap-0.5">
            <span
              className={cn(
                'inline-flex h-4 min-w-4 items-center justify-center rounded px-0.5 text-[10px] font-black ring-1',
                size === 'lg' && 'h-6 min-w-6 text-sm',
                TOKEN_FILL[g],
              )}
            >
              {noble.requires[g]}
            </span>
            {bonuses && (
              <span className="rounded bg-card/85 px-0.5 text-[10px] font-semibold tabular-nums text-ink-muted dark:bg-stone-900/85 dark:text-stone-300">
                {Math.min(bonuses[g], noble.requires[g])}
              </span>
            )}
          </span>
        ))}
      </span>
    </>
  );
  const box = cn(
    'relative flex shrink-0 flex-col overflow-hidden rounded-lg bg-special-soft shadow-sm ring-1 ring-special-line dark:bg-violet-900/40 dark:ring-violet-500/40',
    size === 'lg' ? 'size-32' : 'size-14 sm:size-20',
    ready && 'ring-[3px] ring-success dark:ring-emerald-400',
    fresh && 'jw-pop',
    className,
  );
  return onClick ? (
    <button
      type="button"
      className={cn(box, 'focus-visible:outline-2 focus-visible:outline-accent')}
      onClick={onClick}
      aria-label={label}
      data-noble={id}
    >
      {body}
    </button>
  ) : (
    <span role="img" aria-label={label} className={box} data-noble={id}>
      {body}
    </span>
  );
});

const CSS = `
@keyframes jw-deal { from { opacity: 0; transform: translateY(-10px) scale(.92) } to { opacity: 1; transform: none } }
@keyframes jw-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.12); opacity: 1 } 100% { transform: none } }
@keyframes jw-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
.jw-deal { animation: jw-deal .4s ease-out both }
.jw-pop { animation: jw-pop .55s ease-out both }
.jw-rise { animation: jw-rise .3s ease-out both }
@media (prefers-reduced-motion: reduce) {
  .jw-deal, .jw-pop, .jw-rise { animation: jw-rise .01s both }
}
`;

export function JewellerStyles() {
  return <style>{CSS}</style>;
}
