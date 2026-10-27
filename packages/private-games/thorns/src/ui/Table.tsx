import { type GameRoomInfo, type PlayerColor, waitingFor } from '@vt/game-sdk';
import { Button, Countdown, PlayerTag, ProtectedImage, RefusalSlot, cn } from '@vt/ui';
import { useMemo, useState } from 'react';
import { discName } from '../logic/names.ts';
import {
  type Disc,
  POINTS_TO_WIN,
  type PlayerView,
  type ThornsAction,
  type ThornsView,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { DiscView, type Face } from './Disc.tsx';
import { type NameOf, logLine } from './text.ts';

export type Act = (action: ThornsAction, options?: { anchor?: string }) => Promise<boolean>;

interface TableProps {
  view: ThornsView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}

const colorOf = (room: GameRoomInfo, id: string): PlayerColor | undefined =>
  room.players.find((p) => p.id === id)?.color;

/** A stack's discs, bottom first, as the viewer may see them. */
function stackFaces(
  p: PlayerView,
  own: Disc[] | null,
): { face: Face; marked: boolean; up: boolean }[] {
  const n = p.stack;
  const turned = p.flipped.length;
  return Array.from({ length: n }, (_, i) => {
    const fromTop = n - 1 - i;
    if (fromTop < turned) return { face: p.flipped[fromTop]!, marked: false, up: true };
    if (p.shown) return { face: p.shown[fromTop]!, marked: false, up: true };
    if (own) return { face: own[i]!, marked: false, up: false };
    return { face: 'back' as const, marked: p.chanceAt === i, up: false };
  });
}

/** One player's mat: their stack, points, discs left and what they're doing. */
function Mat({
  p,
  seat,
  view,
  room,
  art,
  onFlip,
}: {
  p: PlayerView;
  seat: number;
  view: ThornsView;
  room: GameRoomInfo;
  art: Art;
  onFlip: (() => void) | null;
}) {
  const g = view.game!;
  const r = g.round;
  const you = p.id === room.you;
  const color = colorOf(room, p.id);
  const faces = stackFaces(p, you ? (view.mine?.stack ?? null) : null);
  const bid = r.bids.findLast((b) => b.by === p.id);
  const waiting = g.clock?.who.includes(p.id) ?? false;
  const set = art.set(seat);
  const matArt = p.points > 0 ? (set.matScored ?? set.mat) : set.mat;
  const offline = room.players.find((x) => x.id === p.id)?.connected === false;
  const chip = p.out
    ? p.left
      ? 'left'
      : 'out'
    : p.away
      ? 'away'
      : r.challenger === p.id
        ? 'Challenger'
        : r.passed.includes(p.id)
          ? 'passed'
          : bid
            ? `bid ${bid.amount}`
            : r.stage === 'place' && r.placed.includes(p.id)
              ? 'ready'
              : null;
  const body = (
    <>
      <div className="flex min-w-0 items-center justify-between gap-1">
        <PlayerTag
          name={p.name}
          you={you}
          host={p.id === room.hostId}
          offline={offline}
          className="text-sm font-semibold"
        />
        {chip && (
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 text-[11px] font-semibold ring-1',
              chip === 'Challenger'
                ? 'bg-accent-soft text-accent-text ring-accent-line dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-500/40'
                : 'bg-panel text-ink-muted ring-line dark:bg-stone-800 dark:text-stone-300 dark:ring-stone-700',
            )}
          >
            {chip}
          </span>
        )}
      </div>
      <div
        className="relative flex min-h-14 items-center justify-center rounded-xl bg-panel px-2 py-1.5 ring-1 ring-line dark:bg-stone-800/70 dark:ring-0"
        aria-label={`${p.name}’s mat: ${p.stack} ${p.stack === 1 ? 'disc' : 'discs'}`}
      >
        {matArt && (
          <ProtectedImage
            src={matArt}
            alt=""
            className="pointer-events-none absolute inset-0 size-full rounded-xl object-cover opacity-60"
          />
        )}
        <div className="relative flex items-center">
          {faces.length === 0 ? (
            <span className="text-xs text-ink-muted dark:text-stone-400">
              {p.out ? '—' : 'no discs'}
            </span>
          ) : (
            faces.map((d, i) => (
              <DiscView
                key={`${r.number}-${i}-${d.up ? d.face : 'down'}`}
                face={d.face}
                marked={d.marked}
                seat={seat}
                color={color}
                art={art}
                size={36}
                flip={d.up}
                className={cn(i > 0 && '-ml-4', you && !d.up && 'opacity-80')}
              />
            ))
          )}
        </div>
      </div>
      <div className="flex items-center justify-between text-xs text-ink-muted dark:text-stone-400">
        <span aria-label={`${p.points} of ${POINTS_TO_WIN} points`}>
          {Array.from({ length: POINTS_TO_WIN }, (_, i) => (i < p.points ? '★' : '☆')).join('')}
        </span>
        <span aria-label={`${p.discs} ${p.discs === 1 ? 'disc' : 'discs'} left`}>
          {'●'.repeat(p.discs)}
          <span className="opacity-40">{'○'.repeat(Math.max(0, 4 - p.discs))}</span>
          {g.chance?.holder === p.id && g.chance.round === r.number && ' 🍀'}
        </span>
      </div>
    </>
  );
  const box = cn(
    'flex min-w-0 flex-col gap-1.5 rounded-2xl bg-card/85 p-2 text-left shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
    waiting && 'ring-2 ring-accent dark:ring-amber-500',
    p.out && 'opacity-50',
    you && 'bg-accent-soft/40 dark:bg-amber-500/5',
  );
  return onFlip ? (
    <button
      type="button"
      className={cn(
        box,
        'th-rise cursor-pointer hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent',
      )}
      onClick={onFlip}
      aria-label={`Turn over ${you ? 'your own' : `${p.name}’s`} top disc`}
      data-flip={p.id}
    >
      {body}
      <span className="rounded-lg bg-accent px-2 py-1 text-center text-xs font-bold text-accent-fg dark:bg-amber-500 dark:text-stone-950">
        Turn over the top disc
      </span>
    </button>
  ) : (
    <div className={box} data-mat={p.id}>
      {body}
    </div>
  );
}

