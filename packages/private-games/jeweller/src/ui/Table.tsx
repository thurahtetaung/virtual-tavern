import { type GameRoomInfo, storageKey, waitingFor } from '@vt/game-sdk';
import { Button, Countdown, Modal, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cardOf } from '../logic/cards.ts';
import { LEVEL_NAME, TOKEN_NAME } from '../logic/gems.ts';
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
import { type Afford, CardBack, CardTile, NobleTile, TokenChip } from './Pieces.tsx';
import { type NameOf, cardLine, logLine } from './text.ts';

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
  | null;

const affordOf = (id: string, me: PlayerView | undefined): Afford => {
  if (!me) return null;
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
  onOpen,
}: {
  p: PlayerView;
  view: JewellerView;
  room: GameRoomInfo;
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
      aria-label={`${p.name}: ${p.points} ${p.points === 1 ? 'point' : 'points'}, ${totalOf(p.tokens)} ${totalOf(p.tokens) === 1 ? 'piece' : 'pieces'}, ${p.reserved.length} reserved${current ? ', playing now' : ''}`}
      data-player={p.id}
    >
      <PlayerTag
        name={p.name}
        you={p.id === room.you}
        host={p.id === room.hostId}
        offline={room.players.find((x) => x.id === p.id)?.connected === false}
        className="max-w-24 truncate font-semibold"
      />
      <span className="font-black tabular-nums">{p.points}★</span>
      <span className="text-xs text-ink-muted tabular-nums dark:text-stone-400">
        ◆{totalOf(p.tokens)}
      </span>
      {p.reserved.length > 0 && (
        <span className="text-xs text-ink-muted dark:text-stone-400">🂠{p.reserved.length}</span>
      )}
      {p.nobles.length > 0 && <span className="text-xs">👑{p.nobles.length}</span>}
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
          {p.left && <span className="text-xs text-ink-muted dark:text-stone-400">away</span>}
          <span className="font-black tabular-nums" aria-label={`${p.points} points`}>
            {p.points}★
          </span>
        </span>
      </div>
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
  const canMove = !!me && view.phase === 'playing' && g.current === me.id && g.stage === 'action';
  const [gold, setGold] = useState<Record<Gem, number>>(() =>
    me ? autoGold(card, me.bonuses, me.tokens) : noGems(),
  );
  const need = me ? costAfter(card, me.bonuses) : card.cost;
  const paid = me ? payment(card, me.bonuses, me.tokens, gold) : 'Not playing';
  const short = me
    ? Math.max(0, totalOf(shortfall(card, me.bonuses, me.tokens)) - me.tokens.gold)
    : 0;
  const reserveOk = canMove && inMarket && (me?.reserved.length ?? 0) < MAX_RESERVED;
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
        {me && (mineReserved || inMarket) && (
          <div className="w-full rounded-xl bg-panel p-2.5 ring-1 ring-line dark:bg-stone-800/70 dark:ring-stone-700">
            <p className="mb-1.5 text-sm font-semibold">
              {short > 0
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
                  {need[c] > 0 && short === 0 && (
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
        {canMove && (mineReserved || inMarket) && (
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
            {inMarket && (
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

/** The whole table: opponents, nobles, the market, the gem piles, the viewer's own area. */
export function Table({ view, room, act, art, name, showGuide }: TableProps) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === room.you);
  const playing = view.phase === 'playing';
  const mine = playing && !!me && g.current === me.id;
  const acting = mine && g.stage === 'action';
  const { staged, tap, clear } = useStaging(view, acting);
  const [sheet, setSheet] = useState<Sheet>(null);
  const others = g.players.filter((p) => p.id !== room.you);
  const marketIds = useMemo(
    () => LEVELS.flatMap((l) => g.market[l]).filter((c): c is string => c !== null),
    [g.market],
  );
  const fresh = useFresh(marketIds);
  const freshNoble = useFresh(me?.nobles ?? []);
  const problem = takeProblem(g.bank, staged);
  const noMove =
    acting &&
    !!me &&
    !canTake(g.bank) &&
    !canReserve(me.reserved.length, g.market, g.decks) &&
    ![...marketIds, ...me.reserved.flatMap((r) => (r.card ? [r.card] : []))].some((id) =>
      canAfford(cardOf(id), me.bonuses, me.tokens),
    );
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
                afford={affordOf(r.card, me)}
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
            ⚑ Final round: {g.finalBy === room.you ? 'you' : name(g.finalBy)} reached{' '}
            {view.settings.target}. {name(g.order.at(-1))} plays last.
          </p>
        )}
        <Flash view={view} name={name} />

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
              {g.market[l].map((id, i) =>
                id ? (
                  <CardTile
                    key={id}
                    id={id}
                    art={art}
                    {...(me && { hints: me })}
                    afford={me ? affordOf(id, me) : null}
                    fresh={fresh(id)}
                    onClick={() => setSheet({ kind: 'card', id })}
                  />
                ) : (
                  <span
                    key={`empty-${i}`}
                    className="rounded-lg border border-dashed border-line dark:border-stone-700"
                    aria-label="Empty space"
                  />
                ),
              )}
            </div>
          ))}
        </section>

        <Bank view={view} art={art} staged={staged} onTap={tap} active={acting} />

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
            ) : noMove ? (
              <Button onClick={() => void act({ type: 'pass' }, { anchor: 'jw-play' })}>
                No move is possible: pass
              </Button>
            ) : (
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
            )}
            <RefusalSlot anchor="jw-play" resetKey={view.log.at(-1)?.id ?? 0} />
          </div>
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
          Round {g.round} · first to {view.settings.target} ·{' '}
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
