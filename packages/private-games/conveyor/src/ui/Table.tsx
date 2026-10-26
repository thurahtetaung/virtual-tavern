import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import {
  Button,
  CardViewer,
  Countdown,
  Modal,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  type ViewerItem,
  cn,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { TYPES, type TypeId, fullMenu, typeOf, variantOf } from '../logic/cards.ts';
import { roundRows } from '../logic/score.ts';
import type {
  Card,
  ConveyorAction,
  ConveyorView,
  GameView,
  LogEntry,
  Played,
  PlayerView,
} from '../logic/types.ts';
import { type Art, preloadThumbs } from './assets.ts';
import { CardFace } from './Cards.tsx';
import { type NameOf, a, groups, logLine, partLine } from './text.ts';

export type Act = (action: ConveyorAction, options?: { anchor?: string }) => Promise<boolean>;

/** "+3" / "−2" / "+0". */
const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

export const TIPS_KEY = 'conveyor.tips';
const PREVIEW_KEY = 'conveyor.preview';

const read = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(storageKey(key));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const write = (key: string, on: boolean) => {
  try {
    localStorage.setItem(storageKey(key), on ? '1' : '0');
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
};

export const tipsSeen = () => read(TIPS_KEY, false);
export const seeTips = () => write(TIPS_KEY, true);

export interface TableProps {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  logName: NameOf;
  showGuide: (topic?: string) => void;
}

/** What each tray scores now (this round only). */
function livePoints(g: GameView): Record<string, number> {
  return Object.fromEntries(
    roundRows({
      order: g.order,
      trays: Object.fromEntries(g.players.map((p) => [p.id, p.tray])),
      ura: Object.fromEntries(g.players.map((p) => [p.id, p.ura])),
      claimed: g.claimed,
    }).map((r) => [r.id, r.points]),
  );
}

/** How many points a card would add to `me`'s round right now (majorities as they stand). */
function previewOf(g: GameView, me: string, k: string, base: number): number {
  const trays = Object.fromEntries(g.players.map((p) => [p.id, p.tray]));
  const mine = trays[me] ?? [];
  const wasabi = mine.find((c) => typeOf(c.k) === 'wasabi' && !c.flipped && !c.filled);
  const card: Played = {
    id: '+',
    k,
    turn: g.turn,
    ...(typeOf(k) === 'nigiri' && wasabi && { on: wasabi.id }),
  };
  const next = roundRows({
    order: g.order,
    trays: {
      ...trays,
      [me]: [...mine.map((c) => (c === wasabi && card.on ? { ...c, filled: true } : c)), card],
    },
    ura: Object.fromEntries(g.players.map((p) => [p.id, p.ura])),
    claimed: g.claimed,
  }).find((r) => r.id === me)!.points;
  return next - base;
}

/** Anything worth a full-screen look: the art at full size. */
function useZoom(art: Art) {
  const [zoom, setZoom] = useState<{ items: ViewerItem[]; start: number; title: string } | null>(
    null,
  );
  const open = (cards: readonly { k: string; flipped?: boolean }[], start: number, title: string) =>
    setZoom({
      title,
      start,
      items: cards.map((c, i) => ({
        key: `${i}-${c.k}`,
        label: c.flipped ? `${art.names.card(c.k)} (face down)` : art.names.card(c.k),
        aspect: 440 / 690,
        src: c.flipped ? art.back(true) : art.card(c.k, true),
        fallback: <CardFace k={c.k} art={art} size="big" flipped={!!c.flipped} />,
      })),
    });
  const viewer = zoom ? (
    <CardViewer
      items={zoom.items}
      start={zoom.start}
      title={zoom.title}
      onClose={() => setZoom(null)}
    />
  ) : null;
  return { open, viewer };
}

export function Table({ view, room, act, art, name, logName, showGuide }: TableProps) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === room.you) ?? null;
  const live = useMemo(() => livePoints(g), [g]);
  const zoom = useZoom(art);
  const menuKey = g.menu.join(',');
  useEffect(() => {
    preloadThumbs(art, fullMenu(g.menu));
    // Once per menu (and once the art is known).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuKey, art]);
  return (
    <div className="flex flex-col gap-3 lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start">
      <div className="flex min-w-0 flex-col gap-3">
        <MenuStrip g={g} art={art} showGuide={showGuide} />
        <Moments view={view} you={room.you} art={art} name={name} />
        <Others g={g} room={room} art={art} name={name} live={live} zoom={zoom.open} />
        {me && (
          <MyTray
            g={g}
            me={me}
            art={art}
            live={live[me.id] ?? 0}
            zoom={zoom.open}
            view={view}
            act={act}
          />
        )}
        {view.phase === 'playing' && g.stage === 'scores' ? (
          <RoundScores view={view} room={room} act={act} art={art} name={name} />
        ) : view.phase === 'playing' ? (
          <Play view={view} room={room} act={act} art={art} name={name} zoom={zoom.open} />
        ) : null}
      </div>
      <aside className="flex min-w-0 flex-col gap-3">
        <Totals g={g} name={name} live={live} you={room.you} />
        <Log view={view} name={logName} art={art} />
      </aside>
      {zoom.viewer}
    </div>
  );
}

/** The menu: every dish in play, a tap from its rules. */
function MenuStrip({
  g,
  art,
  showGuide,
}: {
  g: GameView;
  art: Art;
  showGuide: (t?: string) => void;
}) {
  return (
    <nav aria-label="Menu" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
      {fullMenu(g.menu).map((t) => {
        const tile = art.tile(t);
        return (
          <button
            key={t}
            type="button"
            onClick={() => showGuide(t)}
            className="flex shrink-0 items-center gap-1 rounded-full bg-card px-2 py-1 text-xs font-semibold ring-1 ring-line hover:bg-panel dark:bg-stone-800 dark:ring-stone-600"
            title={`${art.names.type(t)}: ${TYPES[t].short}`}
          >
            {tile ? (
              <ProtectedImage src={tile} alt="" className="h-5 w-4 rounded-sm object-cover" />
            ) : (
              <span aria-hidden>{TYPES[t].emoji}</span>
            )}
            {art.names.type(t)}
          </button>
        );
      })}
    </nav>
  );
}

/** The latest reveal (every card flips in) and the "took what you needed" moments. */
function Moments({
  view,
  you,
  art,
  name,
}: {
  view: ConveyorView;
  you: string;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const reveal = [...view.log]
    .reverse()
    .find((e): e is Extract<LogEntry, { kind: 'reveal' }> => e.kind === 'reveal');
  if (!reveal || reveal.round !== g.round || view.phase !== 'playing' || g.stage === 'scores')
    return null;
  const after = view.log.filter((e) => e.id > reveal.id);
  const steals = after.filter((e): e is Extract<LogEntry, { kind: 'steal' }> => e.kind === 'steal');
  const big = after.filter((e) => e.kind === 'uramaki' || e.kind === 'miso' || e.kind === 'wasabi');
  return (
    <section
      key={reveal.id}
      aria-label={`Turn ${reveal.turn} reveal`}
      className="flex flex-col gap-1.5 rounded-2xl bg-panel p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
    >
      <p className="text-xs font-semibold text-ink-muted dark:text-stone-400">
        Turn {reveal.turn}: everyone revealed
      </p>
      <ul className="flex gap-1.5 overflow-x-auto pb-0.5">
        {reveal.plays.map((p, i) => (
          <li
            key={p.by}
            className="flex shrink-0 flex-col items-center gap-0.5"
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="cv-flip inline-block" style={{ animationDelay: `${i * 70}ms` }}>
              <CardFace k={p.copy ?? p.k} art={art} size="tray">
                {p.copy && (
                  <span
                    className="absolute top-0.5 left-0.5 text-xs"
                    aria-label="copied"
                    title={art.names.type('order')}
                  >
                    🌈
                  </span>
                )}
              </CardFace>
            </span>
            <span className={cn('max-w-14 truncate text-[0.65rem]', p.by === you && 'font-bold')}>
              {name(p.by)}
            </span>
          </li>
        ))}
      </ul>
      {steals.map((e) => (
        <p
          key={e.id}
          className={cn(
            'cv-pop rounded-lg px-2 py-1 text-sm',
            e.from === you
              ? 'bg-danger-soft text-danger-ink ring-1 ring-danger-line dark:bg-red-500/15 dark:text-red-100 dark:ring-red-500/40'
              : 'bg-card ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
          )}
        >
          🫳{' '}
          {e.from === you
            ? `${name(e.by)} took ${a(art.names.card(e.k))} you needed (+${e.worth} for you).`
            : logLine(e, name, art.names)}
        </p>
      ))}
      {big.map((e) => (
        <p key={e.id} className="cv-pop text-sm font-semibold">
          {e.kind === 'uramaki' ? '🍱 ' : e.kind === 'miso' ? '🍲 ' : '🌿 '}
          {logLine(e, name, art.names)}
        </p>
      ))}
    </section>
  );
}

/** The other players: score, this round's points, their tray at a glance. Tap for the full tray. */
function Others({
  g,
  room,
  art,
  name,
  live,
  zoom,
}: {
  g: GameView;
  room: GameRoomInfo;
  art: Art;
  name: NameOf;
  live: Record<string, number>;
  zoom: (cards: readonly { k: string; flipped?: boolean }[], start: number, title: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const n = g.order.length;
  const at = g.order.indexOf(room.you);
  const toId = at >= 0 ? g.order[(at + g.dir + n) % n] : null;
  const fromId = at >= 0 ? g.order[(at - g.dir + n) % n] : null;
  // Starting from the player you pass to, round the table.
  const others =
    at >= 0
      ? Array.from({ length: n - 1 }, (_, i) => g.order[(at + g.dir * (i + 1) + n * 8) % n]!)
      : g.order;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const shown = g.players.find((p) => p.id === open);
  return (
    <section aria-label="Other players" className="flex flex-col gap-1.5">
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
        {others.map((id) => {
          const p = g.players.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => setOpen(id)}
                className="flex w-full flex-col gap-1 rounded-xl bg-card px-2 py-1.5 text-left ring-1 ring-line hover:bg-panel dark:bg-stone-900 dark:ring-stone-700"
              >
                <span className="flex items-center gap-1.5 text-sm">
                  {id === toId && n > 2 && (
                    <span title="You pass to them" aria-label="you pass to them">
                      ▶
                    </span>
                  )}
                  {id === fromId && n > 2 && (
                    <span title="They pass to you" aria-label="they pass to you">
                      ◀
                    </span>
                  )}
                  {n === 2 && <span aria-label="you pass to each other">⇄</span>}
                  <PlayerTag
                    name={name(id)}
                    host={id === room.hostId}
                    offline={offline(id) || p.left}
                    className="min-w-0 flex-1 truncate"
                  />
                  {g.stage === 'pick' && (
                    <span
                      className={cn(
                        'text-xs',
                        p.done
                          ? 'text-success-ink dark:text-emerald-300'
                          : 'text-ink-muted dark:text-stone-500',
                      )}
                    >
                      {p.done ? '✓ picked' : '…'}
                    </span>
                  )}
                  <span className="text-xs font-bold tabular-nums">
                    {p.score}
                    <span className="font-normal text-ink-muted dark:text-stone-400">
                      {' '}
                      {signed(live[id] ?? 0)}
                    </span>
                  </span>
                </span>
                <TrayLine p={p} g={g} art={art} />
              </button>
            </li>
          );
        })}
      </ul>
      <Modal
        open={!!shown}
        onClose={() => setOpen(null)}
        title={shown ? `${name(shown.id)}’s tray` : ''}
      >
        {shown && (
          <div className="flex flex-col gap-3">
            <TrayGroups p={shown} g={g} art={art} zoom={zoom} title={`${name(shown.id)}’s tray`} />
            <Jar p={shown} g={g} art={art} />
            <p className="text-sm text-ink-muted dark:text-stone-400">
              {shown.hand} cards in hand{shown.pile ? `, ${shown.pile} in their pile` : ''} ·{' '}
              {shown.score} points so far, {live[shown.id] ?? 0} this round
            </p>
          </div>
        )}
      </Modal>
    </section>
  );
}

/** A tray as small cards, grouped by dish (phones: emoji counts on narrow screens). */
function TrayLine({ p, g, art }: { p: PlayerView; g: GameView; art: Art }) {
  const order = fullMenu(g.menu) as string[];
  const items = groups(p.tray, order);
  if (!items.length && !p.desserts.length)
    return <span className="text-xs text-ink-muted dark:text-stone-500">Nothing yet</span>;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {items.map(([t, cards]) => (
        <span key={t} className="flex items-center">
          {cards.slice(0, 4).map((c, i) => (
            <CardFace
              key={c.id}
              k={c.k}
              art={art}
              size="mini"
              flipped={c.flipped}
              className={i ? '-ml-5' : ''}
            />
          ))}
          {cards.length > 1 && <span className="ml-0.5 text-xs font-bold">×{cards.length}</span>}
        </span>
      ))}
      {p.desserts.length > 0 && (
        <span className="text-xs" title="Desserts kept from earlier rounds">
          {TYPES[typeOf(p.desserts[0]!.k)].emoji}×{p.desserts.length}
        </span>
      )}
    </span>
  );
}

/** A tray grouped by dish, each group's cards overlapping; tap a card to see it big. */
function TrayGroups({
  p,
  g,
  art,
  zoom,
  title,
  select,
}: {
  p: PlayerView;
  g: GameView;
  art: Art;
  zoom: (cards: readonly { k: string; flipped?: boolean }[], start: number, title: string) => void;
  title: string;
  /** Cards that can be chosen now (a special order's target, a takeout box's). */
  select?: { ids: Set<string>; chosen: Set<string>; toggle: (id: string) => void };
}) {
  const order = fullMenu(g.menu) as string[];
  const items = groups(p.tray, order);
  if (!items.length)
    return <p className="text-sm text-ink-muted dark:text-stone-400">No cards yet this round.</p>;
  const flat = items.flatMap(([, cards]) => cards);
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-2">
      {items.map(([t, cards]) => (
        <li key={t} className="flex flex-col gap-0.5">
          <span className="flex">
            {cards.map((c, i) => {
              const can = select?.ids.has(c.id);
              const on = select?.chosen.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  className={cn(
                    'relative rounded-[7%]',
                    i > 0 && !select && '-ml-6',
                    i > 0 && select && '-ml-1',
                    can && 'ring-2 ring-accent dark:ring-amber-400',
                    on && 'ring-4 ring-accent -translate-y-1 dark:ring-amber-300',
                    select && !can && 'opacity-50',
                  )}
                  aria-pressed={select ? !!on : undefined}
                  onClick={() => (can ? select!.toggle(c.id) : zoom(flat, flat.indexOf(c), title))}
                >
                  <CardFace k={c.k} art={art} size="tray" flipped={c.flipped}>
                    {c.copy && !c.flipped && (
                      <span
                        className="absolute top-0.5 left-0.5 text-xs"
                        title={art.names.type('order')}
                      >
                        🌈
                      </span>
                    )}
                    {c.on && !c.flipped && (
                      <span className="absolute top-0.5 right-0.5 text-xs" title="On wasabi: ×3">
                        ×3
                      </span>
                    )}
                    {typeOf(c.k) === 'wasabi' && c.filled && !c.flipped && (
                      <span className="absolute right-0.5 bottom-0.5 text-[0.6rem] font-bold">
                        used
                      </span>
                    )}
                  </CardFace>
                </button>
              );
            })}
          </span>
          <span className="text-[0.65rem] text-ink-muted dark:text-stone-400">
            {t === 'flipped' ? 'face down' : art.names.type(t as TypeId)} ×{cards.length}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Desserts kept from earlier rounds, with this round's on the way. */
function Jar({ p, g, art }: { p: PlayerView; g: GameView; art: Art }) {
  const dessert = g.menu.find((t) => TYPES[t].group === 'desserts')!;
  const now = p.tray.filter((c) => !c.flipped && TYPES[typeOf(c.k)].group === 'desserts').length;
  return (
    <p className="flex flex-wrap items-center gap-1 text-sm">
      <span className="font-semibold">Dessert jar:</span>
      {p.desserts.map((c) => (
        <CardFace key={c.id} k={c.k} art={art} size="mini" />
      ))}
      <span>
        {p.desserts.length + now} {art.names.type(dessert)}
        {now ? ` (${now} this round)` : ''}
      </span>
    </p>
  );
}

/** Your own tray: grouped, with this round's points and your dessert jar. */
function MyTray({
  g,
  me,
  art,
  live,
  zoom,
  view,
  act,
}: {
  g: GameView;
  me: PlayerView;
  art: Art;
  live: number;
  zoom: (cards: readonly { k: string; flipped?: boolean }[], start: number, title: string) => void;
  view: ConveyorView;
  act: Act;
}) {
  const step = g.step;
  const mine = (by: string) => view.phase === 'playing' && by === me.id;
  // A takeout box or a special order (from a spoon) chooses from the tray.
  const takeout = step?.kind === 'takeout' && mine(step.by) ? step : null;
  const copying = step?.kind === 'copy' && mine(step.by) ? step : null;
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const key = `${g.round}:${g.turn}:${step?.kind ?? ''}`;
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    setForKey(key);
    setChosen(new Set());
  }
  const box = takeout
    ? me.tray.find((c) => typeOf(c.k) === 'takeout' && c.turn === g.turn)
    : undefined;
  const ids = takeout
    ? new Set(
        me.tray.filter((c) => c.turn < g.turn && !c.flipped && c.id !== box?.id).map((c) => c.id),
      )
    : copying
      ? new Set(
          me.tray
            .filter((c) => c.k !== 'order' && typeOf(c.k) !== 'menu' && typeOf(c.k) !== 'takeout')
            .map((c) => c.id),
        )
      : null;
  const toggle = (id: string) =>
    setChosen((s) => {
      const next = new Set(copying ? [] : s);
      if (s.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <section
      aria-label="Your tray"
      className={cn(
        'flex flex-col gap-2 rounded-2xl bg-card p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
        ids && 'ring-2 ring-accent dark:ring-amber-400',
      )}
    >
      <h2 className="flex items-baseline justify-between gap-2 text-sm font-bold">
        <span>Your tray</span>
        {view.phase === 'over' ? (
          <span className="tabular-nums">{me.score} points</span>
        ) : (
          <span className="tabular-nums">
            {me.score} <span className="text-accent-ink dark:text-amber-300">{signed(live)}</span>{' '}
            this round
          </span>
        )}
      </h2>
      {view.phase !== 'over' && (
        <TrayGroups
          p={me}
          g={g}
          art={art}
          zoom={zoom}
          title="Your tray"
          {...(ids && { select: { ids, chosen, toggle } })}
        />
      )}
      <Jar p={me} g={g} art={art} />
      {takeout && (
        <div className="flex flex-col gap-1.5">
          <p className="text-sm">
            Tap the cards from earlier turns to turn face down: each is then worth 2 and no longer
            counts as its dish.
          </p>
          <Button
            onClick={() => void act({ type: 'takeout', cards: [...chosen] }, { anchor: 'cv-tray' })}
          >
            {chosen.size ? `Turn ${chosen.size} face down` : 'Turn nothing over'}
          </Button>
        </div>
      )}
      {copying && (
        <Button
          disabled={chosen.size !== 1}
          onClick={() => void act({ type: 'copy', target: [...chosen][0]! }, { anchor: 'cv-tray' })}
        >
          {chosen.size === 1
            ? `Copy ${art.names.card(me.tray.find((c) => chosen.has(c.id))!.k)}`
            : 'Tap the card to copy'}
        </Button>
      )}
      <RefusalSlot anchor="cv-tray" resetKey={key} />
    </section>
  );
}

/** The scores so far, with this round's running points. */
function Totals({
  g,
  name,
  live,
  you,
}: {
  g: GameView;
  name: NameOf;
  live: Record<string, number>;
  you: string;
}) {
  const rows = [...g.players].sort((x, y) => (g.golf ? x.score - y.score : y.score - x.score));
  return (
    <section className="hidden rounded-2xl bg-panel p-3 ring-1 ring-line lg:block dark:bg-stone-900 dark:ring-stone-700">
      <h2 className="mb-1 text-sm font-bold">Scores{g.golf ? ' (lowest wins)' : ''}</h2>
      <ol className="flex flex-col gap-0.5 text-sm">
        {rows.map((p) => (
          <li key={p.id} className={cn('flex justify-between gap-2', p.id === you && 'font-bold')}>
            <span className="truncate">{name(p.id)}</span>
            <span className="tabular-nums">
              {p.score}{' '}
              <span className="text-ink-muted dark:text-stone-400">{signed(live[p.id] ?? 0)}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Log({ view, name, art }: { view: ConveyorView; name: NameOf; art: Art }) {
  const lines = view.log
    .slice(-40)
    .reverse()
    .flatMap((e) => {
      const l = logLine(e, name, art.names);
      return l ? [{ id: e.id, l }] : [];
    });
  return (
    <details
      className="rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
      open={false}
    >
      <summary className="cursor-pointer text-sm font-semibold">What happened</summary>
      <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
        {lines.map((x) => (
          <li key={x.id}>{x.l}</li>
        ))}
      </ul>
    </details>
  );
}

/** Your hand, and what you do with it now. */
function Play({
  view,
  room,
  act,
  art,
  name,
  zoom,
}: {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  zoom: (cards: readonly { k: string; flipped?: boolean }[], start: number, title: string) => void;
}) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === room.you);
  const hand = g.hand ?? [];
  const step = g.step;
  const [preview, setPreview] = useState(() => read(PREVIEW_KEY, true));
  const [sel, setSel] = useState<{
    key: string;
    card: string | null;
    target: string | null;
    bonus: string | null;
  }>({
    key: '',
    card: null,
    target: null,
    bonus: null,
  });
  const key = `${g.round}:${g.turn}:${g.stage}:${step?.kind ?? ''}`;
  const s =
    sel.key === key
      ? sel
      : {
          key,
          card: g.myPick?.card ?? null,
          target: g.myPick?.target ?? null,
          bonus: g.myPick?.bonus ?? null,
        };
  const set = (patch: Partial<typeof s>) => setSel({ ...s, ...patch, key });

  const picking = g.stage === 'pick' && !!me;
  const chopping =
    step?.kind === 'chop' && step.players.includes(room.you) && !step.done.includes(room.you);
  const menuStep = step?.kind === 'menu' && step.by === room.you && step.drawn ? step : null;
  const giveStep = step?.kind === 'give' && step.from === room.you && step.options ? step : null;
  const spoonStep = step?.kind === 'spoon' && step.by === room.you ? step : null;
  const choices: Card[] = menuStep ? menuStep.drawn! : giveStep ? giveStep.options! : hand;
  const selectable = picking || chopping || !!menuStep || !!giveStep;
  const chosen = choices.find((c) => c.id === s.card) ?? null;
  const targets = me
    ? me.tray.filter((c) => typeOf(c.k) !== 'menu' && typeOf(c.k) !== 'takeout' && c.k !== 'order')
    : [];
  const needsTarget = chosen?.k === 'order' && targets.length > 1;
  const base = me ? (livePoints(g)[me.id] ?? 0) : 0;
  const bonuses =
    me && picking ? me.tray.filter((c) => !c.flipped && /^(chopsticks|spoon)-/.test(c.k)) : [];
  const pickedNow = g.myPick;

  const send = () => {
    if (!chosen) return;
    const target = chosen.k === 'order' && s.target ? { target: s.target } : {};
    if (picking)
      void act(
        { type: 'pick', card: chosen.id, ...target, ...(s.bonus && { bonus: s.bonus }) },
        { anchor: 'cv-play' },
      );
    else if (chopping)
      void act({ type: 'chop', card: chosen.id, ...target }, { anchor: 'cv-play' });
    else if (menuStep)
      void act({ type: 'menu', card: chosen.id, ...target }, { anchor: 'cv-play' });
    else if (giveStep) void act({ type: 'give', card: chosen.id }, { anchor: 'cv-play' });
  };
  const locked =
    picking &&
    pickedNow &&
    pickedNow.card === s.card &&
    (pickedNow.target ?? null) === s.target &&
    (pickedNow.bonus ?? null) === s.bonus;

  const title = menuStep
    ? `Your ${art.names.type('menu')}: the four cards drawn (only you see them)`
    : giveStep
      ? `Give ${name(giveStep.by) === 'You' ? '' : `${name(giveStep.by)} `}one of these`
      : chopping
        ? `Your hand: pick a second card (${art.names.type('chopsticks')})`
        : `Your hand (${hand.length})`;

  const waiting =
    g.stage === 'pick'
      ? g.players.filter((p) => !p.done).map((p) => p.id)
      : step?.kind === 'chop'
        ? step.players.filter((id) => !step.done.includes(id))
        : step?.kind === 'give'
          ? [step.from]
          : step
            ? [step.by]
            : [];
  const clock = g.clock;

  return (
    <section aria-label="Your hand" className="flex flex-col gap-2">
      {me ? (
        <div className="flex flex-col gap-1.5 rounded-2xl bg-card p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold">{title}</h2>
            {selectable && !giveStep && (
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={preview}
                  onChange={(e) => {
                    setPreview(e.target.checked);
                    write(PREVIEW_KEY, e.target.checked);
                  }}
                />
                Points now
              </label>
            )}
          </div>
          {choices.length ? (
            <ul
              className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pt-3 pb-1 sm:flex-wrap sm:overflow-visible"
              aria-label={title}
            >
              {choices.map((c, i) => {
                const on = s.card === c.id;
                const delta =
                  preview && selectable && !giveStep && me ? previewOf(g, me.id, c.k, base) : null;
                return (
                  <li key={c.id} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={selectable ? on : undefined}
                      aria-label={art.names.card(c.k)}
                      data-k={c.k}
                      onClick={() =>
                        selectable
                          ? set({ card: on ? null : c.id, target: null })
                          : zoom(choices, i, title)
                      }
                      className={cn(
                        'relative flex flex-col items-center gap-0.5 rounded-[7%] transition-transform',
                        on && '-translate-y-2',
                        selectable && menuStep && typeOf(c.k) === 'menu' && 'opacity-40',
                      )}
                    >
                      <CardFace
                        k={c.k}
                        art={art}
                        className={cn(
                          on && 'ring-4 ring-accent dark:ring-amber-400',
                          pickedNow?.card === c.id &&
                            'ring-4 ring-success-line dark:ring-emerald-400',
                        )}
                      />
                      {delta !== null && typeOf(c.k) !== 'order' && (
                        <span
                          className={cn(
                            'rounded-full px-1.5 text-[0.65rem] font-bold tabular-nums',
                            delta > 0
                              ? 'bg-success-soft text-success-ink dark:bg-emerald-500/15 dark:text-emerald-200'
                              : delta < 0
                                ? 'bg-danger-soft text-danger-ink dark:bg-red-500/15 dark:text-red-200'
                                : 'text-ink-muted dark:text-stone-400',
                          )}
                        >
                          {delta > 0 ? `+${delta}` : delta < 0 ? `−${-delta}` : '±0'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-ink-muted dark:text-stone-400">No cards in hand.</p>
          )}
          {chosen && (
            <button
              type="button"
              className="self-start text-xs underline"
              onClick={() => zoom(choices, choices.indexOf(chosen), title)}
            >
              🔍 See {art.names.card(chosen.k)} big
            </button>
          )}
          {needsTarget && selectable && !giveStep && (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold">{art.names.type('order')}: copy which card?</p>
              <ul className="flex flex-wrap gap-1.5">
                {targets.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      aria-pressed={s.target === t.id}
                      aria-label={`Copy ${art.names.card(t.k)}`}
                      data-target-k={t.k}
                      onClick={() => set({ target: t.id })}
                      className={cn(
                        'rounded-[7%]',
                        s.target === t.id && 'ring-4 ring-accent dark:ring-amber-400',
                      )}
                    >
                      <CardFace k={t.k} art={art} size="tray" flipped={t.flipped} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {chosen?.k === 'order' && targets.length === 0 && selectable && (
            <p className="text-sm text-warn-ink dark:text-amber-200">
              Nothing to copy yet: it would be discarded.
            </p>
          )}
          {bonuses.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {bonuses.map((b) => {
                const sticks = typeOf(b.k) === 'chopsticks';
                const off = sticks && hand.length < 2;
                return (
                  <Button
                    key={b.id}
                    size="sm"
                    variant={s.bonus === b.id ? 'primary' : 'soft'}
                    disabled={off}
                    aria-pressed={s.bonus === b.id}
                    onClick={() => set({ bonus: s.bonus === b.id ? null : b.id })}
                  >
                    {TYPES[typeOf(b.k)].emoji} {s.bonus === b.id ? 'Using' : 'Use'}{' '}
                    {art.names.type(typeOf(b.k))} ({variantOf(b.k).no})
                  </Button>
                );
              })}
              <span className="self-center text-xs text-ink-muted dark:text-stone-400">
                {s.bonus
                  ? typeOf(me.tray.find((c) => c.id === s.bonus)?.k ?? '') === 'chopsticks'
                    ? 'After the reveal you play a second card from your hand.'
                    : 'After the reveal you ask the table for a dish.'
                  : 'One a turn.'}
              </span>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-ink-muted dark:text-stone-400">You’re watching this game.</p>
      )}
      {spoonStep && <SpoonPicker g={g} art={art} act={act} />}
      {clock?.deadline && waiting.length > 0 && (
        <Countdown
          deadline={clock.deadline}
          clockOffset={room.clockOffset}
          label={clock.fixed ? 'to choose' : g.stage === 'pick' ? 'to pick' : 'to choose'}
          {...(clock.fixed || view.settings.timerMode === 'strict'
            ? {
                atZero: clock.fixed
                  ? 'then a random card that fits is given'
                  : 'then a random choice is made',
              }
            : {
                soft: true,
                expiredHint: room.isHost
                  ? 'You can Act for anyone still choosing.'
                  : 'The host can choose for anyone still choosing.',
              })}
        />
      )}
      {waiting.length > 0 && !(waiting.length === 1 && waiting[0] === room.you) && (
        <p className="text-center text-sm text-ink-muted dark:text-stone-400">
          {waitingFor(waiting, room.players, { you: room.you })}
          {room.isHost &&
            waiting
              .filter((id) => id !== room.you)
              .slice(0, 3)
              .map((id) => (
                <Button
                  key={id}
                  size="sm"
                  variant="ghost"
                  className="ml-1"
                  onClick={() => void act({ type: 'act-for', player: id }, { anchor: 'cv-play' })}
                >
                  Act for {name(id)}
                </Button>
              ))}
        </p>
      )}
      {selectable && me && (
        <StickyBar>
          <div className="flex gap-2">
            {picking && pickedNow && (
              <Button
                variant="secondary"
                onClick={() => void act({ type: 'unpick' }, { anchor: 'cv-play' })}
              >
                Take back
              </Button>
            )}
            <Button
              size="lg"
              className="flex-1"
              data-testid="cv-lock"
              disabled={
                !chosen ||
                (needsTarget && !s.target) ||
                !!locked ||
                (menuStep && chosen && typeOf(chosen.k) === 'menu') ||
                false
              }
              onClick={send}
            >
              {!chosen
                ? picking
                  ? 'Tap a card to pick it'
                  : 'Tap a card'
                : locked
                  ? `Locked in: ${art.names.card(chosen.k)}`
                  : needsTarget && !s.target
                    ? 'Choose what it copies'
                    : `${picking ? (pickedNow ? 'Change to' : 'Lock in') : giveStep ? 'Give' : 'Play'} ${art.names.card(chosen.k)}${s.bonus && picking ? ` + ${art.names.type(typeOf(me.tray.find((c) => c.id === s.bonus)?.k ?? 'spoon-4'))}` : ''}`}
            </Button>
          </div>
          <RefusalSlot anchor="cv-play" resetKey={key} />
        </StickyBar>
      )}
    </section>
  );
}

/** The spoon's request: a whole dish, or one exact card. Only you and the giver see it. */
function SpoonPicker({ g, art, act }: { g: GameView; art: Art; act: Act }) {
  const [type, setType] = useState<TypeId | null>(null);
  const [variant, setVariant] = useState<string | null>(null);
  const types = fullMenu(g.menu);
  const variants = type ? TYPES[type].variants : [];
  return (
    <div className="flex flex-col gap-2 rounded-2xl bg-card p-3 ring-2 ring-accent dark:bg-stone-900 dark:ring-amber-400">
      <p className="text-sm font-semibold">Ask for which dish?</p>
      <ul className="flex flex-wrap gap-1.5">
        {types.map((t) => (
          <li key={t}>
            <Button
              size="sm"
              variant={type === t ? 'primary' : 'soft'}
              aria-pressed={type === t}
              onClick={() => {
                setType(t);
                setVariant(null);
              }}
            >
              {TYPES[t].emoji} {art.names.type(t)}
            </Button>
          </li>
        ))}
      </ul>
      {type && variants.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant={variant === null ? 'primary' : 'soft'}
            aria-pressed={variant === null}
            onClick={() => setVariant(null)}
          >
            Any {art.names.type(type)}
          </Button>
          {variants.map((x) => (
            <Button
              key={x.id}
              size="sm"
              variant={variant === x.id ? 'primary' : 'soft'}
              aria-pressed={variant === x.id}
              onClick={() => setVariant(x.id)}
            >
              {art.names.card(x.id)}
            </Button>
          ))}
        </div>
      )}
      <p className="text-xs text-ink-muted dark:text-stone-400">
        {variant
          ? 'Exactly this card.'
          : type && variants.length > 1
            ? 'Any kind: the giver chooses which.'
            : 'The first player to your left holding one gives it to you; nobody: the spoon is lost.'}
      </p>
      <Button
        disabled={!type}
        onClick={() =>
          void act(
            { type: 'spoon', want: type!, ...(variant && { variant }) },
            { anchor: 'cv-spoon' },
          )
        }
      >
        {type
          ? `Ask for ${variant ? a(art.names.card(variant)) : `any ${art.names.type(type)}`}`
          : 'Pick a dish'}
      </Button>
      <RefusalSlot anchor="cv-spoon" />
    </div>
  );
}

/** The round's scores, part by part, each line rising in turn. */
function RoundScores({
  view,
  room,
  act,
  art,
  name,
}: {
  view: ConveyorView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const result = g.results.at(-1);
  const me = g.players.find((p) => p.id === room.you);
  if (!result) return null;
  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-card p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
      <h2 className="font-bold">Round {result.round} scores</h2>
      <ScoreRows rows={result.rows} art={art} name={name} you={room.you} />
      {g.clock?.deadline && (
        <Countdown
          deadline={g.clock.deadline}
          clockOffset={room.clockOffset}
          label="until the next round"
          atZero="then it is dealt"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {me && (
          <Button
            className="flex-1"
            disabled={me.done}
            onClick={() => void act({ type: 'ready' }, { anchor: 'cv-scores' })}
          >
            {me.done ? 'Ready ✓' : 'Ready'}
          </Button>
        )}
        {room.isHost && (
          <Button
            variant="secondary"
            onClick={() => void act({ type: 'next-round' }, { anchor: 'cv-scores' })}
          >
            Deal now
          </Button>
        )}
      </div>
      <RefusalSlot anchor="cv-scores" />
    </section>
  );
}

export function ScoreRows({
  rows,
  art,
  name,
  you,
}: {
  rows: { id: string; parts: { key: string; points: number; note?: string }[]; points: number }[];
  art: Art;
  name: NameOf;
  you: string;
}) {
  const sorted = [...rows].sort((x, y) => y.points - x.points);
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {sorted.map((r, i) => (
        <li
          key={r.id}
          className={cn(
            'cv-rise rounded-xl bg-panel p-2 ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
            r.id === you && 'ring-2 ring-accent dark:ring-amber-400',
          )}
          style={{ animationDelay: `${i * 120}ms` }}
        >
          <p className="flex justify-between font-semibold">
            <span>{name(r.id)}</span>
            <span className={cn('tabular-nums', r.points >= 25 && 'cv-pop')}>{r.points}</span>
          </p>
          <ul className="text-sm">
            {r.parts.map((p, j) => (
              <li key={j} className="flex justify-between gap-2">
                <span className="text-ink-muted dark:text-stone-400">
                  {partLine(p as never, art.names)}
                </span>
                <span className="tabular-nums">
                  {p.points > 0 ? `+${p.points}` : p.points < 0 ? `−${-p.points}` : '0'}
                </span>
              </li>
            ))}
            {!r.parts.length && (
              <li className="text-ink-muted dark:text-stone-400">Nothing scored</li>
            )}
          </ul>
        </li>
      ))}
    </ul>
  );
}
