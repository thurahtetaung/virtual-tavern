import { type GameRoomInfo, storageKey } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Modal,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  cn,
  useConfirm,
} from '@vt/ui';
import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import {
  RANKS,
  type Rank,
  SUIT_NAME,
  SUIT_SYMBOL,
  type Suit,
  copiesOf,
  played,
  ratingOf,
  scoreOf,
} from '../logic/cards.ts';
import {
  type Clue,
  type Knowledge,
  type Possibility,
  colourChoices,
  possibleRanks,
  possibleSuits,
  touches,
} from '../logic/clues.ts';
import {
  critical,
  dead,
  knowledgeOf,
  optionsOfView,
  ownPossibilities,
} from '../logic/knowledge.ts';
import {
  CLUE_TOKENS,
  FUSES,
  type GameView,
  type LogEntry,
  REACTIONS,
  type SkyfireAction,
  type SkyfireView,
  type Slot,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { CardBack, CardFace, Marks, SUIT_STYLE, cardLabel, marksText, suitLabel } from './Card.tsx';
import { type Detail, DetailSheet } from './Details.tsx';
import { type NameOf, clueText, logLine } from './text.ts';

export type Act = (action: SkyfireAction, options?: { anchor?: string }) => Promise<boolean>;

export const TIPS_KEY = 'skyfire.tips';

export function tipsSeen(): boolean {
  try {
    return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
  } catch {
    return false;
  }
}

export interface TableProps {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  /** "You" for the viewer. */
  name: NameOf;
  showGuide: (id?: string) => void;
}

type Tab = 'table' | 'discards' | 'log';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The log's turns (clues, plays, discards). */
const isTurn = (e: LogEntry): e is Extract<LogEntry, { kind: 'clue' | 'play' | 'discard' }> =>
  e.kind === 'clue' || e.kind === 'play' || e.kind === 'discard';

/** The players in turn order from just after the viewer (everyone, from the first, for watchers). */
function othersOf(g: GameView, you: string): string[] {
  const at = g.order.indexOf(you);
  if (at < 0) return [...g.order];
  return Array.from(
    { length: g.order.length - 1 },
    (_, i) => g.order[(at + 1 + i) % g.order.length]!,
  );
}

/** The ids the latest clue touched (lit on every screen until the next turn). */
function latestClue(view: SkyfireView) {
  const last = [...view.log].reverse().find(isTurn);
  return last?.kind === 'clue' ? last : null;
}

export function Table({ view, room, act, art, name, showGuide }: TableProps) {
  const g = view.game!;
  const [tab, setTab] = useState<Tab>('table');
  const playing = view.phase === 'playing';
  const me = g.hands[room.you] ? room.you : null;
  const mine = playing && g.current === room.you && !!me;
  const [clueFor, setClueFor] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const discards = g.discards.length;
  return (
    <div className="flex flex-col gap-1.5 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-3">
      <div className="flex min-w-0 flex-col gap-1.5 lg:gap-2">
        <TopStrip view={view} art={art} room={room} name={name} onDetail={setDetail} />
        <Fireworks g={g} art={art} onDetail={setDetail} />
        <div role="tablist" aria-label="Table views" className="grid grid-cols-3 gap-1 lg:hidden">
          {(
            [
              ['table', 'Table'],
              ['discards', `Discards ${discards ? `(${discards})` : ''}`],
              ['log', 'Log'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                'rounded-lg px-2 py-1 text-sm font-semibold lg:py-1.5 ring-1 ring-line dark:ring-stone-700',
                tab === id
                  ? 'bg-accent text-accent-fg dark:bg-amber-500 dark:text-stone-950'
                  : 'bg-card dark:bg-stone-900',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={cn('flex flex-col gap-1.5 lg:gap-2', tab !== 'table' && 'hidden lg:flex')}>
          {playing && g.lastTurns && <LastRound g={g} name={name} />}
          <Teammates
            view={view}
            room={room}
            art={art}
            name={name}
            onClue={setClueFor}
            onDetail={setDetail}
            mine={mine}
          />
          <Since view={view} you={room.you} name={name} onMore={() => setTab('log')} />
          {me ? (
            <MyHand
              view={view}
              room={room}
              act={act}
              art={art}
              mine={mine}
              showGuide={showGuide}
              reactions={
                <>
                  <Reactions view={view} room={room} act={act} name={name} />
                  {playing && <ActFor view={view} room={room} act={act} name={name} />}
                </>
              }
            />
          ) : (
            <>
              <Reactions view={view} room={room} act={act} name={name} />
              {playing && <ActFor view={view} room={room} act={act} name={name} />}
            </>
          )}
        </div>
      </div>
      <aside className={cn('flex min-w-0 flex-col gap-3', tab === 'table' && 'hidden lg:flex')}>
        <div className={cn(tab === 'log' && 'hidden lg:block')}>
          <Discards view={view} art={art} onDetail={setDetail} />
        </div>
        <div className={cn('flex flex-col gap-2', tab === 'discards' && 'hidden lg:flex')}>
          <Log view={view} you={room.you} name={name} />
          {playing && <EndShow room={room} act={act} />}
        </div>
      </aside>
      {detail && (
        <DetailSheet
          detail={detail}
          view={view}
          art={art}
          name={name}
          you={room.you}
          canClue={mine && g.clues > 0}
          onClue={(id) => {
            setDetail(null);
            setClueFor(id);
          }}
          onClose={() => setDetail(null)}
        />
      )}
      {clueFor && (
        <ClueSheet
          view={view}
          room={room}
          act={act}
          art={art}
          to={clueFor}
          name={name}
          mine={mine}
          onClose={() => setClueFor(null)}
        />
      )}
    </div>
  );
}

// ---- Tokens, deck, score and clock ----

function TopStrip({
  view,
  art,
  room,
  name,
  onDetail,
}: {
  view: SkyfireView;
  art: Art;
  room: GameRoomInfo;
  name: NameOf;
  onDetail: (d: Detail) => void;
}) {
  const g = view.game!;
  const score = scoreOf(g.fireworks);
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-2xl bg-panel px-3 py-1.5 text-sm sm:gap-x-3 sm:py-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700">
      <button
        type="button"
        onClick={() => onDetail({ kind: 'clues' })}
        className="flex items-center gap-0.5"
        aria-label={`${g.clues} of ${CLUE_TOKENS} clue tokens`}
        data-testid="sf-clues"
        data-clues={g.clues}
      >
        {art.clue ? (
          <ProtectedImage src={art.clue} alt="" className="h-5 w-auto" />
        ) : (
          <span aria-hidden>💡</span>
        )}
        <span aria-hidden className="hidden gap-0.5 sm:flex">
          {Array.from({ length: CLUE_TOKENS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'size-2.5 rounded-full ring-1',
                i < g.clues
                  ? 'bg-info-ink ring-info-ink dark:bg-sky-300 dark:ring-sky-300'
                  : 'bg-transparent ring-line-strong dark:ring-stone-600',
              )}
            />
          ))}
        </span>
        <span className="ml-1 font-semibold tabular-nums">{g.clues}</span>
      </button>
      <button
        type="button"
        onClick={() => onDetail({ kind: 'fuses' })}
        className="flex items-center gap-0.5"
        aria-label={`${g.fuses} of ${FUSES} fuses burned`}
        data-testid="sf-fuses"
        data-fuses={g.fuses}
      >
        {Array.from({ length: FUSES }, (_, i) => {
          const burned = i < g.fuses;
          const src = art.fuse(i, burned);
          return src ? (
            <ProtectedImage key={i} src={src} alt="" className="h-6 w-auto" />
          ) : (
            <span key={i} aria-hidden className={cn(!burned && 'opacity-70')}>
              {burned ? '💥' : '🧨'}
            </span>
          );
        })}
      </button>
      <button
        type="button"
        onClick={() => onDetail({ kind: 'deck' })}
        className="tabular-nums"
        aria-label={`${g.deck} cards in the deck`}
        data-testid="sf-deck"
      >
        🂠 {g.deck}
      </button>
      <span className="ml-auto font-semibold tabular-nums" data-testid="sf-score">
        {score}{' '}
        <span className="font-normal text-ink-muted dark:text-stone-400">
          / {g.max}
          <span className="hidden sm:inline"> · {ratingOf(score, g.max)}</span>
        </span>
      </span>
      {view.phase === 'playing' && <Clock view={view} room={room} name={name} />}
    </div>
  );
}

function Clock({ view, room, name }: { view: SkyfireView; room: GameRoomInfo; name: NameOf }) {
  const g = view.game!;
  if (!g.clock?.deadline) return null;
  const whose = g.clock.who === room.you ? 'for your turn' : `for ${name(g.clock.who)}’s turn`;
  return (
    // On phones the clock keeps to the strip's one line: the time alone (the label stays for
    // screen readers, and the host's Act for button says what a soft clock allows).
    <div className="text-xs max-sm:[&_[aria-hidden]]:hidden max-sm:[&_[role=timer]>span+span]:hidden max-sm:[&_[role=timer]]:py-0 sm:text-sm">
      {view.settings.timerMode === 'strict' ? (
        <Countdown
          deadline={g.clock.deadline}
          clockOffset={room.clockOffset}
          label={whose}
          atZero="then the app makes a safe move"
        />
      ) : (
        <Countdown
          deadline={g.clock.deadline}
          clockOffset={room.clockOffset}
          label={whose}
          soft
          expiredHint={
            room.isHost
              ? 'Time’s up: you can act for them.'
              : 'Time’s up: the host can act for them.'
          }
        />
      )}
    </div>
  );
}

// ---- Fireworks ----

function Fireworks({ g, art, onDetail }: { g: GameView; art: Art; onDetail: (d: Detail) => void }) {
  return (
    <ul aria-label="Fireworks" className="flex justify-between gap-1 sm:justify-start sm:gap-2">
      {g.suits.map((suit) => {
        const h = g.fireworks[suit] ?? 0;
        const top = h ? ((suit === 'black' ? 6 - h : h) as Rank) : null;
        const bg = art.suit(suit);
        return (
          <li key={suit}>
            <button
              type="button"
              onClick={() => onDetail({ kind: 'firework', suit })}
              className="relative flex flex-col items-center gap-0.5"
              aria-label={`${SUIT_NAME[suit]} firework: ${h} of 5${h === 5 ? ', finished' : ''}`}
              data-testid={`sf-firework-${suit}`}
              data-height={h}
            >
              {top ? (
                <CardFace
                  card={{ suit, rank: top }}
                  art={art}
                  size="stack"
                  className={cn(h === 5 && 'ring-2 ring-warn-line dark:ring-amber-300')}
                />
              ) : (
                <span
                  className="relative flex aspect-[5/7] w-8 items-center justify-center overflow-hidden rounded-md text-lg ring-2 ring-dashed sm:w-14"
                  style={{
                    borderColor: 'transparent',
                    boxShadow: `inset 0 0 0 2px ${suit === 'multi' ? '#9a8fb0' : SUIT_STYLE[suit].bg}55`,
                  }}
                >
                  {bg && (
                    <ProtectedImage
                      src={bg}
                      alt=""
                      className="absolute inset-0 size-full object-cover opacity-40"
                    />
                  )}
                  <span aria-hidden className="relative opacity-70">
                    {SUIT_SYMBOL[suit]}
                  </span>
                </span>
              )}
              <span className="hidden text-xs tabular-nums text-ink-muted sm:inline dark:text-stone-400">
                {SUIT_SYMBOL[suit]} {h}/5
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

// ---- The last round ----

function LastRound({ g, name }: { g: GameView; name: NameOf }) {
  const turns = g.lastTurns ?? [];
  const names = turns.map((id) => name(id));
  const list =
    names.length > 1 ? `${names.slice(0, -1).join(', ')}, then ${names.at(-1)}` : names[0];
  return (
    <p
      className="hidden rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn-ink lg:block ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30"
      data-testid="sf-last-round"
    >
      ⏳ Last round: {list} {turns.length === 1 ? 'has the final turn' : 'have one turn each'}.
    </p>
  );
}

// ---- The other hands ----

function Teammates({
  view,
  room,
  art,
  onClue,
  onDetail,
  mine,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  art: Art;
  name: NameOf;
  onClue: (id: string) => void;
  onDetail: (d: Detail) => void;
  mine: boolean;
}) {
  const g = view.game!;
  const clue = latestClue(view);
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const others = othersOf(g, room.you);
  const width = Math.max(...others.map((id) => g.hands[id]!.length), 4);
  return (
    <ul
      aria-label="The other hands"
      className="flex flex-col gap-0.5 lg:grid lg:grid-cols-2 lg:gap-2"
    >
      {others.map((id) => {
        const p = g.players.find((x) => x.id === id)!;
        const hand = g.hands[id]!;
        const current = view.phase === 'playing' && g.current === id;
        return (
          <li
            key={id}
            className={cn(
              'grid w-full grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 rounded-xl bg-card px-2 py-0.5 ring-1 sm:py-1 ring-line sm:grid-cols-[6rem_minmax(0,1fr)] dark:bg-stone-900 dark:ring-stone-700',
              current && 'ring-2 ring-accent dark:ring-amber-500',
            )}
            data-testid={`sf-hand-${id}`}
          >
            <button
              type="button"
              onClick={() => onClue(id)}
              className="flex min-w-0 flex-col self-stretch rounded-lg text-left text-xs hover:bg-panel sm:text-sm dark:hover:bg-stone-800"
              aria-label={`${p.name}${current ? ', on turn' : ''}. ${mine && g.clues > 0 ? 'Give them a clue.' : 'See what they know.'}`}
              data-testid="sf-clue-open"
            >
              <span className="flex items-center gap-1">
                {current && <span aria-hidden>▸</span>}
                <PlayerTag
                  name={p.name}
                  host={id === room.hostId}
                  offline={offline(id) || p.left}
                  className="min-w-0"
                />
              </span>
              <span className="text-[10px] text-ink-muted dark:text-stone-400">
                {mine && g.clues > 0 ? '💡 clue' : 'what they know'}
              </span>
            </button>
            <span
              className="grid gap-1"
              style={{
                gridTemplateColumns: `repeat(${width}, minmax(0, clamp(2.2rem, 9.5vw, 4rem)))`,
              }}
            >
              {hand.map((s) => {
                const lit = clue?.to === id && clue.touched.includes(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() =>
                      s.card && onDetail({ kind: 'card', card: s.card, holder: id, id: s.id })
                    }
                    className="flex min-w-0 flex-col items-center gap-0.5 rounded-md"
                    aria-label={`${p.name}’s ${s.card ? cardLabel(s.card) : 'card'}${s.know && marksText(s.know) ? `, told: ${marksText(s.know)}` : ''}`}
                    data-card={s.id}
                  >
                    {s.card && (
                      <CardFace
                        card={s.card}
                        art={art}
                        size="row"
                        className={cn(lit && 'sf-lit ring-[3px] ring-accent dark:ring-amber-400')}
                      />
                    )}
                    <Marks know={s.know} compact />
                  </button>
                );
              })}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ---- Giving a clue ----

function ClueSheet({
  view,
  act,
  art,
  to,
  name,
  mine,
  onClose,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  to: string;
  name: NameOf;
  mine: boolean;
  onClose: () => void;
}) {
  const g = view.game!;
  const hand = g.hands[to] ?? [];
  const o = optionsOfView(view);
  const [pick, setPick] = useState<Clue | null>(null);
  const [busy, setBusy] = useState(false);
  const canClue = mine && g.clues > 0;
  const options: Clue[] = [
    ...colourChoices(view.settings.multi)
      .filter((c) => g.suits.includes(c))
      .map((colour): Clue => ({ colour })),
    ...RANKS.map((rank): Clue => ({ rank })),
  ];
  const hits = (c: Clue) => hand.filter((s) => s.card && touches(c, s.card, o.multi));
  const touched = pick ? new Set(hits(pick).map((s) => s.id)) : null;
  const send = async () => {
    if (!pick) return;
    setBusy(true);
    const ok = await act({ type: 'clue', to, ...pick }, { anchor: 'sf-clue' });
    setBusy(false);
    if (ok) onClose();
  };
  const who = name(to);
  return (
    <Modal
      open
      onClose={onClose}
      title={canClue ? `Clue ${who}` : `What ${who} knows`}
      footer={
        canClue ? (
          <div className="flex flex-col gap-2">
            <Button
              size="lg"
              className="w-full"
              disabled={!pick || busy}
              onClick={() => void send()}
              data-testid="sf-send-clue"
            >
              {pick
                ? `Tell ${who}: ${clueText(pick)} · ${plural(touched!.size, 'card')} (💡 −1)`
                : 'Pick a colour or a number'}
            </Button>
            <RefusalSlot anchor="sf-clue" />
          </div>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-3">
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(hand.length, 4)}, minmax(0, 4.5rem))` }}
        >
          {hand.map((s) => (
            <span key={s.id} className="flex min-w-0 flex-col items-center gap-1">
              {s.card && (
                <CardFace
                  card={s.card}
                  art={art}
                  size="row"
                  className={cn(
                    touched?.has(s.id) && 'ring-[3px] ring-accent dark:ring-amber-400',
                    touched && !touched.has(s.id) && 'opacity-45',
                  )}
                />
              )}
              <Marks know={s.know} />
            </span>
          ))}
        </div>
        {!view.settings.memory || view.settings.memory !== 'memory' ? (
          <p className="text-xs text-ink-muted dark:text-stone-400">
            Under each card: what {who} has been told about it (✕ is what it isn’t).
          </p>
        ) : (
          <p className="text-xs text-ink-muted dark:text-stone-400">
            The table plays from memory: no marks.
          </p>
        )}
        {canClue ? (
          <>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colours">
              {options
                .filter((c) => c.colour)
                .map((c) => {
                  const n = hits(c).length;
                  const off = n === 0 && !view.settings.zeroClues;
                  const on = pick?.colour === c.colour;
                  const st = SUIT_STYLE[c.colour!];
                  return (
                    <button
                      key={c.colour}
                      type="button"
                      disabled={off}
                      aria-pressed={on}
                      onClick={() => setPick(c)}
                      className={cn(
                        'flex min-w-16 flex-col items-center rounded-lg px-2 py-1 text-sm font-bold ring-1 ring-black/20 disabled:opacity-35',
                        on && 'ring-[3px] ring-accent dark:ring-amber-400',
                      )}
                      style={{
                        background: st.bg,
                        color: st.fg,
                        textShadow: c.colour === 'multi' ? '0 1px 2px rgba(0,0,0,.7)' : undefined,
                      }}
                      data-testid={`sf-clue-${c.colour}`}
                    >
                      <span>{suitLabel(c.colour!)}</span>
                      <span className="text-[10px] font-semibold">
                        {n ? plural(n, 'card') : 'none'}
                      </span>
                    </button>
                  );
                })}
            </div>
            <div className="grid grid-cols-5 gap-1.5" role="group" aria-label="Numbers">
              {options
                .filter((c) => c.rank)
                .map((c) => {
                  const n = hits(c).length;
                  const off = n === 0 && !view.settings.zeroClues;
                  const on = pick?.rank === c.rank;
                  return (
                    <button
                      key={c.rank}
                      type="button"
                      disabled={off}
                      aria-pressed={on}
                      onClick={() => setPick(c)}
                      className={cn(
                        'flex flex-col items-center rounded-lg bg-card px-2 py-1 font-black tabular-nums ring-1 ring-line disabled:opacity-35 dark:bg-stone-800 dark:ring-stone-600',
                        on && 'ring-[3px] ring-accent dark:ring-amber-400',
                      )}
                      data-testid={`sf-clue-${c.rank}`}
                    >
                      <span className="text-lg">{c.rank}</span>
                      <span className="text-[10px] font-semibold">
                        {n ? plural(n, 'card') : 'none'}
                      </span>
                    </button>
                  );
                })}
            </div>
            {view.settings.multi === 'wild' && (
              <p className="text-xs text-ink-muted dark:text-stone-400">
                Multicolour is wild: every colour clue touches it too, and it can’t be named.
              </p>
            )}
            {view.settings.black && (
              <p className="text-xs text-ink-muted dark:text-stone-400">
                Black cards are colourless: only number clues touch them.
              </p>
            )}
            {pick && touched!.size === 0 && (
              <p className="text-xs text-warn-ink dark:text-amber-300">
                This clue touches no card: it tells {who} they have none.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-ink-muted dark:text-stone-400">
            {view.phase !== 'playing'
              ? 'The show is over.'
              : !mine
                ? 'You can give a clue on your turn.'
                : 'No clue tokens left: play or discard a card.'}
          </p>
        )}
      </div>
    </Modal>
  );
}

// ---- Your hand ----

/** What the viewer knows of one of their cards: suits and numbers it may be. */
function knownOf(view: SkyfireView, me: string, slot: Slot) {
  const o = optionsOfView(view);
  const k: Knowledge = knowledgeOf(view, me, slot.id);
  const full = view.settings.memory === 'full';
  const poss: Possibility[] | null = full ? ownPossibilities(view, me, slot.id) : null;
  const suits = poss ? [...new Set(poss.map((p) => p.suit))] : possibleSuits(k, o);
  const ranks = poss ? [...new Set(poss.map((p) => p.rank))] : possibleRanks(k);
  return {
    k,
    poss,
    suit: suits.length === 1 ? suits[0]! : null,
    rank: ranks.length === 1 ? ranks[0]! : null,
  };
}

function MyHand({
  view,
  room,
  act,
  art,
  mine,
  showGuide,
  reactions,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  mine: boolean;
  showGuide: (id?: string) => void;
  reactions: ReactNode;
}) {
  const g = view.game!;
  const me = room.you;
  const hand = g.hands[me]!;
  const memory = view.settings.memory === 'memory';
  const [open, setOpen] = useState<string | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // The order just dropped, shown until the server's next view of this hand arrives.
  const [dropped, setDropped] = useState<{ from: string; order: string[] } | null>(null);
  const refs = useRef<Map<string, HTMLElement>>(new Map());
  // Clues the viewer can still see that touched their cards (playing from memory: the log's).
  const lit = new Set(
    view.log
      .filter((e) => e.kind === 'clue' && e.to === me)
      .flatMap((e) => (e.kind === 'clue' ? e.touched : [])),
  );
  const latest = latestClue(view);
  const served = hand.map((s) => s.id);
  if (dropped && dropped.from !== served.join()) setDropped(null);
  const order = dropped?.from === served.join() ? dropped.order : served;
  const slots = order.map((id) => hand.find((s) => s.id === id)!);

  // The cards never move in the page while one is dragged (moving the node would drop the
  // pointer): the dragged card follows the finger and the others slide aside with a transform.
  const down = (e: ReactPointerEvent, id: string) => {
    if (view.phase !== 'playing' || drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const centres = order.map((x) => {
      const r = refs.current.get(x)?.getBoundingClientRect();
      return r ? r.left + r.width / 2 : 0;
    });
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const from = order.indexOf(id);
    setDrag({
      id,
      pointer: e.pointerId,
      x0: e.clientX,
      dx: 0,
      moved: false,
      from,
      over: from,
      centres,
    });
  };
  const move = (e: ReactPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    const dx = e.clientX - drag.x0;
    const moved = drag.moved || Math.abs(dx) > 8;
    if (!moved) return;
    const x = drag.centres[drag.from]! + dx;
    let over = 0;
    drag.centres.forEach((c, i) => {
      if (Math.abs(x - c) < Math.abs(x - drag.centres[over]!)) over = i;
    });
    setDrag({ ...drag, dx, moved, over });
  };
  const up = (e: ReactPointerEvent) => {
    if (!drag || e.pointerId !== drag.pointer) return;
    setDrag(null);
    if (!drag.moved) {
      setOpen(drag.id);
      return;
    }
    const next = moveTo(order, drag.id, drag.over);
    if (next.join() === order.join()) return;
    setDropped({ from: served.join(), order: next });
    void act({ type: 'reorder', order: next }, { anchor: 'sf-hand' }).then((ok) => {
      if (!ok) setDropped(null);
    });
  };
  /** Where a card sits while another is dragged. */
  const shift = (id: string, i: number): string | undefined => {
    if (!drag?.moved) return undefined;
    if (id === drag.id) return `translateX(${drag.dx}px) scale(1.05)`;
    const step = (drag.centres[1] ?? 0) - (drag.centres[0] ?? 0);
    if (drag.from < i && i <= drag.over) return `translateX(${-step}px)`;
    if (drag.over <= i && i < drag.from) return `translateX(${step}px)`;
    return undefined;
  };

  return (
    <section
      aria-label="Your hand"
      className={cn(
        'flex flex-col gap-1.5 rounded-2xl bg-panel p-2 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
        // Pinned to the bottom of a phone screen during play, so your hand is always in reach.
        view.phase === 'playing' && 'sticky bottom-1 z-10 shadow-lg lg:static lg:shadow-none',
        mine && 'ring-2 ring-accent dark:ring-amber-500',
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-ink-muted dark:text-stone-400">
        <span className="hidden font-semibold text-ink sm:inline dark:text-stone-200">
          Your hand
        </span>
        {reactions}
      </div>
      <div
        className="grid gap-1.5 [--sf-hand-card:3.75rem] sm:[--sf-hand-card:4.75rem]"
        style={{
          gridTemplateColumns: `repeat(${Math.max(hand.length, 4)}, minmax(0, var(--sf-hand-card)))`,
          touchAction: 'pan-y',
        }}
        data-testid="sf-my-hand"
      >
        {slots.map((s, i) => {
          const kn = knownOf(view, me, s);
          const isLit =
            (latest?.to === me && latest.touched.includes(s.id)) || (memory && lit.has(s.id));
          return (
            <button
              key={s.id}
              type="button"
              ref={(el) => {
                if (el) refs.current.set(s.id, el);
                else refs.current.delete(s.id);
              }}
              onPointerDown={(e) => down(e, s.id)}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={() => setDrag(null)}
              onLostPointerCapture={(e) => {
                if (drag?.pointer === e.pointerId) setDrag(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpen(s.id);
                }
              }}
              className={cn(
                'flex min-w-0 touch-pan-y flex-col items-center gap-0.5 rounded-md select-none focus-visible:outline-2 focus-visible:outline-accent',
                drag?.moved &&
                  (drag.id === s.id
                    ? 'relative z-20 cursor-grabbing opacity-90 drop-shadow-lg'
                    : 'transition-transform duration-150'),
              )}
              style={{ transform: shift(s.id, i) }}
              aria-label={`Card ${i + 1} from the left${marksText(kn.k) && !memory ? `: ${marksText(kn.k)}` : ''}`}
              data-testid={`sf-mine-${i}`}
              data-card={s.id}
            >
              {s.card ? (
                // The show is over: your own cards at last.
                <CardFace card={s.card} art={art} size="hand" />
              ) : (
                <CardBack
                  art={art}
                  suit={memory ? null : kn.suit}
                  rank={memory ? null : kn.rank}
                  size="hand"
                  className={cn(isLit && 'sf-lit ring-[3px] ring-accent dark:ring-amber-400')}
                />
              )}
              {!memory && <Marks know={kn.k} poss={kn.poss} />}
            </button>
          );
        })}
      </div>
      <p className="hidden text-xs text-ink-muted sm:block dark:text-stone-400">
        {mine
          ? 'Tap a card to play or discard it · drag to reorder'
          : 'Drag to reorder · new cards arrive on the left'}
      </p>
      <RefusalSlot anchor="sf-hand" />
      {open && hand.some((s) => s.id === open) && (
        <CardSheet
          view={view}
          act={act}
          art={art}
          slot={hand.find((s) => s.id === open)!}
          index={order.indexOf(open)}
          mine={mine}
          me={me}
          onMove={(dir) => {
            const at = order.indexOf(open);
            const next = moveTo(order, open, Math.max(0, Math.min(order.length - 1, at + dir)));
            void act({ type: 'reorder', order: next }, { anchor: 'sf-hand' });
          }}
          onClose={() => setOpen(null)}
          showGuide={showGuide}
        />
      )}
    </section>
  );
}

interface Drag {
  id: string;
  pointer: number;
  x0: number;
  dx: number;
  moved: boolean;
  from: number;
  over: number;
  /** The cards' centres when the drag began, in hand order. */
  centres: number[];
}

function moveTo(order: readonly string[], id: string, to: number): string[] {
  const rest = order.filter((x) => x !== id);
  rest.splice(to, 0, id);
  return rest;
}

function CardSheet({
  view,
  act,
  art,
  slot,
  index,
  mine,
  me,
  onMove,
  onClose,
  showGuide,
}: {
  view: SkyfireView;
  act: Act;
  art: Art;
  slot: Slot;
  index: number;
  mine: boolean;
  me: string;
  onMove: (dir: number) => void;
  onClose: () => void;
  showGuide: (id?: string) => void;
}) {
  const g = view.game!;
  const memory = view.settings.memory === 'memory';
  const kn = knownOf(view, me, slot);
  const [busy, setBusy] = useState(false);
  const canDiscard = g.clues < CLUE_TOKENS;
  const n = g.hands[me]!.length;
  const send = async (type: 'play' | 'discard') => {
    setBusy(true);
    const ok = await act({ type, card: slot.id }, { anchor: 'sf-card' });
    setBusy(false);
    if (ok) onClose();
  };
  const told = marksText(kn.k);
  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={`Your card ${index + 1} of ${n}`}
      footer={
        <div className="flex flex-col gap-2">
          {mine ? (
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="lg"
                disabled={busy}
                onClick={() => void send('play')}
                data-testid="sf-play"
              >
                🎆 Play it
              </Button>
              <Button
                size="lg"
                variant="secondary"
                disabled={busy || !canDiscard}
                onClick={() => void send('discard')}
                data-testid="sf-discard"
              >
                🗑️ Discard (+💡)
              </Button>
            </div>
          ) : (
            <p className="text-sm text-ink-muted dark:text-stone-400">
              You can play or discard it on your turn.
            </p>
          )}
          {mine && !canDiscard && (
            <p className="text-xs text-ink-muted dark:text-stone-400">
              All 8 clue tokens are back: you can’t discard now.
            </p>
          )}
          <RefusalSlot anchor="sf-card" />
          <div className="flex justify-between gap-2">
            <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => onMove(-1)}>
              ◀ Move left
            </Button>
            <Button variant="ghost" size="sm" disabled={index === n - 1} onClick={() => onMove(1)}>
              Move right ▶
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex items-start gap-3">
        <CardBack
          art={art}
          suit={memory ? null : kn.suit}
          rank={memory ? null : kn.rank}
          size="stack"
          className="w-28 shrink-0"
        />
        <div className="flex flex-col gap-1.5 text-sm">
          {memory ? (
            <p>The table plays from memory: think back to the clues you were given.</p>
          ) : told ? (
            <p>
              <span className="font-semibold">Clues: </span>
              {told}.
            </p>
          ) : (
            <p>No clue has touched this card yet.</p>
          )}
          {kn.poss && (
            <p data-testid="sf-could-be">
              <span className="font-semibold">It could be: </span>
              {kn.poss
                .map(
                  (p) => `${SUIT_NAME[p.suit]} ${p.rank}${p.left > 1 ? ` (${p.left} left)` : ''}`,
                )
                .join(', ')}
              .
            </p>
          )}
          {mine && (
            <p className="text-ink-muted dark:text-stone-400">
              Playing it is final: if it isn’t the next number of its colour, a fuse burns.{' '}
              <button type="button" className="underline" onClick={() => showGuide()}>
                Rules
              </button>
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---- What happened since your last turn ----

function Since({
  view,
  you,
  name,
  onMore,
}: {
  view: SkyfireView;
  you: string;
  name: NameOf;
  onMore: () => void;
}) {
  const turns = view.log.filter(
    (e) => isTurn(e) || e.kind === 'last-round' || e.kind === 'left' || e.kind === 'back',
  );
  let from = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const e = turns[i]!;
    if (isTurn(e) && e.by === you) {
      from = i + 1;
      break;
    }
  }
  const recent = turns.slice(from).slice(-4);
  if (!recent.length) return null;
  return (
    <button
      type="button"
      onClick={onMore}
      className="flex flex-col gap-0.5 rounded-xl bg-card px-3 py-1.5 text-left text-xs ring-1 ring-line lg:pointer-events-none dark:bg-stone-900 dark:ring-stone-700"
      aria-label="Since your last turn (open the log)"
      data-testid="sf-since"
    >
      <span className="hidden font-semibold text-ink-muted lg:inline dark:text-stone-400">
        Since your last turn
      </span>
      {recent.map((e, i) => (
        <span key={e.id} className={cn(i < recent.length - 2 && 'hidden lg:inline')}>
          {logLine(e, name, you)}
        </span>
      ))}
    </button>
  );
}

// ---- Reactions ----

function Reactions({
  view,
  room,
  act,
  name,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const g = view.game!;
  const last = [...view.log].reverse().find((e) => isTurn(e) || e.kind === 'end');
  const player = !!g.hands[room.you];
  if (!last) return null;
  const here = view.reactions.filter((r) => r.to === last.id);
  const mineNow = here.find((r) => r.by === room.you)?.emoji;
  return (
    <div className="flex min-w-0 items-center gap-1 sm:gap-1.5" aria-label="Reactions">
      {player &&
        REACTIONS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            aria-pressed={mineNow === emoji}
            aria-label={`React ${emoji}`}
            onClick={() => void act({ type: 'react', emoji }, { anchor: 'sf-react' })}
            className={cn(
              'shrink-0 rounded-full bg-card px-1.5 py-0.5 text-base leading-tight ring-1 ring-line transition hover:scale-110 dark:bg-stone-900 dark:ring-stone-700',
              mineNow === emoji && 'ring-2 ring-accent dark:ring-amber-400',
            )}
          >
            {emoji}
          </button>
        ))}
      {here.length > 0 && (
        <span
          className="min-w-0 truncate text-xs text-ink-muted dark:text-stone-400"
          title={here.map((r) => `${name(r.by)} ${r.emoji}`).join(' · ')}
          data-testid="sf-reactions"
        >
          {here.map((r) => `${name(r.by)} ${r.emoji}`).join(' · ')}
        </span>
      )}
      <RefusalSlot anchor="sf-react" />
    </div>
  );
}

// ---- The host ----

/** The host plays a safe move for whoever is on turn once their clock ran out or they are away. */
function ActFor({
  view,
  room,
  act,
  name,
}: {
  view: SkyfireView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const g = view.game!;
  if (!room.isHost) return null;
  const current = g.players.find((p) => p.id === g.current);
  const away = current?.left || room.players.find((p) => p.id === g.current)?.connected === false;
  if (g.current === room.you || !(g.clock?.reminded || away)) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void act({ type: 'act-for', player: g.current }, { anchor: 'sf-host' })}
      >
        Act for {name(g.current)}
        <span className="hidden sm:inline">&nbsp;(safe move)</span>
      </Button>
      <RefusalSlot anchor="sf-host" />
    </div>
  );
}

/** The host's End the show, under the log (its own tab on phones). */
function EndShow({ room, act }: { room: GameRoomInfo; act: Act }) {
  const [confirm, dialog] = useConfirm();
  if (!room.isHost) return null;
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {dialog}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          void (async () => {
            if (
              await confirm({
                title: 'End the show now?',
                body: 'It ends as it stands, as “ended early”: the fireworks so far are its score, with no win and no room record.',
                confirmLabel: 'End the show',
                danger: true,
              })
            )
              void act({ type: 'end-game' }, { anchor: 'sf-end' });
          })()
        }
        data-testid="sf-end-game"
      >
        End the show
      </Button>
      <RefusalSlot anchor="sf-end" />
    </div>
  );
}

// ---- Discards ----

export function Discards({
  view,
  art,
  onDetail,
}: {
  view: SkyfireView;
  art: Art;
  onDetail: (d: Detail) => void;
}) {
  const g = view.game!;
  const o = optionsOfView(view);
  const count = (suit: Suit, rank: Rank) =>
    g.discards.filter((d) => d.card.suit === suit && d.card.rank === rank).length;
  return (
    <section
      className="flex flex-col gap-2 rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
      aria-label="Discards"
      data-testid="sf-discards"
    >
      <h3 className="flex items-baseline justify-between text-sm font-semibold">
        <span>Discards ({g.discards.length})</span>
        <span className="text-xs font-normal text-ink-muted dark:text-stone-400">
          ! last copy left · ✕ all gone
        </span>
      </h3>
      <table className="w-full text-center text-xs">
        <thead>
          <tr className="text-ink-muted dark:text-stone-400">
            <th className="w-8" />
            {RANKS.map((r) => (
              <th key={r} className="font-semibold">
                {r}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {g.suits.map((suit) => (
            <tr key={suit}>
              <th className="text-base" aria-label={SUIT_NAME[suit]}>
                <span
                  className="rounded px-1"
                  style={{ background: SUIT_STYLE[suit].bg, color: SUIT_STYLE[suit].fg }}
                >
                  {SUIT_SYMBOL[suit]}
                </span>
              </th>
              {RANKS.map((rank) => {
                const total = copiesOf(suit, rank, o);
                const gone = count(suit, rank);
                const card = { suit, rank };
                const onFirework = played(suit, rank, g.fireworks[suit] ?? 0);
                const isDead = dead(card, g, o);
                const last = !onFirework && !isDead && critical(card, g, o) && total - gone === 1;
                const lost = gone >= total && !onFirework;
                return (
                  <td key={rank} className="p-0.5">
                    <button
                      type="button"
                      onClick={() => onDetail({ kind: 'card', card, where: 'discards' })}
                      className={cn(
                        'flex h-7 w-full items-center justify-center gap-0.5 rounded tabular-nums',
                        lost &&
                          'bg-danger-soft font-bold text-danger-ink dark:bg-red-500/15 dark:text-red-300',
                        last &&
                          'bg-warn-soft font-bold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/30',
                        !lost &&
                          !last &&
                          onFirework &&
                          'text-ink-muted opacity-60 dark:text-stone-500',
                      )}
                      title={`${SUIT_NAME[suit]} ${rank}: ${gone} of ${total} discarded`}
                    >
                      {gone > 0 && <CardFace card={card} art={art} size="mini" className="w-4" />}
                      {gone > 0 ? `${gone}/${total}` : onFirework ? '✓' : '·'}
                      {lost ? ' ✕' : last ? ' !' : ''}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---- Log ----

function Log({ view, you, name }: { view: SkyfireView; you: string; name: NameOf }) {
  const entries = [...view.log].reverse();
  return (
    <section
      className="flex flex-col gap-1 rounded-2xl bg-panel p-3 ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700"
      aria-label="Log"
    >
      <h3 className="text-sm font-semibold">Log</h3>
      {view.settings.memory === 'memory' && view.phase === 'playing' && (
        <p className="text-xs text-ink-muted dark:text-stone-400">
          Playing from memory: clues drop out of your log after your next turn.
        </p>
      )}
      <ol className="flex max-h-[28rem] flex-col gap-1 overflow-y-auto text-xs">
        {entries.map((e) => (
          <li
            key={e.id}
            className={cn(e.kind === 'play' && !e.ok && 'text-danger-ink dark:text-red-300')}
          >
            {logLine(e, name, you)}
          </li>
        ))}
      </ol>
    </section>
  );
}
