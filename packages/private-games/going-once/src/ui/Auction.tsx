import type { Drawing, GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  type TabBarItem,
  cn,
  tabPanelProps,
  useSecondsLeft,
} from '@vt/ui';
import { LowEffectsNotice } from '@vt/ui/show';
import { type ReactNode, useEffect, useState } from 'react';
import { money } from '../logic/lines.ts';
import { fillNames } from '../logic/names.ts';
import { closeMs } from '../logic/game.ts';
import { BID_SETTLE_MS, type GoingOnceView, type LotResult, PAIR_TOTAL } from '../logic/types.ts';
import { drewIt } from '../logic/view.ts';
import { BidLadder, Paddle, PsstBubble, SenderIcon } from './Extras.tsx';
import type { Act } from './act.ts';
import type { Art } from './assets.ts';
import { PictureStamp } from './PhoneShow.tsx';
import { Picture } from './Picture.tsx';
import { type NameOf, logLine, whyLine } from './text.ts';

// ---- Small hooks ----

/** Server time, ticking every 100 ms while `on`. */
function useServerNow(clockOffset: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [on]);
  return now + clockOffset;
}

/**
 * Drawings this tab has seen on the easel, so the lot log can show them again (the server only
 * sends the current lot's strokes until the end).
 */
export function useSeenDrawings(view: GoingOnceView): ReadonlyMap<string, Drawing> {
  const [seen, setSeen] = useState<ReadonlyMap<string, Drawing>>(() => new Map());
  const pic = view.game?.auction?.picture;
  if (pic?.drawing && !seen.has(pic.item)) setSeen(new Map(seen).set(pic.item, pic.drawing));
  return seen;
}

// ---- The close ----

const CLOSE_WORDS = {
  intro: 'Coming up…',
  open: 'Bidding open',
  quiet: 'Any more bids?',
  once: 'Going once…',
  twice: 'Going twice…',
} as const;

