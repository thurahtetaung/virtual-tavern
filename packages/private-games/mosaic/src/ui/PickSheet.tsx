import { storageKey } from '@vt/game-sdk';
import { Button, Modal, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { marketAfter } from '../logic/bot.ts';
import { linesFor, previewOf } from '../logic/rules.ts';
import { COLOUR_NAME, targetLine } from '../logic/tiles.ts';
import {
  COLOURS,
  type Colour,
  type MosaicView,
  type PlayerView,
  SIZE,
  type Source,
  type Target,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { BoardView, Tile } from './Pieces.tsx';
import type { NameOf } from './text.ts';

export const CONFIRM_KEY = 'mosaic.confirm';
export const PLAY_ANCHOR = 'mo-play';

/** The confirm step (on by default), kept per seat. */
export function useConfirmSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(storageKey(CONFIRM_KEY)) !== '0';
    } catch {
      return true;
    }
  });
  return [
    on,
    (v) => {
      setOn(v);
      try {
        localStorage.setItem(storageKey(CONFIRM_KEY), v ? '1' : '0');
      } catch {
        // Storage blocked: the choice lasts until the page closes.
      }
    },
  ];
}

export interface Pick {
  source: Source;
  colour: Colour;
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/**
 * The pick sheet: every place the picked group could go, with what it costs (tiles spilled, the
 * floor points, whether the line fills and what its tile will score), what the take leaves in the
 * centre, and the confirm step.
 */
export function PickSheet({
  pick,
  view,
  me,
  art,
  name,
  onPlace,
  onClose,
}: {
  pick: Pick;
  view: MosaicView;
  me: PlayerView;
  art: Art;
  name: NameOf;
  onPlace: (target: Target) => void;
  onClose: () => void;
}) {
  const g = view.game!;
  const [confirm, setConfirm] = useConfirmSetting();
  const [chosen, setChosen] = useState<Target | null>(null);
  const count =
    pick.source === 'centre'
      ? g.centre[pick.colour]
      : g.factories[pick.source]!.filter((t) => t === pick.colour).length;
  const marker = pick.source === 'centre' && g.marker === 'centre';
  const targets: Target[] = [...Array.from({ length: SIZE }, (_, r) => r), 'floor'];
  const previews = targets.map((t) => previewOf(me, pick.colour, count, t, marker));
  const legal = previews.filter((p) => !p.problem);
  const spill = (p: (typeof previews)[number]) => p.toFloor + p.toLid;
  const least = Math.min(...legal.map(spill));
  const leftovers =
    pick.source === 'centre'
      ? []
      : COLOURS.flatMap((c) => {
          const n = g.factories[pick.source as number]!.filter((t) => t === c).length;
          return c !== pick.colour && n ? [{ c, n }] : [];
        });
  // Who plays next, and whether the table left behind gives them a line.
  const playing = g.players.filter((p) => !p.removed);
  const next = playing[(playing.findIndex((p) => p.id === me.id) + 1) % playing.length];
  const after = marketAfter(g, pick.source, pick.colour);
  const stuckColours =
    next && next.id !== me.id
      ? COLOURS.filter((c) => after.centre[c] > 0 && linesFor(next, c).length === 0)
      : [];
  const place = (t: Target) => {
    if (confirm) setChosen(t);
    else onPlace(t);
  };
  const chosenPreview = chosen === null ? null : previews[targets.indexOf(chosen)]!;
  const warn =
    chosenPreview && spill(chosenPreview) >= 3 && spill(chosenPreview) > least
      ? `That spills ${spill(chosenPreview)} tiles; ${targetLine(legal.find((p) => spill(p) === least)!.target)} would spill ${least}.`
      : null;
  const from = pick.source === 'centre' ? 'the centre' : `factory ${pick.source + 1}`;

  return (
    <Modal
      open
      onClose={onClose}
      title={`${count} ${COLOUR_NAME[pick.colour]} from ${from}`}
      footer={
        <div className="flex w-full flex-col gap-1.5">
          {warn && (
            <p className="rounded-lg bg-warn-soft px-2 py-1 text-xs text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40">
              ⚠️ {warn}
            </p>
          )}
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-2 text-sm text-ink-muted dark:text-stone-300">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
                className="size-4 accent-accent"
                data-testid="mo-confirm"
              />
              Ask before placing
            </label>
            {confirm && (
              <Button
                disabled={chosen === null}
                onClick={() => chosen !== null && onPlace(chosen)}
                data-testid="mo-place"
              >
                Place{chosen !== null ? ` in ${targetLine(chosen)}` : ''}
              </Button>
            )}
          </div>
          <RefusalSlot anchor={PLAY_ANCHOR} />
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="flex flex-wrap items-center gap-1 text-sm">
          {Array.from({ length: count }, (_, i) => (
            <Tile key={i} colour={pick.colour} art={art} size={26} />
          ))}
          {marker && (
            <span className="ml-1 text-xs font-semibold text-warn-ink dark:text-amber-200">
              + the first-player marker (costs a floor space; you start next round)
            </span>
          )}
        </p>
        <ul className="flex flex-col gap-1" aria-label="Where they can go">
          {previews.map((p, i) => {
            const t = targets[i]!;
            const s = spill(p);
            const detail = p.problem
              ? p.problem
              : t === 'floor'
                ? `all ${count} on the floor${p.toLid ? ` (${p.toLid} to the lid)` : ''}`
                : `${p.toLine} here${p.fills ? ', fills it ✓' : ''}${s ? `, ${s} spill` : ''}`;
            return (
              <li key={String(t)}>
                <button
                  type="button"
                  disabled={!!p.problem}
                  onClick={() => place(t)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm ring-1 ring-line disabled:opacity-45 dark:ring-stone-700',
                    chosen === t
                      ? 'bg-accent/15 ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-400'
                      : 'bg-card hover:bg-panel dark:bg-stone-800 dark:hover:bg-stone-700',
                  )}
                  data-target={String(t)}
                  aria-pressed={chosen === t}
                >
                  <span className="w-14 font-semibold">
                    {t === 'floor' ? 'Floor' : `Line ${t + 1}`}
                  </span>
                  <span className="flex-1 text-ink-muted dark:text-stone-300">{detail}</span>
                  {!p.problem && (
                    <span className="flex flex-col items-end text-xs font-bold tabular-nums">
                      {p.points !== null && (
                        <span className="text-success-ink dark:text-emerald-300">
                          +{p.points} at round end
                        </span>
                      )}
                      <span
                        className={
                          p.penalty
                            ? 'text-danger-ink dark:text-rose-300'
                            : 'text-ink-muted dark:text-stone-500'
                        }
                      >
                        {p.penalty ? `${p.penalty} now` : 'no cost'}
                      </span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex justify-center rounded-xl bg-panel p-2 ring-1 ring-line dark:bg-stone-950 dark:ring-stone-800">
          <BoardView
            board={me}
            art={art}
            size="sm"
            highlight={{
              colour: pick.colour,
              lines: linesFor(me, pick.colour),
              chosen,
              onPick: place,
            }}
          />
        </div>
        <p className="text-sm text-ink-muted dark:text-stone-400" data-testid="mo-leaves">
          {leftovers.length
            ? `Leaves ${leftovers.map((l) => `${l.n} ${COLOUR_NAME[l.c]}`).join(' and ')} → centre.`
            : pick.source === 'centre'
              ? 'Takes them from the centre.'
              : 'Empties the factory.'}
          {stuckColours.length > 0 && next
            ? ` ${name(next.id)} has no line for ${stuckColours.map((c) => COLOUR_NAME[c]).join(' or ')}.`
            : ''}
          {` ${plural(count, 'tile')} in all.`}
        </p>
      </div>
    </Modal>
  );
}
