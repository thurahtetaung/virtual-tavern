import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, Countdown, Panel, PlayerTag, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import { money } from '../logic/lines.ts';
import {
  type AuctionView,
  type GoingOnceView,
  HOUSE_BIDDER,
  type Message,
  type PracticeStep,
} from '../logic/types.ts';
import type { Act } from './act.ts';
import type { Art } from './assets.ts';
import { BidPanel } from './Auction.tsx';
import { PsstBubble, senderName } from './Extras.tsx';
import { Picture } from './Picture.tsx';
import { type NameOf, unquote } from './text.ts';

const HOUSE_NAME = 'House bidder';

/** The four things the practice lot teaches, in the order it teaches them. */
const LESSONS: Partial<Record<PracticeStep, { n: number; title: string }>> = {
  hint: { n: 1, title: 'Tips are true' },
  sold: { n: 2, title: 'Values are true' },
  own: { n: 3, title: 'You can bid on your own drawing' },
  screw: { n: 4, title: 'A screw fails on a player who can’t pay' },
};

/**
 * The practice lot (a room's first game, before lot 1): a house picture for play money, a house
 * bidder who bids once, and the four lessons in turn. Anyone can skip it for everyone.
 */
export function Practice({
  view,
  room,
  act,
  art,
  name,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const p = g.practice!;
  const lesson = LESSONS[p.step];
  const named: NameOf = (id) => (id === HOUSE_BIDDER ? HOUSE_NAME : name(id));
  const contact = view.mine?.contact ?? 'buyer1';
  const tip: Message = { id: -1, lot: -1, kind: 'filler', from: contact, text: p.hint };
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3" data-testid="go-practice">
      <Panel className="flex flex-col gap-2 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            🎓 Practice lot{' '}
            <span className="text-sm font-normal text-ink-muted dark:text-stone-400">
              play money, nothing counts
            </span>
          </h2>
          {view.mine && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void act({ type: 'skip-practice' }, { anchor: 'go-practice' })}
              data-testid="go-skip-practice"
            >
              Skip practice ▸
            </Button>
          )}
        </div>
        <ol className="flex gap-1" aria-label="Lessons">
          {[1, 2, 3, 4].map((n) => (
            <li
              key={n}
              className={cn(
                'h-1.5 flex-1 rounded-full',
                lesson && n <= lesson.n
                  ? 'bg-accent dark:bg-amber-500'
                  : p.step === 'bid' && n === 1
                    ? 'bg-accent dark:bg-amber-500'
                    : 'bg-line dark:bg-stone-700',
              )}
            />
          ))}
        </ol>
        <RefusalSlot anchor="go-practice" />
        {lesson && (
          <p className="text-lg font-extrabold" data-testid="go-lesson">
            {lesson.n}. {lesson.title}
          </p>
        )}
      </Panel>
      {p.step === 'hint' && (
        <Panel className="flex flex-col gap-3">
          <PsstBubble
            message={tip}
            art={art}
            name={name}
            big
            fact={`True: the practice picture is worth ${money(p.value)}.`}
          />
          <p className="text-sm">
            Before every lot, {senderName(contact, art)} sends you one message. The tips are always
            true; the chit-chat is just gossip. The practice picture is next.
          </p>
          <Countdown deadline={p.until} clockOffset={room.clockOffset} label="until it goes up" />
        </Panel>
      )}
      {p.step === 'bid' && (
        <PracticeBidding view={view} room={room} act={act} art={art} name={named} />
      )}
      {p.step === 'sold' && <PracticeSold view={view} room={room} name={named} />}
      {p.step === 'own' && (
        <Panel className="flex flex-col gap-2">
          <p>
            When one of <b>your</b> drawings comes up, you may bid on it like anyone else. Nobody
            knows it’s yours. If you buy it you pay the full price and earn no commission, but its
            value still counts for you at the end, and outbidding you costs the others more.
          </p>
          <p className="text-sm text-ink-muted dark:text-stone-400">
            When someone else buys your drawing, you earn half the price as commission.
          </p>
          <Countdown deadline={p.until} clockOffset={room.clockOffset} label="next" />
        </Panel>
      )}
      {p.step === 'screw' && <PracticeScrew view={view} room={room} />}
    </div>
  );
}

