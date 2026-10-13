import { Button, Modal, ProtectedImage, cn } from '@vt/ui';
import type { ReactNode } from 'react';
import { CARDS, symbolCount } from '../logic/cards.ts';
import type { CardDef, CardId, HeroId } from '../logic/types.ts';
import { type Art, heroVars } from './assets.ts';
import { rulesLine } from './text.ts';

const ICONS = { atk: '⚔', shd: '🛡', heal: '❤', play: '⚡', draw: '🃏' } as const;
const WORDS = { atk: 'damage', shd: 'shield', heal: 'heal', play: 'play again', draw: 'draw' };

/** The symbol badges in printed order: ⚔3, 🛡2, ❤1, ⚡1, 🃏2, 🐾, ✦. */
export function badges(
  def: CardDef,
): { key: string; icon: string; n: number | null; label: string }[] {
  const out: { key: string; icon: string; n: number | null; label: string }[] = [];
  const seen = new Set<string>();
  for (const step of def.steps) {
    if (step.k === 'paw') out.push({ key: 'paw', icon: '🐾', n: null, label: 'Form bonus' });
    else if (step.k === 'power') out.push({ key: 'power', icon: '✦', n: null, label: 'power' });
    else if (!seen.has(step.k)) {
      seen.add(step.k);
      const n = symbolCount(def, step.k);
      out.push({ key: step.k, icon: ICONS[step.k], n, label: `${n} ${WORDS[step.k]}` });
    }
  }
  if (def.shield > 0)
    out.splice(0, 0, { key: 'shd', icon: ICONS.shd, n: def.shield, label: `${def.shield} shield` });
  return out;
}

export interface CardProps {
  card: CardId;
  art: Art;
  /** Width in px; the height follows the printed 400:630. */
  width: number;
  /** Whose deck it comes from (rim colour when it isn't the holder's own). */
  borrowedFrom?: HeroId | null;
  /** Shields in play: points left of the printed total. */
  left?: number;
  selected?: boolean;
  /** Glows as a legal pick. */
  pickable?: boolean;
  dim?: boolean;
  className?: string;
  children?: ReactNode;
}

/**
 * A card with our overlay: the art (or a placeholder in the hero's colour), a rail of large
 * symbol badges on the left, ✦ for a power, and the name in a banner along the bottom.
 * The untouched original only shows in the zoom view.
 */
export function Card({
  card,
  art,
  width,
  borrowedFrom,
  left,
  selected,
  pickable,
  dim,
  className,
  children,
}: CardProps) {
  const def = CARDS[card];
  if (!def) return null;
  const face = art.face(card, width > 220 ? 'full' : 'thumb');
  const big = width >= 104;
  const name = art.card(card);
  return (
    <div
      style={{ width, ...heroVars(def.hero) }}
      className={cn(
        'relative aspect-[400/630] shrink-0 overflow-hidden rounded-[7%] bg-stone-800 shadow-md ring-1 ring-black/20 select-none',
        selected && 'ring-4 ring-accent dark:ring-amber-400',
        pickable && !selected && 'ring-4 ring-accent-line dark:ring-amber-300/70',
        borrowedFrom &&
          'outline-4 outline-offset-0 outline-[var(--hero)] dark:outline-[var(--hero-dark)]',
        dim && 'opacity-50',
        className,
      )}
      data-card={card}
    >
      {face ? (
        <ProtectedImage src={face} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <Placeholder def={def} big={big} />
      )}
      <div className="absolute top-[3%] left-[3%] flex flex-col gap-0.5" aria-hidden>
        {badges(def).map((b) => (
          <span
            key={b.key}
            className={cn(
              'inline-flex items-center justify-center gap-px rounded-md bg-black/75 font-bold text-white tabular-nums shadow',
              big ? 'min-w-8 px-1 py-0.5 text-sm' : 'min-w-6 px-0.5 text-[11px] leading-4',
            )}
          >
            <span>{b.icon}</span>
            {b.n !== null && <span>{b.n}</span>}
          </span>
        ))}
      </div>
      {left !== undefined && (
        <span
          className={cn(
            'absolute top-[3%] right-[3%] rounded-md bg-black/75 font-bold text-white tabular-nums',
            big ? 'px-1.5 py-0.5 text-sm' : 'px-1 text-[11px]',
          )}
        >
          {left}/{def.shield}
        </span>
      )}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/75 to-black/0 text-center font-semibold text-white',
          big
            ? 'px-1.5 pt-4 pb-1.5 text-[13px] leading-tight'
            : 'px-1 pt-3 pb-1 text-[10px] leading-tight',
        )}
      >
        <span className="line-clamp-2">{name}</span>
      </div>
      <span className="sr-only">
        {name}:{' '}
        {badges(def)
          .map((b) => b.label)
          .join(', ')}
      </span>
      {children}
    </div>
  );
}