export function CloseBar({ view, room }: { view: GoingOnceView; room: GameRoomInfo }) {
  const a = view.game!.auction!;
  const sold = view.game!.stage === 'sold';
  const now = useServerNow(room.clockOffset, !sold);
  const total = closeMs(view, a.close, a.bid);
  // A screw being aimed, or its outcome still playing out: the clock waits.
  const paused = !!a.screw || now < a.pausedUntil;
  const left = paused ? null : Math.max(0, a.closeAt - now);
  const fraction = left === null ? 1 : Math.min(1, left / total);
  const hot = a.close === 'once' || a.close === 'twice';
  const words = sold
    ? 'Sold!'
    : a.screw
      ? 'Paused: a screw is being aimed'
      : paused
        ? 'Paused: the screw is playing out'
        : CLOSE_WORDS[a.close];
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="go-close"
      data-close={sold ? 'sold' : a.close}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span
          aria-live="polite"
          className={cn(
            'text-lg font-extrabold tracking-tight',
            hot && !sold && !a.screw && 'text-danger-ink',
            a.close === 'twice' && !sold && !a.screw && 'motion-safe:animate-pulse',
          )}
        >
          {words}
        </span>
        {left !== null && !sold && (
          <span className="font-mono text-sm tabular-nums text-ink-muted">
            {(left / 1000).toFixed(1)} s
          </span>
        )}
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-line" aria-hidden>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-100 ease-linear',
            hot ? 'bg-danger' : 'bg-accent',
          )}
          style={{ width: `${(sold ? 0 : fraction) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---- Panels ----

function Money({ view, art }: { view: GoingOnceView; art: Art }) {
  const mine = view.mine;
  if (!mine) return null;
  return (
    <div className="flex items-baseline gap-2" data-testid="go-cash">
      <span className="text-xl font-extrabold tabular-nums">{money(mine.cash)}</span>
      <span className="text-xs text-ink-muted">
        cash
        {mine.debt > 0 && ` · owes ${fillNames('{bank}', art.names)} ${money(mine.debt)}`}
      </span>
    </div>
  );
}

export function BidPanel({
  view,
  room,
  act,
  art,
  name,
  quiet = false,
  picking = false,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  /** A table screen shows the lot: once it is sold, the bids that led there are the TV's. */
  quiet?: boolean;
  /** This quiet phone is picking whom to screw: the picker takes the bid buttons' place. */
  picking?: boolean;
}) {
  const g = view.game!;
  const a = g.auction!;
  const mine = view.mine;
  const live = g.stage === 'auction' && a.close !== 'intro';
  const leading = a.bid?.by === room.you;
  const affordable = mine ? a.steps.filter((s) => s <= mine.cash) : [];
  // A screw's outcome playing out holds every bid and screw until it is over.
  const now = useServerNow(room.clockOffset, live);
  // A bid still landing (the original's second of not listening) holds the buttons too.
  const landing = !!a.bid && a.close === 'quiet' && now < a.since + BID_SETTLE_MS;
  const held = !!a.screw || now < a.pausedUntil;
  const screwBlocked = !g.screwsOn || !mine?.screw || held || !!a.screwed || !live;
  const showBank = !!mine && g.bankOpened && mine.bankRefusal !== undefined;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2" data-testid="go-bid-status">
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-1">
          {a.bid ? (
            <p className="flex min-w-0 items-center gap-2 text-lg" data-testid="go-top-bid">
              <Paddle
                key={a.seq}
                name={name(a.bid.by)}
                shape={view.game!.paddles[a.bid.by]}
                art={art}
                raised
              />
              <PlayerTag
                name={name(a.bid.by)}
                you={a.bid.by === room.you}
                className="font-semibold"
              />
              <span className="text-2xl font-extrabold tabular-nums">{money(a.bid.amount)}</span>
              {a.screwed && (
                <span className="text-sm text-ink-muted" title="A forced bid">
                  🔩 by {name(a.screwed.by)}
                </span>
              )}
            </p>
          ) : (
            <p className="text-lg text-ink-muted" data-testid="go-top-bid">
              No bids yet · opens at {money(a.steps[0]!)}
            </p>
          )}
        </div>
        {!(quiet && g.stage === 'sold') && !picking && (
          <BidLadder view={view} art={art} name={name} you={room.you} rows={quiet ? 2 : 3} />
        )}
        <CloseBar view={view} room={room} />
      </div>
      {/* On phones the bid buttons and their refusal sit in the bar at the foot of the screen,
          under the top bid and the clock; once sold, they stay in place. */}
      {mine && !(quiet && g.stage === 'sold') && !picking && (
        <StickyBar fixed off={g.stage === 'sold'} refusal="go-bid" refusalKey={a.seq}>
          <div
            className="grid grid-cols-3 gap-2"
            role="group"
            aria-label="Bid"
            data-testid="go-bid-bar"
          >
            {a.steps.map((amount) => {
              const can = affordable.includes(amount);
              return (
                <Button
                  key={amount}
                  size="lg"
                  variant={amount === a.steps[0] ? 'primary' : 'tint'}
                  className="h-14 px-1 text-lg tabular-nums"
                  disabled={!live || leading || !can || held || landing}
                  onClick={() =>
                    void act({ type: 'bid', amount, seq: a.seq }, { anchor: 'go-bid' })
                  }
                  data-testid={`go-bid-${amount}`}
                >
                  {can ? money(amount) : '—'}
                </Button>
              );
            })}
          </div>
        </StickyBar>
      )}
      {mine && !picking && (
        <>
          {affordable.length === 0 && !leading && live && (
            <p className="text-center text-sm text-ink-muted">
              Not enough cash to bid on this one.
            </p>
          )}
          {(g.screwsOn || showBank) && (
            <div className="flex flex-wrap gap-2">
              {g.screwsOn && (
                <Button
                  variant="secondary"
                  className="min-w-0 flex-1 truncate px-2 text-sm whitespace-nowrap"
                  disabled={screwBlocked}
                  onClick={() => void act({ type: 'screw' }, { anchor: 'go-tools' })}
                  data-testid="go-screw"
                  title={
                    !mine.screw
                      ? 'You’ve used your screw'
                      : a.screwed
                        ? 'No screwing until someone makes a free bid'
                        : 'Force another player to bid $100 more'
                  }
                >
                  🔩 {mine.screw ? 'Screw' : 'Screw used'}
                </Button>
              )}
              {showBank && (
                <Button
                  variant="secondary"
                  className={cn(
                    'min-w-0 flex-1 truncate px-2 text-sm whitespace-nowrap',
                    a.bankCalled && 'ring-2 ring-accent motion-safe:animate-pulse',
                  )}
                  disabled={!mine.canCallBank}
                  onClick={() => void act({ type: 'call-bank' }, { anchor: 'go-tools' })}
                  data-testid="go-call-bank"
                  title={mine.bankRefusal ?? undefined}
                >
                  🏦{' '}
                  {a.bankCalled && !mine.canCallBank
                    ? `${fillNames('{Bank}', art.names)} called`
                    : `Call ${fillNames('{bank}', art.names)}`}
                </Button>
              )}
            </div>
          )}
          {mine.bankRefusal && !a.bankCalled && (
            <p className="text-xs text-ink-muted">{mine.bankRefusal}</p>
          )}
          <RefusalSlot anchor="go-tools" resetKey={a.seq} />
        </>
      )}
    </div>
  );
}

function ScrewPicker({
  view,
  room,
  act,
  name,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
}) {
  const a = view.game!.auction!;
  const targets = view.mine?.targets ?? [];
  const left = useSecondsLeft(a.screw?.until ?? null, room.clockOffset);
  if (!a.screw || a.screw.by !== room.you) return null;
  const amount = a.bid ? a.bid.amount + 100 : 400;
  const hurry = left !== null && left <= 5;
  return (
    <Panel className="flex flex-col gap-2 ring-2 ring-warn-line" data-testid="go-screw-picker">
      <p className="font-semibold">
        Who do you screw? They must bid {money(amount)}.{' '}
        <span className="font-mono text-sm tabular-nums">{left ?? 0} s</span>
      </p>
      <div className="grid grid-cols-2 gap-2">
        {targets.map((id) => (
          <Button
            key={id}
            variant="soft"
            onClick={() => void act({ type: 'screw-pick', target: id }, { anchor: 'go-screw' })}
          >
            <PlayerTag name={name(id)} />
          </Button>
        ))}
      </div>
      <p className={cn('text-xs', hurry ? 'font-semibold text-danger-ink' : 'text-ink-muted')}>
        {hurry
          ? 'Use it or lose it: pick someone now!'
          : 'If they can’t afford it, or you pick nobody in time, the screw is wasted.'}
      </p>
      <RefusalSlot anchor="go-screw" />
    </Panel>
  );
}

function WishList({ view }: { view: GoingOnceView }) {
  const wish = view.mine?.wish ?? [];
  const sold = new Map((view.game?.results ?? []).map((r) => [r.title, r]));
  if (!wish.length)
    return <p className="text-sm text-ink-muted">Your wish list comes after the drawing.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y divide-line" data-testid="go-wish">
        {wish.map((w) => {
          const r = sold.get(w.title);
          return (
            <li key={w.title} className="flex items-baseline justify-between gap-3 py-1.5">
              <span className={cn('min-w-0', r && 'text-ink-muted line-through')}>{w.title}</span>
              <span className="shrink-0 font-bold tabular-nums">{money(w.value)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">
        True values, but which picture is which is the puzzle. A player’s two drawings add up to
        $4,500.
      </p>
    </div>
  );
}

function Hints({ view, name, art }: { view: GoingOnceView; name: NameOf; art: Art }) {
  const messages = [...(view.mine?.messages ?? [])].reverse();
  if (!messages.length) return <p className="text-sm text-ink-muted">No messages yet.</p>;
  return (
    <ul className="flex flex-col gap-2" data-testid="go-hints">
      {messages.slice(0, 8).map((m, i) => {
        const why = whyLine(m, name);
        // Useful tips stand out; chatter reads as gossip.
        const tip = why !== null;
        return (
          <li
            key={m.id}
            className={cn(
              'flex gap-2 rounded-xl px-3 py-2 text-sm',
              i === 0 ? 'bg-info-soft text-info-ink ring-1 ring-info-line' : 'opacity-75',
            )}
          >
            <SenderIcon from={m.from} art={art} />
            <span className={cn('min-w-0', tip ? 'font-semibold' : 'italic opacity-70')}>
              {!tip && <span className="mr-1 text-xs uppercase not-italic">Gossip ·</span>}
              {m.text}
              {why && <span className="mt-0.5 block text-xs font-normal opacity-80">{why}</span>}
              <span className="mt-0.5 block text-xs">Before lot {m.lot + 1}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function resultLine(r: LotResult, name: NameOf, you: string): string {
  if (!r.buyer) return `Unsold – it was worth ${money(r.value)}`;
  const who = r.buyer === you ? 'You' : name(r.buyer);
  return `${who} paid ${money(r.price)} · worth ${money(r.value)}`;
}

export function LotLog({
  view,
  room,
  art,
  name,
  seen,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  art: Art;
  name: NameOf;
  seen: ReadonlyMap<string, Drawing>;
}) {
  const results = [...(view.game?.results ?? [])].reverse();
  const notices = view.log
    .map((e) => logLine(e, name))
    .filter(Boolean)
    .slice(-4)
    .reverse();
  return (
    <div className="flex flex-col gap-2">
      {notices.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs text-ink-muted">
          {notices.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}
      <PairLines view={view} name={name} you={room.you} />
      {results.length === 0 ? (
        <p className="text-sm text-ink-muted">Sold lots show here, with their values.</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="go-log">
          {results.map((r) => (
            <li key={r.item} className="flex items-center gap-2 text-sm">
              <Picture
                drawing={seen.get(r.item) ?? r.drawing}
                house={r.house}
                art={art}
                label={`Lot ${r.index + 1}`}
                compact
                className="w-10 shrink-0"
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">
                  {r.index + 1}. {r.title}
                  {r.artistKnown && (
                    <span className="font-normal text-ink-muted">
                      {' '}
                      ·{' '}
                      {r.artist ? `by ${r.artist === room.you ? 'you' : name(r.artist)}` : 'house'}
                    </span>
                  )}
                </span>
                <span className="block truncate text-xs text-ink-muted">
                  {resultLine(r, name, room.you)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The pair arithmetic, said plainly: an artist with one sold drawing whose value is known has
 * their other one worth $4,500 minus it. Which lot that is stays the puzzle.
 */
function PairLines({ view, name, you }: { view: GoingOnceView; name: NameOf; you: string }) {
  const byArtist = new Map<string, number[]>();
  for (const r of view.game?.results ?? [])
    if (r.artistKnown && r.artist)
      byArtist.set(r.artist, [...(byArtist.get(r.artist) ?? []), r.value]);
  const lines = [...byArtist].filter(([, values]) => values.length === 1);
  if (!lines.length) return null;
  return (
    <ul
      className="flex flex-col gap-0.5 rounded-lg bg-page px-2 py-1.5 text-xs"
      data-testid="go-pairs"
    >
      {lines.map(([artist, [value]]) => (
        <li key={artist}>
          <b>{artist === you ? 'You' : name(artist)}</b>: one sold, worth {money(value!)} → the
          other is worth <b>{money(PAIR_TOTAL - value!)}</b>
        </li>
      ))}
    </ul>
  );
}

/** A phone's sections during the lots, from the tab bar: the lot and its bidding, then the rest. */
export type GoTab = 'auction' | 'wish' | 'hints' | 'log';
type SideTab = Exclude<GoTab, 'auction'>;
export const GO_TABS_ID = 'go-play';
export const GO_TABS: readonly TabBarItem<GoTab>[] = [
  { id: 'auction', label: 'Auction', icon: 'gamepad-2' },
  { id: 'wish', label: 'Wish list', icon: 'scroll-text' },
  { id: 'hints', label: 'Hints', icon: 'message-circle' },
  { id: 'log', label: 'Lots', icon: 'list-ordered' },
];

/**
 * A lot's first moments: its number on the wooden disc and this player's tip arriving as a
 * "psst" bubble, before the picture goes up (in the picture's own space, so nothing jumps).
 */
function LotIntro({
  view,
  art,
  name,
  quiet = false,
}: {
  view: GoingOnceView;
  art: Art;
  name: NameOf;
  /** A quiet phone: the picture is on the table screen, so the disc sits beside the tip. */
  quiet?: boolean;
}) {
  const g = view.game!;
  const a = g.auction!;
  const latest = view.mine?.messages.at(-1);
  const disc = art.ui('lot');
  return (
    <div
      className={cn(
        'relative flex items-center rounded-lg bg-card shadow-vt-1 ring-1 ring-line',
        quiet
          ? 'gap-3 p-2'
          : // Phones: the picture's 220 px of height, the whole width (the tip needs it).
            'mx-auto w-full flex-col justify-center gap-4 p-4 max-sm:min-h-55 sm:aspect-[4/5] sm:max-w-[min(100%,32vh)] lg:max-w-none',
      )}
      data-testid="go-lot-intro"
    >
      <span
        className={cn(
          'relative flex shrink-0 items-end justify-center motion-safe:animate-[go-rise_0.3s_ease-out]',
          quiet ? 'size-20 pb-5' : 'size-28 pb-7',
        )}
      >
        {disc ? (
          <ProtectedImage src={disc} alt="" className="absolute inset-0 size-full" />
        ) : (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-accent-soft ring-4 ring-accent-line"
          />
        )}
        <span
          className={cn('relative text-center leading-none', disc ? 'text-stone-800' : 'text-ink')}
        >
          {/* The disc art says LOT itself. */}
          {!disc && <span className="block text-xs font-bold tracking-widest">LOT</span>}
          <span className="text-3xl font-black tabular-nums">{a.lot + 1}</span>
        </span>
      </span>
      <span className="sr-only">
        Lot {a.lot + 1} of {g.lotCount} is coming up.
      </span>
      {latest && latest.lot === a.lot ? (
        <div className="min-w-0 flex-1">
          <PsstBubble message={latest} art={art} name={name} big={!quiet} />
        </div>
      ) : (
        <p className="text-sm text-ink-muted">The picture is coming up…</p>
      )}
    </div>
  );
}

// ---- The screen ----

export function Auction({
  view,
  room,
  act,
  art,
  name,
  seen,
  quiet = false,
  tab = null,
  sold,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  /** Drawings this tab has seen (kept by the game root, which outlives this screen). */
  seen: ReadonlyMap<string, Drawing>;
  /** A table screen shows the lot: a thumbnail here, so the phone is for bidding. */
  quiet?: boolean;
  /** Phones: the section the tab bar shows (null on wider screens, which show them all). */
  tab?: GoTab | null;
  /** Wide screens: the Sold card, at the top of the bidding column (phones show it above). */
  sold?: ReactNode;
}) {
  const g = view.game!;
  const a = g.auction!;
  const pic = a.picture;
  const own = drewIt(view.mine, pic.item);
  const side = (t: SideTab) =>
    t === 'wish' ? (
      <WishList view={view} />
    ) : t === 'hints' ? (
      <Hints view={view} name={name} art={art} />
    ) : (
      <LotLog view={view} room={room} art={art} name={name} seen={seen} />
    );
  const latest = view.mine?.messages.at(-1);
  // A quiet phone picking whom to screw shows the picker where the bid buttons were.
  const picking = quiet && a.screw?.by === room.you;
  // The lot's number and whose drawing it is (beside the thumbnail on a quiet
  // phone, so the bidding fits the screen).
  const header = (
    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
      <span
        className={cn(
          'relative rounded-full bg-card px-2.5 py-0.5 text-sm font-bold ring-1 ring-line',
          art.ui('lot') && 'lg:hidden',
        )}
      >
        Lot {a.lot + 1}/{g.lotCount}
      </span>
      {/* Desktop and TV: the lot number on the wooden disc, when the manifest has it. */}
      {art.ui('lot') && (
        <span className="relative hidden size-16 items-end justify-center pb-3 lg:flex">
          <ProtectedImage src={art.ui('lot')!} alt="" className="absolute inset-0 size-full" />
          <span className="relative text-lg font-black text-stone-800" aria-hidden>
            {a.lot + 1}/{g.lotCount}
          </span>
        </span>
      )}
      {own && (
        <span className="rounded-full bg-special-soft px-2.5 py-0.5 text-xs font-semibold text-special-ink ring-1 ring-special-line">
          🎨 Your drawing
        </span>
      )}
    </div>
  );
  // Phones: the lot and its bidding on the Auction tab; the wish list, hints and lots each on theirs
  // (hidden rather than unmounted, so the lot's moments and the bidding keep their place).
  const away = tab !== null && tab !== 'auction';
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,0.9fr)] lg:items-start"
      {...(tab === 'auction' && tabPanelProps(GO_TABS_ID, 'auction'))}
    >
      <section
        aria-label="The lot"
        className={cn('relative flex flex-col gap-2 lg:rounded-2xl lg:p-3', away && 'hidden')}
      >
        {art.ui('gallery') && (
          <ProtectedImage
            src={art.ui('gallery')!}
            alt=""
            className="pointer-events-none absolute inset-0 -z-10 hidden size-full rounded-2xl object-cover lg:block"
          />
        )}
        {!quiet && header}
        {a.close === 'intro' ? (
          <LotIntro view={view} art={art} name={name} quiet={quiet} />
        ) : quiet ? (
          <div className="flex items-center gap-3" data-testid="go-thumb">
            <Picture
              drawing={pic.drawing}
              house={pic.house}
              art={art}
              compact
              label={`Lot ${a.lot + 1}`}
              className="relative w-16 shrink-0 shadow-vt-1"
            >
              <PictureStamp />
            </Picture>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {header}
              <p className="text-xs text-ink-muted">
                <span aria-hidden>👀 </span>Look up: the lot is on the table screen.
              </p>
              <LowEffectsNotice compact />
            </div>
          </div>
        ) : (
          <Picture
            drawing={pic.drawing}
            house={pic.house}
            art={art}
            label={`Lot ${a.lot + 1}`}
            className="relative mx-auto w-full max-w-[min(100%,11rem)] shadow-vt-1 sm:max-w-[min(100%,32vh)] lg:max-w-none"
          >
            <PictureStamp />
          </Picture>
        )}
        {!quiet && art.ui('easel') && (
          <ProtectedImage
            src={art.ui('easel')!}
            alt=""
            className="pointer-events-none relative -z-[1] mx-auto -mt-[45%] hidden w-1/2 lg:block"
          />
        )}
      </section>
      <section aria-label="Bidding" className={cn('flex flex-col gap-3', away && 'hidden')}>
        {sold}
        <Panel className="flex flex-col gap-3 p-3">
          <Money view={view} art={art} />
          <BidPanel
            view={view}
            room={room}
            act={act}
            art={art}
            name={name}
            quiet={quiet}
            picking={picking}
          />
        </Panel>
        <ScrewPicker view={view} room={room} act={act} name={name} />
        {/* Once sold, a quiet phone's tip has had its day (the Sold card needs the room). */}
        {latest &&
          latest.lot === a.lot &&
          a.close !== 'intro' &&
          !picking &&
          !(quiet && g.stage === 'sold') && (
            <div className="lg:hidden">
              <PsstBubble message={latest} art={art} name={name} />
            </div>
          )}
      </section>
      {tab && tab !== 'auction' && (
        <Panel className="flex flex-col gap-2 p-3" {...tabPanelProps(GO_TABS_ID, tab)}>
          {side(tab)}
        </Panel>
      )}
      <aside className="hidden flex-col gap-3 lg:flex">
        <Panel className="flex flex-col gap-2 p-3">
          <h3 className="font-bold">📜 Wish list</h3>
          {side('wish')}
        </Panel>
        <Panel className="flex flex-col gap-2 p-3">
          <h3 className="font-bold">💬 Hints</h3>
          {side('hints')}
        </Panel>
        <Panel className="flex flex-col gap-2 p-3">
          <h3 className="font-bold">🧾 Lots</h3>
          {side('log')}
        </Panel>
      </aside>
    </div>
  );
}