/** The practice bidding: the real bid panel, on a stand-in lot, sending practice bids. */
function PracticeBidding({
  view,
  room,
  act,
  art,
  name,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const p = g.practice!;
  const auction: AuctionView = {
    lot: -1,
    picture: { item: 'practice', drawing: null, house: p.house, hidden: false },
    seq: p.seq,
    bid: p.bid,
    close: p.close,
    closeAt: p.closeAt,
    since: p.since,
    steps: p.steps,
    screw: null,
    pausedUntil: 0,
    screwed: null,
    bankCalled: false,
    bidders: [],
    recent: p.recent,
  };
  const stand: GoingOnceView = {
    ...view,
    game: { ...g, stage: 'auction', auction, screwsOn: false, bankOpened: false },
    mine: view.mine ? { ...view.mine, cash: p.cash, bankRefusal: null, canCallBank: false } : null,
  };
  const practiceAct: Act = (action, opts) =>
    act(
      action.type === 'bid'
        ? { type: 'practice-bid', amount: action.amount, seq: action.seq }
        : action,
      opts,
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-2 lg:items-start">
      <Picture
        drawing={null}
        house={p.house}
        hidden={false}
        hiddenByMe={false}
        art={art}
        label="The practice picture"
        className="mx-auto w-full max-w-[min(100%,32vh)] shadow-md lg:max-w-none"
      />
      <Panel className="flex flex-col gap-3 p-3">
        <p className="text-sm">
          Your tip said this one is worth <b>{money(p.value)}</b>. Bid below that and you profit.
          The {HOUSE_NAME.toLowerCase()} will bid once to show you how it goes.
        </p>
        {view.mine && (
          <p className="text-xl font-extrabold tabular-nums">
            {money(p.cash)}{' '}
            <span className="text-xs font-normal text-ink-muted dark:text-stone-400">
              play money
            </span>
          </p>
        )}
        <BidPanel view={stand} room={room} act={practiceAct} art={art} name={name} />
      </Panel>
    </div>
  );
}

/** Sold: the price against the true value, the lesson that values are true. */
function PracticeSold({
  view,
  room,
  name,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  name: NameOf;
}) {
  const p = view.game!.practice!;
  const bid = p.bid!;
  const profit = p.value - bid.amount;
  const you = bid.by === room.you;
  return (
    <Panel className="flex flex-col items-center gap-1 text-center" data-testid="go-practice-sold">
      <p className="text-2xl font-black tracking-tight">
        SOLD to {bid.by === HOUSE_BIDDER ? HOUSE_NAME : <PlayerTag name={name(bid.by)} you={you} />}
      </p>
      <p>
        Paid <b>{money(bid.amount)}</b> · Worth <b>{money(p.value)}</b>
      </p>
      <p
        className={cn(
          'font-bold',
          profit > 0
            ? 'text-success-ink dark:text-emerald-300'
            : profit < 0
              ? 'text-danger-ink dark:text-rose-300'
              : '',
        )}
      >
        {profit > 0
          ? `PROFIT ${money(profit)}`
          : profit < 0
            ? `LOSS ${money(-profit)}`
            : 'BROKE EVEN'}
      </p>
      {p.title && (
        <p className="text-lg">
          “<span className="font-semibold">{unquote(p.title)}</span>” · a house picture
        </p>
      )}
      <p className="mt-1 max-w-md text-sm">
        Every drawing’s true value shows when it sells, and it matches what the tips said. At the
        end your art counts at its value, not the price you paid.
      </p>
      <Countdown deadline={p.until} clockOffset={room.clockOffset} label="next" />
    </Panel>
  );
}

/**
 * The screw lesson, tried on this screen only: aim it at the house bidder, who has no money left,
 * and see it fail.
 */
function PracticeScrew({ view, room }: { view: GoingOnceView; room: GameRoomInfo }) {
  const p = view.game!.practice!;
  const [tried, setTried] = useState(false);
  const top = p.bid?.amount ?? 400;
  return (
    <Panel className="flex flex-col gap-3" data-testid="go-practice-screw">
      <p>
        From half-time everyone has one 🔩 screw. Press it during a lot and pick a player: they must
        bid $100 more than the top bid. But if they <b>can’t afford it</b>, the screw fails and is
        gone.
      </p>
      <div className="flex flex-wrap items-center gap-2 rounded-xl bg-panel px-3 py-2 dark:bg-stone-800/70">
        <span className="font-semibold">{HOUSE_NAME}</span>
        <span className="text-sm text-ink-muted dark:text-stone-400">has $0 left</span>
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          disabled={tried}
          onClick={() => setTried(true)}
          data-testid="go-practice-screw-try"
        >
          🔩 Screw them
        </Button>
      </div>
      {tried && (
        <p
          role="status"
          className="rounded-xl bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink ring-1 ring-danger-line dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40"
        >
          The screw fails: the {HOUSE_NAME.toLowerCase()} can’t pay {money(top + 100)}, so your
          screw is wasted. Pick someone with cash! The clock waits while a screw plays out, then
          everyone gets a fresh countdown to bid.
        </p>
      )}
      <Countdown deadline={p.until} clockOffset={room.clockOffset} label="until lot 1" />
    </Panel>
  );
}
