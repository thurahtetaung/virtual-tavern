import { type GameRoomInfo, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Badge,
  Button,
  Countdown,
  Hint,
  Modal,
  Panel,
  PlayerTag,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  TimerSettings,
  cn,
  useSpectatorPrompt,
  useAbandonGame,
  LobbySettings,
} from '@vt/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  EDITIONS,
  EDITION_IDS,
  type Edition,
  type LogEntry,
  type Note,
  type Role,
  type RoundPlayerView,
  type RoyalPostAction,
  type RoyalPostView,
} from '../logic/types.ts';
import { mustPlayCountess, shortTarget, tokensToWin } from '../logic/game.ts';
import { type Deck, deckFor, useManifest } from './assets.ts';
import { Card, CardBack } from './Card.tsx';
import {
  CardChip,
  type CardReader,
  CardReaderProvider,
  Rich,
  rankIn,
  useCardReader,
} from './CardChip.tsx';
import { type Status, startBlocker, statusFor } from './status.ts';
import {
  cardText,
  describeLog,
  describeNote,
  listNames,
  nameOf,
  noteOther,
  notesByRound,
  roundEndingNotes,
  spyBonusLine,
  tiebreakLine,
  tokensLine,
  unseenCounts,
} from './text.ts';

export type RoyalPostUiProps = GameUiProps<RoyalPostView, RoyalPostAction>;
type Act = RoyalPostUiProps['act'];

const deckSize = (edition: Edition) => EDITIONS[edition].cards.reduce((n, c) => n + c.count, 0);

