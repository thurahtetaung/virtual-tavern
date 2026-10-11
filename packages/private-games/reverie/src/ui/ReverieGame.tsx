import { type ActOptions, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  ChoicePicker,
  Countdown,
  Hint,
  Modal,
  Panel,
  PlayerTag,
  RefusalSlot,
  Standings,
  StickyBar,
  TimerSettings,
  cn,
  revealElement,
  useSpectatorPrompt,
} from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  CARD_SETS,
  MAX_CLUE_LENGTH,
  type ReverieAction,
  type ReverieView,
  type SeatColor,
  TARGET_SCORES,
  cardsIn,
} from '../logic/types.ts';
import { useManifest } from './assets.ts';
import { Card } from './Card.tsx';
import { startBlocker, statusFor } from './status.ts';

export type ReverieUiProps = GameUiProps<ReverieView, ReverieAction>;
type Act = (a: ReverieAction, options?: ActOptions) => Promise<boolean>;

/** The Take a seat / Sit out button, which the shell's "You're watching" banner leads to. */
const SEAT_CONTROL_ID = 'reverie-seat';
/** Where the server's refusal of a story shows: under the clue form. */
const TELL_ANCHOR = 'reverie-tell';

/** Seats can only change between turns (and in the lobby or at the end). */
const seatsOpen = (view: ReverieView) =>
  view.phase === 'lobby' || view.turn?.phase === 'reveal' || view.phase === 'over';

const COLOR_DOT: Record<SeatColor, string> = {
  red: 'bg-red-500',
  blue: 'bg-blue-500',
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-400',
  purple: 'bg-purple-500',
  orange: 'bg-orange-500',
  pink: 'bg-pink-400',
  teal: 'bg-teal-500',
};

const nameOf = (view: ReverieView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

export function ReverieGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
}: ReverieUiProps) {
  const manifest = useManifest();
  const setNames = new Map(
    manifest && manifest !== 'unavailable' ? manifest.sets.map((s) => [s.id, s]) : [],
  );
  const choices = CARD_SETS.map((s) => ({
    id: s.id,
    name:
      setNames.get(s.id)?.name ??
      (s.id === 'base' ? 'Base set' : s.id === 'extras' ? 'Extras' : `Set ${s.id.split('-')[1]}`),
    description: setNames.get(s.id)?.description,
    count: s.cards.length,
  }));
  const cardCount = CARD_SETS.filter((s) => view.settings.sets.includes(s.id)).reduce(
    (n, s) => n + cardsIn(s).length,
    0,
  );
  const blocker = startBlocker(view, cardCount);
  const status = statusFor(view, room.isHost, blocker, room);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;

  // Watchers get the shell's "You're watching" banner, leading to Take a seat.
  const full = view.seats.filter((s) => s.playing).length >= 8;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? full
        ? { text: 'All 8 seats are taken.' }
        : seatsOpen(view)
          ? { text: 'Take a seat to play.', action: () => revealElement(SEAT_CONTROL_ID) }
          : { text: 'You can take a seat once this turn’s cards are revealed.' }
      : null,
  );

  // Mark the tab when it's your turn in play (picking seats in the lobby doesn't count).
  const tabAlert = view.phase !== 'lobby' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby') {
    return (
      <div className="space-y-4">
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        <Seats view={view} online={online} act={act} hostId={room.hostId} />
        <Panel className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold">Game settings</h3>
            {!room.isHost && (
              <span className="text-sm text-stone-500">Only the host can change these.</span>
            )}
          </div>
          <ChoicePicker
            selectedIds={view.settings.sets}
            choices={choices}
            editable={room.isHost}
            onSave={(ids) => act({ type: 'update-settings', sets: ids })}
            labels={{
              title: 'Card sets',
              unit: 'cards',
              noun: 'set',
              change: 'Change card sets',
              summary: (chosen, total) =>
                `Playing with ${chosen.length === 1 ? 'this set' : 'these sets'} (${total} cards).`,
            }}
          />
          {room.isHost ? (
            <fieldset>
              <legend className="text-sm font-semibold">Play to</legend>
              <div className="mt-1 flex gap-2">
                {TARGET_SCORES.map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={view.settings.targetScore === t}
                    onClick={() => void act({ type: 'update-settings', targetScore: t })}
                    className={cn(
                      'rounded-lg px-4 py-2 font-semibold ring-1 transition',
                      view.settings.targetScore === t
                        ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/10'
                        : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                    )}
                  >
                    {t} points
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <p>
              <span className="block text-sm font-semibold">Play to</span>
              <span className="mt-1 block">{view.settings.targetScore} points</span>
            </p>
          )}
          <TimerSettings
            values={view.settings}
            editable={room.isHost}
            onChange={(patch) => void act({ type: 'update-settings', ...patch })}
            clueHelp="Time for the storyteller to pick a card and a clue."
            guessHelp="Time to give a card, and again to vote."
            strictHelp="a slow storyteller is skipped, late cards are played for you and late votes are lost"
          />
          {room.isHost && (
            <StickyBar>
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
            </StickyBar>
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

  // A new turn starts from a clean slate: a card picked last turn is no longer in the hand.
  return (
    <Play
      key={view.turn?.round ?? 0}
      view={view}
      room={room}
      act={act}
      status={status}
      online={online}
    />
  );
}

function Seats({
  view,
  online,
  act,
  hostId,
}: {
  view: ReverieView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
}) {
  const me = view.me;
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const canChange = seatsOpen(view);
  return (
    <Panel className="space-y-2">
      <h3 className="font-bold">Players ({playing.length}/8)</h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('size-2.5 rounded-full', COLOR_DOT[s.color])} />
            <PlayerTag
              name={s.name}
              host={s.id === hostId}
              you={s.id === me?.id}
              offline={!online(s.id)}
            />
          </li>
        ))}
        {playing.length === 0 && <li className="text-stone-500 italic">Nobody seated yet</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-stone-600 dark:text-stone-400">
        <span className="font-semibold">Watching:</span>
        {watching.map((s) => (
          <PlayerTag
            key={s.id}
            name={s.name}
            host={s.id === hostId}
            you={s.id === me?.id}
            offline={!online(s.id)}
          />
        ))}
        {watching.length === 0 && <span className="italic">nobody</span>}
      </div>
      {me && canChange && (
        <Button
          id={SEAT_CONTROL_ID}
          size="sm"
          variant={me.playing ? 'ghost' : 'primary'}
          onClick={() => void act({ type: 'sit', playing: !me.playing })}
        >
          {me.playing ? 'Sit out (watch)' : 'Take a seat'}
        </Button>
      )}
    </Panel>
  );
}

