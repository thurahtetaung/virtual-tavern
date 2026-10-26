import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import { Button, Countdown, Modal, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardOf } from '../logic/cards.ts';
import { anyColours, cityGap, cityOf } from '../logic/cities.ts';
import { LEVEL_NAME, TOKEN_NAME } from '../logic/gems.ts';
import { type StrongholdColor, strongholdColors } from '../logic/manifest.ts';
import {
  autoGold,
  canAfford,
  canReserve,
  canTake,
  costAfter,
  differentToTake,
  noGems,
  noPieces,
  payment,
  shortfall,
  takeProblem,
  totalOf,
} from '../logic/rules.ts';
import {
  type HoldMove,
  conquestCard,
  holdMoves,
  holdsOf,
  occupiedFor,
  openMarket,
} from '../logic/strongholds.ts';
import {
  DOUBLE_MIN,
  GEMS,
  type Gem,
  type JewellerAction,
  type JewellerView,
  LEVELS,
  type Level,
  MAX_RESERVED,
  type Pieces,
  type PlayerView,
  TOKENS,
  TOKEN_LIMIT,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import {
  type Afford,
  CardBack,
  CardTile,
  CityTile,
  type HoldInfo,
  NobleTile,
  StrongholdIcon,
  TokenChip,
} from './Pieces.tsx';
import { type NameOf, cardLine, logLine } from './text.ts';

/** A player's stronghold colour: their room colour where it is one, else one left in turn order. */
function holdColor(view: JewellerView, room: GameRoomInfo, id: string): StrongholdColor {
  const colors = strongholdColors(
    view.game!.order,
    (x) => room.players.find((p) => p.id === x)?.color,
  );
  return colors[id] ?? 'blue';
}

export type Act = (action: JewellerAction, options?: { anchor?: string }) => Promise<boolean>;

export interface TableProps {
  view: JewellerView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  showGuide: (id?: string) => void;
}

type Sheet =
  | { kind: 'card'; id: string }
  | { kind: 'deck'; level: Level }
  | { kind: 'player'; id: string }
  | { kind: 'noble'; id: string }
  | { kind: 'city'; id: string }
  | null;

const affordOf = (id: string, me: PlayerView | undefined, view?: JewellerView): Afford => {
  if (!me) return null;
  // Another player's strongholds keep it off.
  if (view && occupiedFor(view.game!.holds, id, me.id)) return null;
  const c = cardOf(id);
  if (totalOf(shortfall(c, me.bonuses, me.tokens)) === 0) return 'yes';
  return canAfford(c, me.bonuses, me.tokens) ? 'gold' : 'no';
};

/** Market cards that weren't there on the last render, so they can play their deal. */
function useFresh(ids: readonly string[]) {
  const prev = useRef<Set<string> | null>(null);
  const before = prev.current;
  useEffect(() => {
    prev.current = new Set(ids);
  }, [ids]);
  return (id: string) => !!before && !before.has(id);
}

/** The newest buy or noble visit, shown for a moment as it happens. */
function Flash({ view, name }: { view: JewellerView; name: NameOf }) {
  const last = [...view.log].reverse().find((e) => e.kind === 'buy' || e.kind === 'noble');
  const [shown, setShown] = useState<number | null>(null);
  const lastId = last?.id ?? 0;
  const seen = useRef<number | null>(null);
  useEffect(() => {
    // The first render only remembers where the log is.
    if (seen.current === null) {
      seen.current = lastId;
      return;
    }
    if (lastId === seen.current) return;
    seen.current = lastId;
    setShown(lastId);
    const t = setTimeout(() => {
      setShown(null);
    }, 3200);
    return () => {
      clearTimeout(t);
    };
  }, [lastId]);
  if (!last || shown !== last.id) return null;
  const text = logLine(last, name);
  return (
    <p
      role="status"
      className={cn(
        'jw-pop rounded-xl px-3 py-1.5 text-center text-sm font-semibold ring-1',
        last.kind === 'noble'
          ? 'bg-special-soft text-special-ink ring-special-line dark:bg-violet-500/15 dark:text-violet-100 dark:ring-violet-500/40'
          : 'bg-success-soft text-success-ink ring-success-line dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/40',
      )}
    >
      {text}
    </p>
  );
}

/** A player's pieces and discounts by colour: "discount + pieces", the most-read line. */
function Holdings({ p, art, compact }: { p: PlayerView; art: Art; compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-end gap-1.5', compact && 'gap-1')}>
      {GEMS.map((g) => (
        <span
          key={g}
          className="flex flex-col items-center gap-0.5"
          aria-label={`${TOKEN_NAME[g]}: ${p.bonuses[g]} ${p.bonuses[g] === 1 ? 'card' : 'cards'}, ${p.tokens[g]} ${p.tokens[g] === 1 ? 'piece' : 'pieces'}`}
          role="group"
        >
          <span
            className={cn(
              'flex h-4 min-w-6 items-center justify-center rounded-sm text-[11px] font-black tabular-nums ring-1',
              p.bonuses[g]
                ? 'bg-card text-ink ring-line dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-600'
                : 'text-ink-muted ring-transparent dark:text-stone-500',
            )}
            title="Cards (lasting discount)"
          >
            🃏{p.bonuses[g]}
          </span>
          <TokenChip
            token={g}
            art={art}
            count={p.tokens[g]}
            size={compact ? 24 : 30}
            dim={!p.tokens[g]}
          />
        </span>
      ))}
      <span
        className="flex flex-col items-center gap-0.5"
        role="group"
        aria-label={`Gold: ${p.tokens.gold}`}
      >
        <span className="h-4 text-[11px] text-ink-muted dark:text-stone-400">wild</span>
        <TokenChip
          token="gold"
          art={art}
          count={p.tokens.gold}
          size={compact ? 24 : 30}
          dim={!p.tokens.gold}
        />
      </span>
      <span
        className={cn(
          'ml-auto self-center rounded-full px-2 py-0.5 text-xs font-bold tabular-nums ring-1',
          totalOf(p.tokens) >= TOKEN_LIMIT
            ? 'bg-warn-soft text-warn-ink ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40'
            : 'text-ink-muted ring-line dark:text-stone-400 dark:ring-stone-700',
        )}
        aria-label={`${totalOf(p.tokens)} of ${TOKEN_LIMIT} pieces`}
      >
        {totalOf(p.tokens)}/{TOKEN_LIMIT}
      </span>
    </div>
  );
}

/** One opponent as a chip on phones: points, pieces and reserved cards; tap for the rest. */
function PlayerChip({
  p,
  view,
  room,
  art,
  onOpen,
}: {
  p: PlayerView;
  view: JewellerView;
  room: GameRoomInfo;
  art: Art;
  onOpen: () => void;
}) {
  const g = view.game!;
  const current = g.current === p.id && view.phase === 'playing';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        'flex shrink-0 items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm shadow-sm ring-1 ring-line focus-visible:outline-2 focus-visible:outline-accent dark:bg-stone-900 dark:ring-stone-700',
        current && 'ring-2 ring-accent dark:ring-amber-500',
        p.left && 'opacity-60',
      )}
      aria-label={`${p.name}: ${p.points} ${p.points === 1 ? 'point' : 'points'}, ${totalOf(p.tokens)} ${totalOf(p.tokens) === 1 ? 'piece' : 'pieces'}, ${p.reserved.length} reserved${view.settings.strongholds ? `, ${p.strongholds} ${holdColor(view, room, p.id)} ${p.strongholds === 1 ? 'stronghold' : 'strongholds'} in supply` : ''}${p.cities.length ? ', meets a City' : ''}${current ? ', playing now' : ''}`}
      data-player={p.id}
    >
      <PlayerTag
        name={p.name}
        you={p.id === room.you}
        host={p.id === room.hostId}
        offline={room.players.find((x) => x.id === p.id)?.connected === false}
        className="max-w-24 truncate font-semibold"
      />
      {view.settings.strongholds && (
        <span className="flex items-center text-xs text-ink-muted tabular-nums dark:text-stone-400">
          <StrongholdIcon art={art.stronghold(holdColor(view, room, p.id))} size={14} />
          {p.strongholds}
        </span>
      )}
      <span className="font-black tabular-nums">{p.points}★</span>
      <span className="text-xs text-ink-muted tabular-nums dark:text-stone-400">
        ◆{totalOf(p.tokens)}
      </span>
      {p.reserved.length > 0 && (
        <span className="text-xs text-ink-muted dark:text-stone-400">🂠{p.reserved.length}</span>
      )}
      {p.nobles.length > 0 && <span className="text-xs">👑{p.nobles.length}</span>}
      {p.cities.length > 0 && <span className="text-xs">🏙✓</span>}
    </button>
  );
}

