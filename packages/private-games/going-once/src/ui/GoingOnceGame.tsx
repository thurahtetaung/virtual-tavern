import {
  type Drawing,
  type GameRoomInfo,
  type GameUiProps,
  storageKey,
  waitingFor,
  waitingForHost,
} from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  cn,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { money } from '../logic/lines.ts';
import { fillNames } from '../logic/names.ts';
import {
  DRAW_SECONDS,
  type GoingOnceAction,
  type GoingOnceView,
  LOAN_CASH,
  LOAN_DEBT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PACES,
  type Pace,
} from '../logic/types.ts';
import type { Act } from './act.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { Auction, useLocalHidden, useSeenDrawings } from './Auction.tsx';
import { Draw } from './Draw.tsx';
import { Picture } from './Picture.tsx';
import { type NameOf, statusFor } from './text.ts';

export type GoingOnceUiProps = GameUiProps<GoingOnceView, GoingOnceAction>;

export function GoingOnceGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: GoingOnceUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  const status = statusFor(view, room.you, name, art.names);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const inGame = !!view.game?.players.some((p) => p.id === room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : { text: 'You can join from the next game.' }
      : null,
  );
  // Seen here so the gallery keeps drawings from lots this tab watched.
  const seen = useSeenDrawings(view);
  const g = view.game;
  const wide = g && (g.stage === 'auction' || g.stage === 'sold' || g.stage === 'done');

  return (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-3',
        wide ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl',
      )}
    >
      {view.phase === 'lobby' || !g ? (
        <Lobby view={view} room={room} act={act} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {g.stage === 'draw' && <Draw view={view} room={room} act={act} />}
          {(g.stage === 'auction' || g.stage === 'sold') && (
            <>
              {g.auction?.lot === 0 && g.stage === 'auction' && <FirstLotTips art={art} />}
              {g.stage === 'sold' && <SoldCard view={view} room={room} act={act} name={name} />}
              <Auction view={view} room={room} act={act} art={art} name={name} />
            </>
          )}
          {g.stage === 'halftime' && <Halftime view={view} room={room} act={act} />}
          {g.stage === 'bank' && <Bank view={view} room={room} act={act} art={art} />}
          {g.stage === 'done' && (
            <End view={view} room={room} act={act} art={art} name={name} seen={seen} />
          )}
        </>
      )}
    </div>
  );
}

const TIPS_KEY = 'go.tips.v1';

