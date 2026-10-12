import { cn } from '@vt/ui';
import { useRef, useState } from 'react';
import type { GameView, InquestView, PlayerView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content, Deck } from './assets.ts';
import { type Mark, type Marks, markKey, nextMark } from './marks.ts';

export interface OpenCard {
  deck: Deck;
  n: number;
  owner: string;
}

/** Everyone whose cards are on the table (the Forensic Scientist deals none). */
export const suspectsOf = (g: GameView) => g.players.filter((p) => p.clue.length > 0);

/** Badge state for a chip: 🪪 still holds an attempt, ✕ spent. */
function BadgeDot({ p }: { p: PlayerView }) {
  if (p.isFs || p.formerFs) return <span aria-label="Forensic Scientist">🔬</span>;
  if (p.badges > 1) return <span aria-label={`${p.badges} attempts`}>🪪×{p.badges}</span>;
  return p.badges > 0 ? (
    <span aria-label="has an attempt">🪪</span>
  ) : (
    <span aria-label="attempt used" className="opacity-60">
      ✕
    </span>
  );
}

interface Common {
  view: InquestView;
  content: Content;
  marks: Marks;
  setMark: (id: string, mark: Mark | null) => void;
  onOpen: (card: OpenCard) => void;
}

/** A suspect's 8 cards: the Clue row, then the Means row, filling the width. */
function CardGrid({
  p,
  view,
  content,
  marks,
  setMark,
  onOpen,
  size = 'grid',
}: Common & { p: PlayerView; size?: 'grid' | 'thumb' }) {
  const g = view.game!;
  const sol = g.solution && g.solution.murderer === p.id ? g.solution : null;
  const row = (deck: Deck, cards: number[]) => (
    <div className={cn('grid gap-1.5', cards.length <= 4 ? 'grid-cols-4' : 'grid-cols-5')}>
      {cards.map((n) => {
        const key = markKey(deck, n);
        return (
          <ArtCard
            key={key}
            deck={deck}
            n={n}
            content={content}
            size={size}
            mark={marks[key]}
            ruledOut={deck === 'clue' && p.ruledOut.includes(n)}
            key_={!!sol && (deck === 'clue' ? sol.clue === n : sol.means === n)}
            onTap={() => onOpen({ deck, n, owner: p.id })}
            onLongPress={() => setMark(key, nextMark(marks[key]))}
          />
        );
      })}
    </div>
  );
  return (
    <div className="space-y-1.5">
      {row('clue', p.clue)}
      {row('means', p.means)}
    </div>
  );
}

function chipLabel(p: PlayerView, view: InquestView) {
  return p.id === view.me?.id ? `${p.name} (you)` : p.name;
}

/** Phones: one suspect at a time, a chip strip and swipes; a Grid toggle for the overview. */
export function Suspects(props: Common) {
  const { view } = props;
  const g = view.game!;
  const list = suspectsOf(g);
  const [index, setIndex] = useState(0);
  const [grid, setGrid] = useState(false);
  const touch = useRef<number | null>(null);
  const i = Math.min(index, Math.max(0, list.length - 1));
  const p = list[i];
  if (!p) return null;
  const go = (d: number) => setIndex((i + d + list.length) % list.length);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <div
          role="tablist"
          aria-label="Suspects"
          className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]"
        >
          {list.map((s, k) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={!grid && k === i}
              onClick={() => {
                setIndex(k);
                setGrid(false);
              }}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
                !grid && k === i
                  ? 'bg-amber-500 text-stone-950 ring-amber-600'
                  : 'bg-white text-stone-700 ring-stone-300 dark:bg-stone-800 dark:text-stone-200 dark:ring-stone-600',
                s.gone && 'opacity-60',
              )}
            >
              {chipLabel(s, view)}
              <BadgeDot p={s} />
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={grid}
          onClick={() => setGrid(!grid)}
          className={cn(
            'shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ring-1',
            grid
              ? 'bg-amber-500 text-stone-950 ring-amber-600'
              : 'ring-stone-300 dark:ring-stone-600',
          )}
        >
          ▦ Grid
        </button>
      </div>
      {grid ? (
        <ul className="space-y-2" aria-label="All suspects">
          {list.map((s, k) => (
            <li key={s.id}>
              <button
                type="button"
                className="mb-0.5 text-xs font-bold underline-offset-2 hover:underline"
                onClick={() => {
                  setIndex(k);
                  setGrid(false);
                }}
              >
                {chipLabel(s, view)} <BadgeDot p={s} />
              </button>
              <div className="grid grid-cols-[repeat(10,minmax(0,1fr))] gap-1">
                {(['clue', 'means'] as const).flatMap((deck) =>
                  (deck === 'clue' ? s.clue : s.means).map((n) => {
                    const key = markKey(deck, n);
                    return (
                      <ArtCard
                        key={key}
                        deck={deck}
                        n={n}
                        size="thumb"
                        content={props.content}
                        mark={props.marks[key]}
                        ruledOut={deck === 'clue' && s.ruledOut.includes(n)}
                        onTap={() => props.onOpen({ deck, n, owner: s.id })}
                        onLongPress={() => props.setMark(key, nextMark(props.marks[key]))}
                      />
                    );
                  }),
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <section
          aria-label={`${p.name}’s cards`}
          onTouchStart={(e) => {
            touch.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            const start = touch.current;
            touch.current = null;
            const end = e.changedTouches[0]?.clientX;
            if (start === null || end === undefined) return;
            if (Math.abs(end - start) > 50) go(end < start ? 1 : -1);
          }}
        >
          <CardGrid {...props} p={p} />
          <p className="mt-1 text-center text-[11px] text-stone-500 dark:text-stone-400">
            Swipe for the next suspect · hold a card to mark it ★ / ✕
          </p>
        </section>
      )}
    </div>
  );
}

/** Desktop: every suspect at once, one row of art cards each. */
export function AllSuspects(props: Common) {
  const g = props.view.game!;
  return (
    <ul className="grid gap-3 xl:grid-cols-2" aria-label="Suspects">
      {suspectsOf(g).map((p) => (
        <li
          key={p.id}
          className="rounded-xl bg-white/70 p-2 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:ring-stone-800"
        >
          <h4 className="mb-1 flex items-center gap-1 text-sm font-bold">
            {chipLabel(p, props.view)} <BadgeDot p={p} />
          </h4>
          <CardGrid {...props} p={p} />
        </li>
      ))}
    </ul>
  );
}