/** A card-shaped placeholder in the hero's colour, for when there is no art. */
function Placeholder({ def, big }: { def: CardDef; big: boolean }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--hero)] p-2 text-white dark:bg-[var(--hero-dark)] dark:text-stone-950">
      <span className={cn('font-black opacity-80', big ? 'text-3xl' : 'text-lg')}>
        {def.effect ? '✦' : badges(def)[0]?.icon}
      </span>
    </div>
  );
}

/** The back of a hero's deck, for deck piles. */
export function CardBack({ hero, art, width }: { hero: HeroId; art: Art; width: number }) {
  const back = art.heroCard(hero, 'back');
  return (
    <div
      style={{ width, ...heroVars(hero) }}
      className="relative aspect-[400/630] shrink-0 overflow-hidden rounded-[7%] bg-[var(--hero)] shadow ring-1 ring-black/20 dark:bg-[var(--hero-dark)]"
    >
      {back && (
        <ProtectedImage src={back} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </div>
  );
}

/** Replaces the printed `{atk}`-style tokens with our icons. */
export const printed = (text: string) =>
  text.replace(/\{(atk|shd|heal|play|draw)\}/g, (_, k: keyof typeof ICONS) => ICONS[k]);

/**
 * The zoom view: the untouched original card (or the placeholder with its symbols), our rules
 * line, and, for a card in your hand on your turn, a Play button.
 */
export function Zoom({
  card,
  art,
  note,
  onClose,
  onPlay,
}: {
  card: CardId | null;
  art: Art;
  /** E.g. "From Ben's deck". */
  note?: string;
  onClose: () => void;
  onPlay?: () => void;
}) {
  const def = card ? CARDS[card] : undefined;
  const face = card ? art.face(card, 'full') : null;
  const text = card ? art.text(card) : null;
  return (
    <Modal
      open={!!def}
      onClose={onClose}
      title={card ? art.card(card) : ''}
      footer={
        onPlay ? (
          <Button className="w-full" onClick={onPlay}>
            Play {card ? art.card(card) : ''}
          </Button>
        ) : undefined
      }
    >
      {def && card && (
        <div className="flex flex-col items-center gap-3">
          {face ? (
            <ProtectedImage
              src={face}
              alt={art.card(card)}
              className="max-h-[52dvh] w-auto max-w-full rounded-[4.5%] shadow-lg"
            />
          ) : (
            <Card card={card} art={art} width={200} />
          )}
          <p className="text-center font-semibold">
            {badges(def)
              .map((b) => `${b.icon}${b.n ?? ''}`)
              .join('  ')}
          </p>
          {text && <p className="text-center text-sm italic">{printed(text)}</p>}
          <p className="text-center text-sm text-ink-muted dark:text-stone-400">{rulesLine(def)}</p>
          {note && <p className="text-center text-sm font-medium">{note}</p>}
        </div>
      )}
    </Modal>
  );
}
