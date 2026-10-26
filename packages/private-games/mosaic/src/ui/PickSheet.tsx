import { storageKey } from '@vt/game-sdk';
import { Button, Modal, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { type Market, marketAfter, splitFor } from '../logic/bot.ts';
import { countOf, linesFor, previewOf } from '../logic/rules.ts';
import { SPECIAL_TEXT, leftoverGroups, neighbours } from '../logic/specials.ts';
import { COLOUR_NAME, targetLine, tilesLine } from '../logic/tiles.ts';
import {
  COLOURS,
  type Move,
  type MosaicView,
  type PlayerView,
  SIZE,
  type Source,
  type Split,
  TILES,
  type Target,
  type Tile as TileKind,
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
  colour: TileKind;
}

/** The tiles at a place on the table. */
export const tilesAt = (view: MosaicView, source: Source): TileKind[] => {
  const g = view.game!;
  return source === 'centre'
    ? TILES.flatMap((t) => Array<TileKind>(countOf(g.centre, t)).fill(t))
    : (g.factories[source] ?? []);
};

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
  onPlace: (move: Move) => void;
  onClose: () => void;
}) {
  const g = view.game!;
  const grey = !!view.settings.grey;
  const [confirm, setConfirm] = useConfirmSetting();
  const [chosen, setChosen] = useState<Target | null>(null);
  const tiles = tilesAt(view, pick.source);
  const jokersHere = tiles.filter((t) => t === 'joker').length;
  // What is taken: the picked colour (or, picking a joker, the jokers alone or with a colour).
  const [colour, setColour] = useState<TileKind>(pick.colour);
  const [withJokers, setWithJokers] = useState(false);
  const jokers = colour !== 'joker' && withJokers ? jokersHere : 0;
  const count = tiles.filter((t) => t === colour).length;
  const market: Market = {
    factories: g.factories,
    centre: g.centre,
    marker: g.marker,
    specials: g.specials,
  };
  const special = pick.source === 'centre' ? null : (g.specials?.[pick.source] ?? null);
  const [split, setSplit] = useState<Split>(() =>
    splitFor(market, pick.source, pick.colour, false),
  );
  const marker = pick.source === 'centre' && g.marker === 'centre';
  const targets: Target[] = [...Array.from({ length: SIZE }, (_, r) => r), 'floor'];
  const previews = targets.map((t) => previewOf(me, colour, count, t, marker, jokers, grey));
  const legal = previews.filter((p) => !p.problem);
  const spill = (p: (typeof previews)[number]) => p.toFloor + p.toLid - (p.shielded ? 1 : 0);
  const least = Math.min(...legal.map(spill));
  const rest = tiles.filter((t) => t !== colour && !(jokers && t === 'joker'));
  const groups = leftoverGroups(rest);
  const sides =
    special?.kind === 'sf4' && pick.source !== 'centre'
      ? neighbours(g.specials, g.factories.length, pick.source)
      : null;
  const sideOf = (t: TileKind) => split[t] ?? (sides?.left === null ? 'right' : 'left');
  const move = (target: Target): Move => ({
    source: pick.source,
    colour,
    target,
    ...(jokers > 0 && { jokers: true }),
    ...(sides && { split: Object.fromEntries(groups.map((x) => [x.tile, sideOf(x.tile)])) }),
  });
  // Who plays next, and whether the table left behind gives them a line.
  const playing = g.players.filter((p) => !p.removed);
  const next = playing[(playing.findIndex((p) => p.id === me.id) + 1) % playing.length];
  const after = marketAfter(market, move('floor'));
  const stuckColours =
    next && next.id !== me.id
      ? COLOURS.filter((c) => after.centre[c] > 0 && linesFor(next, c, grey).length === 0)
      : [];
  const place = (t: Target) => {
    if (confirm) setChosen(t);
    else onPlace(move(t));
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
      title={`${tilesLine(count, colour)}${jokers ? ` + ${tilesLine(jokers, 'joker')}` : ''} from ${from}`}
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
                onClick={() => chosen !== null && onPlace(move(chosen))}
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
        {jokersHere > 0 && (
          <JokerChoice
            pickColour={pick.colour}
            colour={colour}
            withJokers={withJokers}
            jokersHere={jokersHere}
            tiles={tiles}
            art={art}
            onChange={(c, w) => {
              setColour(c);
              setWithJokers(w);
              setChosen(null);
              setSplit(splitFor(market, pick.source, c, w));
            }}
          />
        )}
        <p className="flex flex-wrap items-center gap-1 text-sm">
          {Array.from({ length: count }, (_, i) => (
            <Tile key={i} colour={colour} art={art} size={26} />
          ))}
          {Array.from({ length: jokers }, (_, i) => (
            <Tile key={`j${i}`} colour="joker" art={art} size={26} />
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
                ? `all ${count + jokers} on the floor${p.shielded ? ' (1 on your shield)' : ''}${p.toLid ? ` (${p.toLid} to the lid)` : ''}`
                : `${p.toLine} here${p.fills ? ', fills it ✓' : ''}${s ? `, ${s} spill` : ''}${p.shielded ? ', 1 on your shield' : ''}${p.choice ? ' · you pick its wall space' : ''}${p.falls ? ' · no wall space left: it would fall to the floor' : ''}`;
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
                          {p.choice ? 'up to ' : ''}+{p.points} at round end
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
            grey={grey}
            highlight={{
              colour,
              lines: linesFor(me, colour, grey),
              chosen,
              onPick: place,
            }}
          />
        </div>
        {special && (
          <p
            className="rounded-lg bg-special-soft px-2 py-1 text-xs text-special-ink ring-1 ring-special-line"
            data-testid="mo-special-note"
          >
            ✦ Special factory: {SPECIAL_TEXT[special.kind]}
          </p>
        )}
        {sides && groups.length > 0 && (
          <fieldset className="flex flex-col gap-1 text-sm" data-testid="mo-split">
            <legend className="mb-1 font-semibold">Send what’s left to its neighbours</legend>
            {groups.map(({ tile, count: n }) => (
              <div key={tile} className="flex flex-wrap items-center gap-1.5">
                <span className="flex min-w-24 items-center gap-1">
                  <Tile colour={tile} art={art} size={20} /> {tilesLine(n, tile)}
                </span>
                {(['left', 'right'] as const).map((side) => {
                  const to = sides[side];
                  if (to === null) return null;
                  return (
                    <button
                      key={side}
                      type="button"
                      onClick={() => setSplit({ ...split, [tile]: side })}
                      aria-pressed={sideOf(tile) === side}
                      className={cn(
                        'rounded-lg px-2 py-1 text-xs ring-1 ring-line dark:ring-stone-700',
                        sideOf(tile) === side
                          ? 'bg-accent/15 font-semibold ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-400'
                          : 'bg-card dark:bg-stone-800',
                      )}
                      data-side={side}
                    >
                      {side === 'left' ? `← factory ${to + 1}` : `factory ${to + 1} →`}
                    </button>
                  );
                })}
              </div>
            ))}
          </fieldset>
        )}
        <p className="text-sm text-ink-muted dark:text-stone-400" data-testid="mo-leaves">
          {rest.length === 0
            ? pick.source === 'centre'
              ? 'Takes them from the centre.'
              : 'Empties the factory.'
            : special?.kind === 'sf3'
              ? `Leaves ${groups.map((l) => tilesLine(l.count, l.tile)).join(' and ')} on this factory.`
              : sides
                ? `Sends ${groups.map((l) => `${tilesLine(l.count, l.tile)} ${sideOf(l.tile)}`).join(' and ')}.`
                : `Leaves ${groups.map((l) => tilesLine(l.count, l.tile)).join(' and ')}${pick.source === 'centre' ? ' in the centre' : ' → centre'}.`}
          {stuckColours.length > 0 && next
            ? ` ${name(next.id)} has no line for ${stuckColours.map((c) => COLOUR_NAME[c]).join(' or ')}.`
            : ''}
          {` ${plural(count + jokers, 'tile')} in all.`}
        </p>
      </div>
    </Modal>
  );
}

/**
 * With jokers at the picked place: take the colour alone or with the jokers, or (picking a joker)
 * the jokers alone or with one colour from the same place.
 */
function JokerChoice({
  pickColour,
  colour,
  withJokers,
  jokersHere,
  tiles,
  art,
  onChange,
}: {
  pickColour: TileKind;
  colour: TileKind;
  withJokers: boolean;
  jokersHere: number;
  tiles: TileKind[];
  art: Art;
  onChange: (colour: TileKind, withJokers: boolean) => void;
}) {
  const options: { colour: TileKind; withJokers: boolean; label: string }[] =
    pickColour === 'joker'
      ? [
          { colour: 'joker', withJokers: false, label: `${tilesLine(jokersHere, 'joker')} alone` },
          ...COLOURS.flatMap((c) => {
            const n = tiles.filter((t) => t === c).length;
            return n ? [{ colour: c, withJokers: true, label: `jokers + ${tilesLine(n, c)}` }] : [];
          }),
        ]
      : [
          { colour: pickColour, withJokers: false, label: 'without the jokers' },
          {
            colour: pickColour,
            withJokers: true,
            label: `with the ${tilesLine(jokersHere, 'joker')} too`,
          },
        ];
  return (
    <div
      className="flex flex-col gap-1"
      role="radiogroup"
      aria-label="Jokers"
      data-testid="mo-jokers"
    >
      <p className="flex items-center gap-1 text-xs text-ink-muted dark:text-stone-400">
        <Tile colour="joker" art={art} size={18} /> Jokers stand in for any colour. Taking them, you
        may take one other colour from here too; a line holds one colour plus jokers.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = o.colour === colour && o.withJokers === withJokers;
          return (
            <button
              key={o.label}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(o.colour, o.withJokers)}
              className={cn(
                'rounded-lg px-2 py-1 text-xs ring-1 ring-line dark:ring-stone-700',
                on
                  ? 'bg-accent/15 font-semibold ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-400'
                  : 'bg-card dark:bg-stone-800',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
