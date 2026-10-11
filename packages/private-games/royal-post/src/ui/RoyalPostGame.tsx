import type { GameRoomInfo, GameUiProps } from '@vt/game-sdk';
import { Badge, Button, Countdown, Hint, Modal, Panel, TimerSettings, cn } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import {
  EDITIONS,
  EDITION_IDS,
  type Edition,
  type Note,
  type Role,
  type RoundPlayerView,
  type RoyalPostAction,
  type RoyalPostView,
} from '../logic/types.ts';
import { type Deck, deckFor, useManifest } from './assets.ts';
import { Card, CardBack } from './Card.tsx';
import { type Status, startBlocker, statusFor } from './status.ts';
import { cardText, describeLog, describeNote, listNames, nameOf } from './text.ts';

export type RoyalPostUiProps = GameUiProps<RoyalPostView, RoyalPostAction>;
type Act = (a: RoyalPostAction) => Promise<boolean>;

const rankIn = (edition: Edition, role: Role) =>
  EDITIONS[edition].cards.find((c) => c.role === role)?.rank ?? 0;

const deckSize = (edition: Edition) => EDITIONS[edition].cards.reduce((n, c) => n + c.count, 0);

export function RoyalPostGame({ view, room, act, showGuide, setYourMove }: RoyalPostUiProps) {
  const manifest = useManifest();
  const deck = deckFor(manifest, view.settings.edition);
  const status = statusFor(view, room.isHost);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;

  // Mark the tab when it's your move in a game (the lobby doesn't count).
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby') {
    return (
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        online={online}
        showGuide={showGuide}
      />
    );
  }
  return <Table view={view} room={room} act={act} status={status} deck={deck} online={online} />;
}

// ---- Lobby ----

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

function Seats({
  view,
  online,
  act,
}: {
  view: RoyalPostView;
  online: (id: string) => boolean;
  act: Act;
}) {
  const me = view.me;
  const max = EDITIONS[view.settings.edition].maxPlayers;
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  return (
    <Panel className="space-y-2">
      <h3 className="font-bold">
        Players ({playing.length}/{max})
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li
            key={s.id}
            className={cn('inline-flex items-center gap-1.5', !online(s.id) && 'opacity-50')}
          >
            <span aria-hidden>💌</span>
            {s.name}
            {s.id === me?.id && <Badge>you</Badge>}
          </li>
        ))}
        {playing.length === 0 && <li className="text-stone-500 italic">Nobody seated yet</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-semibold">Watching:</span>
        {watching.map((s) => (
          <span key={s.id}>{s.name}</span>
        ))}
        {watching.length === 0 && <span className="italic">nobody</span>}
      </div>
      {me && view.phase !== 'playing' && (
        <Button
          size="sm"
          variant={me.playing ? 'ghost' : 'primary'}
          onClick={() => void act({ type: 'sit', playing: !me.playing })}
        >
          {me.playing ? 'Just watch' : 'Take a seat'}
        </Button>
      )}
    </Panel>
  );
}

function Lobby({
  view,
  room,
  act,
  status,
  online,
  showGuide,
}: {
  view: RoyalPostView;
  room: GameRoomInfo;
  act: Act;
  status: Status;
  online: (id: string) => boolean;
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
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      <Seats view={view} online={online} act={act} />
      <Panel className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold">Game settings</h3>
          {!editable && (
            <span className="text-sm text-stone-500">Only the host can change these.</span>
          )}
        </div>
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
                      ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/10'
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
                    {e.tokens[n]} tokens to win
                    {id === '2019' ? ' · Spy, Chancellor' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
        {/* Folded away so the Start button stays on a phone's first screen. */}
        <details className="group">
          <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm [&::-webkit-details-marker]:hidden">
            <span>
              <span className="font-semibold">Timer</span>
              <span className="text-stone-500"> · {timers}</span>
            </span>
            <span aria-hidden className="text-stone-500 transition group-open:rotate-90">
              ▸
            </span>
          </summary>
          <div className="pt-2">
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
          </div>
        </details>
        {editable && (
          <div className="flex flex-wrap items-center gap-2 border-t border-stone-200 pt-4 dark:border-stone-800">
            <Button
              size="lg"
              disabled={blocker !== null}
              onClick={() => void act({ type: 'start' })}
            >
              Start game
            </Button>
            {blocker && <span className="text-sm text-stone-500">{blocker}</span>}
          </div>
        )}
      </Panel>
      <p className="text-center text-sm text-stone-500">
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

/** Favour tokens as pips out of the target. */
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
            i < tokens ? 'bg-rose-500 dark:bg-rose-400' : 'bg-stone-300 dark:bg-stone-700',
          )}
        />
      ))}
    </span>
  );
}

