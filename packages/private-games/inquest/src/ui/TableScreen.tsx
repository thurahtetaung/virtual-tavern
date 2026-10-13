import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, cn } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import { eventText } from '../logic/names.ts';
import type { InquestView, PlayerView } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content } from './assets.ts';
import { Timeline, orderOf } from './Scene.tsx';
import { FinalList } from './Final.tsx';
import { accuserOf, nameOf, statusFor } from './status.ts';
import { suspectsOf } from './Suspects.tsx';
import { Tile } from './Tile.tsx';

/** Card height over width. */
const CARD_RATIO = 510 / 315;
/** Gaps (px) between suspects, between cards, and a suspect's padding plus its name line. */
const GAP = 12;
const CARD_GAP = 6;
const PAD = 16;
const HEAD = 30;

export interface SuspectLayout {
  /** Suspects per row. */
  cols: number;
  /** Cards per row inside one suspect (a hand of 8 is 4 + 4, or all 8 in one line). */
  perRow: number;
  /** Card width in px. */
  card: number;
}

/**
 * The biggest card size at which every suspect's hand fits the box at once, trying each number of
 * columns and both hand shapes.
 */
export function fitSuspects(width: number, height: number, n: number, hand: number): SuspectLayout {
  let best: SuspectLayout = { cols: Math.min(n, 3), perRow: Math.ceil(hand / 2), card: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols);
    for (const perRow of [Math.ceil(hand / 2), hand]) {
      const handRows = Math.ceil(hand / perRow);
      const colW = (width - (cols - 1) * GAP) / cols - PAD;
      const byW = (colW - (perRow - 1) * CARD_GAP) / perRow;
      const rowH = (height - (rows - 1) * GAP) / rows - PAD - HEAD;
      const byH = (rowH - (handRows - 1) * CARD_GAP) / handRows / CARD_RATIO;
      const card = Math.floor(Math.min(byW, byH));
      if (card > best.card) best = { cols, perRow, card };
    }
  }
  return best;
}