/** Tips for a newcomer's first lot, until dismissed (per seat in a playtest). */
function FirstLotTips({ art }: { art: Art }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  return (
    <aside className="flex flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">Your first lot: how it works</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Open your <b>wish list</b>: three titles with their true values. If this picture looks
          like one of them, you know what it’s worth.
        </li>
        <li>
          Every artist’s two drawings add up to <b>$4,500</b>: one high, one low. Once one sells,
          the other’s value is known.
        </li>
        <li>
          Tap a bid button. After each bid there are a few quiet seconds, then “Going once”, “Going
          twice”, Sold. Any bid restarts the clock.
        </li>
        <li>
          The artist earns half the price. From half-time, your screw forces someone to bid; short
          of cash, {fillNames('{bank}', art.names)} lends $1,000 for $1,500.
        </li>
      </ul>
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => {
          try {
            localStorage.setItem(storageKey(TIPS_KEY), '1');
          } catch {
            // Storage blocked: the tips just close for now.
          }
          setSeen(true);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}

const PACE_HELP: Record<Pace, string> = {
  relaxed: 'More time before each Sold (12 s to open, 6 s after a bid).',
  normal: '8 s to open, 4 s after a bid, then going once, going twice.',
  fast: 'For players who know the game (6 s to open, 3 s after a bid).',
};

function Segmented<T extends string | number>({
  label,
  values,
  value,
  format,
  editable,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  format: (v: T) => string;
  editable: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {values.map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={v === value}
            disabled={!editable}
            onClick={() => onChange(v)}
            className={cn(
              'h-10 flex-1 rounded-lg px-3 text-sm font-semibold ring-1',
              v === value
                ? 'bg-accent text-accent-fg ring-accent dark:bg-amber-500 dark:text-stone-950 dark:ring-amber-500'
                : 'bg-card ring-line-strong hover:bg-panel dark:bg-stone-800 dark:ring-stone-600',
              !editable && 'cursor-default',
            )}
          >
            {format(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

const PACE_NAME: Record<Pace, string> = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };

function Lobby({
  view,
  room,
  act,
  showGuide,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  showGuide: () => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const noContent = view.groupsAvailable < 2;
  const blocker =
    seated.length < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${seated.length} seated).`
      : seated.length > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : noContent
          ? 'No title groups yet: an admin has to import them first.'
          : null;
  return (
    <>
      <Hint tone={room.isHost && !blocker ? 'action' : 'neutral'}>
        {!me
          ? 'Watching the table.'
          : !me.playing
            ? 'You’re watching. Take a seat to play.'
            : blocker
              ? blocker
              : room.isHost
                ? 'Everyone’s here? Start the game.'
                : waitingForHost(room)}
      </Hint>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Bidders ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden>🔨</span>
              <PlayerTag
                name={s.name}
                host={s.id === room.hostId}
                you={s.id === room.you}
                offline={offline(s.id)}
                className="flex-1"
              />
              {s.id === room.you && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void act({ type: 'sit', playing: false })}
                >
                  Stand up
                </Button>
              )}
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted dark:text-stone-400">
            <span>Watching:</span>
            {watching.map((s) => (
              <PlayerTag key={s.id} name={s.name} />
            ))}
          </p>
        )}
        {me && !me.playing && seated.length < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <p className="text-sm text-ink-muted dark:text-stone-400">
          Draw two quick pictures from secret titles, then bid on everyone’s art. Each artist’s two
          drawings are worth $4,500 together. 4 to 6 players is best.
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          `${view.settings.drawSeconds} s to draw`,
          `${PACE_NAME[view.settings.pace]} pace`,
        ]}
        className="space-y-4"
      >
        <Segmented
          label="Drawing time (both drawings)"
          values={DRAW_SECONDS}
          value={view.settings.drawSeconds}
          format={(v) => `${v} s`}
          editable={room.isHost}
          onChange={(v) =>
            void act({ type: 'update-settings', drawSeconds: v }, { anchor: 'go-lobby' })
          }
        />
        <div className="flex flex-col gap-1">
          <Segmented
            label="Auction pace"
            values={PACES}
            value={view.settings.pace}
            format={(v) => PACE_NAME[v]}
            editable={room.isHost}
            onChange={(v) => void act({ type: 'update-settings', pace: v }, { anchor: 'go-lobby' })}
          />
          <p className="text-xs text-ink-muted dark:text-stone-400">
            {PACE_HELP[view.settings.pace]}
          </p>
        </div>
        <RefusalSlot anchor="go-lobby" />
      </LobbySettings>
      {view.rigAllowed && room.isHost && <RigPanel view={view} act={act} />}
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'go-start' })}
            data-testid="go-start"
          >
            Start the game
          </Button>
          <RefusalSlot anchor="go-start" />
        </StickyBar>
      )}
    </>
  );
}

/** Test servers only: a fixed deal and a quicker clock for browser tests. */
function RigPanel({ view, act }: { view: GoingOnceView; act: Act }) {
  return (
    <Panel className="flex flex-wrap items-center gap-2 text-sm" data-testid="go-rig">
      <span className="font-semibold">Test rig</span>
      <span className="text-ink-muted">
        {view.rig ? `on (×${view.rig.scale}, cash ${view.rig.cash ?? 'normal'})` : 'off'}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => void act({ type: 'rig', scale: 0.5, fixed: true, cash: 1400 })}
      >
        Rig next game
      </Button>
    </Panel>
  );
}

function SoldCard({
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
  const r = view.game!.results.at(-1);
  if (!r) return null;
  const who = (id: string | null) => (id === room.you ? 'you' : name(id));
  const profit = r.value - r.price;
  return (
    <Panel
      className="flex flex-col items-center gap-1 text-center ring-2 ring-accent-line dark:ring-amber-500/50"
      role="status"
      data-testid="go-sold"
    >
      <p className="text-2xl font-black tracking-tight">
        {r.buyer ? (
          <>
            SOLD to <PlayerTag name={name(r.buyer)} you={r.buyer === room.you} />
          </>
        ) : (
          'Unsold'
        )}
      </p>
      <p className="text-lg">
        “<span className="font-semibold">{r.title}</span>”
        {r.artistKnown && (
          <span className="text-ink-muted dark:text-stone-400">
            {' '}
            {r.artist ? `by ${who(r.artist)}` : '· a house picture'}
          </span>
        )}
      </p>
      {r.buyer ? (
        <>
          <p>
            Paid <b>{money(r.price)}</b> · Worth <b>{money(r.value)}</b>
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
          {r.commission > 0 && r.artist && (
            <p className="text-sm text-ink-muted dark:text-stone-400">
              {r.artist === room.you ? 'You earn' : `${name(r.artist)} earns`} {money(r.commission)}{' '}
              commission
            </p>
          )}
          {r.screwedBy && (
            <p className="text-sm text-ink-muted dark:text-stone-400">
              🔩 A forced buy, thanks to {who(r.screwedBy)}
            </p>
          )}
        </>
      ) : (
        <p>Unsold – it was worth {money(r.value)}</p>
      )}
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          Next lot ▸
        </Button>
      )}
    </Panel>
  );
}

function Halftime({ view, room, act }: { view: GoingOnceView; room: GameRoomInfo; act: Act }) {
  return (
    <Panel className="flex flex-col items-center gap-2 text-center" data-testid="go-halftime">
      <p className="text-3xl" aria-hidden>
        🔩
      </p>
      <h2 className="text-xl font-bold">Half-time: screws are unlocked!</h2>
      <p className="max-w-md text-sm">
        Everyone has one screw for the rest of the game. Press Screw during a lot and pick a player:
        they must bid $100 more than the top bid ($400 if nobody has bid). The top bidder can’t be
        screwed, and nobody can screw again until someone makes a free bid.
      </p>
      <Countdown
        deadline={view.game!.until}
        clockOffset={room.clockOffset}
        label="until the next lot"
      />
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          Next lot ▸
        </Button>
      )}
    </Panel>
  );
}

function Bank({
  view,
  room,
  act,
  art,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const mine = view.mine;
  const g = view.game!;
  const f = (s: string) => fillNames(s, art.names);
  return (
    <Panel
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 text-center"
      data-testid="go-bank"
    >
      <p className="text-3xl" aria-hidden>
        🏦
      </p>
      <h2 className="text-xl font-bold">{f('{Bank} is open')}</h2>
      {mine && !mine.bankDone ? (
        mine.canLoan ? (
          <>
            <p>
              You will receive <b>{money(LOAN_CASH)}</b> now, and owe <b>{money(LOAN_DEBT)}</b> at
              the end. ({mine.loans} of 3 loans taken.)
            </p>
            <div className="flex w-full gap-2">
              <Button
                size="lg"
                className="flex-1"
                onClick={() => void act({ type: 'loan', take: true }, { anchor: 'go-bank' })}
                data-testid="go-take-loan"
              >
                Get a loan
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="flex-1"
                onClick={() => void act({ type: 'loan', take: false }, { anchor: 'go-bank' })}
              >
                No thanks
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>Bad credit: three loans is the limit.</p>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => void act({ type: 'loan', take: false }, { anchor: 'go-bank' })}
            >
              Carry on
            </Button>
          </>
        )
      ) : (
        <p className="text-sm">
          {mine
            ? `You have ${money(mine.cash)} cash${mine.debt ? ` and owe ${money(mine.debt)}` : ''}. `
            : ''}
          {waitingFor(g.bank?.waiting ?? [], room.players, { you: room.you })}
        </p>
      )}
      <Countdown deadline={g.until} clockOffset={room.clockOffset} label="until it closes" />
      <RefusalSlot anchor="go-bank" />
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          {f('Close {bank}')} ▸
        </Button>
      )}
    </Panel>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
  seen,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  seen: ReadonlyMap<string, Drawing>;
}) {
  const g = view.game!;
  const [localHidden] = useLocalHidden();
  const final = g.final ?? [];
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
      <Panel className="flex flex-col gap-3">
        <Standings
          entries={final.map((f) => ({
            id: f.id,
            name: name(f.id),
            score: f.score,
            note: `cash ${money(f.cash)} + art ${money(f.art)}${f.debt ? ` − debt ${money(f.debt)}` : ''}`,
          }))}
          you={room.you}
          scoreLabel={(n) => money(n)}
        />
        <Superlatives lines={room.superlatives} />
        {room.isHost ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={() => void act({ type: 'play-again' }, { anchor: 'go-end' })}
            >
              Play again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'go-end' })}
            >
              Change setup
            </Button>
          </div>
        ) : (
          <Hint>{waitingForHost(room, 'start the next game')}</Hint>
        )}
        <RefusalSlot anchor="go-end" />
      </Panel>
      <Panel className="flex flex-col gap-2">
        <h3 className="font-bold">🖼 The gallery</h3>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="go-gallery">
          {g.results.map((r) => {
            const profit = r.value - r.price;
            return (
              <li key={r.item} className="flex flex-col gap-1 text-sm">
                <Picture
                  drawing={r.drawing ?? seen.get(r.item) ?? null}
                  house={r.house}
                  hidden={r.hidden}
                  hiddenByMe={localHidden.has(r.item)}
                  art={art}
                  label={r.title}
                  className="w-full shadow-sm"
                />
                <span className="truncate font-semibold">{r.title}</span>
                <span className="truncate text-xs text-ink-muted dark:text-stone-400">
                  {r.artist
                    ? `by ${r.artist === room.you ? 'you' : name(r.artist)}`
                    : 'house picture'}
                </span>
                <span className="text-xs">
                  {r.buyer ? (
                    <>
                      <PlayerTag name={name(r.buyer)} you={r.buyer === room.you} /> paid{' '}
                      {money(r.price)} · worth {money(r.value)}{' '}
                      <b
                        className={
                          profit >= 0
                            ? 'text-success-ink dark:text-emerald-300'
                            : 'text-danger-ink dark:text-rose-300'
                        }
                      >
                        {profit >= 0 ? '+' : '−'}
                        {money(Math.abs(profit))}
                      </b>
                    </>
                  ) : (
                    `Unsold · worth ${money(r.value)}`
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