export function RoyalPostGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: RoyalPostUiProps) {
  const manifest = useManifest();
  const edition = view.settings.edition;
  const deck = useMemo(() => deckFor(manifest, edition), [manifest, edition]);
  const status = statusFor(view, room);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  // Any card named anywhere opens here, read-only.
  const [reading, setReading] = useState<Role | null>(null);
  const reader = useMemo<CardReader>(() => ({ deck, edition, read: setReading }), [deck, edition]);

  // Mark the tab when it's your move in a game (the lobby doesn't count).
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  // Watchers see the shared "You're watching" banner: a seat in the lobby, or wait for the next game.
  const watching = !!view.me && !view.me.playing;
  const inLobby = view.phase !== 'playing';
  useSpectatorPrompt(
    setSpectator,
    watching
      ? inLobby
        ? {
            text: 'Take a seat to play in the next game.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: 'You join in from the next game.' }
      : null,
  );

  return (
    <CardReaderProvider value={reader}>
      {view.phase === 'lobby' ? (
        <Lobby view={view} room={room} act={act} status={status} showGuide={showGuide} />
      ) : (
        <Table view={view} room={room} act={act} status={status} deck={deck} online={online} />
      )}
      <PlaySheet
        key={`read-${reading ?? ''}`}
        role={reading}
        view={view}
        deck={deck}
        canPlay={false}
        onClose={() => setReading(null)}
        act={act}
      />
    </CardReaderProvider>
  );
}

// ---- Lobby ----

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

function Seats({
  view,
  room,
  act,
  title = 'Players',
}: {
  view: RoyalPostView;
  room: GameRoomInfo;
  act: Act;
  title?: string;
}) {
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const me = view.me;
  const max = EDITIONS[view.settings.edition].maxPlayers;
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  return (
    <Panel className="space-y-2">
      <h3 className="font-bold">
        {title} ({playing.length}/{max})
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden>💌</span>
            <PlayerTag
              name={s.name}
              host={s.id === room.hostId}
              you={s.id === me?.id}
              offline={offline(s.id)}
            />
          </li>
        ))}
        {playing.length === 0 && <li className="text-ink-muted italic">Nobody seated yet</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-semibold">Watching:</span>
        {watching.map((s) => (
          <PlayerTag
            key={s.id}
            name={s.name}
            host={s.id === room.hostId}
            you={s.id === me?.id}
            offline={offline(s.id)}
          />
        ))}
        {watching.length === 0 && <span className="italic">nobody</span>}
      </div>
      {me && view.phase !== 'playing' && (
        <div className="flex flex-wrap items-center gap-2">
          {me.playing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act({ type: 'sit', playing: false })}
            >
              Sit out (watch)
            </Button>
          ) : playing.length < max ? (
            <Button size="sm" onClick={() => void act({ type: 'sit', playing: true })}>
              Take a seat
            </Button>
          ) : (
            <span className="text-sm text-ink-muted">
              The table is full{me.waiting ? ': you’ll get the next free seat' : ''}.
            </span>
          )}
          {!me.playing && me.waiting && playing.length >= max && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void act({ type: 'sit', playing: false })}
            >
              Sit out (watch)
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** A folded lobby section: a 44 px summary line, so Start stays on a phone's first screen. */
function Fold({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details className="group">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
        <span>
          <span className="font-semibold">{title}</span>
          <span className="text-ink-muted"> · {summary}</span>
        </span>
        <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="pt-2">{children}</div>
    </details>
  );
}

function Lobby({
  view,
  room,
  act,
  status,
  showGuide,
}: {
  view: RoyalPostView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  showGuide: () => void;
}) {
  const editable = room.isHost;
  const blocker = startBlocker(view);
  const s = view.settings;
  const timers =
    s.turnSeconds === null
      ? 'no time limit'
      : `${seconds(s.turnSeconds)} a turn, ${s.timerMode === 'strict' ? 'strict' : 'reminder only'}`;
  const seated = view.seats.filter((x) => x.playing).length;
  const cards = EDITIONS[s.edition].cards;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Seats view={view} room={room} act={act} />
      <LobbySettings
        editable={editable}
        title="Game settings"
        summary={[
          s.edition === 'classic' ? 'Classic' : '2019 edition',
          `${tokensToWin(EDITIONS[s.edition], Math.min(EDITIONS[s.edition].maxPlayers, Math.max(EDITIONS[s.edition].minPlayers, seated)), s.short)} tokens to win`,
          timers,
        ].join(' · ')}
        className="space-y-4"
      >
        {editable && <h3 className="text-lg font-bold">Game settings</h3>}
        <fieldset>
          <legend className="text-sm font-semibold">Edition</legend>
          <div className="mt-1 grid grid-cols-2 gap-2">
            {EDITION_IDS.map((id) => {
              const e = EDITIONS[id];
              const on = s.edition === id;
              const n = Math.min(e.maxPlayers, Math.max(e.minPlayers, seated));
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  disabled={!editable}
                  onClick={() => void act({ type: 'update-settings', edition: id })}
                  className={cn(
                    'rounded-lg px-3 py-2 text-left ring-1 transition disabled:cursor-default',
                    on
                      ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                      : 'ring-stone-200 enabled:hover:bg-stone-100 dark:ring-stone-700 dark:enabled:hover:bg-stone-800',
                    !editable && !on && 'opacity-60',
                  )}
                >
                  <span className="block font-semibold">
                    {id === 'classic' ? 'Classic' : '2019 edition'}
                  </span>
                  <span className="block text-xs text-stone-600 dark:text-stone-400">
                    {deckSize(id)} cards · {e.minPlayers}–{e.maxPlayers} players
                  </span>
                  <span className="block text-xs text-stone-600 dark:text-stone-400">
                    {tokensToWin(e, n, s.short)} tokens to win
                    {id === '2019' ? ' · Spy, Chancellor' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">Game length</legend>
          <span aria-hidden className="text-sm font-semibold">
            Length
          </span>
          {[false, true].map((short) => {
            const on = !!s.short === short;
            const full = tokensToWin(EDITIONS[s.edition], seated);
            return (
              <button
                key={String(short)}
                type="button"
                aria-pressed={on}
                disabled={!editable}
                onClick={() => void act({ type: 'update-settings', short })}
                className={cn(
                  'h-11 flex-1 rounded-lg px-3 text-sm ring-1 transition disabled:cursor-default',
                  on
                    ? 'bg-accent-soft font-semibold ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                    : 'ring-stone-200 enabled:hover:bg-stone-100 dark:ring-stone-700 dark:enabled:hover:bg-stone-800',
                  !editable && !on && 'opacity-60',
                )}
              >
                {short ? 'Short' : 'Full'} · {short ? shortTarget(full) : full} tokens
              </button>
            );
          })}
        </fieldset>
        <Fold title="The cards" summary={`${cards.length} kinds, tap one to read it`}>
          <ul aria-label="The cards" className="flex flex-wrap gap-x-1 gap-y-3 text-sm">
            {cards.map((c) => (
              <li key={c.role}>
                <CardChip role={c.role} />
                <span className="text-xs text-ink-muted"> ×{c.count}</span>
              </li>
            ))}
          </ul>
        </Fold>
        <Fold title="Timer" summary={timers}>
          <TimerSettings
            values={{ clueSeconds: s.turnSeconds, guessSeconds: null, timerMode: s.timerMode }}
            editable={editable}
            clueLabel="Turn timer"
            onChange={(patch) =>
              void act({
                type: 'update-settings',
                ...(patch.clueSeconds !== undefined ? { turnSeconds: patch.clueSeconds } : {}),
                ...(patch.timerMode !== undefined ? { timerMode: patch.timerMode } : {}),
              })
            }
            clueHelp="Time to play a card (and again for a Chancellor’s choice)."
            strictHelp="the lower card is played for you at a random player"
          />
        </Fold>
        {editable && (
          <StickyBar>
            <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
              <Button
                size="lg"
                disabled={blocker !== null}
                onClick={() => void act({ type: 'start' }, { anchor: 'royal-post-start' })}
              >
                Start game
              </Button>
              {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
            </div>
            <RefusalSlot anchor="royal-post-start" />
          </StickyBar>
        )}
      </LobbySettings>
      <p className="text-center text-sm text-ink-muted">
        New here?{' '}
        <button
          type="button"
          className="font-semibold text-amber-700 underline dark:text-amber-400"
          onClick={showGuide}
        >
          Read the guide
        </button>
      </p>
    </div>
  );
}

// ---- Table ----

/** Favour tokens as pips out of the target, with the count spelled out. */
function Tokens({ tokens, target }: { tokens: number; target: number }) {
  return (
    <span
      role="img"
      aria-label={`${tokens} of ${target} tokens`}
      className="inline-flex flex-wrap items-center gap-0.5"
    >
      {Array.from({ length: Math.max(target, tokens) }, (_, i) => (
        <span
          key={i}
          className={cn(
            'size-2 rounded-full',
            i < tokens ? 'bg-danger dark:bg-rose-400' : 'bg-stone-300 dark:bg-stone-700',
          )}
        />
      ))}
      <span aria-hidden className="ml-1 text-[0.65rem] font-semibold text-ink-muted tabular-nums">
        {tokens}/{target}
      </span>
    </span>
  );
}

/** A player's discard pile in miniature: one tap target that opens the pile. */
function Discards({
  p,
  edition,
  deck,
  onOpen,
}: {
  p: RoundPlayerView;
  edition: Edition;
  deck: Deck;
  onOpen: () => void;
}) {
  if (p.discards.length === 0)
    return <span className="text-xs text-ink-muted italic">no discards</span>;
  return (
    <button
      type="button"
      aria-label={`${p.name}’s discards: ${p.discards.map(deck.name).join(', ')}`}
      onClick={onOpen}
      className="-my-1 flex min-h-11 max-w-full min-w-11 items-center rounded-lg px-1 transition hover:bg-stone-100 dark:hover:bg-stone-800"
    >
      <ul aria-label="Discards" className="flex min-w-0">
        {/* The newest cards matter most: show the last few, newest on top. */}
        {p.discards.slice(-5).map((role, i) => (
          <li key={i} className={cn('w-7 shrink-0 sm:w-9', i > 0 && '-ml-3 sm:-ml-2')}>
            <Card role={role} rank={rankIn(edition, role)} deck={deck} size="xs" />
          </li>
        ))}
      </ul>
      {p.discards.length > 5 && (
        <span className="ml-1 text-xs font-semibold text-ink-muted">+{p.discards.length - 5}</span>
      )}
    </button>
  );
}

function PlayerTile({
  view,
  p,
  deck,
  online,
  onPile,
}: {
  view: RoyalPostView;
  p: RoundPlayerView;
  deck: Deck;
  online: boolean;
  onPile: () => void;
}) {
  const round = view.round!;
  const seat = view.seats.find((s) => s.id === p.id);
  const isTurn = round.current === p.id && round.stage !== 'over' && view.phase === 'playing';
  const me = p.id === view.me?.id;
  // Still in and has played (or discarded) a Spy: in line for the Spy bonus, if alone.
  const spy = !p.out && p.discards.includes('spy');
  return (
    <li
      aria-label={`${p.name}${me ? ' (you)' : ''}`}
      className={cn(
        'min-w-0 space-y-1 rounded-xl px-2 py-1.5 ring-1',
        isTurn
          ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
          : 'bg-white ring-stone-200 dark:bg-stone-900 dark:ring-stone-700',
        p.out && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-1 text-sm">
        <span
          className={cn(
            'min-w-0 truncate font-semibold',
            p.out && 'line-through',
            !online && !p.left && 'opacity-60',
          )}
        >
          {p.name}
        </span>
        {me && <span className="text-xs text-ink-muted">(you)</span>}
        {!online && !p.left && <Badge className="px-1.5 py-0 text-[0.65rem]">offline</Badge>}
        <span
          className="ml-auto flex shrink-0 items-center gap-0.5"
          aria-label={
            p.out ? undefined : `${p.handCount} card${p.handCount === 1 ? '' : 's'} in hand`
          }
          role={p.out ? undefined : 'img'}
        >
          {p.out ? (
            <Badge className="px-1.5 py-0 text-[0.65rem]">{p.left ? 'left' : 'out'}</Badge>
          ) : (
            Array.from({ length: p.handCount }, (_, i) => (
              <CardBack key={i} deck={deck} className="w-3.5 rounded-sm" />
            ))
          )}
        </span>
      </div>
      {(isTurn || p.protected || spy) && (
        <div className="flex flex-wrap gap-1">
          {isTurn && (
            <Badge className="bg-accent-soft px-1.5 py-0 text-[0.65rem] text-amber-950 dark:bg-amber-500/30 dark:text-amber-100">
              {me ? 'your turn' : 'their turn'}
            </Badge>
          )}
          {p.protected && (
            <Badge className="bg-danger-soft px-1.5 py-0 text-[0.65rem] text-rose-900 dark:bg-rose-500/20 dark:text-rose-100">
              <span aria-label="protected" title="Protected by the Handmaid until their next turn">
                🌸 protected
              </span>
            </Badge>
          )}
          {spy && (
            <Badge className="bg-stone-200 px-1.5 py-0 text-[0.65rem] text-stone-900 dark:bg-stone-700 dark:text-stone-100">
              <span
                aria-label="played a Spy"
                title="Played a Spy: gains a token if the only player still in who did"
              >
                🕶️ spy
              </span>
            </Badge>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Tokens tokens={seat?.tokens ?? 0} target={view.target} />
        <Discards p={p} edition={view.settings.edition} deck={deck} onOpen={onPile} />
      </div>
    </li>
  );
}

/** The log entries of the round on the table (the log runs across rounds and games). */
function roundEntries(view: RoyalPostView): LogEntry[] {
  const log = view.log;
  // A finished round ends with its round-end line; a running one starts after the last one.
  const end = view.round?.stage === 'over' ? log.length - 1 : log.length;
  let start = end;
  while (start > 0 && log[start - 1]!.kind !== 'round-end') start--;
  return log.slice(start, end);
}

/** What happened in this round since the viewer last played (all of it for a watcher). */
function sinceMyTurn(view: RoyalPostView): LogEntry[] {
  const entries = roundEntries(view);
  const me = view.me?.id;
  const last = entries.findLastIndex((e) => e.kind === 'play' && e.by === me);
  return entries.slice(last + 1);
}

function Table({
  view,
  room,
  act,
  status,
  deck,
  online,
}: {
  view: RoyalPostView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  deck: Deck;
  online: (id: string) => boolean;
}) {
  const round = view.round;
  const edition = view.settings.edition;
  const me = view.me;
  const myTurn = !!round && round.current === me?.id && round.stage === 'play';
  const [viewing, setViewing] = useState<Role | null>(null);
  const [pileOf, setPileOf] = useState<string | null>(null);
  // The hand bar is fixed over the page, so the page pads by its measured height.
  const handBar = useRef<HTMLElement>(null);
  const [handHeight, setHandHeight] = useState(0);
  // Once the round is over the result shows everyone's last card, yours included.
  const showHand = view.hand.length > 0 && view.phase === 'playing' && round?.stage !== 'over';
  useEffect(() => {
    const el = handBar.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      setHandHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setHandHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [showHand]);

  const chancellor =
    !!round && round.stage === 'chancellor' && round.current === me?.id && view.phase === 'playing';
  // The keep-one sheet opens by itself for each new Chancellor draw; "Later" folds it away.
  const handKey = view.hand.join();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const chancellorOpen = dismissed !== handKey;
  const recent = view.phase === 'playing' && round?.stage !== 'over' ? sinceMyTurn(view) : [];
  const pile = round?.players.find((p) => p.id === pileOf) ?? null;
  const { read } = useCardReader();

  return (
    <div
      className={cn('mx-auto max-w-4xl space-y-3', showHand && 'pb-48')}
      style={showHand && handHeight > 0 ? { paddingBottom: handHeight + 12 } : undefined}
    >
      {round && (
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted sm:text-sm">
          <span className="flex flex-wrap items-center gap-x-2">
            <span>
              Round {round.number} · {view.target} to win
            </span>
            <span className="inline-flex items-center gap-1">
              <CardBack deck={deck} className="w-3.5 rounded-sm" />
              <span>
                <b className="tabular-nums">{round.deckCount}</b> left in the deck
              </span>
            </span>
          </span>
          {/* Kept on one line: a squeezed "Time's up!" badge would wrap. */}
          <span className="shrink-0 whitespace-nowrap">
            <Countdown
              deadline={round.stage !== 'over' && view.phase === 'playing' ? round.deadline : null}
              clockOffset={room.clockOffset}
              label={round.stage === 'chancellor' ? 'to keep a card' : 'to play a card'}
              soft={view.settings.timerMode !== 'strict'}
              atZero={
                round.stage === 'chancellor'
                  ? 'then a card is kept at random'
                  : 'then the lower card is played'
              }
              expiredHint="Just a reminder: the turn waits until a card is played."
            />
          </span>
        </div>
      )}

      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>

      {view.phase === 'over' ? (
        <Podium view={view} deck={deck} act={act} room={room} />
      ) : (
        round?.stage === 'over' && <RoundResult view={view} deck={deck} act={act} room={room} />
      )}

      {round && (
        <ul aria-label="Players" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {round.players.map((p) => (
            <PlayerTile
              key={p.id}
              view={view}
              p={p}
              deck={deck}
              online={online(p.id)}
              onPile={() => setPileOf(p.id)}
            />
          ))}
        </ul>
      )}

      {round && round.faceUp.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <span>Set aside face up (out of this round, so nobody holds these):</span>
          <ul aria-label="Set aside face up" className="flex gap-1.5">
            {round.faceUp.map((role, i) => (
              // The thumbnail is too small for a name, so it sits underneath, wrapping if long.
              <li key={i} className="flex w-16 flex-col items-center gap-0.5">
                <span className="w-11 sm:w-14">
                  <Card
                    role={role}
                    rank={rankIn(edition, role)}
                    deck={deck}
                    size="xs"
                    reads
                    onClick={() => read(role)}
                  />
                </span>
                <span
                  aria-hidden
                  className="w-full text-center text-[0.7rem] leading-tight font-semibold break-words hyphens-auto text-stone-700 dark:text-stone-300"
                >
                  {deck.name(role)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {recent.length > 0 && <Recent view={view} entries={recent} />}

      <Journal view={view} deck={deck} />

      {view.seats.some((s) => !s.playing) && (
        <p className="text-xs text-ink-muted">
          Watching:{' '}
          {view.seats
            .filter((s) => !s.playing)
            .map((s) => s.name)
            .join(', ')}
        </p>
      )}

      {showHand && (
        <section
          ref={handBar}
          aria-label="Your hand"
          className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95"
        >
          <div className="mx-auto flex max-w-4xl items-end gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 space-y-1 text-xs text-ink-muted">
              <p className="font-semibold">Your hand</p>
              {me && <Tokens tokens={me.tokens} target={view.target} />}
              {myTurn && (
                <p className="text-amber-700 dark:text-amber-400">
                  {mustPlayCountess(view.hand)
                    ? `You must play the ${deck.name('countess')}: tap her.`
                    : 'Tap a card to play it.'}
                </p>
              )}
              {chancellor && !chancellorOpen && (
                <Button size="sm" onClick={() => setDismissed(null)}>
                  Choose a card to keep
                </Button>
              )}
            </div>
            <ul className="flex shrink-0 gap-2">
              {view.hand.map((role, i) => (
                <li key={`${role}-${i}`} className="w-20 sm:w-24">
                  <Card
                    role={role}
                    rank={rankIn(edition, role)}
                    deck={deck}
                    size="md"
                    // A forced Countess: the card that forces her can't be played.
                    dimmed={myTurn && role !== 'countess' && mustPlayCountess(view.hand)}
                    hint={
                      myTurn && role !== 'countess' && mustPlayCountess(view.hand)
                        ? 'can’t be played now'
                        : undefined
                    }
                    onClick={() => setViewing(role)}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <PlaySheet
        // A fresh sheet (no target or guess yet) for each card opened.
        key={viewing ?? ''}
        role={viewing}
        view={view}
        deck={deck}
        canPlay={myTurn}
        onClose={() => setViewing(null)}
        act={act}
      />
      <PileSheet pile={pile} view={view} deck={deck} onClose={() => setPileOf(null)} />
      {chancellor && (
        <ChancellorSheet
          key={view.hand.join()}
          open={chancellorOpen}
          view={view}
          deck={deck}
          onClose={() => setDismissed(handKey)}
          act={act}
        />
      )}
      <Reveal view={view} deck={deck} />
    </div>
  );
}

// ---- Playing a card ----

const TARGETED: readonly Role[] = ['guard', 'priest', 'baron', 'prince', 'king'];

function PlaySheet({
  role,
  view,
  deck,
  canPlay,
  onClose,
  act,
}: {
  role: Role | null;
  view: RoyalPostView;
  deck: Deck;
  canPlay: boolean;
  onClose: () => void;
  act: Act;
}) {
  const [target, setTarget] = useState<string | null>(null);
  const [guess, setGuess] = useState<Role | null>(null);
  const [busy, setBusy] = useState(false);
  const round = view.round;
  const edition = view.settings.edition;
  const me = view.me?.id;
  const targeted = !!role && TARGETED.includes(role);
  const targets =
    round && targeted
      ? round.players.filter(
          (p) =>
            !p.out &&
            (role === 'prince' ? p.id === me || !p.protected : p.id !== me && !p.protected),
        )
      : [];
  const forcing = view.hand.find((r) => r === 'king' || r === 'prince');
  const mustCountess = view.hand.includes('countess') && !!forcing;
  const countessLock = role !== 'countess' && mustCountess;
  const needsGuess = role === 'guard' && targets.length > 0;
  const ready =
    canPlay &&
    !countessLock &&
    (!targeted || targets.length === 0 || target !== null) &&
    (!needsGuess || guess !== null);
  const play = async () => {
    if (!role) return;
    setBusy(true);
    const ok = await act(
      {
        type: 'play',
        card: role,
        ...(target ? { target } : {}),
        ...(needsGuess && guess ? { guess } : {}),
      },
      { anchor: 'royal-post-play' },
    );
    setBusy(false);
    if (ok) onClose();
  };
  const cardName = role ? deck.name(role) : '';
  const inRound = !!round && round.stage !== 'over' && view.phase === 'playing';
  const counts = inRound ? unseenCounts(view) : [];
  const count = counts.find((c) => c.role === role);
  return (
    <Modal
      open={role !== null}
      onClose={onClose}
      title={role ? `${cardName} (${rankIn(edition, role)})` : ''}
      footer={
        <div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {canPlay && (
              <Button onClick={() => void play()} disabled={!ready || busy}>
                Play {cardName}
              </Button>
            )}
          </div>
          {canPlay && <RefusalSlot anchor="royal-post-play" />}
        </div>
      }
    >
      {role && (
        <div className="space-y-3">
          <div className="flex gap-3">
            <div className={cn('shrink-0', canPlay && targeted ? 'w-20 sm:w-28' : 'w-32 sm:w-44')}>
              <Card
                role={role}
                rank={rankIn(edition, role)}
                deck={deck}
                size={canPlay && targeted ? 'md' : 'lg'}
              />
            </div>
            <div className="space-y-2 text-sm">
              <p>{cardText(role, edition)}</p>
              {!canPlay && (
                <p className="text-xs text-ink-muted">
                  {EDITIONS[edition].cards.find((c) => c.role === role)?.count ?? 0} in the deck
                  {count ? ` · ${count.unseen} not seen by you yet` : ''}
                </p>
              )}
            </div>
          </div>
          {canPlay && role === 'countess' && mustCountess && (
            <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-amber-950 dark:bg-amber-500/15 dark:text-amber-100">
              You must play her: your other card is the {deck.name(forcing)}.
            </p>
          )}
          {canPlay && countessLock && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
              You hold the Countess with the {deck.name(forcing)}, so you must play the Countess.
            </p>
          )}
          {canPlay && role === 'princess' && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
              Playing her knocks you out of the round!
            </p>
          )}
          {canPlay && !countessLock && targeted && (
            <fieldset>
              <legend className="text-sm font-semibold">Choose a player</legend>
              {targets.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  Everyone else is protected or out, so this card has no effect.
                </p>
              ) : (
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {targets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      aria-pressed={target === p.id}
                      onClick={() => setTarget(p.id)}
                      className={cn(
                        'h-11 truncate rounded-lg px-3 font-semibold ring-1 transition',
                        target === p.id
                          ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                          : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                      )}
                    >
                      {p.id === me ? 'Yourself' : p.name}
                    </button>
                  ))}
                </div>
              )}
              {round && round.players.some((p) => p.id !== me && p.protected && !p.out) && (
                <p className="mt-1 text-xs text-ink-muted">
                  🌸 Protected:{' '}
                  {round.players
                    .filter((p) => p.id !== me && p.protected && !p.out)
                    .map((p) => p.name)
                    .join(', ')}
                </p>
              )}
            </fieldset>
          )}
          {canPlay && !countessLock && needsGuess && (
            <fieldset>
              <legend className="text-sm font-semibold">Name a card</legend>
              <p className="text-xs text-ink-muted">
                Each shows how many you haven’t seen yet (not in any discard or your hand).
              </p>
              <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {counts
                  .filter((c) => c.role !== 'guard')
                  .map((c) => (
                    <button
                      key={c.role}
                      type="button"
                      aria-pressed={guess === c.role}
                      aria-label={`${deck.name(c.role)} (${c.rank}), ${c.unseen} unseen`}
                      onClick={() => setGuess(c.role)}
                      className={cn(
                        'flex h-12 flex-col justify-center rounded-lg px-2 text-left text-sm ring-1 transition',
                        guess === c.role
                          ? 'bg-accent-soft font-semibold ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                          : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                        c.unseen === 0 && guess !== c.role && 'opacity-50',
                      )}
                    >
                      <span className="flex w-full items-center gap-1">
                        <b className="tabular-nums">{c.rank}</b>
                        <span className="truncate">{deck.name(c.role)}</span>
                      </span>
                      <span className="text-[0.65rem] font-normal text-ink-muted">
                        {c.unseen === 0 ? 'all seen' : `${c.unseen} unseen`}
                      </span>
                    </button>
                  ))}
              </div>
              {guess && (
                <p className="mt-2 text-sm">
                  {/* The guessed card's name opens it to read; its own effect isn't the point here. */}
                  {target
                    ? `If ${nameOf(view, target)} holds the `
                    : 'Choose a player: if they hold the '}
                  <CardChip role={guess} />, they are out of the round.
                </p>
              )}
            </fieldset>
          )}
        </div>
      )}
    </Modal>
  );
}

/** One player's discard pile, oldest first, each card big enough to read. */
function PileSheet({
  pile,
  view,
  deck,
  onClose,
}: {
  pile: RoundPlayerView | null;
  view: RoyalPostView;
  deck: Deck;
  onClose: () => void;
}) {
  const { read } = useCardReader();
  const edition = view.settings.edition;
  const mine = pile?.id === view.me?.id;
  return (
    <Modal
      open={pile !== null}
      onClose={onClose}
      title={pile ? `${mine ? 'Your' : `${pile.name}’s`} discards` : ''}
    >
      {pile && (
        <div className="space-y-2">
          <p className="text-sm text-ink-muted">Oldest first. Tap a card to read it.</p>
          <ol aria-label="Discard pile" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {pile.discards.map((role, i) => (
              <li key={i}>
                <Card
                  role={role}
                  rank={rankIn(edition, role)}
                  deck={deck}
                  size="sm"
                  reads
                  onClick={() => read(role)}
                />
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

function ChancellorSheet({
  open,
  view,
  deck,
  onClose,
  act,
}: {
  open: boolean;
  view: RoyalPostView;
  deck: Deck;
  onClose: () => void;
  act: Act;
}) {
  const edition = view.settings.edition;
  const [keepAt, setKeepAt] = useState<number | null>(null);
  const [flip, setFlip] = useState(false);
  const rest = view.hand.map((role, i) => ({ role, i })).filter((c) => c.i !== keepAt);
  const bottom = flip ? [...rest].reverse() : rest;
  const keep = keepAt === null ? null : view.hand[keepAt]!;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Keep one card"
      footer={
        <div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Later
            </Button>
            <Button
              disabled={keep === null}
              onClick={() =>
                keep &&
                void act(
                  { type: 'chancellor-keep', keep, bottomOrder: bottom.map((c) => c.role) },
                  { anchor: 'royal-post-keep' },
                )
              }
            >
              {keep ? `Keep ${deck.name(keep)}` : 'Pick a card'}
            </Button>
          </div>
          <RefusalSlot anchor="royal-post-keep" />
        </div>
      }
    >
      <div className="space-y-3">
        <p className="text-sm">Tap the card to keep. The others go to the bottom of the deck.</p>
        <ul aria-label="Cards to choose from" className="grid grid-cols-3 gap-2">
          {view.hand.map((role, i) => (
            <li key={i}>
              <Card
                role={role}
                rank={rankIn(edition, role)}
                deck={deck}
                size="md"
                selected={keepAt === i}
                dimmed={keepAt !== null && keepAt !== i}
                hint={keepAt === i ? 'keeping' : undefined}
                onClick={() => setKeepAt(i)}
              />
            </li>
          ))}
        </ul>
        {keep && (
          <p className="text-sm">
            <CardChip role={keep} /> {cardText(keep, edition)}
          </p>
        )}
        {keep && bottom.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Bottom of the deck, in this order</p>
            <ol className="space-y-2 text-sm">
              {bottom.map((c, n) => (
                <li key={c.i} className="flex items-center gap-2">
                  <span className="text-ink-muted">
                    {n === bottom.length - 1 ? 'Very bottom:' : 'Then:'}
                  </span>
                  <CardChip role={c.role} />
                </li>
              ))}
            </ol>
            {bottom.length === 2 && (
              <Button size="sm" variant="secondary" onClick={() => setFlip((f) => !f)}>
                ↕ Swap order
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ---- What only you know ----

/** The cards a note is about, each with a caption, to show with it. */
function noteCards(view: RoyalPostView, note: Note): { role: Role; caption: string }[] {
  const other = nameOf(view, noteOther(note));
  switch (note.kind) {
    case 'peek':
      return [{ role: note.card, caption: other }];
    case 'seen':
      return [{ role: note.card, caption: `${other} knows` }];
    case 'bottom':
      return note.cards.map((role, i) => ({
        role,
        caption: i === note.cards.length - 1 ? 'Very bottom' : 'Above it',
      }));
    case 'compare':
      return [
        { role: note.mine, caption: 'You' },
        { role: note.theirs, caption: other },
      ];
    case 'trade':
      return [
        { role: note.gave, caption: 'You gave' },
        { role: note.got, caption: 'You got' },
      ];
  }
}

/**
 * Pops up each new private note (a Priest peek, a Baron comparison, a King trade), while the
 * round is in play. A note made by the move that ends the round shows in the round result
 * instead, so the pop-up never covers it or Next round.
 */
function Reveal({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  const { read } = useCardReader();
  const latest = view.notes.at(-1);
  // Notes that were already there when the page opened don't pop up again.
  const [seen, setSeen] = useState(() => latest?.id ?? 0);
  const inPlay =
    view.phase === 'playing' &&
    !!view.round &&
    view.round.stage !== 'over' &&
    latest?.round === view.round.number;
  const note = latest && latest.id > seen && inPlay ? latest : null;
  return (
    <Modal
      open={note !== null}
      onClose={() => setSeen(latest?.id ?? 0)}
      title="Only you can see this"
      footer={
        <div className="flex justify-end">
          <Button onClick={() => setSeen(latest?.id ?? 0)}>Got it</Button>
        </div>
      }
    >
      {note && (
        <div className="space-y-3">
          <ul className="flex justify-center gap-3">
            {noteCards(view, note).map((c, i) => (
              <li key={i} className="w-24 space-y-1 text-center text-xs font-semibold">
                <Card
                  role={c.role}
                  rank={rankIn(view.settings.edition, c.role)}
                  deck={deck}
                  size="md"
                  reads
                  onClick={() => read(c.role)}
                />
                <p className="truncate">{c.caption}</p>
              </li>
            ))}
          </ul>
          <p className="text-base leading-7 font-semibold">
            <Rich line={describeNote(view, note)} />
          </p>
        </div>
      )}
    </Modal>
  );
}

/** What happened since your last turn, so nothing done to you goes unnoticed. */
function Recent({ view, entries }: { view: RoyalPostView; entries: LogEntry[] }) {
  // Newest first, like the Log tab below.
  const shown = entries.slice(-3).reverse();
  const watcher = !view.round?.players.some((p) => p.id === view.me?.id);
  return (
    <section
      aria-label={watcher ? 'Latest moves' : 'Since your turn'}
      aria-live="polite"
      className="space-y-1 text-sm leading-7 text-stone-700 dark:text-stone-300"
    >
      <h3 className="text-xs font-semibold text-ink-muted">
        {watcher ? 'Latest moves' : 'Since your turn'}
        {entries.length > shown.length && ` (${entries.length - shown.length} more below)`}
      </h3>
      <ul className="space-y-0.5">
        {shown.map((e) => (
          <li
            key={e.id}
            className={cn(touches(view, e) && 'font-semibold text-rose-800 dark:text-rose-200')}
          >
            <Rich line={describeLog(view, e)} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Whether a log entry did something to the viewer. */
const touches = (view: RoyalPostView, e: LogEntry) =>
  !!view.me &&
  ((e.kind === 'play' && e.target === view.me.id && e.by !== view.me.id) ||
    (e.kind === 'out' && e.player === view.me.id));

type JournalTab = 'log' | 'count' | 'notes';

/** The log, the card count and your notes, as tabs so a phone screen doesn't grow. */
function Journal({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  const [tab, setTab] = useState<JournalTab>('log');
  if (view.log.length === 0 && !view.round) return null;
  const tabs: { id: JournalTab; label: string }[] = [
    { id: 'log', label: 'Log' },
    { id: 'count', label: 'Card count' },
    ...(view.notes.length > 0
      ? [{ id: 'notes' as const, label: `Notes (${notesByRound(view).current.length})` }]
      : []),
  ];
  const current = tabs.some((t) => t.id === tab) ? tab : 'log';
  return (
    <section
      aria-label="Table records"
      className="rounded-xl bg-white/80 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <div role="tablist" className="flex border-b border-stone-200 dark:border-stone-800">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={current === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              'h-11 flex-1 truncate px-2 text-sm font-semibold transition',
              current === t.id
                ? 'border-b-2 border-accent dark:border-amber-500 text-stone-900 dark:text-stone-100'
                : 'text-ink-muted hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        // The card count is short and fixed, so it shows in full; the rest scroll in a box.
        className={cn('px-3 py-2', current !== 'count' && 'max-h-56 overflow-y-auto sm:max-h-72')}
      >
        {current === 'log' && <Log view={view} />}
        {current === 'count' && <CardCount view={view} deck={deck} />}
        {current === 'notes' && <Notes view={view} />}
      </div>
    </section>
  );
}

function Notes({ view }: { view: RoyalPostView }) {
  const { current, earlier } = notesByRound(view);
  return (
    <div className="space-y-2">
      <ul aria-label="Your notes" className="space-y-1 text-sm leading-7">
        <li className="text-xs leading-normal text-ink-muted">
          Only you see these. {current.length === 0 && 'Nothing yet this round.'}
        </li>
        {[...current].reverse().map((n) => (
          <li key={n.id}>
            <Rich line={describeNote(view, n)} />
          </li>
        ))}
      </ul>
      {earlier.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-xs font-semibold text-ink-muted">
            Earlier rounds ({earlier.length})
          </summary>
          <ul aria-label="Earlier notes" className="mt-1 space-y-1 leading-7 text-ink-muted">
            {[...earlier].reverse().map((n) => (
              <li key={n.id}>
                <span>Round {n.round}: </span>
                <Rich line={describeNote(view, n)} />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Log({ view }: { view: RoyalPostView }) {
  if (view.log.length === 0) return <p className="text-sm text-ink-muted">Nothing yet.</p>;
  const fresh = new Set(
    view.phase === 'playing' && view.round?.stage !== 'over'
      ? sinceMyTurn(view).map((e) => e.id)
      : [],
  );
  return (
    <ol aria-label="What happened" className="space-y-0.5 text-sm leading-7">
      {[...view.log].reverse().map((e) => (
        <li
          key={e.id}
          className={cn(
            'border-l-2 pl-2',
            fresh.has(e.id) ? 'border-accent dark:border-amber-500' : 'border-transparent',
            e.kind === 'round-end' && 'font-semibold',
            touches(view, e) && 'text-rose-800 dark:text-rose-200',
          )}
        >
          <span className="mr-1 text-xs text-ink-muted tabular-nums">R{e.round}</span>
          <Rich line={describeLog(view, e)} />
        </li>
      ))}
    </ol>
  );
}

/** How many of each card you haven't seen: what the others, the deck and the set-aside hold. */
function CardCount({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  if (!view.round) return null;
  const counts = unseenCounts(view);
  const left = counts.reduce((n, c) => n + c.unseen, 0);
  return (
    <div className="space-y-2 text-sm">
      <p className="text-xs text-ink-muted">
        {left} card{left === 1 ? '' : 's'} you haven’t seen: in other hands, the deck (
        {view.round.deckCount}) or set aside face down. Discards and your own hand are counted out.
      </p>
      {view.knownDeck.length > 0 && (
        <p className="text-xs text-amber-800 dark:text-amber-300" data-testid="known-deck">
          📜 Still in the deck, as you put them: the last {view.knownDeck.length} card
          {view.knownDeck.length === 1 ? ' is ' : 's are '}
          {listNames(view.knownDeck.map((r) => deck.name(r)))}
          {view.knownDeck.length > 1 && ' (the very bottom last)'}.
        </p>
      )}
      <ul aria-label="Card count" className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
        {counts.map((c) => (
          <li
            key={c.role}
            aria-label={`${deck.name(c.role)}: ${c.unseen} of ${c.total} unseen${c.inDeck ? `, ${c.inDeck} known in the deck` : ''}`}
            className={cn('flex items-center gap-2', c.unseen === 0 && 'opacity-50')}
          >
            <span className="min-w-0 flex-1">
              <CardChip role={c.role} />
            </span>
            <span aria-hidden className="flex gap-0.5">
              {Array.from({ length: c.total }, (_, i) => (
                <span
                  key={i}
                  className={cn(
                    'h-3 w-2 rounded-sm',
                    i < c.unseen ? 'bg-danger dark:bg-rose-400' : 'bg-stone-300 dark:bg-stone-700',
                  )}
                />
              ))}
            </span>
            <span aria-hidden className="w-10 text-right text-xs text-ink-muted tabular-nums">
              {c.unseen}/{c.total}
            </span>
            {c.inDeck > 0 && (
              <span className="text-xs text-amber-800 dark:text-amber-300">{c.inDeck} in deck</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---- Results ----

/** Everyone's last card at the end of a round, each one readable. */
function FinalHands({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  const { read } = useCardReader();
  const result = view.round?.result;
  if (!result || Object.keys(result.hands).length === 0) return null;
  const edition = view.settings.edition;
  return (
    <ul aria-label="Final hands" className="flex flex-wrap justify-center gap-3">
      {Object.entries(result.hands).map(([id, role]) => (
        <li key={id} className="w-16 space-y-1 text-xs">
          <Card
            role={role}
            rank={rankIn(edition, role)}
            deck={deck}
            size="sm"
            reads
            onClick={() => read(role)}
          />
          <p className={cn('truncate', result.winners.includes(id) && 'font-bold')}>
            {id === view.me?.id ? 'You' : nameOf(view, id)}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** What the round's end uncovers: your note from its last move. */
function RoundSecrets({ view }: { view: RoyalPostView }) {
  const ending = roundEndingNotes(view);
  if (ending.length === 0) return null;
  return (
    <div className="rounded-lg bg-accent-soft px-3 py-2 text-left text-sm leading-7 dark:bg-amber-500/10">
      <p className="text-xs font-semibold text-ink-muted">Only you can see this</p>
      {ending.map((n) => (
        <p key={n.id}>
          <Rich line={describeNote(view, n)} />
        </p>
      ))}
    </div>
  );
}

function RoundResult({
  view,
  deck,
  act,
  room,
}: {
  view: RoyalPostView;
  deck: Deck;
  act: Act;
  room: GameRoomInfo;
}) {
  const round = view.round!;
  const result = round.result;
  if (!result) return null;
  const name = (id: string) => (id === view.me?.id ? 'You' : nameOf(view, id));
  const won = result.winners.map(name);
  const tiebreak = tiebreakLine(view);
  const spyLine = spyBonusLine(view);
  const headline = won.length
    ? `${listNames(won)} ${won.length > 1 || won[0] === 'You' ? 'win' : 'wins'} the round!`
    : 'Nobody wins the round.';
  return (
    <Panel aria-label="Round result" className="space-y-3 text-center">
      <p className="text-xl font-bold">💌 {headline}</p>
      <p className="text-sm leading-7 text-stone-600 dark:text-stone-400">
        {result.reason === 'last-standing'
          ? 'Everyone else was knocked out.'
          : 'The deck ran out, so the highest card won.'}
        {tiebreak && ` ${tiebreak}`}
        {spyLine && (
          <>
            {' '}
            <Rich line={spyLine} />
          </>
        )}
      </p>
      <p className="text-sm font-semibold" data-testid="tokens-to-win">
        {tokensLine(view)}
      </p>
      <FinalHands view={view} deck={deck} />
      <RoundSecrets view={view} />
      {room.isHost ? (
        <Button size="lg" onClick={() => void act({ type: 'next-round' })}>
          Next round
        </Button>
      ) : (
        <p className="text-sm text-ink-muted">{waitingForHost(room, 'deal the next round')}</p>
      )}
    </Panel>
  );
}

function Podium({
  view,
  deck,
  act,
  room,
}: {
  view: RoyalPostView;
  deck: Deck;
  act: Act;
  room: GameRoomInfo;
}) {
  // Everyone who played (or scored before leaving); the status line above names the winner.
  const entries = view.seats
    .filter((s) => s.playing || s.tokens > 0)
    .map((s) => ({ id: s.id, name: s.name, score: s.tokens }));
  const last = view.log.findLast((e) => e.kind === 'round-end');
  return (
    <Panel aria-label="Game result" className="space-y-4">
      <Standings
        entries={entries}
        you={view.me?.id}
        scoreLabel={(n) => `${n} token${n === 1 ? '' : 's'}`}
      />
      {last && view.round?.result && (
        <div className="space-y-2">
          <p className="text-sm leading-7 text-stone-600 dark:text-stone-400">
            Last round: <Rich line={describeLog(view, last)} />
          </p>
          <FinalHands view={view} deck={deck} />
          <RoundSecrets view={view} />
        </div>
      )}
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change setup
          </Button>
        </div>
      ) : (
        <p className="text-center">{waitingForHost(room, 'start the next game')}</p>
      )}
      {/* Watchers and late joiners pick their seat for the next game right here. */}
      <div className="text-left">
        <Seats view={view} room={room} act={act} title="Next game" />
      </div>
    </Panel>
  );
}