/** What each timed phase's clock is for, and what a strict timer does at 0:00. */
const PHASE_TIMER: Partial<Record<string, { label: string; atZero: string }>> = {
  clue: { label: 'to tell a story', atZero: 'then the storyteller is skipped' },
  pick: { label: 'to play a card', atZero: 'then a card is played for you' },
  vote: { label: 'to vote', atZero: 'then missing votes are lost' },
};

function Scoreboard({ view, clockOffset }: { view: ReverieView; clockOffset: number }) {
  const turn = view.turn;
  const playing = view.seats.filter((s) => s.playing);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-stone-500 sm:text-sm">
        <span>
          {turn && view.phase === 'playing' ? `Turn ${turn.round}` : 'Game over'} · to{' '}
          {view.settings.targetScore} · {view.drawPile} in the pile
        </span>
        <Countdown
          deadline={turn && turn.phase !== 'reveal' ? turn.deadline : null}
          clockOffset={clockOffset}
          label={PHASE_TIMER[turn?.phase ?? 'clue']?.label}
          soft={view.settings.timerMode !== 'strict'}
          expiredHint="Just a reminder: the turn waits for everyone."
          atZero={PHASE_TIMER[turn?.phase ?? 'clue']?.atZero}
        />
      </div>
      <ul className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Scores">
        {playing.map((s) => {
          const story = turn?.storyteller === s.id;
          const gained = turn?.results?.[s.id]?.points;
          return (
            <li
              key={s.id}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ring-1',
                story
                  ? 'bg-amber-100 ring-amber-400 dark:bg-amber-500/20 dark:ring-amber-500'
                  : 'bg-white ring-stone-200 dark:bg-stone-900 dark:ring-stone-700',
                turn && turn.phase !== 'reveal' && !s.done && !story && 'opacity-60',
              )}
              title={story ? 'Storyteller' : s.done ? 'Done' : 'Still deciding'}
            >
              <span aria-hidden className={cn('size-2.5 rounded-full', COLOR_DOT[s.color])} />
              <span className="max-w-24 truncate font-medium">{s.name}</span>
              {story && <span aria-label="storyteller">📖</span>}
              <b className="tabular-nums">{s.score}</b>
              {gained !== undefined && gained > 0 && (
                <span className="text-xs font-bold text-emerald-600">+{gained}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Full-size card with the action that fits the moment. */
function CardViewer({
  card,
  onClose,
  action,
}: {
  card: number | null;
  onClose: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <Modal
      open={card !== null}
      onClose={onClose}
      title={card === null ? '' : `Card ${card}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {action && (
            <Button onClick={action.onClick} disabled={action.disabled}>
              {action.label}
            </Button>
          )}
        </div>
      }
    >
      {card !== null && (
        <div className="mx-auto w-[min(100%,calc(60dvh*366/512))]">
          <Card card={card} big />
        </div>
      )}
    </Modal>
  );
}

function Play({
  view,
  room,
  act,
  status,
  online,
}: {
  view: ReverieView;
  room: ReverieUiProps['room'];
  act: Act;
  status: ReturnType<typeof statusFor>;
  online: (id: string) => boolean;
}) {
  const turn = view.turn;
  const me = view.me;
  const isStory = !!turn && me?.id === turn.storyteller;
  const [viewing, setViewing] = useState<{
    card: number;
    from: 'hand' | 'table';
    index?: number;
  } | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [clue, setClue] = useState('');
  const [storyPick, setStoryPick] = useState<number | null>(null);
  // The hand bar is fixed over the page, so the page pads by the bar's measured height and
  // nothing ends up hidden under it, whatever the screen or font size.
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

  const canTell = isStory && turn.phase === 'clue';
  const canNext = room.isHost && view.phase === 'playing' && turn?.phase === 'reveal';
  const canGive =
    !!turn && turn.phase === 'pick' && !isStory && !!me?.playing && turn.myCards.length === 0;
  const canVote =
    !!turn && turn.phase === 'vote' && !isStory && !!me?.playing && turn.myVote === null;

  const tell = async (e: FormEvent) => {
    e.preventDefault();
    if (storyPick === null) return;
    if (await act({ type: 'tell', card: storyPick, clue }, { anchor: TELL_ANCHOR })) {
      setClue('');
      setStoryPick(null);
    }
  };

  const togglePick = (card: number) => {
    setPicked((p) =>
      p.includes(card) ? p.filter((c) => c !== card) : [...p, card].slice(-view.cardsToGive),
    );
  };

  const viewerAction = (() => {
    if (!viewing) return undefined;
    if (viewing.from === 'hand' && canTell) {
      return {
        label: 'Tell a story with this card',
        onClick: () => (setStoryPick(viewing.card), setViewing(null)),
      };
    }
    if (viewing.from === 'hand' && canGive) {
      const on = picked.includes(viewing.card);
      return {
        label: on ? 'Put it back' : view.cardsToGive === 2 ? 'Pick this card' : 'Give this card',
        onClick: () => (togglePick(viewing.card), setViewing(null)),
      };
    }
    if (viewing.from === 'table' && canVote && viewing.index !== undefined) {
      const mine = turn.table[viewing.index]?.mine;
      return {
        label: mine ? "That's your card" : `Vote for #${viewing.index + 1}`,
        disabled: mine,
        onClick: () =>
          void act({ type: 'vote', index: viewing.index! }).then(() => setViewing(null)),
      };
    }
    return undefined;
  })();

  return (
    <div
      className={cn('space-y-3', showHand && 'pb-44')}
      style={showHand && handHeight > 0 ? { paddingBottom: handHeight + 12 } : undefined}
    >
      <Scoreboard view={view} clockOffset={room.clockOffset} />
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {canNext && (
        <div className="flex justify-center">
          <Button size="lg" onClick={() => void act({ type: 'next-turn' })}>
            Next turn
          </Button>
        </div>
      )}

      {turn?.clue && (
        <p className="text-center text-lg">
          <span className="text-stone-500">{nameOf(view, turn.storyteller)} says: </span>
          <b className="font-serif text-2xl">“{turn.clue}”</b>
        </p>
      )}

      {view.phase === 'over' && (
        <Panel className="space-y-3 text-center">
          {/* The status line above already says who won; this is the podium and the standings. */}
          <Standings
            entries={view.seats
              .filter((s) => s.playing || s.score > 0)
              .map((s) => ({ id: s.id, name: s.name, score: s.score }))}
            you={me?.id}
            className="text-left"
          />
          {room.isHost ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button size="lg" onClick={() => void act({ type: 'start' })}>
                Play again
              </Button>
              <Button
                variant="secondary"
                size="lg"
                onClick={() => void act({ type: 'back-to-lobby' })}
              >
                Change settings
              </Button>
            </div>
          ) : (
            <p>{waitingForHost(room, 'start the next game')}</p>
          )}
        </Panel>
      )}

      {canTell && (
        <Panel className="space-y-3">
          {storyPick === null ? (
            <p className="text-center text-stone-600 dark:text-stone-400">
              Tap a card in your hand below, then write your clue.
            </p>
          ) : (
            <form
              onSubmit={(e) => void tell(e)}
              className="flex flex-col gap-3 sm:flex-row sm:items-end"
            >
              <div className="w-24 shrink-0">
                <Card
                  card={storyPick}
                  onClick={() => setViewing({ card: storyPick, from: 'hand' })}
                />
              </div>
              <label className="flex-1">
                <span className="text-sm font-semibold">Your clue</span>
                <input
                  autoFocus
                  value={clue}
                  maxLength={MAX_CLUE_LENGTH}
                  onChange={(e) => setClue(e.target.value)}
                  placeholder="A word, a line, a feeling…"
                  className="mt-1 block w-full rounded-lg bg-white px-3 py-2 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
                />
              </label>
              <Button type="submit" size="lg" disabled={!clue.trim()}>
                Tell
              </Button>
            </form>
          )}
          <RefusalSlot anchor={TELL_ANCHOR} />
        </Panel>
      )}

      {turn && turn.table.length > 0 && (
        <section aria-label="Table">
          <h3 className="mb-2 font-bold">On the table</h3>
          <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {turn.table.map((t, i) => (
              <li key={i} className="space-y-1">
                <Card
                  card={t.card}
                  label={i + 1}
                  selected={turn.myVote === i}
                  dimmed={canVote && t.mine}
                  onClick={() => setViewing({ card: t.card, from: 'table', index: i })}
                  className={cn(t.isStory && 'ring-4 ring-amber-500')}
                />
                {turn.phase === 'reveal' && (
                  <div className="text-center text-xs">
                    <p className="font-semibold">
                      {t.isStory && '📖 '}
                      {t.owner ? nameOf(view, t.owner) : ''}
                    </p>
                    {t.voters.length > 0 && (
                      <p className="text-stone-500">
                        {t.voters.map((v) => nameOf(view, v)).join(', ')}
                      </p>
                    )}
                  </div>
                )}
                {turn.phase !== 'reveal' && t.mine && (
                  <p className="text-center text-xs text-stone-500">yours</p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {turn?.phase === 'reveal' && turn.results && (
        <Panel className="space-y-1 text-sm">
          <p className="font-bold">
            {turn.allOrNone
              ? turn.table.every((t) => t.voters.length === 0)
                ? 'Nobody voted in time, so only the votes on cards count.'
                : turn.table.find((t) => t.isStory)?.voters.length
                  ? 'Everyone found it, so the storyteller scores nothing and the voters get 2.'
                  : 'Nobody found it, so the storyteller scores nothing and the voters get 2.'
              : 'Some found it: the storyteller and the finders score 3.'}
          </p>
          <ul className="grid gap-x-4 sm:grid-cols-2">
            {view.seats
              .filter((s) => s.playing && turn.results![s.id])
              .map((s) => {
                const r = turn.results![s.id]!;
                return (
                  <li key={s.id} className="flex justify-between">
                    <span>
                      {s.name}
                      {s.id === turn.storyteller ? ' (storyteller)' : r.foundIt ? ' found it' : ''}
                      {r.votesReceived > 0 &&
                        s.id !== turn.storyteller &&
                        ` · ${r.votesReceived} vote${r.votesReceived === 1 ? '' : 's'}`}
                    </span>
                    <b className={r.points > 0 ? 'text-emerald-600' : 'text-stone-500'}>
                      +{r.points}
                    </b>
                  </li>
                );
              })}
          </ul>
        </Panel>
      )}

      {showHand && (
        <section
          ref={handBar}
          aria-label="Your hand"
          className="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95"
        >
          <div className="mx-auto max-w-7xl px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold text-stone-500">
              <span>Your hand</span>
              {canGive && (
                <Button
                  size="sm"
                  disabled={picked.length !== view.cardsToGive}
                  onClick={() =>
                    void act({ type: 'give', cards: picked }).then((ok) => ok && setPicked([]))
                  }
                >
                  {picked.length === view.cardsToGive
                    ? view.cardsToGive === 2
                      ? 'Give these cards'
                      : 'Give this card'
                    : view.cardsToGive === 2
                      ? `Pick ${2 - picked.length} more`
                      : 'Pick a card'}
                </Button>
              )}
            </div>
            <ul className="flex gap-2 overflow-x-auto pb-1">
              {view.hand.map((card) => (
                <li key={card} className="w-20 shrink-0 sm:w-24">
                  <Card
                    card={card}
                    selected={picked.includes(card) || storyPick === card}
                    onClick={() => setViewing({ card, from: 'hand' })}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <Seats view={view} online={online} act={act} hostId={room.hostId} />
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
      <CardViewer
        card={viewing?.card ?? null}
        onClose={() => setViewing(null)}
        action={viewerAction}
      />
    </div>
  );
}
