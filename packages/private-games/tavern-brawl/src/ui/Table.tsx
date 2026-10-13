import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Hint, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CARDS } from '../logic/cards.ts';
import type {
  CardRef,
  ChoiceView,
  GameView,
  PlayerView,
  ShieldView,
  TavernBrawlAction,
  TavernBrawlView,
} from '../logic/types.ts';
import { type Art, heroVars } from './assets.ts';
import { Card, Zoom } from './Card.tsx';
import { Portrait } from './Lobby.tsx';
import { type NameOf, describe, possessive, prompt, waitingLine } from './text.ts';

type Act = (action: TavernBrawlAction, options?: { anchor?: string }) => Promise<boolean>;

export interface Status {
  text: string;
  yourMove: boolean;
}

export function statusFor(view: TavernBrawlView, you: string, name: NameOf, art: Art): Status {
  const g = view.game;
  if (view.phase === 'lobby' || !g) return { text: '', yourMove: false };
  if (view.phase === 'over') {
    if (g.winners.length === 0) return { text: 'Everyone is out: it’s a tie!', yourMove: false };
    const w = g.winners.map(name).join(' & ');
    return { text: `🏆 ${w} ${w === 'You' ? 'win' : 'wins'} the brawl!`, yourMove: false };
  }
  const me = g.players.find((p) => p.id === you);
  const c = g.choice;
  if (c && c.chooser === you)
    return {
      text: c.kind === 'social' ? 'Your move: animal noise time!' : 'Your move: choose below.',
      yourMove: true,
    };
  if (c) return { text: waitingLine(c, name, art), yourMove: false };
  if (me?.out) return { text: 'You’re out: watching the rest of the brawl.', yourMove: false };
  const turn = g.turn;
  if (turn.player === you) {
    if (g.resolving.length > 0) return { text: 'Resolving your card…', yourMove: false };
    const more =
      turn.debt > 1
        ? `Play ${turn.debt} more cards (${'⚡'.repeat(Math.min(turn.debt, 6))})`
        : turn.plays > 0
          ? 'Play one more card (⚡)'
          : 'Your turn: play a card';
    return { text: `${more}. Tap a card, then Play.`, yourMove: true };
  }
  return {
    text: `${possessive(name(turn.player)).replace(/^./, (x) => x.toUpperCase())} turn…`,
    yourMove: false,
  };
}

/** Hit points as a ring that empties, with the number in the middle. */
export function HpDial({ hp, size = 44, out }: { hp: number; size?: number; out?: boolean }) {
  const pct = Math.max(0, Math.min(10, hp)) * 10;
  const colour =
    hp <= 3 ? 'var(--color-danger)' : hp <= 6 ? 'var(--color-warn)' : 'var(--color-success)';
  return (
    <span
      role="img"
      aria-label={out ? 'knocked out' : `${hp} hit points`}
      style={{
        width: size,
        height: size,
        background: out ? undefined : `conic-gradient(${colour} ${pct}%, transparent 0)`,
      }}
      className="relative inline-flex shrink-0 items-center justify-center rounded-full bg-line dark:bg-stone-700"
    >
      <span
        className="absolute inset-[4px] flex items-center justify-center rounded-full bg-card font-black tabular-nums dark:bg-stone-900"
        style={{ fontSize: size * 0.4 }}
      >
        {out ? '💀' : hp}
      </span>
    </span>
  );
}

