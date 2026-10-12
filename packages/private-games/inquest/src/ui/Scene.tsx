import { Button, Hint, RefusalSlot, cn } from '@vt/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { LOCATION_TILES, SCENE_SLOTS } from '../logic/content.ts';
import type { Bullet, GameView, InquestAction, InquestView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { type BulletNo, bulletNumbers } from './bullets.ts';
import { BulletIcon, Tile } from './Tile.tsx';
import { useTip } from './tips.ts';

type Act = (a: InquestAction, o?: { anchor?: string }) => Promise<boolean>;

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/**
 * "3rd · Location: Kitchen"; a moved bullet keeps its number: "3rd moved · Location: Kitchen →
 * Hall". Order only, never timings: the table talks between bullets, so a gap measures the talk.
 */
export function bulletLine(b: Bullet, content: Content, no: BulletNo) {
  const title = content.tileTitle(b.tile);
  const item = content.tileItem(b.tile, b.item);
  const what =
    b.movedFrom !== undefined
      ? `${ordinal(no.no)} moved · ${title}: ${content.tileItem(b.tile, b.movedFrom)} → ${item}`
      : `${ordinal(no.no)} · ${title}: ${item}`;
  return `${what}${no.movedLater ? ' (moved later)' : ''}`;
}

/** Location tiles look alike (one title), so the picker letters them: "Location A". */
export const locationLabel = (tile: number) =>
  `Location ${String.fromCharCode(65 + Math.max(0, LOCATION_TILES.indexOf(tile)))}`;

/** The bullets in the order they went down. During a discussion, this round's are highlighted. */
export function Timeline({
  g,
  content,
  full = false,
}: {
  g: GameView;
  content: Content;
  full?: boolean;
}) {
  if (!g.bullets.length) return null;
  const nos = bulletNumbers(g.bullets);
  const fresh = (b: Bullet) => g.stage === 'discuss' && b.round === g.round;
  if (full)
    return (
      <ol className="space-y-1 text-sm" aria-label="Bullet timeline">
        {g.bullets.map((b) => {
          const no = nos.get(b.seq)!;
          return (
            <li key={b.seq} className={cn('flex items-center gap-2', no.moved && 'pl-4')}>
              {no.moved ? <span aria-hidden>↪</span> : <BulletIcon />}
              <span
                className={cn(
                  fresh(b) && 'font-semibold text-amber-700 dark:text-amber-300',
                  no.movedLater && 'text-stone-500 dark:text-stone-400',
                )}
              >
                {bulletLine(b, content, no)}
                {fresh(b) ? ' · new' : ''}
              </span>
            </li>
          );
        })}
      </ol>
    );
  return (
    <ol
      aria-label="Bullet order"
      className="-mx-1 flex gap-1.5 overflow-x-auto overscroll-x-contain px-1 py-1 text-xs [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:thin] after:shrink-0 after:basis-4 after:content-['']"
    >
      {g.bullets.map((b, i) => {
        const no = nos.get(b.seq)!;
        return (
          <li
            key={b.seq}
            title={bulletLine(b, content, no)}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 dark:bg-stone-800',
              (fresh(b) || (g.stage !== 'discuss' && i === g.bullets.length - 1)) &&
                'ring-2 ring-amber-400',
              no.movedLater && 'opacity-60',
            )}
          >
            <b>
              {no.no}
              {no.moved ? ' ↪' : ''}
            </b>
            <span className="max-w-28 truncate">{content.tileItem(b.tile, b.item)}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The evidence on the table right now (one bullet per tile, newest first), in one slim line, so
 * a presentation can point at it without switching tabs.
 */
export function LatestBullets({ g, content }: { g: GameView; content: Content }) {
  const current = g.slots
    .map((s, slot) => ({ s, seq: seqOf(g, slot) }))
    .filter((x): x is { s: (typeof g.slots)[number]; seq: number } => x.seq !== null)
    .sort((a, b) => b.seq - a.seq);
  if (!current.length) return null;
  const newest = g.bullets.at(-1)?.seq;
  return (
    <ol
      aria-label="Bullets on the table"
      className="flex gap-1 overflow-x-auto py-0.5 text-[11px] [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] after:shrink-0 after:basis-4 after:content-['']"
    >
      {current.map(({ s, seq }) => (
        <li
          key={seq}
          className={cn(
            'flex shrink-0 items-center gap-1 rounded-full bg-stone-200 px-2 py-0.5 dark:bg-stone-800',
            seq === newest && 'ring-2 ring-amber-400',
          )}
        >
          <BulletIcon className="h-3" />
          <span className="text-stone-500 dark:text-stone-400">{content.tileTitle(s.tile)}:</span>
          <b>{content.tileItem(s.tile, s.bullet!)}</b>
        </li>
      ))}
    </ol>
  );
}

/** Which bullet (by `seq`) sits on a slot right now. */
function seqOf(g: GameView, slot: number) {
  const s = g.slots[slot];
  if (!s || s.bullet === null) return null;
  return g.bullets.findLast((b) => b.slot === slot && b.tile === s.tile)?.seq ?? null;
}

/** The order number players see on a slot's bullet (a moved bullet keeps its number). */
export function orderOf(g: GameView, slot: number) {
  const seq = seqOf(g, slot);
  return seq === null ? null : (bulletNumbers(g.bullets).get(seq)?.no ?? null);
}

interface Pending {
  slot: number;
  item?: number;
  /** Useful Clue: the drawn tile chosen. */
  tile?: number;
}

/** The six tiles, with whatever the viewer can do to them right now. */
export function Scene({ view, content, act }: { view: InquestView; content: Content; act: Act }) {
  const g = view.game!;
  const isFs = g.myRole === 'forensic' && g.stage !== 'done';
  const ev = g.event;
  const stepKey = `${g.round}-${g.step?.kind}-${ev?.kind}-${g.bullets.length}-${g.slots.map((s) => s.tile).join('.')}`;
  const [pending, setPending] = useState<{ key: string; p: Pending | null }>({
    key: stepKey,
    p: null,
  });
  const cur = pending.key === stepKey ? pending.p : null;
  const pick = (p: Pending | null) => setPending({ key: stepKey, p });
  const [tipOpen, dismissTip] = useTip('scene');
  const [fsTipOpen, dismissFsTip] = useTip('fs-picker');
  const [paceTipOpen, dismissPaceTip] = useTip('fs-pacing');
  const fresh = g.bullets.at(-1);
  // Keep the picked tile in sight above the confirm sheet (and the tab bar on phones).
  const grid = useRef<HTMLDivElement>(null);
  const pickedSlot = cur && cur.slot >= 0 ? cur.slot : null;
  useEffect(() => {
    if (pickedSlot === null) return;
    const el = grid.current?.querySelector<HTMLElement>(`[data-slot="${pickedSlot}"]`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [pickedSlot]);

  // What a tap on an item or a tile does, by step.
  const mode: 'bullet' | 'move' | 'replace' | 'testify' | 'useful' | 'location' | null = (() => {
    if (g.stage !== 'collect') return null;
    if (ev?.kind === 'testimony') return g.myRole === 'witness' ? 'testify' : null;
    if (!isFs) return null;
    if (ev?.kind === 'erroneous') return 'move';
    if (ev?.kind === 'countdown') return 'replace';
    if (ev?.kind === 'useful-clue') return 'useful';
    if (g.step?.kind === 'pick-location') return 'location';
    if (g.step?.kind === 'replace') return 'replace';
    if (g.step?.kind === 'bullets') return 'bullet';
    return null;
  })();

  const send = (action: InquestAction) =>
    void act(action, { anchor: 'inquest-scene' }).then(() => pick(null));

  const incoming =
    mode === 'replace'
      ? ev?.kind === 'countdown'
        ? (ev.drawn?.[0] ?? null)
        : g.step?.kind === 'replace'
          ? g.step.drawn
          : null
      : mode === 'useful'
        ? (cur?.tile ?? null)
        : null;

  const confirm = (() => {
    if (!cur) return null;
    const slot = g.slots[cur.slot];
    if (!slot) return null;
    switch (mode) {
      case 'bullet':
        return cur.item === undefined
          ? null
          : {
              label: `Place bullet on “${content.tileItem(slot.tile, cur.item)}”`,
              note: 'Bullets can’t move once placed.',
              run: () => send({ type: 'place-bullet', slot: cur.slot, item: cur.item! }),
            };
      case 'move':
        return cur.item === undefined
          ? null
          : {
              label: `Move the bullet to “${content.tileItem(slot.tile, cur.item)}”`,
              note: '',
              run: () => send({ type: 'move-bullet', slot: cur.slot, item: cur.item! }),
            };
      case 'replace':
        return {
          label: `Replace “${content.tileTitle(slot.tile)}”`,
          note: 'Its bullet goes with it; the new tile then gets a bullet.',
          run: () => send({ type: 'replace-tile', slot: cur.slot }),
        };
      case 'useful':
        return cur.tile === undefined || cur.slot < 0
          ? null
          : {
              label: `Swap “${content.tileTitle(cur.tile)}” in for “${content.tileTitle(slot.tile)}”`,
              note: '',
              run: () => send({ type: 'useful-pick', tile: cur.tile!, slot: cur.slot }),
            };
      case 'testify':
        return {
          label: `Have “${content.tileTitle(slot.tile)}” replaced`,
          note: 'Nobody will know it was you.',
          run: () => send({ type: 'testify', slot: cur.slot }),
        };
      default:
        return null;
    }
  })();

  const tileProps = (i: number) => {
    const slot = g.slots[i]!;
    const scene = SCENE_SLOTS.includes(i);
    const base = {
      tile: slot.tile,
      bullet: slot.bullet,
      content,
      fresh: g.stage !== 'discuss' && fresh?.slot === i && fresh.tile === slot.tile,
      isNew:
        g.stage === 'discuss' &&
        g.bullets.findLast((b) => b.slot === i && b.tile === slot.tile)?.round === g.round,
      order: orderOf(g, i),
    };
    switch (mode) {
      case 'bullet':
        return slot.bullet === null
          ? {
              ...base,
              pending: cur?.slot === i ? cur.item : null,
              onItem: (item: number) => pick({ slot: i, item }),
            }
          : { ...base, dim: true };
      case 'move':
        return scene && slot.bullet !== null
          ? {
              ...base,
              pending: cur?.slot === i ? cur.item : null,
              onItem: (item: number) =>
                item === slot.bullet ? undefined : pick({ slot: i, item }),
            }
          : { ...base, dim: true };
      case 'replace':
      case 'testify': {
        const ok =
          scene && (mode === 'testify' || ev?.kind !== 'countdown' || slot.bullet !== null);
        return ok
          ? { ...base, selected: cur?.slot === i, onTile: () => pick({ slot: i }) }
          : { ...base, dim: true };
      }
      case 'useful':
        return scene && cur?.tile !== undefined
          ? { ...base, selected: cur?.slot === i, onTile: () => pick({ ...cur, slot: i }) }
          : { ...base, dim: !scene };
      default:
        return base;
    }
  };

  return (
    <div className="space-y-2">
      {tipOpen && g.slots.length > 0 && (
        <TipBox onClose={dismissTip}>
          The 6 tiles describe the crime. Each bullet marks the item that fits best. Talk it over as
          they land: the order bullets land in can be a clue.
        </TipBox>
      )}
      {mode === 'bullet' && paceTipOpen && (
        <TipBox onClose={dismissPaceTip}>
          No rush: the table talks while your bullets land, and you may let that talk guide the next
          one. Place each bullet when you’re ready, but never speak, nod or point.
        </TipBox>
      )}
      {mode === 'location' && (
        <div className="space-y-2">
          {fsTipOpen && (
            <TipBox onClose={dismissFsTip}>
              Only your bullets may speak: no words, faces or gestures. Tap a tile or item, then
              confirm.
            </TipBox>
          )}
          <p className="text-sm font-semibold">Pick the Location tile:</p>
          <div className="grid grid-cols-2 gap-2">
            {LOCATION_TILES.map((t) => (
              <Tile
                key={t}
                tile={t}
                label={locationLabel(t)}
                bullet={null}
                content={content}
                selected={cur?.tile === t}
                onTile={() => pick({ slot: -1, tile: t })}
              />
            ))}
          </div>
          <Button
            className="h-auto! min-h-12 w-full py-2 leading-tight"
            size="lg"
            disabled={cur?.tile === undefined}
            onClick={() =>
              void act({ type: 'pick-location', tile: cur!.tile! }, { anchor: 'inquest-scene' })
            }
          >
            {cur?.tile !== undefined
              ? `Use ${locationLabel(cur.tile)} (${content.tileItem(cur.tile, 0)}…)`
              : 'Tap a Location tile'}
          </Button>
        </div>
      )}
      {incoming !== null && mode !== 'useful' && (
        <div className="rounded-xl bg-sky-50 p-2 ring-1 ring-sky-300 dark:bg-sky-500/10 dark:ring-sky-500/40">
          <div className="grid grid-cols-2 items-center gap-2">
            <Tile tile={incoming} bullet={null} content={content} />
            <p className="text-sm font-semibold">
              New tile: tap the scene tile below that it replaces.
            </p>
          </div>
        </div>
      )}
      {mode === 'useful' && ev?.kind === 'useful-clue' && ev.options && (
        <div className="space-y-1 rounded-xl bg-sky-50 p-2 ring-1 ring-sky-300 dark:bg-sky-500/10 dark:ring-sky-500/40">
          <p className="text-sm font-semibold">
            {cur?.tile === undefined
              ? 'Pick one of these tiles:'
              : 'Now tap the scene tile it replaces.'}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {ev.options.map((t) => (
              <Tile
                key={t}
                tile={t}
                bullet={null}
                content={content}
                selected={cur?.tile === t}
                onTile={() => pick({ slot: -1, tile: t })}
              />
            ))}
          </div>
        </div>
      )}
      {g.slots.length > 0 && (
        <div ref={grid} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {g.slots.map((_, i) => (
            <Tile
              key={`${i}-${g.slots[i]!.tile}`}
              slot={i}
              className="scroll-mt-20 scroll-mb-[calc(8.5rem+env(safe-area-inset-bottom))] lg:scroll-mb-24"
              {...tileProps(i)}
            />
          ))}
        </div>
      )}
      {confirm && (
        <div
          role="group"
          aria-label="Confirm"
          className="sticky bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-10 rounded-xl bg-white/95 p-1.5 shadow-lg ring-1 ring-amber-400 lg:bottom-2 dark:bg-stone-900/95"
        >
          <div className="flex items-center gap-1.5">
            <Button
              size="md"
              className="h-auto! min-h-10 min-w-0 flex-1 py-1.5 text-[15px] leading-tight text-balance"
              onClick={confirm.run}
            >
              {confirm.label}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => pick(null)}>
              Cancel
            </Button>
          </div>
          {confirm.note && (
            <p className="px-1 pt-0.5 text-[11px] leading-tight text-stone-500">{confirm.note}</p>
          )}
        </div>
      )}
      <RefusalSlot anchor="inquest-scene" />
      {g.bullets.length > 0 && <Timeline g={g} content={content} />}
      {g.removed.length > 0 && (
        <details className="rounded-xl bg-stone-100 p-2 text-sm dark:bg-stone-900">
          <summary className="cursor-pointer font-semibold">
            Removed tiles ({g.removed.length})
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {g.removed.map((s, i) => (
              <Tile key={i} tile={s.tile} bullet={s.bullet} content={content} dim />
            ))}
          </div>
        </details>
      )}
      {g.bullets.length > 0 && (
        <details className="rounded-xl bg-stone-100 p-2 dark:bg-stone-900">
          <summary className="cursor-pointer text-sm font-semibold">Full bullet timeline</summary>
          <div className="mt-2">
            <Timeline g={g} content={content} full />
          </div>
        </details>
      )}
      {g.slots.length === 0 && g.stage !== 'night' && mode !== 'location' && (
        <Hint>The Forensic Scientist is laying out the tiles…</Hint>
      )}
    </div>
  );
}

export function TipBox({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sm text-sky-950 ring-1 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
    >
      <span aria-hidden>💡</span>
      <span className="flex-1">{children}</span>
      <button type="button" className="font-bold" aria-label="Got it" onClick={onClose}>
        Got it
      </button>
    </div>
  );
}

export { ordinal };