/** Raise-or-open stepper, capped at the discs in play. */
function BidControls({ view, act }: { view: ThornsView; act: Act }) {
  const r = view.game!.round;
  const high = r.bids.at(-1)?.amount ?? 0;
  const min = high + 1;
  const max = r.total;
  // Keyed by the bids so far, so it starts at the least bid again after every bid.
  const [amount, setAmount] = useState(min);
  const value = Math.min(max, Math.max(min, amount));
  if (min > max) return null;
  return (
    <div
      className="flex flex-wrap items-center justify-center gap-2"
      role="group"
      aria-label="Your bid"
    >
      <Button
        variant="secondary"
        size="icon"
        aria-label="One less"
        disabled={value <= min}
        onClick={() => setAmount(value - 1)}
      >
        −
      </Button>
      <span className="min-w-10 text-center text-2xl font-black tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        variant="secondary"
        size="icon"
        aria-label="One more"
        disabled={value >= max}
        onClick={() => setAmount(value + 1)}
      >
        +
      </Button>
      <Button onClick={() => void act({ type: 'bid', amount: value }, { anchor: 'th-play' })}>
        {r.stage === 'bid' ? `Raise to ${value}` : `Bid ${value}`}
      </Button>
      {r.stage === 'bid' && (
        <Button
          variant="secondary"
          onClick={() => void act({ type: 'pass' }, { anchor: 'th-play' })}
        >
          Pass
        </Button>
      )}
      <span className="w-full text-center text-xs text-ink-muted dark:text-stone-400">
        {max} {max === 1 ? 'disc' : 'discs'} on the mats: the most anyone may bid.
      </span>
    </div>
  );
}