/** "−3" floating up from a dial when hit points change. */
function useHpDelta(hp: number): { id: number; delta: number } | null {
  const last = useRef(hp);
  const [fx, setFx] = useState<{ id: number; delta: number } | null>(null);
  useEffect(() => {
    if (hp !== last.current) {
      setFx({ id: Date.now(), delta: hp - last.current });
      last.current = hp;
      const t = setTimeout(() => setFx(null), 1400);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [hp]);
  return fx;
}

const STYLE = `
@keyframes tb-float { from { opacity: 1; transform: translateY(0) } to { opacity: 0; transform: translateY(-22px) } }
@keyframes tb-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
@media (prefers-reduced-motion: reduce) { .tb-anim { animation: none !important } }
`;

function Delta({ hp }: { hp: number }) {
  const fx = useHpDelta(hp);
  if (!fx) return null;
  return (
    <span
      key={fx.id}
      className={cn(
        'tb-anim pointer-events-none absolute -top-2 left-1/2 -translate-x-1/2 rounded-full px-1.5 text-sm font-black shadow',
        fx.delta < 0
          ? 'bg-danger text-white dark:bg-rose-600'
          : 'bg-success-soft text-success-ink dark:bg-emerald-500/20 dark:text-emerald-100',
      )}
      style={{ animation: 'tb-float 1.3s ease-out forwards' }}
      aria-hidden
    >
      {fx.delta > 0 ? `+${fx.delta}` : fx.delta}
    </span>
  );
}

interface Picking {
  /** Options of the open choice, when it's the viewer's. */
  options: Set<string>;
  pick: (id: string) => void;
}

function ShieldChip({
  shield,
  art,
  picking,
  name,
  holder,
  onZoom,
}: {
  shield: ShieldView;
  art: Art;
  picking: Picking | null;
  name: NameOf;
  holder: PlayerView;
  onZoom: (r: CardRef) => void;
}) {
  const pickable = !!picking?.options.has(shield.id);
  const borrowed = shield.owner !== holder.id;
  return (
    <button
      type="button"
      onClick={() => (pickable ? picking!.pick(shield.id) : onZoom(shield))}
      aria-label={`${art.card(shield.card)}, shield ${shield.left} of ${CARDS[shield.card]?.shield}${borrowed ? `, from ${possessive(name(shield.owner))} deck` : ''}${pickable ? ', tap to pick' : ''}`}
      className={cn(
        'inline-flex h-8 items-center gap-1 rounded-lg bg-info-soft px-2 text-sm font-bold text-info-ink ring-1 ring-info-line dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40',
        pickable &&
          'animate-pulse ring-4 ring-accent motion-reduce:animate-none dark:ring-amber-400',
      )}
      data-shield={shield.id}
    >
      🛡{shield.left}
      <span className="max-w-24 truncate text-xs font-medium">{art.card(shield.card)}</span>
    </button>
  );
}

function PlayerRow({
  p,
  g,
  art,
  name,
  room,
  picking,
  onZoom,
  compact,
}: {
  p: PlayerView;
  g: GameView;
  art: Art;
  name: NameOf;
  room: GameRoomInfo;
  picking: Picking | null;
  onZoom: (r: CardRef) => void;
  compact?: boolean;
}) {
  const turn = g.turn.player === p.id && !p.out;
  const waiting = g.clock?.who === p.id;
  const pickable = !!picking?.options.has(p.id);
  const offline = room.players.find((x) => x.id === p.id)?.connected === false;
  if (p.out)
    return (
      <li
        className="flex items-center gap-2 rounded-xl bg-panel px-2 py-1 text-sm text-ink-muted dark:bg-stone-900/60 dark:text-stone-500"
        data-player={p.id}
      >
        <span aria-hidden>💀</span>
        <span className="truncate font-medium line-through">{name(p.id)}</span>
        <span className="truncate text-xs">{art.hero(p.hero)} · out</span>
      </li>
    );
  return (
    <li
      style={heroVars(p.hero)}
      data-player={p.id}
      className={cn(
        'relative flex flex-col gap-1 rounded-xl bg-card p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-800',
        turn && 'ring-2 ring-[var(--hero)] dark:ring-[var(--hero-dark)]',
        pickable && 'ring-4 ring-accent dark:ring-amber-400',
      )}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={!pickable}
          onClick={() => picking?.pick(p.id)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-2 text-left',
            pickable && 'cursor-pointer',
          )}
          aria-label={`${name(p.id)}, ${art.hero(p.hero)}, ${p.hp} hit points${pickable ? ', tap to pick' : ''}`}
        >
          <span className="relative">
            <Portrait hero={p.hero} art={art} size={compact ? 36 : 40} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1">
              <PlayerTag
                name={name(p.id)}
                host={p.id === room.hostId}
                offline={offline}
                className="font-semibold"
              />
              {p.left && <span className="text-xs text-ink-muted">(left)</span>}
              {waiting && <span aria-label="their move">⏳</span>}
            </span>
            <span className="block truncate text-xs text-ink-muted dark:text-stone-400">
              {art.hero(p.hero)} · ✋{p.handCount} · 🂠{p.deckCount}
              {p.form && ` · ${p.form.kind === 'bear' ? '🐻' : '🐺'}`}
              {p.disguised && ' · 🎭 disguised'}
            </span>
          </span>
          <span className="relative">
            <HpDial hp={p.hp} size={compact ? 38 : 44} />
            <Delta hp={p.hp} />
          </span>
          {pickable && <span className="sr-only">Pick</span>}
        </button>
      </div>
      {p.shields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {p.shields.map((s) => (
            <ShieldChip
              key={s.id}
              shield={s}
              art={art}
              picking={picking}
              name={name}
              holder={p}
              onZoom={onZoom}
            />
          ))}
        </div>
      )}
    </li>
  );
}

