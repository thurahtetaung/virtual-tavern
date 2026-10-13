import { cn } from '@vt/ui';
import { type ReactNode, createContext, useContext } from 'react';
import { EDITIONS, type Edition, type Role } from '../logic/types.ts';
import type { Deck } from './assets.ts';
import type { Line } from './text.ts';

export const rankIn = (edition: Edition, role: Role) =>
  EDITIONS[edition].cards.find((c) => c.role === role)?.rank ?? 0;

/** What a card chip needs: the edition's names and ranks, and a way to open a card to read. */
export interface CardReader {
  deck: Deck;
  edition: Edition;
  read: (role: Role) => void;
}

const ReaderContext = createContext<CardReader | null>(null);
export const CardReaderProvider = ReaderContext.Provider;

export function useCardReader(): CardReader {
  const reader = useContext(ReaderContext);
  if (!reader) throw new Error('card chips need a CardReaderProvider');
  return reader;
}

/**
 * A card name in running text, as a tappable chip that opens the card (art and rule text) to
 * read. Every place a card is named uses this, so any name can be checked mid-game.
 */
export function CardChip({ role, className }: { role: Role; className?: string }) {
  const reader = useCardReader();
  const name = reader.deck.name(role);
  const rank = rankIn(reader.edition, role);
  return (
    <button
      type="button"
      aria-label={`Read ${name} (${rank})`}
      onClick={(e) => {
        // Chips sit inside buttons and summaries too (the Guard grid, the lobby): read, don't pick.
        e.stopPropagation();
        reader.read(role);
      }}
      className={cn(
        // The visible chip stays inline-sized; the ::before pad makes a 44 px tall tap target.
        'relative inline-flex items-baseline gap-0.5 rounded px-0.5 font-semibold whitespace-nowrap text-rose-800 underline decoration-rose-400/70 decoration-dotted underline-offset-2 transition before:absolute before:inset-x-0 before:-inset-y-3 hover:bg-danger-soft focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent dark:focus-visible:outline-amber-500 dark:text-rose-200 dark:hover:bg-rose-500/20',
        className,
      )}
    >
      <span aria-hidden className="text-[0.85em] tabular-nums opacity-70">
        {rank}
      </span>
      {name}
    </button>
  );
}

/** A described line with each card as a chip. */
export function Rich({ line }: { line: Line }) {
  const out: ReactNode[] = [];
  for (let i = 0; i < line.length; i++) {
    const s = line[i]!;
    if (typeof s === 'string') {
      out.push(s);
      continue;
    }
    // Punctuation right after a card stays on the chip's line ("Princess." never wraps the dot).
    const next = line[i + 1];
    const tail = typeof next === 'string' ? (/^[.,:;!?]+/.exec(next)?.[0] ?? '') : '';
    out.push(
      <span key={i} className="whitespace-nowrap">
        <CardChip role={s.card} />
        {tail}
      </span>,
    );
    if (tail) {
      const rest = (next as string).slice(tail.length);
      if (rest) out.push(rest);
      i++;
    }
  }
  return <>{out}</>;
}