/** A player's whole table: pieces, discounts, reserved cards (as they may be seen) and nobles. */
function PlayerPanel({
  p,
  view,
  room,
  art,
  onCard,
}: {
  p: PlayerView;
  view: JewellerView;
  room: GameRoomInfo;
  art: Art;
  onCard?: (id: string) => void;
}) {
  const g = view.game!;
  const current = g.current === p.id && view.phase === 'playing';
  return (
    <section
      aria-label={`${p.name}’s table`}
      className={cn(
        'flex flex-col gap-2 rounded-2xl bg-card/85 p-2.5 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        current && 'ring-2 ring-accent dark:ring-amber-500',
      )}
      data-panel={p.id}
    >
      <div className="flex items-center justify-between gap-2">
        <PlayerTag
          name={p.name}
          you={p.id === room.you}
          host={p.id === room.hostId}
          offline={room.players.find((x) => x.id === p.id)?.connected === false}
          className="min-w-0 truncate font-semibold"
        />
        <span className="flex items-center gap-2 text-sm">
          {p.left && (
            <span className="text-xs text-ink-muted dark:text-stone-400">
              {p.removed ? 'removed' : 'away'}
            </span>
          )}
          {p.cities.length > 0 && (
            <span className="text-xs font-semibold text-success-ink dark:text-emerald-300">
              🏙 City met
            </span>
          )}
          <span className="font-black tabular-nums" aria-label={`${p.points} points`}>
            {p.points}★
          </span>
        </span>
      </div>
      {view.settings.strongholds && <Supply p={p} view={view} room={room} art={art} />}
      <Holdings p={p} art={art} compact />
      {(p.reserved.length > 0 || p.nobles.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {p.reserved.map((r, i) =>
            r.card ? (
              <CardTile
                key={`${r.card}-${i}`}
                id={r.card}
                art={art}
                className="w-12"
                {...(onCard && { onClick: () => onCard(r.card!) })}
              />
            ) : (
              <CardBack
                key={i}
                level={r.level}
                art={art}
                className="h-14 w-12"
                label={`A reserved level ${LEVEL_NAME[r.level]} card${r.blind ? ' (from the deck)' : ''}`}
              />
            ),
          )}
          {p.nobles.map((n) => (
            <NobleTile key={n} id={n} art={art} className="!size-12" />
          ))}
        </div>
      )}
    </section>
  );
}

/** A player's strongholds still in their supply, as pieces. */
function Supply({
  p,
  view,
  room,
  art,
}: {
  p: PlayerView;
  view: JewellerView;
  room: GameRoomInfo;
  art: Art;
}) {
  const color = holdColor(view, room, p.id);
  return (
    <span
      className="flex items-center gap-1 text-xs text-ink-muted dark:text-stone-400"
      role="img"
      aria-label={`${p.strongholds} ${color} ${p.strongholds === 1 ? 'stronghold' : 'strongholds'} in supply`}
    >
      {Array.from({ length: p.strongholds }, (_, i) => (
        <StrongholdIcon key={i} art={art.stronghold(color)} size={18} />
      ))}
      {p.strongholds === 0 ? 'All strongholds out' : 'in supply'}
    </span>
  );
}