/** The size of an element, kept up to date. */
function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => {
      if (e) setBox({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return [ref, box] as const;
}

/**
 * A big, read-only layout for a shared screen at an in-person table: the tiles with their
 * numbered bullets, the events, every suspect's cards, and who is presenting, all on one screen
 * edge to edge. It only uses a watcher's view, which carries nothing private.
 */
export function TableScreen({
  view,
  room,
  content,
  onExit,
}: {
  view: InquestView;
  room: GameRoomInfo;
  content: Content;
  onExit: () => void;
}) {
  const g = view.game!;
  const p = g.present;
  const speaker = g.stage === 'present' && p ? p.order[p.index] : null;
  const f = g.final;
  const accuser = accuserOf(g);
  const newest = g.bullets.at(-1);
  const suspects = suspectsOf(g);
  const hand = Math.max(8, ...suspects.map((s) => s.clue.length + s.means.length));
  const [area, box] = useBox<HTMLDivElement>();
  const fit = box ? fitSuspects(box.w, box.h, suspects.length, hand) : null;
  const ev = g.event;
  const night = g.stage === 'night';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [onExit]);

  return (
    <div
      aria-label="Table screen"
      className="fixed inset-0 z-30 flex flex-col gap-3 overflow-auto bg-stone-100 p-3 text-stone-900 dark:bg-stone-950 dark:text-stone-100"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-3 rounded-xl bg-stone-900 px-4 py-2 text-stone-50">
        <p className="min-w-0 flex-1 text-xl font-semibold">
          {speaker
            ? `🎙️ ${nameOf(view, speaker)} is presenting`
            : accuser
              ? `⚖️ Final accusations: ${nameOf(view, accuser)} is accusing…`
              : g.stage === 'discuss'
                ? '💬 Discussion: talk over the new bullets'
                : statusFor(view, false, room).text}
          <span className="ml-3 text-base font-normal text-stone-400">
            {accuser && f
              ? `${f.index + 1} of ${f.order.length}`
              : `Round ${g.round} of ${g.finalRound}${g.countdown && g.stage !== 'done' ? ' · last round' : ''}`}
          </span>
        </p>
        <span className="rounded-full bg-info/20 dark:bg-sky-500/20 px-3 py-1 text-base font-semibold text-sky-100">
          🔬 Forensic Scientist: {nameOf(view, g.fs)}
        </span>
        {g.stage === 'discuss' && g.deadline !== null && (
          <Countdown
            deadline={g.deadline}
            clockOffset={room.clockOffset}
            soft
            expiredHint="The Forensic Scientist moves on when the table is ready"
          />
        )}
        {accuser && f && (
          <Countdown
            deadline={f.deadline}
            clockOffset={room.clockOffset}
            soft={view.settings.presentMode === 'soft'}
          />
        )}
        {speaker && p && (
          <Countdown
            deadline={p.deadline}
            clockOffset={room.clockOffset}
            soft={view.settings.presentMode === 'soft'}
          />
        )}
        <Button variant="secondary" size="sm" onClick={onExit}>
          Leave table screen
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,32rem)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,40rem)_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col gap-3">
          {night || !g.slots.length ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 rounded-xl bg-stone-900 p-6 text-center text-stone-100">
              <p className="text-6xl" aria-hidden>
                🌙
              </p>
              <p className="text-3xl font-semibold">
                {night ? 'Night falls…' : 'The scene is being set…'}
              </p>
              <p className="text-lg text-stone-400">
                {night
                  ? 'The Murderer is choosing the crime. Study the suspects’ cards meanwhile.'
                  : `${nameOf(view, g.fs)} is laying out the tiles.`}
              </p>
              {night && (
                <Countdown
                  deadline={g.deadline}
                  clockOffset={room.clockOffset}
                  label="until the scene is set"
                />
              )}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {g.slots.map((s, i) => (
                <Tile
                  key={`${i}-${s.tile}`}
                  tile={s.tile}
                  bullet={s.bullet}
                  content={content}
                  order={orderOf(g, i)}
                  wrapTitle
                  fresh={g.stage !== 'discuss' && newest?.slot === i && newest.tile === s.tile}
                  isNew={
                    g.stage === 'discuss' &&
                    g.bullets.findLast((b) => b.slot === i && b.tile === s.tile)?.round === g.round
                  }
                  className="[&_h4]:text-sm 2xl:[&_h4]:text-base [&_li>div]:text-sm 2xl:[&_li>div]:text-base"
                />
              ))}
            </div>
          )}
          {f && (
            <section
              aria-label="Final accusations"
              className="space-y-1 rounded-xl bg-white/70 p-3 ring-2 ring-danger dark:ring-rose-400 dark:bg-stone-900/70"
            >
              <h3 className="text-sm font-bold tracking-wide text-stone-500 uppercase">
                Final accusations
              </h3>
              <FinalList view={view} content={content} big />
            </section>
          )}
          {(ev || g.events.length > 0) && (
            <section
              aria-label="Events"
              className="space-y-1 rounded-xl bg-white/70 p-3 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:ring-stone-800"
            >
              <h3 className="text-sm font-bold tracking-wide text-stone-500 uppercase">Events</h3>
              {ev && (
                <p className="text-base">
                  <b>⚡ {content.eventName(ev.kind)}:</b> {eventText(ev.kind, view.settings)}
                </p>
              )}
              <ol className="flex flex-wrap gap-1.5 text-sm">
                {g.events.map((k, i) => (
                  <li
                    key={`${i}-${k}`}
                    className={cn(
                      'rounded-full bg-stone-200 px-2 py-0.5 dark:bg-stone-800',
                      ev?.kind === k &&
                        i === g.events.length - 1 &&
                        'ring-2 ring-accent dark:ring-amber-400',
                    )}
                  >
                    {content.eventName(k)}
                  </li>
                ))}
              </ol>
            </section>
          )}
          {g.bullets.length > 0 && (
            <section
              aria-label="Bullets in order"
              className="min-h-0 space-y-1 overflow-auto rounded-xl bg-white/70 p-3 ring-1 ring-stone-200 dark:bg-stone-900/70 dark:ring-stone-800"
            >
              <h3 className="text-sm font-bold tracking-wide text-stone-500 uppercase">
                Bullets in order
              </h3>
              <Timeline g={g} content={content} full />
            </section>
          )}
        </div>
        <div ref={area} className="min-h-[60vh] lg:min-h-0">
          <ul
            className="grid content-start gap-3"
            style={{ gridTemplateColumns: `repeat(${fit?.cols ?? 2}, minmax(0, max-content))` }}
            aria-label="Suspects"
          >
            {suspects.map((s) => (
              <SuspectHand
                key={s.id}
                s={s}
                speaking={s.id === speaker}
                accusing={s.id === accuser}
                content={content}
                perRow={fit?.perRow ?? 4}
                card={fit?.card ?? 96}
              />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SuspectHand({
  s,
  speaking,
  accusing,
  content,
  perRow,
  card,
}: {
  s: PlayerView;
  speaking: boolean;
  accusing: boolean;
  content: Content;
  perRow: number;
  card: number;
}) {
  const cards = [
    ...s.clue.map((n) => ({ deck: 'clue' as const, n })),
    ...s.means.map((n) => ({ deck: 'means' as const, n })),
  ];
  return (
    <li
      className={cn(
        'rounded-xl bg-white/70 p-2 dark:bg-stone-900/70',
        speaking || accusing
          ? 'ring-4 ring-accent dark:ring-amber-400'
          : 'ring-1 ring-stone-200 dark:ring-stone-800',
      )}
    >
      <h4 className="mb-1 truncate text-lg leading-tight font-bold">
        {s.name}
        {speaking && (
          <span className="ml-2 text-sm font-semibold text-amber-500">🎙️ presenting</span>
        )}
        {accusing && <span className="ml-2 text-sm font-semibold text-amber-500">⚖️ accusing</span>}
        {s.badges <= 0 && (
          <span className="ml-2 text-sm font-normal text-stone-500">attempt used</span>
        )}
      </h4>
      <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${perRow}, ${card}px)` }}>
        {cards.map(({ deck, n }) => (
          <ArtCard
            key={`${deck}-${n}`}
            deck={deck}
            n={n}
            content={content}
            ruledOut={deck === 'clue' && s.ruledOut.includes(n)}
          />
        ))}
      </div>
    </li>
  );
}