/** The viewer's own discs and every choice they can make right now. */
function MyArea({ view, room, act, art, name }: TableProps) {
  const g = view.game!;
  const r = g.round;
  const mine = view.mine;
  const me = g.players.find((p) => p.id === room.you);
  if (!mine || !me) return null;
  const seat = g.order.indexOf(room.you);
  const color = colorOf(room, room.you);
  const names = art.names;
  const canPlace =
    !me.out &&
    ((r.stage === 'place' && mine.stack.length === 0) ||
      (r.stage === 'turns' && r.current === room.you));
  const canBid = !me.out && (r.stage === 'turns' || r.stage === 'bid') && r.current === room.you;
  const kinds = (['rose', 'thorn', 'chance'] as const).filter((d) => mine.hand.includes(d));
  const failed = r.result?.outcome === 'failed' && ['lose', 'starter', 'result'].includes(r.stage);
  const canShow = failed && me.stack > 0 && !me.shown;
  return (
    <section
      aria-label="Your discs"
      className="flex flex-col gap-3 rounded-2xl bg-card/85 p-3 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
    >
      {r.stage === 'lose' && r.challenger === room.you ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold">Choose the disc you lose for good:</p>
          <div className="flex gap-3">
            {(['rose', 'thorn'] as const)
              .filter((d) => mine.discs.includes(d))
              .map((d) => (
                <button
                  key={d}
                  type="button"
                  className="flex flex-col items-center gap-1 rounded-xl p-2 hover:bg-panel focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => void act({ type: 'lose', disc: d }, { anchor: 'th-play' })}
                >
                  <DiscView face={d} seat={seat} color={color} art={art} size={56} />
                  <span className="text-sm font-semibold">Lose a {discName(names, d)}</span>
                </button>
              ))}
          </div>
        </div>
      ) : r.stage === 'starter' && r.challenger === room.you ? (
        <div className="flex flex-col items-center gap-2">
          <p className="text-sm font-semibold">Who starts the next round?</p>
          <div className="flex flex-wrap justify-center gap-2">
            {g.players
              .filter((p) => !p.out)
              .map((p) => (
                <Button
                  key={p.id}
                  variant="secondary"
                  onClick={() => void act({ type: 'starter', player: p.id }, { anchor: 'th-play' })}
                >
                  {name(p.id)}
                </Button>
              ))}
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {mine.hand.length === 0 ? (
              <span className="text-sm text-ink-muted dark:text-stone-400">
                {me.out ? 'You’re out: watch the rest.' : 'No discs left in hand.'}
              </span>
            ) : (
              mine.hand
                .map((d, i) => ({ d, i }))
                .sort((a, b) => kinds.indexOf(a.d) - kinds.indexOf(b.d))
                .map(({ d, i }) =>
                  canPlace ? (
                    <button
                      key={`${d}-${i}`}
                      type="button"
                      className="rounded-full transition-transform hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      onClick={() => void act({ type: 'place', disc: d }, { anchor: 'th-play' })}
                      aria-label={`Put down a ${discName(names, d)}`}
                      data-place={d}
                    >
                      <DiscView face={d} seat={seat} color={color} art={art} size={56} />
                    </button>
                  ) : (
                    <DiscView
                      key={`${d}-${i}`}
                      face={d}
                      seat={seat}
                      color={color}
                      art={art}
                      size={48}
                    />
                  ),
                )
            )}
          </div>
          {canBid && <BidControls key={r.bids.length} view={view} act={act} />}
        </>
      )}
      {(mine.lost.length > 0 || canShow) && (
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-ink-muted dark:text-stone-400">
          {mine.lost.length > 0 && (
            <span>Lost (only you know): {mine.lost.map((d) => discName(names, d)).join(', ')}</span>
          )}
          {canShow && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void act({ type: 'show' }, { anchor: 'th-play' })}
            >
              Show my stack
            </Button>
          )}
        </div>
      )}
      <RefusalSlot anchor="th-play" resetKey={view.log.at(-1)?.id ?? 0} />
    </section>
  );
}