/** Strongholds on a card, for its badge. */
function holdInfo(
  view: JewellerView,
  room: GameRoomInfo,
  art: Art,
  card: string,
): HoldInfo | undefined {
  const g = view.game!;
  const h = g.holds[card];
  if (!h) return undefined;
  const owner = g.players.find((p) => p.id === h.by);
  return {
    n: h.n,
    mine: h.by === room.you,
    owner: owner?.name ?? 'Someone',
    color: room.players.find((p) => p.id === h.by)?.color,
    art: art.stronghold(holdColor(view, room, h.by)),
  };
}

/**
 * Where the owed stronghold comes from: the supply (`from` null) or one of the player's cards, or
 * `evict` to send an opponent's back.
 */
type HoldFrom = { from: string | null } | 'evict';

const sameFrom = (a: HoldFrom, b: HoldFrom) =>
  a === 'evict' || b === 'evict' ? a === b : a.from === b.from;

/** The stronghold picker's mode, reset each time a new stronghold is owed. */
function useHoldMode(view: JewellerView, you: string) {
  const { stage, current, market, holds } = view.game!;
  const moves = useMemo(
    () => (stage === 'hold' && current === you ? holdMoves(market, holds, you) : []),
    [stage, current, market, holds, you],
  );
  // From the supply while there is one, else moving one, else sending one back.
  const place = moves.find((m) => m.type === 'stronghold' && m.from === undefined);
  const move = moves.find((m) => m.type === 'stronghold');
  const fallback: HoldFrom = place
    ? { from: null }
    : move?.type === 'stronghold'
      ? { from: move.from ?? null }
      : 'evict';
  const key = `${view.game!.turns}:${view.log.at(-1)?.id ?? 0}`;
  const [state, setState] = useState<{ key: string; from: HoldFrom }>({ key, from: fallback });
  const from = state.key === key ? state.from : fallback;
  const legal = (card: string): HoldMove | undefined =>
    moves.find((m) =>
      from === 'evict'
        ? m.type === 'evict' && m.card === card
        : m.type === 'stronghold' && m.card === card && (m.from ?? null) === from.from,
    );
  return { moves, from, setFrom: (f: HoldFrom) => setState({ key, from: f }), legal };
}

/** Pick-and-confirm for the gem piles: tap to stage, tap again for two of a colour. */
function useStaging(view: JewellerView, mine: boolean) {
  const [staged, setStaged] = useState<Gem[]>([]);
  const g = view.game!;
  const key = `${g.turns}:${g.stage}`;
  const [forKey, setForKey] = useState(key);
  if (forKey !== key) {
    setForKey(key);
    setStaged([]);
  }
  const tap = (gem: Gem) => {
    if (!mine) return;
    setStaged((s) => {
      const double = s.length === 2 && s[0] === s[1];
      if (s.length === 1 && s[0] === gem) return g.bank[gem] >= DOUBLE_MIN ? [gem, gem] : [];
      if (double) return s[0] === gem ? [] : [gem];
      if (s.includes(gem)) return s.filter((x) => x !== gem);
      if (s.length >= differentToTake(g.bank)) return s;
      return [...s, gem];
    });
  };
  return { staged, tap, clear: () => setStaged([]) };
}

/** What a take still lacks, for the action bar. */
function takeHint(view: JewellerView, staged: Gem[]): string {
  const g = view.game!;
  const n = differentToTake(g.bank);
  if (!staged.length)
    return n === 3
      ? 'Tap 3 different gems, or one twice for two of a colour. Tap a card to buy or reserve it.'
      : `Only ${n} ${n === 1 ? 'colour is' : 'colours are'} left: take one of each. Or tap a card.`;
  const problem = takeProblem(g.bank, staged);
  if (!problem) return '';
  if (staged.length < n && new Set(staged).size === staged.length)
    return `Pick ${n - staged.length} more ${n - staged.length === 1 ? 'colour' : 'colours'}${staged.length === 1 && g.bank[staged[0]!] >= DOUBLE_MIN ? ', or tap it again for two' : ''}.`;
  return problem;
}

/** The gem piles. */
function Bank({
  view,
  art,
  staged,
  onTap,
  active,
}: {
  view: JewellerView;
  art: Art;
  staged: Gem[];
  onTap: (g: Gem) => void;
  active: boolean;
}) {
  const g = view.game!;
  return (
    <div
      className="flex items-center justify-between gap-1 rounded-2xl bg-panel px-2 py-1.5 ring-1 ring-line dark:bg-stone-900/70 dark:ring-stone-800"
      role="group"
      aria-label="Gem piles"
    >
      {GEMS.map((gem) => {
        const n = g.bank[gem];
        const picked = staged.filter((x) => x === gem).length;
        return (
          <button
            key={gem}
            type="button"
            disabled={!active || n === 0}
            onClick={() => onTap(gem)}
            className={cn(
              'relative flex flex-col items-center rounded-full p-0.5 transition-transform focus-visible:outline-2 focus-visible:outline-accent enabled:hover:-translate-y-0.5 disabled:cursor-default',
              picked > 0 && '-translate-y-1',
            )}
            aria-label={`${TOKEN_NAME[gem]} pile: ${n} left${picked ? `, ${picked} picked` : ''}`}
            aria-pressed={picked > 0}
            data-pile={gem}
          >
            <TokenChip token={gem} art={art} count={n - picked} size={38} dim={n - picked === 0} />
            {picked > 0 && (
              <span className="absolute -top-1 -right-1 rounded-full bg-accent px-1 text-[11px] font-black text-accent-fg dark:bg-amber-500 dark:text-stone-950">
                +{picked}
              </span>
            )}
          </button>
        );
      })}
      <span
        className="flex flex-col items-center p-0.5"
        aria-label={`Gold: ${g.bank.gold} left (only by reserving)`}
        role="img"
      >
        <TokenChip token="gold" art={art} count={g.bank.gold} size={38} dim={!g.bank.gold} />
      </span>
    </div>
  );
}

