import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import { Button, Countdown, Modal, PlayerTag, ProtectedImage, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { closeTo } from '../logic/rules.ts';
import { COLOUR_NAME, SYMBOL } from '../logic/tiles.ts';
import {
  COLOURS,
  type Colour,
  type LogEntry,
  type MosaicAction,
  type MosaicView,
  OUCH,
  type PlayerView,
  type Source,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { PLAY_ANCHOR, type Pick, PickSheet } from './PickSheet.tsx';
import { BoardView, Marker, MiniWall, Tile } from './Pieces.tsx';
import { Tiling } from './Tiling.tsx';
import { type NameOf, logLine } from './text.ts';

export type Act = (action: MosaicAction, options?: { anchor?: string }) => Promise<boolean>;

export interface TableProps {
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  showGuide: (id?: string) => void;
}

type Tab = 'play' | 'boards' | 'scores';

/** Whether the desktop layout is showing (Tailwind's `lg`). */
function useWide() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );
  useEffect(() => {
    const m = window.matchMedia?.(query);
    if (!m) return;
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => {
      m.removeEventListener('change', on);
    };
  }, []);
  return wide;
}

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

function fly(from: DOMRect, to: DOMRect, colour: Colour, count: number, art: Art) {
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
      className="mo-rise rounded-xl bg-danger-soft px-3 py-1.5 text-center text-sm font-bold text-danger-ink ring-1 ring-danger-line dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40"
      data-testid="mo-ouch"
    >
      😬 Ouch: {take.by === you ? 'you' : name(take.by)} ate {take.penalty}!
    </p>
  );
}

/** A factory: a disc of up to 4 tiles; tap one to pick its colour. */
function Factory({
  index,
  tiles,
  art,
  onPick,
  hover,
  setHover,
}: {
  index: number;
  tiles: Colour[];
  art: Art;
  onPick: ((p: Pick) => void) | null;
  hover: Pick | null;
  setHover: (p: Pick | null) => void;
}) {
  const bg = art.factory(true);
  return (
    <div
      className={cn(
        'relative flex aspect-square items-center justify-center rounded-full',
        !bg && 'bg-panel ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
      )}
      role="group"
      aria-label={`Factory ${index + 1}: ${tiles.length ? tiles.map((t) => COLOUR_NAME[t]).join(', ') : 'empty'}`}
      data-factory={index}
    >
      {bg && <ProtectedImage src={bg} alt="" className="absolute inset-0 size-full rounded-full" />}
      <div className="relative grid grid-cols-2 gap-0.5">
        {tiles.map((t, i) => {
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
                lit && 'outline-2 outline-offset-1 outline-accent',
              )}
              aria-label={`${n} ${COLOUR_NAME[t]} from factory ${index + 1}`}
              data-src={`${index}:${t}`}
            >
              <Tile colour={t} art={art} size={24} />
            </button>
          ) : (
            <span key={i} data-src={`${index}:${t}`}>
              <Tile colour={t} art={art} size={24} />
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
  onPick,
}: {
  view: MosaicView;
  art: Art;
  onPick: ((p: Pick) => void) | null;
}) {
  const g = view.game!;
  const [hover, setHover] = useState<Pick | null>(null);
  const centre = COLOURS.filter((c) => g.centre[c] > 0);
  return (
    <section aria-label="The table" className="flex flex-col gap-2" data-testid="mo-market">
      <div className="grid grid-cols-5 gap-1.5">
        {g.factories.map((f, i) => (
          <Factory
            key={i}
            index={i}
            tiles={f}
            art={art}
            onPick={f.length ? onPick : null}
            hover={hover}
            setHover={setHover}
          />
        ))}
      </div>
      <div
        className="flex min-h-12 flex-wrap items-center gap-2 rounded-2xl bg-panel/80 px-2.5 py-1.5 ring-1 ring-line dark:bg-stone-900/70 dark:ring-stone-800"
        role="group"
        aria-label="Centre"
        data-testid="mo-centre"
      >
        <span className="text-xs font-semibold text-ink-muted dark:text-stone-400">Centre</span>
        {g.marker === 'centre' && <Marker art={art} size={26} />}
        {centre.length === 0 && (
          <span className="text-xs text-ink-muted dark:text-stone-500">empty</span>
        )}
        {centre.map((c) => {
          const n = g.centre[c];
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
              className="flex items-center rounded-lg px-1 py-0.5 hover:bg-card focus-visible:outline-2 focus-visible:outline-accent dark:hover:bg-stone-800"
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
        'flex shrink-0 items-center gap-2 rounded-2xl bg-card px-2.5 py-1.5 text-sm shadow-sm ring-1 ring-line focus-visible:outline-2 focus-visible:outline-accent dark:bg-stone-900 dark:ring-stone-700',
        current && 'ring-2 ring-accent dark:ring-amber-500',
        (p.left || p.removed) && 'opacity-60',
      )}
      aria-label={`${p.name}: ${p.score} points, ${p.floor.length} on the floor${current ? ', playing now' : ''}`}
      data-chip={p.id}
    >
      <span className="flex flex-col items-start leading-tight">
        <PlayerTag name={p.name} you={p.id === room.you} className="max-w-24 font-semibold" />
        <span className="text-xs text-ink-muted tabular-nums dark:text-stone-400">
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
        'flex flex-col items-center gap-1 rounded-2xl bg-card/85 p-2 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        current && 'ring-2 ring-accent dark:ring-amber-500',
        (p.left || p.removed) && 'opacity-70',
      )}
      data-panel={p.id}
    >
      <div className="flex w-full items-center justify-between gap-2 text-sm">
        <PlayerTag name={p.name} you={p.id === room.you} className="font-semibold" />
        <span className="flex items-center gap-1.5">
          {(p.left || p.removed) && (
            <span className="rounded-full bg-warn-soft px-1.5 text-[11px] text-warn-ink dark:bg-amber-500/15 dark:text-amber-100">
              {p.removed ? 'removed' : 'away'}
            </span>
          )}
          {g.marker === p.id && <Marker art={art} size={18} />}
          <span className="text-lg font-black tabular-nums" aria-label={`${p.score} points`}>
            {p.score}
          </span>
        </span>
      </div>
      <BoardView board={p} art={art} size={size} owner={p.id} />
    </section>
  );
}