/** The table: every mat, the viewer's discs and controls, the clock and the log. */
export function Table(props: TableProps) {
  const { view, room, act, art, name } = props;
  const g = view.game!;
  const r = g.round;
  const strict = view.settings.timerMode === 'strict';
  const flipping = r.stage === 'flip' && r.challenger === room.you;
  const targets = useMemo(() => {
    if (!flipping) return new Set<string>();
    const me = g.players.find((p) => p.id === room.you)!;
    const own = Math.min(r.bids.at(-1)?.amount ?? 0, me.stack);
    if (me.flipped.length < own) return new Set([room.you]);
    return new Set(
      g.players
        .filter((p) => p.id !== room.you && !p.out && p.flipped.length < p.stack)
        .map((p) => p.id),
    );
  }, [flipping, g.players, r.bids, room.you]);
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const clock = g.clock;
  const away = g.players.filter((p) => p.away && !p.out);
  const nudge =
    clock &&
    room.isHost &&
    view.phase === 'playing' &&
    clock.who.filter((id) => id !== room.you && (clock.reminded || offline(id)));
  const lines = view.log
    .map((e) => ({ id: e.id, text: logLine(e, name, art.names) }))
    .filter((l): l is { id: number; text: string } => l.text !== null)
    .slice(-8)
    .reverse();
  return (
    <div className="flex flex-col gap-3">
      {(clock?.deadline || r.stage === 'starter') && view.phase === 'playing' && (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span className="text-sm text-ink-muted dark:text-stone-400">
            {clock ? waitingFor(clock.who, room.players, { you: room.you }) : ''}
          </span>
          {r.stage === 'starter' && r.result ? (
            <Countdown
              deadline={r.result.until}
              clockOffset={room.clockOffset}
              label="to name who starts"
              atZero="then the next player starts"
            />
          ) : (
            <Countdown
              deadline={clock?.deadline ?? null}
              clockOffset={room.clockOffset}
              label="to decide"
              soft={!strict}
              expiredHint={
                room.isHost ? 'You can act for them below.' : 'The host can act for them.'
              }
              atZero={strict ? 'then a safe move is made' : undefined}
            />
          )}
        </div>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="The table">
        {g.players.map((p, seat) => (
          <li key={p.id} className="min-w-0">
            <Mat
              p={p}
              seat={seat}
              view={view}
              room={room}
              art={art}
              onFlip={
                targets.has(p.id)
                  ? () => void act({ type: 'flip', owner: p.id }, { anchor: 'th-play' })
                  : null
              }
            />
          </li>
        ))}
      </ul>
      {view.phase === 'playing' && <MyArea {...props} />}
      {view.phase === 'playing' && away.length > 0 && (
        <section
          aria-label="Players who left"
          className="flex flex-col gap-2 rounded-2xl bg-warn-soft px-3 py-2 text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30"
        >
          <p>
            {away.map((p) => p.name).join(', ')} left the room:{' '}
            {away.length === 1 ? 'they’re' : 'they’re all'} skipped (a skipped bidder passes), and
            their discs stay on the mat.{' '}
            {room.isHost
              ? 'Wait for them to come back, or remove them.'
              : 'The host can wait for them or remove them.'}
          </p>
          {room.isHost && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {away.map((p) => (
                <Button
                  key={p.id}
                  variant="secondary"
                  size="sm"
                  onClick={() => void act({ type: 'remove', player: p.id }, { anchor: 'th-away' })}
                >
                  Remove {p.name}
                </Button>
              ))}
            </div>
          )}
          <RefusalSlot anchor="th-away" />
        </section>
      )}
      {nudge && nudge.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1.5">
          {nudge.map((id) => (
            <Button
              key={id}
              variant="secondary"
              size="sm"
              onClick={() => void act({ type: 'act-for', player: id }, { anchor: 'th-host' })}
            >
              Act for {name(id)}
            </Button>
          ))}
          <RefusalSlot anchor="th-host" />
        </div>
      )}
      {lines.length > 0 && (
        <details
          className="rounded-2xl bg-card/85 px-3 py-2 text-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
          open
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
      )}
      <p className="text-center text-xs text-ink-muted dark:text-stone-500">
        Round {r.number} · {g.players.filter((p) => !p.out).length} players in
      </p>
    </div>
  );
}