/** Handing back pieces down to 10: a guided picker, pre-filled with a suggestion. */
function ReturnPicker({ me, art, act }: { me: PlayerView; art: Art; act: Act }) {
  const over = totalOf(me.tokens) - TOKEN_LIMIT;
  const [back, setBack] = useState<Pieces>(() => {
    // Suggest the pieces held most of, gold last.
    const left = { ...me.tokens };
    const out = noPieces();
    for (let i = 0; i < over; i++) {
      const gem = [...GEMS].sort((a, b) => left[b] - left[a])[0]!;
      const t = left[gem] > 0 ? gem : 'gold';
      left[t] -= 1;
      out[t] += 1;
    }
    return out;
  });
  const chosen = totalOf(back);
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Pieces to hand back">
      <p className="text-sm font-semibold">
        Hand back {over} {over === 1 ? 'piece' : 'pieces'} ({chosen} chosen):
      </p>
      <div className="flex flex-wrap justify-center gap-x-1 gap-y-2">
        {TOKENS.filter((t) => me.tokens[t] > 0).map((t) => (
          <span key={t} className="flex flex-col items-center gap-1">
            <TokenChip token={t} art={art} count={me.tokens[t] - back[t]} size={30} />
            <span className="flex items-center gap-0.5">
              <Button
                variant="secondary"
                size="sm"
                className="!h-7 !px-1.5"
                aria-label={`Keep one more ${TOKEN_NAME[t]}`}
                disabled={back[t] === 0}
                onClick={() => setBack({ ...back, [t]: back[t] - 1 })}
              >
                −
              </Button>
              <span
                className="w-4 text-center text-sm font-bold tabular-nums"
                aria-label={`${back[t]} ${TOKEN_NAME[t]} back`}
              >
                {back[t]}
              </span>
              <Button
                variant="secondary"
                size="sm"
                className="!h-7 !px-1.5"
                aria-label={`Hand back one more ${TOKEN_NAME[t]}`}
                disabled={back[t] >= me.tokens[t] || chosen >= over}
                onClick={() => setBack({ ...back, [t]: back[t] + 1 })}
              >
                +
              </Button>
            </span>
          </span>
        ))}
      </div>
      <Button
        disabled={chosen !== over}
        onClick={() => void act({ type: 'return', tokens: back }, { anchor: 'jw-play' })}
      >
        Hand back {chosen} of {over}
      </Button>
    </div>
  );
}