function Discards({
  cards,
  edition,
  deck,
  onView,
}: {
  cards: Role[];
  edition: Edition;
  deck: Deck;
  onView: (role: Role) => void;
}) {
  if (cards.length === 0) return <span className="text-xs text-stone-400 italic">no discards</span>;
  return (
    <ul aria-label="Discards" className="flex">
      {cards.map((role, i) => (
        <li key={i} className={cn('w-8 shrink-0 sm:w-10', i > 0 && '-ml-2')}>
          <Card
            role={role}
            rank={rankIn(edition, role)}
            deck={deck}
            size="xs"
            onClick={() => onView(role)}
          />
        </li>
      ))}
    </ul>
  );
}

function PlayerTile({
  view,
  p,
  deck,
  online,
  onView,
}: {
  view: RoyalPostView;
  p: RoundPlayerView;
  deck: Deck;
  online: boolean;
  onView: (role: Role) => void;
}) {
  const round = view.round!;
  const seat = view.seats.find((s) => s.id === p.id);
  const isTurn = round.current === p.id && round.stage !== 'over';
  const me = p.id === view.me?.id;
  return (
    <li
      aria-label={`${p.name}${me ? ' (you)' : ''}`}
      className={cn(
        'min-w-0 space-y-1 rounded-xl px-2 py-1.5 ring-1',
        isTurn
          ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/10'
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
        {me && <span className="text-xs text-stone-500">(you)</span>}
        {p.protected && (
          <span title="Protected" aria-label="protected" className="text-xs">
            🌸
          </span>
        )}
        {isTurn && <span className="sr-only">(their turn)</span>}
        <span className="ml-auto flex shrink-0 items-center gap-0.5">
          {p.out ? (
            <Badge className="px-1.5 py-0 text-[0.65rem]">{p.left ? 'left' : 'out'}</Badge>
          ) : (
            Array.from({ length: p.handCount }, (_, i) => (
              <CardBack key={i} deck={deck} className="w-3.5 rounded-sm" />
            ))
          )}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <Tokens tokens={seat?.tokens ?? 0} target={view.target} />
        <Discards cards={p.discards} edition={view.settings.edition} deck={deck} onView={onView} />
      </div>
    </li>
  );
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
  // A card on the table (a discard or a face-up set-aside card), opened to read, never to play.
  const [peeking, setPeeking] = useState<Role | null>(null);
  // The hand bar is fixed over the page, so the page pads by its measured height.
  const handBar = useRef<HTMLElement>(null);
  const [handHeight, setHandHeight] = useState(0);
  const showHand = view.hand.length > 0 && view.phase === 'playing';
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

  const latest = view.log.at(-1);
  const name = (role: Role) => deck.name(role);
  const chancellor =
    !!round && round.stage === 'chancellor' && round.current === me?.id && view.phase === 'playing';
  // The keep-one sheet opens by itself for each new Chancellor draw; "Later" folds it away.
  const handKey = view.hand.join();
  const [dismissed, setDismissed] = useState<string | null>(null);
  const chancellorOpen = dismissed !== handKey;

  return (
    <div
      className={cn('mx-auto max-w-4xl space-y-3', showHand && 'pb-48')}
      style={showHand && handHeight > 0 ? { paddingBottom: handHeight + 12 } : undefined}
    >
      {round && (
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-stone-500 sm:text-sm">
          <span className="flex items-center gap-2">
            <span>
              Round {round.number} · {view.target} to win
            </span>
            <span
              className="inline-flex items-center gap-1"
              aria-label={`${round.deckCount} cards in the deck`}
            >
              <CardBack deck={deck} className="w-4 rounded-sm" />
              <b className="tabular-nums">{round.deckCount}</b>
            </span>
            {round.setAside && (
              <span title="One card is set aside face down" className="hidden sm:inline">
                · 1 set aside
              </span>
            )}
          </span>
          <Countdown
            deadline={round.stage !== 'over' && view.phase === 'playing' ? round.deadline : null}
            clockOffset={room.clockOffset}
            expiredLabel={view.settings.timerMode === 'strict' ? undefined : "Time's up!"}
          />
        </div>
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
              onView={setPeeking}
            />
          ))}
        </ul>
      )}

      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>

      {round && round.faceUp.length > 0 && (
        <div className="flex items-center gap-2 text-xs text-stone-500">
          <span>Set aside face up:</span>
          <ul aria-label="Set aside face up" className="flex gap-1.5">
            {round.faceUp.map((role, i) => (
              <li key={i} className="w-12 sm:w-16">
                <Card
                  role={role}
                  rank={rankIn(edition, role)}
                  deck={deck}
                  size="sm"
                  onClick={() => setPeeking(role)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {latest && round?.stage !== 'over' && view.phase === 'playing' && (
        <p aria-live="polite" className="text-center text-sm text-stone-700 dark:text-stone-300">
          {describeLog(view, latest, name)}
        </p>
      )}

      {view.phase === 'over' ? (
        <Podium view={view} act={act} isHost={room.isHost} status={status} />
      ) : (
        round?.stage === 'over' && (
          <RoundResult view={view} deck={deck} act={act} isHost={room.isHost} />
        )
      )}

      <Notes view={view} deck={deck} />
      <Log view={view} deck={deck} />

      {view.seats.some((s) => !s.playing) && (
        <p className="text-xs text-stone-500">
          Watching:{' '}
          {view.seats
            .filter((s) => !s.playing)
            .map((s) => s.name)
            .join(', ')}
        </p>
      )}
      {room.isHost && view.phase === 'playing' && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={() => {
            if (window.confirm('End this game for everyone and go back to the lobby?')) {
              void act({ type: 'back-to-lobby' });
            }
          }}
        >
          Abandon game
        </Button>
      )}

      {showHand && (
        <section
          ref={handBar}
          aria-label="Your hand"
          className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95"
        >
          <div className="mx-auto flex max-w-4xl items-end gap-3 px-3 py-2">
            <div className="min-w-0 flex-1 space-y-1 text-xs text-stone-500">
              <p className="font-semibold">Your hand</p>
              {me && <Tokens tokens={me.tokens} target={view.target} />}
              {myTurn && (
                <p className="text-amber-700 dark:text-amber-400">Tap a card to play it.</p>
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
      <PlaySheet
        key={`peek-${peeking ?? ''}`}
        role={peeking}
        view={view}
        deck={deck}
        canPlay={false}
        onClose={() => setPeeking(null)}
        act={act}
      />
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
  const targeted = !!role && ['guard', 'priest', 'baron', 'prince', 'king'].includes(role);
  const targets =
    round && targeted
      ? round.players.filter(
          (p) =>
            !p.out &&
            (role === 'prince' ? p.id === me || !p.protected : p.id !== me && !p.protected),
        )
      : [];
  const countessLock =
    role !== 'countess' &&
    view.hand.includes('countess') &&
    (view.hand.includes('king') || view.hand.includes('prince'));
  const needsGuess = role === 'guard' && targets.length > 0;
  const ready =
    canPlay &&
    !countessLock &&
    (!targeted || targets.length === 0 || target !== null) &&
    (!needsGuess || guess !== null);
  const play = async () => {
    if (!role) return;
    setBusy(true);
    const ok = await act({
      type: 'play',
      card: role,
      ...(target ? { target } : {}),
      ...(needsGuess && guess ? { guess } : {}),
    });
    setBusy(false);
    if (ok) onClose();
  };
  const cardName = role ? deck.name(role) : '';
  return (
    <Modal
      open={role !== null}
      onClose={onClose}
      title={role ? `${cardName} (${rankIn(edition, role)})` : ''}
      footer={
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
            <p className="text-sm">{cardText(role, edition)}</p>
          </div>
          {canPlay && countessLock && (
            <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
              You hold the Countess with the King or a Prince, so you must play the Countess.
            </p>
          )}
          {canPlay && role === 'princess' && (
            <p className="rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-900 dark:bg-rose-500/15 dark:text-rose-200">
              Playing her knocks you out of the round!
            </p>
          )}
          {canPlay && !countessLock && targeted && (
            <fieldset>
              <legend className="text-sm font-semibold">Choose a player</legend>
              {targets.length === 0 ? (
                <p className="text-sm text-stone-500">
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
                          ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/10'
                          : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                      )}
                    >
                      {p.id === me ? 'Yourself' : p.name}
                    </button>
                  ))}
                </div>
              )}
              {round && round.players.some((p) => p.id !== me && p.protected && !p.out) && (
                <p className="mt-1 text-xs text-stone-500">
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
              <div className="mt-1 grid grid-cols-3 gap-1.5 sm:grid-cols-5">
                {EDITIONS[edition].cards
                  .filter((c) => c.role !== 'guard')
                  .map((c) => (
                    <button
                      key={c.role}
                      type="button"
                      aria-pressed={guess === c.role}
                      onClick={() => setGuess(c.role)}
                      className={cn(
                        'flex h-11 items-center gap-1 truncate rounded-lg px-2 text-left text-sm ring-1 transition',
                        guess === c.role
                          ? 'bg-amber-50 font-semibold ring-2 ring-amber-500 dark:bg-amber-500/10'
                          : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                      )}
                    >
                      <b className="tabular-nums">{c.rank}</b>
                      <span className="truncate">{deck.name(c.role)}</span>
                    </button>
                  ))}
              </div>
            </fieldset>
          )}
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
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Later
          </Button>
          <Button
            disabled={keep === null}
            onClick={() =>
              keep &&
              void act({
                type: 'chancellor-keep',
                keep,
                bottomOrder: bottom.map((c) => c.role),
              })
            }
          >
            {keep ? `Keep ${deck.name(keep)}` : 'Pick a card'}
          </Button>
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
        {keep && bottom.length > 0 && (
          <div className="space-y-1">
            <p className="text-sm font-semibold">Bottom of the deck, in this order</p>
            <ol className="space-y-1 text-sm">
              {bottom.map((c, n) => (
                <li key={c.i} className="flex items-center gap-2">
                  <span className="text-stone-500">
                    {n === bottom.length - 1 ? 'Very bottom:' : 'Then:'}
                  </span>
                  <b>{deck.name(c.role)}</b>
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

/** The card a note is about, to show with it. */
const noteCard = (note: Note): Role =>
  note.kind === 'peek' ? note.card : note.kind === 'compare' ? note.theirs : note.got;

/** Pops up each new private note (a Priest peek, a Baron comparison, a King trade). */
function Reveal({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  const latest = view.notes.at(-1);
  // Notes that were already there when the page opened don't pop up again.
  const [seen, setSeen] = useState(() => latest?.id ?? 0);
  const note = latest && latest.id > seen ? latest : null;
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
        <div className="flex items-center gap-3">
          <div className="w-24 shrink-0">
            <Card
              role={noteCard(note)}
              rank={rankIn(view.settings.edition, noteCard(note))}
              deck={deck}
              size="md"
            />
          </div>
          <p className="text-base font-semibold">{describeNote(view, note, deck.name)}</p>
        </div>
      )}
    </Modal>
  );
}

function Notes({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  if (view.notes.length === 0) return null;
  return (
    <details className="rounded-xl bg-white/80 px-3 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800">
      <summary className="flex h-11 cursor-pointer items-center text-sm font-semibold">
        Your notes ({view.notes.length}) · only you see these
      </summary>
      <ul aria-label="Your notes" className="space-y-1 pb-3 text-sm">
        {[...view.notes].reverse().map((n) => (
          <li key={n.id}>
            <span className="text-stone-500">Round {n.round}: </span>
            {describeNote(view, n, deck.name)}
          </li>
        ))}
      </ul>
    </details>
  );
}

function Log({ view, deck }: { view: RoyalPostView; deck: Deck }) {
  if (view.log.length === 0) return null;
  return (
    <details className="rounded-xl bg-white/80 px-3 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800">
      <summary className="flex h-11 cursor-pointer items-center text-sm font-semibold">
        What happened
      </summary>
      <ol aria-label="What happened" className="space-y-1 pb-3 text-sm">
        {[...view.log].reverse().map((e) => (
          <li key={e.id} className={cn(e.kind === 'round-end' && 'font-semibold')}>
            {describeLog(view, e, deck.name)}
          </li>
        ))}
      </ol>
    </details>
  );
}

// ---- Results ----

function RoundResult({
  view,
  deck,
  act,
  isHost,
}: {
  view: RoyalPostView;
  deck: Deck;
  act: Act;
  isHost: boolean;
}) {
  const round = view.round!;
  const result = round.result;
  if (!result) return null;
  const name = (id: string) => (id === view.me?.id ? 'You' : nameOf(view, id));
  const won = result.winners.map(name);
  const headline = won.length
    ? `${listNames(won)} ${won.length > 1 || won[0] === 'You' ? 'win' : 'wins'} the round!`
    : 'Nobody wins the round.';
  const edition = view.settings.edition;
  return (
    <Panel aria-label="Round result" className="space-y-3 text-center">
      <p className="text-xl font-bold">💌 {headline}</p>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        {result.reason === 'last-standing'
          ? 'Everyone else was knocked out.'
          : 'The deck ran out, so the highest card won.'}
        {result.discardTotals &&
          ` Tied cards were settled on discards: ${Object.entries(result.discardTotals)
            .map(([id, n]) => `${nameOf(view, id)} ${n}`)
            .join(', ')}.`}
        {result.spy && ` ${name(result.spy)} gained a token for the Spy.`}
      </p>
      {Object.keys(result.hands).length > 0 && (
        <ul className="flex flex-wrap justify-center gap-3">
          {Object.entries(result.hands).map(([id, role]) => (
            <li key={id} className="w-16 space-y-1 text-xs">
              <Card role={role} rank={rankIn(edition, role)} deck={deck} size="sm" />
              <p className={cn('truncate', result.winners.includes(id) && 'font-bold')}>
                {nameOf(view, id)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {isHost ? (
        <Button size="lg" onClick={() => void act({ type: 'next-round' })}>
          Next round
        </Button>
      ) : (
        <p className="text-sm text-stone-500">Waiting for the host…</p>
      )}
    </Panel>
  );
}

function Podium({
  view,
  act,
  isHost,
  status,
}: {
  view: RoyalPostView;
  act: Act;
  isHost: boolean;
  status: Status;
}) {
  const ranked = view.seats
    .filter((s) => s.playing || s.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
  const top = ranked.slice(0, 3);
  // Second, first, third, like a real podium.
  const steps = [top[1], top[0], top[2]];
  const heights = ['h-16', 'h-24', 'h-12'];
  return (
    <Panel aria-label="Podium" className="space-y-4 text-center">
      <p className="text-2xl font-bold">🏆 {status.text}</p>
      <ol className="flex items-end justify-center gap-2">
        {steps.map((s, i) =>
          s ? (
            <li key={s.id} className="flex w-24 flex-col items-center gap-1">
              <span className="max-w-full truncate text-sm font-semibold">
                {view.winners.includes(s.id) && '👑 '}
                {s.name}
              </span>
              <span className="text-xs text-stone-500">
                {s.tokens} token{s.tokens === 1 ? '' : 's'}
              </span>
              <span
                className={cn(
                  'flex w-full items-start justify-center rounded-t-lg pt-1 text-lg font-bold',
                  heights[i],
                  i === 1
                    ? 'bg-amber-300 text-amber-950 dark:bg-amber-500'
                    : 'bg-stone-200 dark:bg-stone-700',
                )}
              >
                {i === 1 ? 1 : i === 0 ? 2 : 3}
              </span>
            </li>
          ) : null,
        )}
      </ol>
      {ranked.length > 3 && (
        <ul className="text-sm text-stone-600 dark:text-stone-400">
          {ranked.slice(3).map((s) => (
            <li key={s.id}>
              {s.name}: {s.tokens}
            </li>
          ))}
        </ul>
      )}
      {isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change settings
          </Button>
        </div>
      ) : (
        <p>Waiting for the host…</p>
      )}
    </Panel>
  );
}
