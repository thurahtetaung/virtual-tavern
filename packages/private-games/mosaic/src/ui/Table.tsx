import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import {
  Button,
  FitArea,
  Countdown,
  Modal,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  TabBar,
  cn,
  tabPanelProps,
  FoldSummary,
} from '@vt/ui';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeTo, countOf } from '../logic/rules.ts';
import { SPECIAL_CHIP, SPECIAL_SHORT, SPECIAL_TEXT } from '../logic/specials.ts';
import { COLOUR_NAME, SYMBOL } from '../logic/tiles.ts';
import {
  type Move,
  type MosaicAction,
  type MosaicView,
  OUCH,
  type LogEntry,
  type PlayerView,
  type Special,
  TILES,
  type Tile as TileKind,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { PLAY_ANCHOR, type Pick, PickSheet } from './PickSheet.tsx';
import { BoardView, Marker, MiniWall, Tile, useMatch } from './Pieces.tsx';
import { Tiling } from './Tiling.tsx';
import { WallStage } from './Wall.tsx';
import { type NameOf, logLine } from './text.ts';

export type Act = (action: MosaicAction, options?: { anchor?: string }) => Promise<boolean>;

export interface TableProps {
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  showGuide: (id?: string) => void;
  tips?: ReactNode;
}

type Tab = 'play' | 'boards' | 'scores';
const TABS_ID = 'mosaic-view';

/** Whether the desktop layout is showing (Tailwind's `lg`). */
const useWide = () => useMatch('(min-width: 1024px)');

const reduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Take = Extract<LogEntry, { kind: 'take' }>;
const lastTake = (view: MosaicView) =>
  [...view.log].reverse().find((e): e is Take => e.kind === 'take');

/** The first element of a selector that is on screen. */
function visible(selector: string): Element | null {
  for (const el of document.querySelectorAll(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

/**
 * Tiles fly from where they were taken to the line (or floor, or the player's chip) they went
 * to: the positions of every group on the table are kept from the last render, so the picture
 * still knows where the tiles were once the state has moved on.
 */
function useFlights(view: MosaicView, art: Art) {
  const rects = useRef(new Map<string, DOMRect>());
  const seen = useRef<number | null>(null);
  const take = lastTake(view);
  const id = take?.id ?? 0;
  useLayoutEffect(() => {
    if (seen.current !== null && take && id !== seen.current && !reduced()) {
      const from = rects.current.get(`${take.source}:${take.colour}`);
      const dest =
        (take.target === 'floor'
          ? visible(`[data-board="${take.by}"] [data-floor]`)
          : visible(`[data-board="${take.by}"] [data-line="${take.target}"]`)) ??
        visible(`[data-chip="${take.by}"]`);
      if (from && dest) fly(from, dest.getBoundingClientRect(), take.colour, take.count, art);
    }
    seen.current = id;
  }, [id, take, art]);
  // After every render: where each group sits now.
  useLayoutEffect(() => {
    const next = new Map<string, DOMRect>();
    for (const el of document.querySelectorAll<HTMLElement>('[data-src]')) {
      const key = el.dataset.src!;
      const r = el.getBoundingClientRect();
      if (!next.has(key) && r.width > 0) next.set(key, r);
    }
    rects.current = next;
  });
}

function fly(from: DOMRect, to: DOMRect, colour: TileKind, count: number, art: Art) {
  const size = Math.min(28, from.width || 24);
  const src = art.tile(colour, true);
  for (let i = 0; i < Math.min(count, 8); i++) {
    const el = document.createElement('span');
    el.className = `mo-tile mo-c-${colour} mo-flight`;
    el.style.width = el.style.height = `${size}px`;
    el.style.left = `${from.left + i * 4}px`;
    el.style.top = `${from.top}px`;
    if (src) {
      el.style.backgroundImage = `url("${src}")`;
      el.style.backgroundSize = 'cover';
    } else {
      el.textContent = SYMBOL[colour];
      el.style.fontSize = `${size * 0.5}px`;
    }
    document.body.appendChild(el);
    const dx = to.left + to.width / 2 - (from.left + i * 4) - size / 2;
    const dy = to.top + to.height / 2 - from.top - size / 2;
    const anim = el.animate(
      [
        { transform: 'translate(0, 0) scale(1.1)' },
        { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 30}px) scale(1.15)`, offset: 0.5 },
        { transform: `translate(${dx}px, ${dy}px) scale(.9)`, opacity: 0.6 },
      ],
      { duration: 520 + i * 70, easing: 'ease-in-out' },
    );
    anim.onfinish = () => el.remove();
    anim.oncancel = () => el.remove();
  }
}

/** "Ouch: Ben ate −8", for everyone, when one take costs 5 or more. */
function Ouch({ view, name, you }: { view: MosaicView; name: NameOf; you: string }) {
  const take = lastTake(view);
  const id = take?.id ?? 0;
  // Only takes made while this screen is open: not the one already there when it opened.
  const [opened] = useState(id);
  const [dismissed, setDismissed] = useState<number | null>(null);
  const ouch = !!take && id !== opened && id !== dismissed && take.penalty <= -OUCH;
  useEffect(() => {
    if (!ouch) return;
    const t = setTimeout(() => setDismissed(id), 3500);
    return () => {
      clearTimeout(t);
    };
  }, [ouch, id]);
  if (!ouch) return null;
  return (
    <p
      role="status"
      className="mo-rise rounded-xl bg-danger-soft px-3 py-1.5 text-center text-sm font-bold text-danger-ink ring-1 ring-danger-line"
      data-testid="mo-ouch"
    >
      😬 Ouch: {take.by === you ? 'you' : name(take.by)} ate {take.penalty}!
    </p>
  );
}

/** A special factory's name in words: "+1 tile", "Gathers red". */
export const specialName = (sp: Special) =>
  sp.kind === 'sf2' && sp.colour ? `Gathers ${COLOUR_NAME[sp.colour]}` : SPECIAL_SHORT[sp.kind];

/**
 * A factory: a disc of up to 4 tiles (a few more on some special ones); tap one to pick its
 * colour. A special factory shows its gold face (or a drawn placeholder) and its effect in words;
 * one taken as a floor shield shows who has it.
 */
function Factory({
  index,
  tiles,
  special,
  art,
  name,
  onPick,
  hover,
  setHover,
  onInfo,
}: {
  index: number;
  tiles: TileKind[];
  special: Special | null;
  art: Art;
  name: NameOf;
  onPick: ((p: Pick) => void) | null;
  hover: Pick | null;
  setHover: (p: Pick | null) => void;
  onInfo: (sp: Special) => void;
}) {
  const face = special ? art.special(special, true) : null;
  const bg = special ? face : art.factory(true);
  if (special?.holder)
    return (
      <div
        className="relative flex aspect-square flex-col items-center justify-center rounded-full bg-panel text-center text-xs leading-tight text-ink-muted ring-1 ring-line ring-dashed"
        role="group"
        aria-label={`Factory ${index + 1}: ${name(special.holder)}’s floor shield this round`}
        data-factory={index}
      >
        <span aria-hidden>🛡</span>
        <span className="max-w-full truncate px-1">{name(special.holder)}</span>
      </div>
    );
  const big = tiles.length > 4;
  const sorted = [...tiles].sort((a, b) => TILES.indexOf(a) - TILES.indexOf(b));
  return (
    <div
      className={cn(
        'relative flex aspect-square items-center justify-center rounded-full',
        !bg && 'bg-panel ring-1 ring-line',
        special && 'mo-gold',
      )}
      role="group"
      aria-label={`Factory ${index + 1}${special ? ` (special: ${specialName(special)})` : ''}: ${tiles.length ? tiles.map((t) => COLOUR_NAME[t]).join(', ') : 'empty'}`}
      data-factory={index}
      data-special={special ? special.kind : undefined}
    >
      {bg && (
        // An empty factory's face is dimmed, so the art's own pieces never read as tiles left.
        <ProtectedImage
          src={bg}
          alt=""
          className={cn('absolute inset-0 size-full rounded-full', !tiles.length && 'opacity-45')}
        />
      )}
      {special?.kind === 'sf2' && special.colour && face && tiles.length > 0 && (
        // The face shows another set's piece: our own tile sits over its centre square (not once
        // the factory is empty, where it would read as a tile left behind).
        <Tile
          colour={special.colour}
          art={art}
          size={14}
          className="absolute! top-[39%] left-[39%] size-[22%]! opacity-90"
        />
      )}
      {special && (
        <button
          type="button"
          onClick={() => onInfo(special)}
          className="absolute -top-2 left-1/2 z-10 -translate-x-1/2 rounded-full bg-special px-2 text-xs leading-[18px] font-bold whitespace-nowrap text-white shadow-sm ring-1 ring-white/70 sm:leading-5 dark:ring-black/50"
          aria-label={`Special factory ${index + 1}: ${specialName(special)}. What does it do?`}
          data-testid="mo-special"
        >
          ✦ {SPECIAL_CHIP[special.kind]}
        </button>
      )}
      <div
        className={cn(
          // On touch screens the tiles touch and each one's padding fills its share of the disc,
          // so a thumb never lands in a gap; same colours sit together, so a near miss still picks
          // the colour meant (a pick takes every tile of its colour anyway).
          'relative grid gap-0.5 pointer-coarse:gap-0',
          big ? 'grid-cols-3' : 'grid-cols-2',
        )}
      >
        {sorted.map((t, i) => {
          const lit = hover?.source === index && hover.colour === t;
          const n = tiles.filter((x) => x === t).length;
          return onPick ? (
            <button
              key={i}
              type="button"
              onClick={() => onPick({ source: index, colour: t })}
              onPointerEnter={() => setHover({ source: index, colour: t })}
              onPointerLeave={() => setHover(null)}
              className={cn(
                'rounded-[18%] focus-visible:outline-2 focus-visible:outline-accent',
                big ? 'pointer-coarse:p-px' : 'pointer-coarse:p-[3px]',
                lit && 'outline-2 outline-offset-1 outline-accent',
              )}
              aria-label={`${n} ${COLOUR_NAME[t]} from factory ${index + 1}`}
              data-src={`${index}:${t}`}
            >
              <Tile colour={t} art={art} size={big ? 18 : 24} />
            </button>
          ) : (
            <span key={i} data-src={`${index}:${t}`}>
              <Tile colour={t} art={art} size={big ? 18 : 24} />
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Market({
  view,
  art,
  name,
  onPick,
}: {
  view: MosaicView;
  art: Art;
  name: NameOf;
  onPick: ((p: Pick) => void) | null;
}) {
  const g = view.game!;
  const [hover, setHover] = useState<Pick | null>(null);
  const [info, setInfo] = useState<Special | null>(null);
  const centre = TILES.filter((c) => countOf(g.centre, c) > 0);
  // Wide screens: every factory in one row, so the boards under them stay in the window.
  const wide = useWide();
  return (
    <section aria-label="The table" className="flex flex-col gap-2" data-testid="mo-market">
      <div
        className={cn('grid grid-cols-5 gap-1.5', g.specials && 'pt-2.5')}
        style={
          wide
            ? {
                gridTemplateColumns: `repeat(${g.factories.length}, minmax(0, min(9rem, 16dvh)))`,
                justifyContent: 'center',
              }
            : undefined
        }
      >
        {g.factories.map((f, i) => (
          <Factory
            key={i}
            index={i}
            tiles={f}
            special={g.specials?.[i] ?? null}
            art={art}
            name={name}
            onPick={f.length ? onPick : null}
            hover={hover}
            setHover={setHover}
            onInfo={setInfo}
          />
        ))}
      </div>
      {info && (
        <Modal open onClose={() => setInfo(null)} title={`✦ ${specialName(info)}`}>
          <p className="text-sm" data-testid="mo-special-info">
            {SPECIAL_TEXT[info.kind]}
            {info.kind === 'sf2' && info.colour
              ? ` This one gathers ${COLOUR_NAME[info.colour]}.`
              : ''}
          </p>
        </Modal>
      )}
      <div
        className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl bg-panel/80 px-2.5 py-1.5 ring-1 ring-line"
        role="group"
        aria-label="Centre"
        data-testid="mo-centre"
      >
        <span className="text-xs font-semibold text-ink-muted">Centre</span>
        {g.marker === 'centre' && <Marker art={art} size={26} />}
        {centre.length === 0 && <span className="text-xs text-ink-muted">empty</span>}
        {centre.map((c) => {
          const n = countOf(g.centre, c);
          const body = (
            <>
              {Array.from({ length: Math.min(n, 4) }, (_, i) => (
                <Tile key={i} colour={c} art={art} size={24} className={i ? '-ml-4' : ''} />
              ))}
              <span className="ml-0.5 text-sm font-bold tabular-nums">×{n}</span>
            </>
          );
          return onPick ? (
            <button
              key={c}
              type="button"
              onClick={() => onPick({ source: 'centre', colour: c })}
              className="flex items-center rounded-lg px-1 py-0.5 hover:bg-card focus-visible:outline-2 focus-visible:outline-accent"
              aria-label={`${n} ${COLOUR_NAME[c]} from the centre`}
              data-src={`centre:${c}`}
            >
              {body}
            </button>
          ) : (
            <span key={c} className="flex items-center px-1" data-src={`centre:${c}`}>
              {body}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** One opponent on phones: score, a dot picture of the wall, the floor; tap for the board. */
function PlayerChip({
  p,
  view,
  room,
  onOpen,
}: {
  p: PlayerView;
  view: MosaicView;
  room: GameRoomInfo;
  onOpen: () => void;
}) {
  const g = view.game!;
  const current = g.current === p.id && view.phase === 'playing' && g.stage === 'draft';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex shrink-0 items-center gap-2 rounded-2xl bg-card px-2.5 py-1.5 text-sm shadow-sm ring-1 ring-line focus-visible:outline-2 focus-visible:outline-accent',
        current && 'ring-2 ring-accent',
        (p.left || p.removed) && 'opacity-60',
      )}
      aria-label={`${p.name}: ${p.score} points, ${p.floor.length} on the floor${current ? ', playing now' : ''}`}
      data-chip={p.id}
    >
      <span className="flex flex-col items-start leading-tight">
        <PlayerTag name={p.name} you={p.id === room.you} className="max-w-24 font-semibold" />
        <span className="text-xs text-ink-muted tabular-nums">
          {p.score} pts{p.floor.length ? ` · floor ${p.floor.length}` : ''}
          {g.marker === p.id ? ' · 1st' : ''}
        </span>
      </span>
      <MiniWall wall={p.wall} />
    </button>
  );
}

/** A player's whole board with their name and score: desktop sides, the Boards tab, sheets. */
function PlayerBoard({
  p,
  view,
  room,
  art,
  size,
}: {
  p: PlayerView;
  view: MosaicView;
  room: GameRoomInfo;
  art: Art;
  size: 'sm' | 'md' | 'lg';
}) {
  const g = view.game!;
  const current = g.current === p.id && view.phase === 'playing' && g.stage === 'draft';
  return (
    <section
      aria-label={p.id === room.you ? 'Your board' : `${p.name}’s board`}
      className={cn(
        'flex flex-col items-center gap-1 rounded-2xl bg-card/85 p-2 shadow-sm ring-1 ring-line',
        current && 'ring-2 ring-accent',
        (p.left || p.removed) && 'opacity-70',
      )}
      data-panel={p.id}
    >
      <div className="flex w-full items-center justify-between gap-2 text-sm">
        <PlayerTag name={p.name} you={p.id === room.you} className="font-semibold" />
        <span className="flex items-center gap-1.5">
          {(p.left || p.removed) && (
            <span className="rounded-full bg-warn-soft px-1.5 text-xs text-warn-ink">
              {p.removed ? 'removed' : 'away'}
            </span>
          )}
          {g.marker === p.id && <Marker art={art} size={18} />}
          <span className="text-lg font-black tabular-nums" aria-label={`${p.score} points`}>
            {p.score}
          </span>
        </span>
      </div>
      <BoardView board={p} art={art} size={size} owner={p.id} grey={!!view.settings.grey} />
    </section>
  );
}

/** Running scores, how close everyone is to the bonuses, the bag and the lid. */
function Scores({ view, room, art }: { view: MosaicView; room: GameRoomInfo; art: Art }) {
  const g = view.game!;
  const kinds = TILES.filter((t) => t !== 'joker' || view.settings.jokers);
  return (
    <section aria-label="Scores" className="flex flex-col gap-3 text-sm" data-testid="mo-scores">
      <table className="w-full text-left tabular-nums">
        <thead className="text-xs text-ink-muted">
          <tr>
            <th className="font-medium">Player</th>
            <th className="font-medium">Points</th>
            <th className="font-medium" title="Best row, column and colour so far, out of 5">
              Row · Col · Colour
            </th>
          </tr>
        </thead>
        <tbody>
          {g.players.map((p) => {
            const c = closeTo(p.wall);
            return (
              <tr key={p.id} className={cn(p.removed && 'opacity-50')}>
                <td className="py-0.5">
                  <PlayerTag name={p.name} you={p.id === room.you} />
                </td>
                <td className="font-bold">{p.score}</td>
                <td>
                  {c.row}/5 · {c.column}/5 · {c.colour}/5
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs text-ink-muted">
        Bonuses at the end: +2 a full row, +7 a full column, +10 all 5 of a colour. “4/5” means one
        to go.
      </p>
      <table className="w-full text-center tabular-nums" aria-label="Tiles left">
        <thead className="text-xs text-ink-muted">
          <tr>
            <th />
            {kinds.map((c) => (
              <th key={c} className="font-medium">
                <Tile colour={c} art={art} size={20} label={COLOUR_NAME[c]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="text-left text-xs font-medium">In the bag</th>
            {kinds.map((c) => (
              <td key={c}>{countOf(g.bag, c)}</td>
            ))}
          </tr>
          <tr>
            <th className="text-left text-xs font-medium">In the lid</th>
            {kinds.map((c) => (
              <td key={c}>{countOf(g.lid, c)}</td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function Log({ view, name, open }: { view: MosaicView; name: NameOf; open: boolean }) {
  const lines = view.log
    .map((e) => ({ id: e.id, text: logLine(e, name) }))
    .filter((l): l is { id: number; text: string } => l.text !== null)
    .slice(-14)
    .reverse();
  return (
    <details
      className="group rounded-2xl bg-card/85 px-3 py-2 text-sm ring-1 ring-line"
      open={open}
    >
      <FoldSummary className="-my-1 px-0 font-semibold">What happened</FoldSummary>
      <ol className="mt-1 flex flex-col gap-0.5 text-ink-muted" aria-label="Log">
        {lines.map((l) => (
          <li key={l.id}>{l.text}</li>
        ))}
      </ol>
    </details>
  );
}

export function Table({ view, room, act, art, name, showGuide, tips }: TableProps) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === room.you && !p.removed);
  const playing = view.phase === 'playing';
  const drafting = playing && g.stage === 'draft';
  const mine = drafting && !!me && g.current === me.id;
  const [tab, setTab] = useState<Tab>('play');
  const [pick, setPick] = useState<Pick | null>(null);
  const [sheet, setSheet] = useState<string | null>(null);
  const others = g.players.filter((p) => p.id !== room.you);
  const away = g.players.filter((p) => p.left && !p.removed && p.id !== room.you);
  useFlights(view, art);
  const wide = useWide();
  const tall = useMatch('(min-height: 800px)');
  // A pick that no longer stands (the turn moved on) closes.
  const open =
    pick &&
    mine &&
    (pick.source === 'centre'
      ? countOf(g.centre, pick.colour) > 0
      : !!g.factories[pick.source]?.includes(pick.colour))
      ? pick
      : null;
  const clock = g.clock;
  const strict = view.settings.timerMode === 'strict';
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const nudge =
    clock &&
    room.isHost &&
    drafting &&
    (clock.reminded || offline(clock.who)) &&
    clock.who !== room.you;
  // The wall stage: everyone still choosing, for the host's Act for.
  const choosing =
    playing && g.stage === 'wall'
      ? Object.entries(g.walls ?? {}).flatMap(([id, w]) => (w.row === null ? [] : [id]))
      : [];
  const wallNudge =
    room.isHost &&
    clock &&
    choosing.filter((id) => id !== room.you && (clock.reminded || offline(id)));
  const place = async (move: Move) => {
    if (await act({ type: 'take', ...move }, { anchor: PLAY_ANCHOR })) setPick(null);
  };

  // Phones and tablets: the views on the shared bottom tab bar; wide screens show them all.
  const tabs = !wide && (
    <TabBar
      id={TABS_ID}
      label="View"
      value={tab}
      onChange={setTab}
      items={[
        { id: 'play', label: 'Play', icon: 'gamepad-2' },
        { id: 'boards', label: 'Boards', icon: 'layout-grid' },
        { id: 'scores', label: 'Scores', icon: 'list-ordered' },
      ]}
    />
  );

  const clockLine = (drafting || choosing.length > 0) && clock && (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-ink-muted">
        {/* The status line already tells the viewer it's their move: name only the others. */}
        {waitingFor(
          (drafting ? [clock.who] : choosing).filter((id) => id !== room.you),
          room.players,
        )}
      </span>
      {clock.deadline && (
        <Countdown
          deadline={clock.deadline}
          clockOffset={room.clockOffset}
          label={drafting ? 'for this turn' : 'to choose'}
          soft={!strict}
          expiredHint={room.isHost ? 'You can act for them below.' : 'The host can act for them.'}
          atZero={
            strict
              ? drafting
                ? 'then the safe move is made for them'
                : 'then the leftmost spaces are taken for them'
              : undefined
          }
        />
      )}
    </div>
  );

  const hostTools = (
    <>
      {playing && away.length > 0 && (
        <section
          aria-label="Players who left"
          className="flex flex-col gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line"
        >
          <p>
            {away.map((p) => p.name).join(', ')} left the room: the table plays their turns for
            them.{' '}
            {room.isHost
              ? 'Wait for them to come back, or remove them: their lines and floor go to the lid and their board leaves play.'
              : 'The host can wait for them or remove them.'}
          </p>
          {room.isHost && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {away.map((p) => (
                <Button
                  key={p.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => void act({ type: 'remove', player: p.id }, { anchor: 'mo-away' })}
                >
                  Remove {p.name}
                </Button>
              ))}
            </div>
          )}
          <RefusalSlot anchor="mo-away" />
        </section>
      )}
      {nudge && (
        <div className="flex justify-end gap-1.5">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void act({ type: 'act-for', player: clock.who }, { anchor: 'mo-host' })}
          >
            Act for {name(clock.who)}
          </Button>
          <RefusalSlot anchor="mo-host" />
        </div>
      )}
      {wallNudge && wallNudge.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {wallNudge.map((id) => (
            <Button
              key={id}
              variant="secondary"
              size="sm"
              onClick={() => void act({ type: 'act-for', player: id }, { anchor: 'mo-host' })}
            >
              Act for {name(id)}
            </Button>
          ))}
          <RefusalSlot anchor="mo-host" />
        </div>
      )}
    </>
  );

  const tiling = g.stage === 'tiling' && !!g.scoring;
  const myRow = g.stage === 'wall' ? (g.walls?.[room.you]?.row ?? null) : null;
  const centrePiece = tiling ? (
    <Tiling view={view} room={room} act={act} art={art} />
  ) : g.stage === 'wall' ? (
    <WallStage view={view} room={room} act={act} art={art} name={name} />
  ) : (
    <Market view={view} art={art} name={name} onPick={mine ? setPick : null} />
  );

  const myBoard = me && (
    <section
      aria-label="Your board"
      className={cn(
        'flex flex-col items-center gap-1 rounded-2xl bg-card/85 p-2 shadow-sm ring-1 ring-line',
        (mine || myRow !== null) && 'ring-2 ring-accent',
        myRow !== null && 'hidden',
      )}
      data-panel={me.id}
    >
      <div className="flex w-full items-center justify-between text-sm">
        <span className="font-semibold">You</span>
        <span className="flex items-center gap-1.5">
          {g.marker === me.id && <Marker art={art} size={18} />}
          <span className="text-lg font-black tabular-nums" aria-label={`${me.score} points`}>
            {me.score}
          </span>
        </span>
      </div>
      <BoardView
        board={me}
        art={art}
        size={wide ? (tall ? 'xl' : 'lg') : 'md'}
        owner={me.id}
        grey={!!view.settings.grey}
      />
    </section>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-3">
        <div
          className={cn(
            'flex min-w-0 flex-col gap-2 lg:max-w-[66.5rem]',
            tab !== 'play' && 'hidden lg:flex',
          )}
          {...(!wide && tabPanelProps(TABS_ID, 'play'))}
        >
          {/* The wall-tiling shows every board itself; on phones it stands in for these. */}
          {!(tiling && !wide) && (
            <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:hidden" aria-label="Players">
              {others.map((p) => (
                <PlayerChip
                  key={p.id}
                  p={p}
                  view={view}
                  room={room}
                  onOpen={() => setSheet(p.id)}
                />
              ))}
            </div>
          )}
          {clockLine}
          <Ouch view={view} name={name} you={room.you} />
          {centrePiece}
          {!(tiling && !wide) &&
            (wide && others.length > 0 && !tiling ? (
              // Wide screens: the rivals' boards beside yours (one at 60 %, two or three smaller in
              // a grid), where they can be read while you plan; the rail keeps the scores.
              <div className="flex items-start justify-center gap-3">
                {myBoard}
                <div
                  className={cn('grid gap-2', others.length > 1 && 'grid-cols-2')}
                  aria-label="Other boards"
                >
                  {others.map((p) => (
                    <PlayerBoard
                      key={p.id}
                      p={p}
                      view={view}
                      room={room}
                      art={art}
                      size={others.length === 1 ? 'md' : 'sm'}
                    />
                  ))}
                </div>
              </div>
            ) : (
              myBoard
            ))}
          {hostTools}
          <p className="text-center text-xs text-ink-muted">
            Round {g.round} ·{' '}
            <button
              type="button"
              className="min-h-11 min-w-11 px-2 underline"
              onClick={() => showGuide()}
            >
              rules
            </button>
          </p>
        </div>

        <aside className="hidden flex-col gap-2 lg:flex" aria-label="More players and scores">
          <FitArea on={wide} plain min={128}>
            <div className="space-y-2">
              {tips}
              {/* In the wall-tiling the boards are the stage; otherwise they sit beside yours. */}
              {tiling &&
                others.map((p) => (
                  <PlayerBoard key={p.id} p={p} view={view} room={room} art={art} size="sm" />
                ))}
              <div className="rounded-2xl bg-card/85 p-2.5 ring-1 ring-line">
                <Scores view={view} room={room} art={art} />
              </div>
              <Log view={view} name={name} open />
            </div>
          </FitArea>
        </aside>

        {tab === 'boards' && (
          <div className="flex flex-col gap-2 lg:hidden" {...tabPanelProps(TABS_ID, 'boards')}>
            {g.players.map((p) => (
              <PlayerBoard key={p.id} p={p} view={view} room={room} art={art} size="md" />
            ))}
          </div>
        )}
        {tab === 'scores' && (
          <div className="flex flex-col gap-2 lg:hidden" {...tabPanelProps(TABS_ID, 'scores')}>
            <div className="rounded-2xl bg-card/85 p-2.5 ring-1 ring-line">
              <Scores view={view} room={room} art={art} />
            </div>
            <Log view={view} name={name} open />
          </div>
        )}
      </div>

      {tabs}
      {open && me && (
        <PickSheet
          key={`${open.source}:${open.colour}`}
          pick={open}
          view={view}
          me={me}
          art={art}
          name={name}
          onPlace={(m) => void place(m)}
          onClose={() => setPick(null)}
        />
      )}
      {sheet &&
        (() => {
          const p = g.players.find((x) => x.id === sheet);
          return p ? (
            <Modal open onClose={() => setSheet(null)} title={`${p.name}’s board`}>
              <div className="flex justify-center">
                <PlayerBoard p={p} view={view} room={room} art={art} size="md" />
              </div>
            </Modal>
          ) : null;
        })()}
    </div>
  );
}

/** For the first-time tips. */
export const TIPS_KEY = 'mosaic.tips.v1';
export const tipsSeen = () => {
  try {
    return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
  } catch {
    return true;
  }
};