/** The latest card and what it did, for everyone to follow along. */
function Resolution({
  view,
  art,
  name,
  onZoom,
}: {
  view: TavernBrawlView;
  art: Art;
  name: NameOf;
  onZoom: (r: CardRef) => void;
}) {
  const g = view.game!;
  const lastPlay = view.log.findLast((e) => e.kind === 'play');
  const since = lastPlay ? view.log.filter((e) => e.id >= lastPlay.id) : [];
  const lines = since
    .map((e) => ({ id: e.id, text: describe(e, name, art) }))
    .filter((l): l is { id: number; text: string } => !!l.text)
    .slice(-5);
  const showing: CardRef | null =
    g.resolving.at(-1) ??
    (lastPlay?.kind === 'play'
      ? { id: lastPlay.inst, card: lastPlay.card, owner: lastPlay.owner }
      : null);
  return (
    <section
      aria-label="Table"
      className="flex items-start gap-3 rounded-xl bg-panel p-2 ring-1 ring-line dark:bg-stone-900/70 dark:ring-stone-800"
    >
      {showing ? (
        <button
          type="button"
          onClick={() => onZoom(showing)}
          aria-label={`Zoom ${art.card(showing.card)}`}
        >
          <Card card={showing.card} art={art} width={76} />
        </button>
      ) : (
        <div className="flex aspect-[400/630] w-[76px] items-center justify-center rounded-[7%] border-2 border-dashed border-line text-xs text-ink-muted dark:border-stone-700">
          No card yet
        </div>
      )}
      <div className="min-w-0 flex-1">
        <ol className="flex flex-col gap-0.5 text-sm" aria-live="polite">
          {lines.map((l, i) => (
            <li
              key={l.id}
              className={cn('tb-anim', i === 0 && 'font-semibold')}
              style={{ animation: `tb-in 0.35s ease-out ${Math.min(i, 4) * 0.12}s both` }}
            >
              {l.text}
            </li>
          ))}
          {lines.length === 0 && <li className="text-ink-muted">The brawl begins!</li>}
        </ol>
        {g.turn.played.length > 0 && (
          <div
            className="mt-1.5 flex items-center gap-1 overflow-x-auto"
            aria-label="Played this turn"
          >
            <span className="shrink-0 text-xs text-ink-muted dark:text-stone-400">This turn:</span>
            {g.turn.played.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onZoom(r)}
                aria-label={art.card(r.card)}
              >
                <Card card={r.card} art={art} width={34} />
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Long-press (or right-click) zooms; a tap does `onTap`. */
function usePress(onTap: () => void, onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const long = useRef(false);
  return {
    onPointerDown: () => {
      long.current = false;
      timer.current = setTimeout(() => {
        long.current = true;
        onLong();
      }, 450);
    },
    onPointerUp: () => timer.current && clearTimeout(timer.current),
    onPointerLeave: () => timer.current && clearTimeout(timer.current),
    onClick: () => {
      if (!long.current) onTap();
    },
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      onLong();
    },
  };
}

function HandCard({
  r,
  art,
  width,
  selected,
  borrowed,
  pickable,
  overlap,
  index,
  onTap,
  onZoom,
}: {
  r: CardRef;
  art: Art;
  width: number;
  selected: boolean;
  borrowed: PlayerView | undefined;
  pickable: boolean;
  overlap: number;
  index: number;
  onTap: () => void;
  onZoom: () => void;
}) {
  const press = usePress(onTap, onZoom);
  return (
    <li
      style={{ marginLeft: index === 0 ? 0 : -overlap, zIndex: selected ? 50 : index }}
      className={cn('relative transition-transform', selected && '-translate-y-3')}
    >
      <button
        type="button"
        {...press}
        aria-pressed={selected}
        aria-label={`${art.card(r.card)}${borrowed ? `, from ${borrowed.name}’s deck` : ''}`}
        className="block touch-manipulation"
        data-hand={r.card}
      >
        <Card
          card={r.card}
          art={art}
          width={width}
          selected={selected}
          pickable={pickable}
          borrowedFrom={borrowed?.hero}
        />
      </button>
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Read ${art.card(r.card)}`}
        className="absolute top-0 right-0 flex size-9 items-start justify-end p-1 text-xs"
      >
        <span className="flex size-5 items-center justify-center rounded-full bg-black/70 font-bold text-white">
          i
        </span>
      </button>
    </li>
  );
}

function Hand({
  view,
  art,
  selected,
  setSelected,
  pickCard,
  onZoom,
}: {
  view: TavernBrawlView;
  art: Art;
  selected: string | null;
  setSelected: (id: string | null) => void;
  /** Hand cards that answer the open choice (a free Form). */
  pickCard: Picking | null;
  onZoom: (r: CardRef) => void;
}) {
  const g = view.game!;
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(360);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    setRoom(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const width = room >= 700 ? 132 : 108;
  const n = view.hand.length;
  const overlap = n > 1 ? Math.max(0, (n * width - room) / (n - 1)) : 0;
  const owners = new Map(g.players.map((p) => [p.id, p]));
  return (
    <div ref={ref} className="w-full" role="region" aria-label="Your hand">
      {n === 0 ? (
        <p className="py-6 text-center text-sm text-ink-muted">No cards in hand.</p>
      ) : (
        <ul className="flex justify-center pt-3">
          {view.hand.map((r, i) => (
            <HandCard
              key={r.id}
              r={r}
              art={art}
              width={width}
              index={i}
              overlap={overlap}
              selected={selected === r.id}
              pickable={!!pickCard?.options.has(r.id)}
              borrowed={r.owner !== view.me?.id ? owners.get(r.owner) : undefined}
              onTap={() =>
                pickCard?.options.has(r.id)
                  ? pickCard.pick(r.id)
                  : setSelected(selected === r.id ? null : r.id)
              }
              onZoom={() => onZoom(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The docked question: options as big chips, never covering the hand. */
function ChoiceStrip({
  c,
  g,
  me,
  art,
  name,
  picking,
}: {
  c: ChoiceView;
  g: GameView;
  me: PlayerView | undefined;
  art: Art;
  name: NameOf;
  picking: Picking;
}) {
  const shields = new Map(
    g.players.flatMap((p) => p.shields.map((s) => [s.id, { s, holder: p }] as const)),
  );
  const discard = new Map((me?.discard ?? []).map((r) => [r.id, r]));
  const label = (o: string) => {
    if (o === 'skip') return 'Skip';
    const p = g.players.find((x) => x.id === o);
    if (p)
      return `${name(p.id)} (❤${p.hp}${p.shields.length ? ` 🛡${p.shields.reduce((n, s) => n + s.left, 0)}` : ''})`;
    const sh = shields.get(o);
    if (sh) return `${art.card(sh.s.card)} (${name(sh.holder.id)}, 🛡${sh.s.left})`;
    const d = discard.get(o);
    if (d) return art.card(d.card);
    return 'Card';
  };
  if (c.kind === 'social') return null;
  const cards = c.kind === 'recover' ? c.options.filter((o) => discard.has(o)) : [];
  // Several copies of one card are the same pick.
  const uniqueCards = [...new Map(cards.map((o) => [discard.get(o)!.card, o])).values()];
  const chips =
    c.kind === 'recover' ? [] : c.options.filter((o) => c.kind !== 'form' || o === 'skip');
  return (
    <section
      aria-label="Your choice"
      className="flex flex-col gap-2 rounded-xl bg-warn-soft p-2 ring-1 ring-warn-line dark:bg-amber-500/10 dark:ring-amber-500/40"
    >
      <p className="text-sm font-semibold text-warn-ink dark:text-amber-100">
        {prompt(c, g, name, art)}
      </p>
      {uniqueCards.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1">
          {uniqueCards.map((o) => (
            <li key={o}>
              <button type="button" onClick={() => picking.pick(o)} aria-label={`Take ${label(o)}`}>
                <Card card={discard.get(o)!.card} art={art} width={72} pickable />
              </button>
            </li>
          ))}
        </ul>
      )}
      {c.kind === 'form' && (
        <p className="text-xs text-warn-ink dark:text-amber-100">
          Tap a glowing card in your hand to play it, or skip.
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((o) => (
          <Button
            key={o}
            variant={o === 'skip' ? 'secondary' : 'soft'}
            size="md"
            onClick={() => picking.pick(o)}
            className="min-h-11"
          >
            {label(o)}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** The honour-system prompt: one big button, a smaller skip, and a fixed 20-second clock. */
function SocialSheet({
  c,
  art,
  room,
  picking,
}: {
  c: ChoiceView;
  art: Art;
  room: GameRoomInfo;
  picking: Picking;
}) {
  return (
    <section
      aria-label="Animal noise"
      className="flex flex-col items-center gap-2 rounded-2xl bg-special-soft p-4 text-center ring-1 ring-special-line dark:bg-violet-500/15 dark:ring-violet-500/40"
    >
      <p className="font-bold text-special-ink dark:text-violet-100">
        {art.card(c.source.card)}: make an animal noise, out loud, for everyone!
      </p>
      <p className="text-sm text-special-ink dark:text-violet-100">
        Then every opponent takes 1 damage. Honour system: the table is listening.
      </p>
      <Button size="lg" className="w-full" onClick={() => picking.pick('done')}>
        🐺 I made an animal noise!
      </Button>
      <Button variant="ghost" size="sm" onClick={() => picking.pick('skip')}>
        Skip the noise (no damage)
      </Button>
      <Countdown
        deadline={c.deadline ?? null}
        clockOffset={room.clockOffset}
        label="to howl"
        atZero="then it counts as done"
      />
    </section>
  );
}

function Discards({
  g,
  art,
  name,
  onZoom,
}: {
  g: GameView;
  art: Art;
  name: NameOf;
  onZoom: (r: CardRef) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {g.players.map((p) => (
        <section key={p.id} aria-label={`${possessive(name(p.id))} discard pile`}>
          <h3 className="mb-1 text-sm font-semibold">
            {possessive(name(p.id)).replace(/^./, (x) => x.toUpperCase())} discard pile (
            {p.discard.length}) · deck {p.deckCount}
          </h3>
          {p.discard.length === 0 ? (
            <p className="text-xs text-ink-muted">Empty.</p>
          ) : (
            <ul className="flex flex-wrap gap-1">
              {[...p.discard].reverse().map((r) => (
                <li key={r.id}>
                  <button type="button" onClick={() => onZoom(r)} aria-label={art.card(r.card)}>
                    <Card card={r.card} art={art} width={56} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The public log, newest turn first, each turn's header above its lines (newest first). */
function Log({ view, art, name }: { view: TavernBrawlView; art: Art; name: NameOf }) {
  const turns: { key: number; head: string | null; lines: { id: number; text: string }[] }[] = [];
  for (const e of view.log) {
    if (e.kind === 'turn' || turns.length === 0) turns.push({ key: e.id, head: null, lines: [] });
    const text = describe(e, name, art);
    if (!text) continue;
    const t = turns.at(-1)!;
    if (e.kind === 'turn') t.head = text;
    else t.lines.push({ id: e.id, text });
  }
  return (
    <div className="flex flex-col gap-1.5 text-sm" aria-label="Log" role="log">
      {[...turns].reverse().map((t) => (
        <section
          key={t.key}
          className="border-t border-line pt-1 first:border-0 first:pt-0 dark:border-stone-800"
        >
          {t.head && <h3 className="font-semibold">{t.head}</h3>}
          <ol className="flex flex-col gap-0.5">
            {[...t.lines].reverse().map((l) => (
              <li key={l.id}>{l.text}</li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

type Tab = 'table' | 'log' | 'discards';

export function Table({
  view,
  room,
  act,
  art,
  name,
  status,
}: {
  view: TavernBrawlView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  status: Status;
}) {
  const g = view.game!;
  const you = room.you;
  const me = g.players.find((p) => p.id === you);
  const [selected, setSelected] = useState<string | null>(null);
  const [zoom, setZoom] = useState<{ ref: CardRef; play?: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>('table');
  const c = g.choice;
  const mine = c && c.chooser === you ? c : null;
  const canPlay =
    g.turn.player === you &&
    !c &&
    g.resolving.length === 0 &&
    g.turn.debt > 0 &&
    view.phase === 'playing';
  const picking: Picking | null = mine
    ? {
        options: new Set(mine.options),
        pick: (pick) =>
          void act({ type: 'choose', choice: mine.id, pick }, { anchor: 'tb-choice' }),
      }
    : null;
  const play = (id: string) => {
    setSelected(null);
    setZoom(null);
    void act({ type: 'play', card: id }, { anchor: 'tb-play' });
  };
  const order = useMemo(() => {
    const at = g.order.indexOf(you);
    const round = at >= 0 ? [...g.order.slice(at + 1), ...g.order.slice(0, at)] : g.order;
    return round.map((id) => g.players.find((p) => p.id === id)!).filter(Boolean);
  }, [g, you]);
  const zoomRef = zoom?.ref;
  const selectedRef = view.hand.find((r) => r.id === selected);
  const clock = g.clock;
  const strict = view.settings.timerMode === 'strict';
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const waitingOn = clock && clock.who !== you ? clock.who : null;
  const nudged = g.nudges[you];
  // A nudge shows a banner (and buzzes the phone) until it's been seen for a few seconds.
  const [seenNudge, setSeenNudge] = useState(nudged);
  const buzz = nudged !== undefined && nudged !== seenNudge;
  useEffect(() => {
    if (!buzz) return;
    navigator.vibrate?.([120, 80, 120]);
    const t = setTimeout(() => setSeenNudge(nudged), 4000);
    return () => clearTimeout(t);
  }, [buzz, nudged]);
  useEffect(() => {
    if (status.yourMove) navigator.vibrate?.(80);
  }, [status.yourMove]);

  const tabs = (
    <div
      role="tablist"
      className="flex gap-1 rounded-xl bg-panel p-1 ring-1 ring-line lg:hidden dark:bg-stone-900 dark:ring-stone-800"
    >
      {(
        [
          ['table', 'Table'],
          ['log', 'Log'],
          ['discards', 'Discards'],
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

  const header = (
    <div className="flex flex-col gap-1.5">
      {buzz && (
        <p
          role="alert"
          className="rounded-xl bg-warn-soft px-3 py-2 text-center text-sm font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100"
        >
          👋 The table is waiting for you!
        </p>
      )}
      <div className="flex items-start gap-2">
        {view.phase === 'playing' && (
          <div className="min-w-0 flex-1">
            <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          </div>
        )}
        {clock && clock.deadline !== null && !mine?.deadline && (
          <Countdown
            key={`${clock.who}-${clock.since}`}
            deadline={clock.deadline}
            clockOffset={room.clockOffset}
            soft={!strict}
            label={clock.who === you ? 'to play' : undefined}
            expiredHint={
              clock.who === you
                ? 'Take your time, but the table is waiting.'
                : `Waiting on ${name(clock.who)}.`
            }
            atZero={strict ? 'then a random card is played' : undefined}
          />
        )}
      </div>
      {waitingOn &&
        (offline(waitingOn) ||
          clock?.reminded ||
          g.players.find((p) => p.id === waitingOn)?.left) && (
          <div className="flex flex-wrap justify-end gap-1.5">
            {view.me?.playing !== false && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void act({ type: 'nudge', player: waitingOn }, { anchor: 'tb-host' })
                }
              >
                👋 Nudge {name(waitingOn)}
              </Button>
            )}
            {room.isHost && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  void act({ type: 'act-for', player: waitingOn }, { anchor: 'tb-host' })
                }
              >
                Act for {name(waitingOn)}
              </Button>
            )}
            {room.isHost &&
              g.players.find((p) => p.id === waitingOn)?.left &&
              g.resolving.length === 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    void act({ type: 'remove', player: waitingOn }, { anchor: 'tb-host' })
                  }
                >
                  Remove {name(waitingOn)}
                </Button>
              )}
          </div>
        )}
      <RefusalSlot anchor="tb-host" />
    </div>
  );

  const opponents = (
    <ul
      className={cn(
        'grid gap-1.5',
        order.length >= 3 ? 'lg:grid-cols-3' : order.length === 2 ? 'lg:grid-cols-2' : '',
      )}
      aria-label="Opponents"
    >
      {order.map((p) => (
        <PlayerRow
          key={p.id}
          p={p}
          g={g}
          art={art}
          name={name}
          room={room}
          picking={picking}
          onZoom={(r) => setZoom({ ref: r })}
          compact={order.length >= 3}
        />
      ))}
    </ul>
  );

  const mePanel = me && (
    <ul aria-label="You">
      <PlayerRow
        p={me}
        g={g}
        art={art}
        name={name}
        room={room}
        picking={picking}
        onZoom={(r) => setZoom({ ref: r })}
      />
    </ul>
  );

  const playArea = (
    <>
      {mine && mine.kind === 'social' && picking && (
        <SocialSheet c={mine} art={art} room={room} picking={picking} />
      )}
      {mine && mine.kind !== 'social' && picking && (
        <ChoiceStrip c={mine} g={g} me={me} art={art} name={name} picking={picking} />
      )}
      <RefusalSlot anchor="tb-choice" />
      {canPlay && (
        <div role="group" aria-label="Play a card" className="flex items-center gap-2">
          <span
            className="shrink-0 rounded-lg bg-panel px-2 py-2 text-sm font-bold tabular-nums ring-1 ring-line dark:bg-stone-800 dark:ring-0"
            aria-label={`${g.turn.debt} to play`}
          >
            ⚡{g.turn.debt}
          </span>
          <Button
            size="lg"
            className="min-w-0 flex-1"
            disabled={!selectedRef}
            onClick={() => selectedRef && play(selectedRef.id)}
          >
            <span className="truncate">
              {selectedRef ? `Play ${art.card(selectedRef.card)}` : 'Pick a card to play'}
            </span>
          </Button>
        </div>
      )}
      {me && !me.out && (
        <Hand
          view={view}
          art={art}
          selected={canPlay ? selected : null}
          setSelected={(id) =>
            canPlay ? setSelected(id) : id && setZoom({ ref: view.hand.find((r) => r.id === id)! })
          }
          pickCard={mine?.kind === 'form' ? picking : null}
          onZoom={(r) => setZoom({ ref: r, play: canPlay })}
        />
      )}
      <RefusalSlot anchor="tb-play" />
    </>
  );

  return (
    <div
      data-seq={`${view.log.at(-1)?.id ?? 0}-${g.choice?.id ?? 0}`}
      className="mx-auto flex w-full max-w-6xl flex-col gap-2 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-4"
    >
      <style>{STYLE}</style>
      <div className="flex min-w-0 flex-col gap-2">
        {header}
        {tabs}
        <div className={cn('flex flex-col gap-2', tab !== 'table' && 'max-lg:hidden')}>
          {opponents}
          <Resolution view={view} art={art} name={name} onZoom={(r) => setZoom({ ref: r })} />
          {mePanel}
          {playArea}
        </div>
        {tab === 'log' && (
          <div className="lg:hidden">
            <Log view={view} art={art} name={name} />
          </div>
        )}
        {tab === 'discards' && (
          <div className="lg:hidden">
            <Discards g={g} art={art} name={name} onZoom={(r) => setZoom({ ref: r })} />
          </div>
        )}
      </div>
      <aside className="hidden max-h-[calc(100dvh-8rem)] flex-col gap-3 overflow-y-auto rounded-2xl bg-card/85 p-3 ring-1 ring-line lg:sticky lg:top-4 lg:flex dark:bg-stone-900/80 dark:ring-stone-800">
        <h2 className="font-bold">Log</h2>
        <Log view={view} art={art} name={name} />
        <h2 className="font-bold">Discard piles</h2>
        <Discards g={g} art={art} name={name} onZoom={(r) => setZoom({ ref: r })} />
      </aside>
      <Zoom
        card={zoomRef?.card ?? null}
        art={art}
        note={
          zoomRef && zoomRef.owner !== you && view.hand.some((r) => r.id === zoomRef.id)
            ? `From ${possessive(name(zoomRef.owner))} deck: it goes back to their discard pile.`
            : undefined
        }
        onClose={() => setZoom(null)}
        onPlay={
          zoom?.play && zoomRef && canPlay && view.hand.some((r) => r.id === zoomRef.id)
            ? () => play(zoomRef.id)
            : undefined
        }
      />
    </div>
  );
}