/** Buy a card (with the payment, gold editable) or reserve it. */
function CardSheet({
  id,
  view,
  me,
  art,
  act,
  onClose,
}: {
  id: string;
  view: JewellerView;
  me: PlayerView | undefined;
  art: Art;
  act: Act;
  onClose: () => void;
}) {
  const g = view.game!;
  const card = cardOf(id);
  const inMarket = LEVELS.some((l) => g.market[l].includes(id));
  const mineReserved = !!me?.reserved.some((r) => r.card === id);
  const conquest = !!me && g.stage === 'conquer' && conquestCard(g.holds, me.id) === id;
  const myTurn = !!me && view.phase === 'playing' && g.current === me.id;
  const canMove = myTurn && (g.stage === 'action' || conquest);
  const hold = g.holds[id];
  const blocked = !!me && occupiedFor(g.holds, id, me.id);
  const holder = hold && g.players.find((p) => p.id === hold.by);
  const [gold, setGold] = useState<Record<Gem, number>>(() =>
    me ? autoGold(card, me.bonuses, me.tokens) : noGems(),
  );
  const need = me ? costAfter(card, me.bonuses) : card.cost;
  const paid = me ? payment(card, me.bonuses, me.tokens, gold) : 'Not playing';
  const short = me
    ? Math.max(0, totalOf(shortfall(card, me.bonuses, me.tokens)) - me.tokens.gold)
    : 0;
  const reserveOk = canMove && !conquest && inMarket && (me?.reserved.length ?? 0) < MAX_RESERVED;
  const goldLeft = me ? me.tokens.gold - totalOf(gold) : 0;
  const run = async (action: JewellerAction) => {
    if (await act(action, { anchor: 'jw-sheet' })) onClose();
  };
  return (
    <Modal open onClose={onClose} title={cardLine(id).replace(/^a /, 'A ')}>
      <div className="flex flex-col items-center gap-3">
        <CardTile id={id} art={art} size="lg" {...(me && { hints: me })} />
        <p className="text-center text-sm text-ink-muted dark:text-stone-400">
          Owning it gives a lasting {TOKEN_NAME[card.bonus]} discount
          {card.points ? ` and ${card.points} ${card.points === 1 ? 'point' : 'points'}` : ''}.
        </p>
        {hold && inMarket && (
          <p
            className={cn(
              'w-full rounded-xl px-3 py-1.5 text-center text-sm ring-1',
              blocked
                ? 'bg-warn-soft text-warn-ink ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40'
                : 'bg-info-soft text-info-ink ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30',
            )}
          >
            🏰{' '}
            {blocked
              ? `${holder?.name ?? 'Someone'}’s ${hold.n === 1 ? 'stronghold is' : `${hold.n} strongholds are`} on this card: only they can buy or reserve it.`
              : conquest
                ? 'Conquest: all three of your strongholds are here. Buy it on top of your action, or skip it.'
                : `Your ${hold.n === 1 ? 'stronghold is' : `${hold.n} strongholds are`} here: nobody else can buy or reserve it. Buying or reserving it takes ${hold.n === 1 ? 'it' : 'them'} back.`}
          </p>
        )}
        {me && (mineReserved || inMarket) && (
          <div className="w-full rounded-xl bg-panel p-2.5 ring-1 ring-line dark:bg-stone-800/70 dark:ring-stone-700">
            <p className="mb-1.5 text-sm font-semibold">
              {blocked
                ? 'Its cost (after your discounts):'
                : short > 0
                  ? `You need ${short} more ${short === 1 ? 'piece' : 'pieces'} to buy it.`
                  : 'You pay (after your discounts):'}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {GEMS.filter((c) => card.cost[c] > 0).map((c) => (
                <li key={c} className="flex items-center gap-2">
                  <TokenChip token={c} art={art} size={22} />
                  <span className="w-28">
                    {card.cost[c]} − {me.bonuses[c]} cards = <b>{need[c]}</b>
                  </span>
                  {need[c] > 0 && short === 0 && !blocked && (
                    <span className="ml-auto flex items-center gap-1">
                      <span className="tabular-nums">{need[c] - gold[c]}</span>
                      <TokenChip token={c} art={art} size={18} />
                      <span>+</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!px-1.5"
                        aria-label={`Use one less gold for ${TOKEN_NAME[c]}`}
                        disabled={gold[c] === 0 || need[c] - gold[c] >= me.tokens[c]}
                        onClick={() => setGold({ ...gold, [c]: gold[c] - 1 })}
                      >
                        −
                      </Button>
                      <span className="tabular-nums">{gold[c]}</span>
                      <TokenChip token="gold" art={art} size={18} />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="!px-1.5"
                        aria-label={`Use one more gold for ${TOKEN_NAME[c]}`}
                        disabled={gold[c] >= need[c] || goldLeft <= 0}
                        onClick={() => setGold({ ...gold, [c]: gold[c] + 1 })}
                      >
                        +
                      </Button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {canMove && !blocked && (mineReserved || inMarket) && (
          <div className="flex w-full flex-wrap gap-2">
            <Button
              className="flex-1"
              disabled={typeof paid === 'string'}
              onClick={() => void run({ type: 'buy', card: id, gold })}
              data-testid="jw-buy"
            >
              {typeof paid === 'string'
                ? 'Can’t afford it yet'
                : totalOf(paid) === 0
                  ? 'Buy for free'
                  : `Buy for ${totalOf(paid)} ${totalOf(paid) === 1 ? 'piece' : 'pieces'}`}
            </Button>
            {inMarket && !conquest && (
              <Button
                variant="secondary"
                className="flex-1"
                disabled={!reserveOk}
                onClick={() => void run({ type: 'reserve', card: id })}
                data-testid="jw-reserve"
              >
                {(me?.reserved.length ?? 0) >= MAX_RESERVED
                  ? '3 reserved already'
                  : g.bank.gold > 0
                    ? 'Reserve + 🟡'
                    : 'Reserve (no gold left)'}
              </Button>
            )}
          </div>
        )}
        <RefusalSlot anchor="jw-sheet" />
      </div>
    </Modal>
  );
}

function DeckSheet({
  level,
  view,
  me,
  art,
  act,
  onClose,
}: {
  level: Level;
  view: JewellerView;
  me: PlayerView | undefined;
  art: Art;
  act: Act;
  onClose: () => void;
}) {
  const g = view.game!;
  const n = g.decks[level];
  const canMove = !!me && view.phase === 'playing' && g.current === me.id && g.stage === 'action';
  const full = (me?.reserved.length ?? 0) >= MAX_RESERVED;
  return (
    <Modal open onClose={onClose} title={`Level ${LEVEL_NAME[level]} deck`}>
      <div className="flex flex-col items-center gap-3">
        <CardBack level={level} art={art} count={n} className="h-40 w-28" />
        <p className="text-center text-sm text-ink-muted dark:text-stone-400">
          {n} {n === 1 ? 'card' : 'cards'} left. Reserve the top card without showing it to anyone,
          and take a gold.
        </p>
        {canMove && (
          <Button
            className="w-full"
            disabled={n === 0 || full}
            onClick={() =>
              void act({ type: 'reserve', level }, { anchor: 'jw-sheet' }).then((ok) => {
                if (ok) onClose();
              })
            }
            data-testid="jw-reserve-deck"
          >
            {full ? '3 reserved already' : `Reserve the top card${g.bank.gold > 0 ? ' + 🟡' : ''}`}
          </Button>
        )}
        <RefusalSlot anchor="jw-sheet" />
      </div>
    </Modal>
  );
}

/** The owed stronghold: where it comes from, then a tap on a highlighted card. */
function HoldPicker({
  view,
  room,
  me,
  art,
  mode,
  name,
}: {
  view: JewellerView;
  room: GameRoomInfo;
  me: PlayerView;
  art: Art;
  mode: ReturnType<typeof useHoldMode>;
  name: NameOf;
}) {
  const g = view.game!;
  const mineOn = holdsOf(g.holds, me.id);
  const canEvict = mode.moves.some((m) => m.type === 'evict');
  const choice = (from: HoldFrom, label: string, key: string) => (
    <Button
      key={key}
      variant={sameFrom(mode.from, from) ? 'primary' : 'secondary'}
      size="sm"
      aria-pressed={sameFrom(mode.from, from)}
      onClick={() => mode.setFrom(from)}
    >
      {label}
    </Button>
  );
  const hint =
    mode.from === 'evict'
      ? 'Tap a card with a lone stronghold of another player’s to send it back.'
      : 'Tap a highlighted card. Only you can buy or reserve a card you hold.';
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Place a stronghold">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <StrongholdIcon art={art.stronghold(holdColor(view, room, me.id))} size={22} />
        You bought a card: place a stronghold.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {me.strongholds > 0 &&
          choice({ from: null }, `From your supply (${me.strongholds})`, 'supply')}
        {mineOn.map((h) =>
          choice(
            { from: h.card },
            `Move from ${cardLine(h.card)
              .replace(/^a /, '')
              .replace(/ \(.*\)$/, '')}${h.n > 1 ? ` (${h.n})` : ''}`,
            h.card,
          ),
        )}
        {canEvict && choice('evict', 'Send one back', 'evict')}
      </div>
      <p className="text-xs text-ink-muted dark:text-stone-400">{hint}</p>
      {mode.from === 'evict' && (
        <p className="sr-only">
          {mode.moves
            .filter((m) => m.type === 'evict')
            .map((m) => `${name(g.holds[m.card]?.by)}: ${cardLine(m.card)}`)
            .join('; ')}
        </p>
      )}
    </div>
  );
}

/** A City side, large, with what the viewer still needs. */
function CitySheet({
  id,
  view,
  me,
  art,
  onClose,
}: {
  id: string;
  view: JewellerView;
  me: PlayerView | undefined;
  art: Art;
  onClose: () => void;
}) {
  const city = cityOf(id);
  const wants = GEMS.filter((g) => city.requires[g] > 0);
  const met = !!me?.cities.includes(id);
  const others = view.game!.players.filter((p) => p.id !== me?.id && p.cities.includes(id));
  return (
    <Modal open onClose={onClose} title={`A City: ${city.points} points`}>
      <div className="flex flex-col items-center gap-3">
        <CityTile id={id} art={art} size="lg" met={met} />
        <p className="text-center text-sm text-ink-muted dark:text-stone-400">
          Meet it at the end of your turn to finish the round: at least {city.points} points and
          {wants.length || city.any ? ' these cards (not gems):' : ' no cards at all.'}
        </p>
        <ul className="flex flex-col gap-1 text-sm">
          {wants.map((g) => (
            <li key={g} className="flex items-center gap-2">
              <TokenChip token={g} art={art} size={22} />
              {city.requires[g]} {TOKEN_NAME[g]} {city.requires[g] === 1 ? 'card' : 'cards'}
              {me && (
                <span className="text-ink-muted dark:text-stone-400">
                  (you have {me.bonuses[g]})
                </span>
              )}
            </li>
          ))}
          {city.any > 0 && (
            <li>
              {city.any} cards of one {wants.length ? 'other ' : ''}colour (
              {anyColours(city)
                .map((g) => TOKEN_NAME[g])
                .join(', ')}
              )
              {me && (
                <span className="text-ink-muted dark:text-stone-400">
                  {' '}
                  (your most: {Math.max(...anyColours(city).map((g) => me.bonuses[g]))})
                </span>
              )}
            </li>
          )}
        </ul>
        {me && (
          <p className="text-center text-sm font-semibold">
            {met
              ? 'You meet it now.'
              : `You have ${me.points} ${me.points === 1 ? 'point' : 'points'}: ${cityGap(city, me.bonuses, me.points)} to go (points and cards).`}
          </p>
        )}
        {others.length > 0 && (
          <p className="text-center text-sm">Also met by {others.map((p) => p.name).join(', ')}.</p>
        )}
        <p className="text-center text-xs text-ink-muted dark:text-stone-400">
          Only players who meet a City can win; among them, the most points wins.
        </p>
      </div>
    </Modal>
  );
}

/** The whole table: opponents, nobles, the market, the gem piles, the viewer's own area. */
export function Table({ view, room, act, art, name, showGuide }: TableProps) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === room.you);
  const playing = view.phase === 'playing';
  const mine = playing && !!me && g.current === me.id;
  const acting = mine && g.stage === 'action';
  const { staged, tap, clear } = useStaging(view, acting);
  const holding = mine && g.stage === 'hold';
  const holdMode = useHoldMode(view, room.you);
  const [sheet, setSheet] = useState<Sheet>(null);
  const others = g.players.filter((p) => p.id !== room.you);
  // Left the room and still in the game: the host may remove them.
  const away = g.players.filter((p) => p.left && !p.removed && p.id !== room.you);
  const marketIds = useMemo(
    () => LEVELS.flatMap((l) => g.market[l]).filter((c): c is string => c !== null),
    [g.market],
  );
  const fresh = useFresh(marketIds);
  const freshNoble = useFresh(me?.nobles ?? []);
  const problem = takeProblem(g.bank, staged);
  const open = me ? openMarket(g.market, g.holds, me.id) : g.market;
  const noMove =
    acting &&
    !!me &&
    !canTake(g.bank) &&
    !canReserve(me.reserved.length, open, g.decks) &&
    ![
      ...LEVELS.flatMap((l) => open[l]).filter((c): c is string => c !== null),
      ...me.reserved.flatMap((r) => (r.card ? [r.card] : [])),
    ].some((id) => canAfford(cardOf(id), me.bonuses, me.tokens));
  const conquest = mine && g.stage === 'conquer' ? conquestCard(g.holds, room.you) : null;
  const cities = !!view.settings.cities;
  const clock = g.clock;
  const strict = view.settings.timerMode === 'strict';
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const nudge =
    clock &&
    room.isHost &&
    playing &&
    (clock.reminded || offline(clock.who)) &&
    clock.who !== room.you;
  const lines = view.log
    .map((e) => ({ id: e.id, text: logLine(e, name) }))
    .filter((l): l is { id: number; text: string } => l.text !== null)
    .slice(-12)
    .reverse();
  const after = me ? totalOf(me.tokens) + staged.length - TOKEN_LIMIT : 0;

  const log = (open: boolean) => (
    <details
      className="rounded-2xl bg-card/85 px-3 py-2 text-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
      open={open}
    >
      <summary className="cursor-pointer font-semibold">Table talk</summary>
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

  const mePanel = me && (
    <section
      aria-label="Your table"
      className="flex flex-col gap-2 rounded-2xl bg-card/85 p-2.5 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-semibold">You</span>
        <span className="flex items-center gap-2">
          {me.nobles.map((n) => (
            <NobleTile key={n} id={n} art={art} className="!size-9" fresh={freshNoble(n)} />
          ))}
          <span className="text-lg font-black tabular-nums" aria-label={`${me.points} points`}>
            {me.points}★
          </span>
        </span>
      </div>
      {view.settings.strongholds && <Supply p={me} view={view} room={room} art={art} />}
      <Holdings p={me} art={art} />
      {me.reserved.length > 0 && (
        <div className="flex items-center gap-1.5" role="group" aria-label="Your reserved cards">
          <span className="text-xs text-ink-muted dark:text-stone-400">Reserved:</span>
          {me.reserved.map((r, i) =>
            r.card ? (
              <CardTile
                key={`${r.card}-${i}`}
                id={r.card}
                art={art}
                hints={me}
                afford={affordOf(r.card, me, view)}
                className="!w-14"
                onClick={() => setSheet({ kind: 'card', id: r.card! })}
              />
            ) : null,
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-2 lg:grid lg:grid-cols-[17rem_minmax(0,34rem)_minmax(0,1fr)] lg:items-start lg:gap-3">
      {/* Opponents: chips on phones, panels on desktop. */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 lg:hidden" aria-label="Players">
        {others.map((p) => (
          <PlayerChip
            key={p.id}
            p={p}
            view={view}
            room={room}
            art={art}
            onOpen={() => setSheet({ kind: 'player', id: p.id })}
          />
        ))}
      </div>
      <aside className="hidden flex-col gap-2 lg:flex" aria-label="Players">
        {mePanel}
        {others.map((p) => (
          <PlayerPanel key={p.id} p={p} view={view} room={room} art={art} />
        ))}
      </aside>

      <div className="flex min-w-0 flex-col gap-2">
        {playing && (clock?.deadline || g.finalBy) && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-ink-muted dark:text-stone-400">
              {clock ? waitingFor([clock.who], room.players, { you: room.you }) : ''}
            </span>
            {clock?.deadline && (
              <Countdown
                deadline={clock.deadline}
                clockOffset={room.clockOffset}
                label="for this turn"
                soft={!strict}
                expiredHint={
                  room.isHost ? 'You can act for them below.' : 'The host can act for them.'
                }
                atZero={strict ? 'then a safe move is made' : undefined}
              />
            )}
          </div>
        )}
        {playing && g.finalBy && (
          <p className="rounded-xl bg-warn-soft px-3 py-1 text-center text-sm font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40">
            ⚑ Final round: {g.finalBy === room.you ? 'you' : name(g.finalBy)}{' '}
            {cities ? 'met a City' : `reached ${view.settings.target}`}. {name(g.order.at(-1))}{' '}
            plays last.
          </p>
        )}
        <Flash view={view} name={name} />

        {cities ? (
          <section aria-label="Cities" className="grid grid-cols-3 gap-1.5">
            {g.cities.map((c) => (
              <CityTile
                key={c}
                id={c}
                art={art}
                met={!!me?.cities.includes(c)}
                onClick={() => setSheet({ kind: 'city', id: c })}
              />
            ))}
          </section>
        ) : (
          <section aria-label="Nobles" className="flex items-center gap-1.5 overflow-x-auto">
            {g.nobles.map((n) => (
              <NobleTile
                key={n}
                id={n}
                art={art}
                {...(me && { bonuses: me.bonuses })}
                onClick={() => setSheet({ kind: 'noble', id: n })}
              />
            ))}
            {g.nobles.length === 0 && (
              <span className="text-sm text-ink-muted dark:text-stone-400">No nobles left.</span>
            )}
          </section>
        )}

        <section aria-label="Cards for sale" className="flex flex-col gap-1.5">
          {([3, 2, 1] as const).map((l) => (
            <div
              key={l}
              className="grid grid-cols-[2.25rem_repeat(4,minmax(0,1fr))] gap-1.5 sm:grid-cols-[3.5rem_repeat(4,minmax(0,1fr))]"
            >
              <CardBack
                level={l}
                art={art}
                count={g.decks[l]}
                className="h-full min-h-12"
                onClick={() => setSheet({ kind: 'deck', level: l })}
              />
              {g.market[l].map((id, i) => {
                if (!id)
                  return (
                    <span
                      key={`empty-${i}`}
                      className="rounded-lg border border-dashed border-line dark:border-stone-700"
                      aria-label="Empty space"
                    />
                  );
                const move = holding ? holdMode.legal(id) : undefined;
                return (
                  <CardTile
                    key={id}
                    id={id}
                    art={art}
                    {...(me && { hints: me })}
                    afford={me && !holding ? affordOf(id, me, view) : null}
                    fresh={fresh(id)}
                    hold={holdInfo(view, room, art, id)}
                    target={!!move}
                    onClick={() =>
                      move
                        ? void act({ ...move }, { anchor: 'jw-play' })
                        : setSheet({ kind: 'card', id })
                    }
                  />
                );
              })}
            </div>
          ))}
        </section>

        {/* On your turn the piles sit in the action bar, so the bar never hides them. */}
        {!(acting && !noMove) && (
          <Bank view={view} art={art} staged={staged} onTap={tap} active={false} />
        )}

        <div className="lg:hidden">{mePanel}</div>

        {mine && (
          <div className="sticky bottom-2 z-10 flex flex-col gap-2 rounded-2xl bg-card p-2.5 shadow-lg ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
            {g.stage === 'return' ? (
              <ReturnPicker key={g.turns} me={me} art={art} act={act} />
            ) : g.stage === 'noble' ? (
              <div
                className="flex flex-col items-center gap-2"
                role="group"
                aria-label="Pick a noble"
              >
                <p className="text-sm font-semibold">Which noble visits you?</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {g.nobleChoice.map((n) => (
                    <NobleTile
                      key={n}
                      id={n}
                      art={art}
                      bonuses={me.bonuses}
                      size="lg"
                      onClick={() => void act({ type: 'noble', noble: n }, { anchor: 'jw-play' })}
                    />
                  ))}
                </div>
              </div>
            ) : g.stage === 'hold' ? (
              <HoldPicker view={view} room={room} me={me} art={art} mode={holdMode} name={name} />
            ) : g.stage === 'conquer' && conquest ? (
              <div className="flex flex-col items-center gap-2" role="group" aria-label="Conquest">
                <p className="text-center text-sm font-semibold">
                  🏰 Conquest! All three of your strongholds hold this card. Buy it too?
                </p>
                <CardTile
                  id={conquest}
                  art={art}
                  hints={me}
                  afford={affordOf(conquest, me)}
                  hold={holdInfo(view, room, art, conquest)}
                  className="!w-20"
                  onClick={() => setSheet({ kind: 'card', id: conquest })}
                />
                <div className="flex w-full gap-2">
                  <Button
                    className="flex-1"
                    onClick={() => setSheet({ kind: 'card', id: conquest })}
                    data-testid="jw-conquer"
                  >
                    Buy it…
                  </Button>
                  <Button
                    variant="secondary"
                    className="flex-1"
                    onClick={() => void act({ type: 'no-conquest' }, { anchor: 'jw-play' })}
                  >
                    Not now
                  </Button>
                </div>
              </div>
            ) : noMove ? (
              <Button onClick={() => void act({ type: 'pass' }, { anchor: 'jw-play' })}>
                No move is possible: pass
              </Button>
            ) : (
              <>
                <Bank view={view} art={art} staged={staged} onTap={tap} active />
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    {staged.length > 0
                      ? staged.map((s, i) => <TokenChip key={i} token={s} art={art} size={26} />)
                      : null}
                    <span className="text-xs text-ink-muted dark:text-stone-400">
                      {takeHint(view, staged)}
                      {!problem && after > 0 && ` You’ll hand back ${after} after.`}
                    </span>
                  </span>
                  {staged.length > 0 && (
                    <Button variant="ghost" size="sm" onClick={clear}>
                      Clear
                    </Button>
                  )}
                  <Button
                    disabled={!!problem}
                    onClick={() => void act({ type: 'take', gems: staged }, { anchor: 'jw-play' })}
                    data-testid="jw-take"
                  >
                    Take {staged.length || ''}
                  </Button>
                </div>
              </>
            )}
            <RefusalSlot anchor="jw-play" resetKey={view.log.at(-1)?.id ?? 0} />
          </div>
        )}

        {playing && away.length > 0 && (
          <section
            aria-label="Players who left"
            className="flex flex-col gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
          >
            <p>
              {away.map((p) => p.name).join(', ')} left the room: the table plays their turns for
              them.{' '}
              {room.isHost
                ? 'Wait for them to come back, or remove them: their pieces go back to the supply and their cards leave play.'
                : 'The host can wait for them or remove them.'}
            </p>
            {room.isHost && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {away.map((p) => (
                  <Button
                    key={p.id}
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      void act({ type: 'remove', player: p.id }, { anchor: 'jw-away' })
                    }
                  >
                    Remove {p.name}
                  </Button>
                ))}
              </div>
            )}
            <RefusalSlot anchor="jw-away" />
          </section>
        )}

        {nudge && (
          <div className="flex justify-end gap-1.5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                void act({ type: 'act-for', player: clock.who }, { anchor: 'jw-host' })
              }
            >
              Act for {name(clock.who)}
            </Button>
            <RefusalSlot anchor="jw-host" />
          </div>
        )}
        <div className="lg:hidden">{log(false)}</div>
        <p className="text-center text-xs text-ink-muted dark:text-stone-500">
          Round {g.round} · {cities ? 'Cities' : `first to ${view.settings.target}`}
          {view.settings.strongholds ? ' · Strongholds' : ''} ·{' '}
          <button type="button" className="underline" onClick={() => showGuide()}>
            rules
          </button>
        </p>
      </div>

      <aside className="hidden lg:block">{log(true)}</aside>

      {sheet?.kind === 'card' && (
        <CardSheet
          id={sheet.id}
          view={view}
          me={me}
          art={art}
          act={act}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'deck' && (
        <DeckSheet
          level={sheet.level}
          view={view}
          me={me}
          art={art}
          act={act}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'noble' && (
        <Modal open onClose={() => setSheet(null)} title={art.nobleName(sheet.id)}>
          <div className="flex flex-col items-center gap-3">
            <NobleTile id={sheet.id} art={art} size="lg" {...(me && { bonuses: me.bonuses })} />
            <p className="text-center text-sm text-ink-muted dark:text-stone-400">
              Visits the first player whose cards (not gems) meet these numbers, at the end of their
              turn: 3 points.{me ? ' The small numbers are your cards so far.' : ''}
            </p>
          </div>
        </Modal>
      )}
      {sheet?.kind === 'city' && (
        <CitySheet id={sheet.id} view={view} me={me} art={art} onClose={() => setSheet(null)} />
      )}
      {sheet?.kind === 'player' &&
        (() => {
          const p = g.players.find((x) => x.id === sheet.id);
          return p ? (
            <Modal open onClose={() => setSheet(null)} title={`${p.name}’s table`}>
              <PlayerPanel p={p} view={view} room={room} art={art} />
              <p className="mt-2 text-xs text-ink-muted dark:text-stone-400">
                {p.cards.length} {p.cards.length === 1 ? 'card' : 'cards'} bought. Reserved cards
                stay hidden unless the host shows them; you see their level.
              </p>
            </Modal>
          ) : null;
        })()}
    </div>
  );
}

/** For the first-time tips. */
export const TIPS_KEY = 'jeweller.tips.v1';
export const tipsSeen = () => {
  try {
    return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
  } catch {
    return true;
  }
};