/** Running scores, how close everyone is to the bonuses, the bag and the lid. */
function Scores({ view, room, art }: { view: MosaicView; room: GameRoomInfo; art: Art }) {
  const g = view.game!;
  return (
    <section aria-label="Scores" className="flex flex-col gap-3 text-sm" data-testid="mo-scores">
      <table className="w-full text-left tabular-nums">
        <thead className="text-xs text-ink-muted dark:text-stone-400">
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
      <p className="text-xs text-ink-muted dark:text-stone-400">
        Bonuses at the end: +2 a full row, +7 a full column, +10 all 5 of a colour. “4/5” means one
        to go.
      </p>
      <table className="w-full text-center tabular-nums" aria-label="Tiles left">
        <thead className="text-xs text-ink-muted dark:text-stone-400">
          <tr>
            <th />
            {COLOURS.map((c) => (
              <th key={c} className="font-medium">
                <Tile colour={c} art={art} size={20} label={COLOUR_NAME[c]} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th className="text-left text-xs font-medium">In the bag</th>
            {COLOURS.map((c) => (
              <td key={c}>{g.bag[c]}</td>
            ))}
          </tr>
          <tr>
            <th className="text-left text-xs font-medium">In the lid</th>
            {COLOURS.map((c) => (
              <td key={c}>{g.lid[c]}</td>
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
      className="rounded-2xl bg-card/85 px-3 py-2 text-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
      open={open}
    >
      <summary className="cursor-pointer font-semibold">What happened</summary>
      <ol
        className="mt-1 flex flex-col gap-0.5 text-ink-muted dark:text-stone-400"
        aria-label="Log"
      >
        {lines.map((l) => (
          <li key={l.id}>{l.text}</li>
        ))}
      </ol>
    </details>
  );
}

export function Table({ view, room, act, art, name, showGuide }: TableProps) {
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
  // A pick that no longer stands (the turn moved on) closes.
  const open =
    pick &&
    mine &&
    (pick.source === 'centre'
      ? g.centre[pick.colour] > 0
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
  const place = async (source: Source, colour: Colour, target: number | 'floor') => {
    if (await act({ type: 'take', source, colour, target }, { anchor: PLAY_ANCHOR })) setPick(null);
  };

  const tabs = (
    <div
      role="tablist"
      aria-label="View"
      className="flex gap-1 rounded-xl bg-panel p-1 ring-1 ring-line lg:hidden dark:bg-stone-900 dark:ring-stone-800"
    >
      {(
        [
          ['play', 'Play'],
          ['boards', 'Boards'],
          ['scores', 'Scores'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          role="tab"
          type="button"
          aria-selected={tab === id}
          onClick={() => setTab(id)}
          className={cn(
            'min-h-9 flex-1 rounded-lg text-sm font-semibold',
            tab === id
              ? 'bg-card shadow-sm dark:bg-stone-700'
              : 'text-ink-muted dark:text-stone-400',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const clockLine = drafting && clock && (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <span className="text-ink-muted dark:text-stone-400">
        {waitingFor([clock.who], room.players, { you: room.you })}
      </span>
      {clock.deadline && (
        <Countdown
          deadline={clock.deadline}
          clockOffset={room.clockOffset}
          label="for this turn"
          soft={!strict}
          expiredHint={room.isHost ? 'You can act for them below.' : 'The host can act for them.'}
          atZero={strict ? 'then the safe move is made for them' : undefined}
        />
      )}
    </div>
  );

  const hostTools = (
    <>
      {playing && away.length > 0 && (
        <section
          aria-label="Players who left"
          className="flex flex-col gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
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
    </>
  );

  const centrePiece =
    g.stage === 'tiling' && g.scoring ? (
      <Tiling view={view} room={room} act={act} art={art} />
    ) : (
      <Market view={view} art={art} onPick={mine ? setPick : null} />
    );

  const myBoard = me && (
    <section
      aria-label="Your board"
      className={cn(
        'flex flex-col items-center gap-1 rounded-2xl bg-card/85 p-2 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        mine && 'ring-2 ring-accent dark:ring-amber-500',
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
      <BoardView board={me} art={art} size={wide ? 'lg' : 'md'} owner={me.id} />
    </section>
  );

  return (
    <div className="flex flex-col gap-2">
      {tabs}
      <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)_minmax(0,1fr)] lg:items-start lg:gap-3">
        <aside className="hidden flex-col gap-2 lg:flex" aria-label="Players">
          {others
            .filter((_, i) => i % 2 === 0)
            .map((p) => (
              <PlayerBoard key={p.id} p={p} view={view} room={room} art={art} size="sm" />
            ))}
        </aside>

        <div className={cn('flex min-w-0 flex-col gap-2', tab !== 'play' && 'hidden lg:flex')}>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:hidden" aria-label="Players">
            {others.map((p) => (
              <PlayerChip key={p.id} p={p} view={view} room={room} onOpen={() => setSheet(p.id)} />
            ))}
          </div>
          {clockLine}
          <Ouch view={view} name={name} you={room.you} />
          {centrePiece}
          {myBoard}
          {hostTools}
          <p className="text-center text-xs text-ink-muted dark:text-stone-500">
            Round {g.round} ·{' '}
            <button type="button" className="underline" onClick={() => showGuide()}>
              rules
            </button>
          </p>
        </div>

        <aside className="hidden flex-col gap-2 lg:flex" aria-label="More players and scores">
          {others
            .filter((_, i) => i % 2 === 1)
            .map((p) => (
              <PlayerBoard key={p.id} p={p} view={view} room={room} art={art} size="sm" />
            ))}
          <div className="rounded-2xl bg-card/85 p-2.5 ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800">
            <Scores view={view} room={room} art={art} />
          </div>
          <Log view={view} name={name} open />
        </aside>

        {tab === 'boards' && (
          <div className="flex flex-col gap-2 lg:hidden">
            {g.players.map((p) => (
              <PlayerBoard key={p.id} p={p} view={view} room={room} art={art} size="md" />
            ))}
          </div>
        )}
        {tab === 'scores' && (
          <div className="flex flex-col gap-2 lg:hidden">
            <div className="rounded-2xl bg-card/85 p-2.5 ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800">
              <Scores view={view} room={room} art={art} />
            </div>
            <Log view={view} name={name} open />
          </div>
        )}
      </div>

      {open && me && (
        <PickSheet
          pick={open}
          view={view}
          me={me}
          art={art}
          name={name}
          onPlace={(t) => void place(open.source, open.colour, t)}
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
