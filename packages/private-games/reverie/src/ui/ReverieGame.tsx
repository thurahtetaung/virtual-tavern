import { type ActOptions, type GameUiProps, waitingForHost, winnersTitle } from '@vt/game-sdk';
import {
  Button,
  END_ART,
  FitArea,
  ChoicePicker,
  Countdown,
  GuideLink,
  Hint,
  Input,
  Modal,
  Panel,
  PlayerDot,
  PlayerTag,
  EndHero,
  EndLayout,
  EndTabs,
  Standings,
  StickyBar,
  Superlatives,
  TabBar,
  type TabBarItem,
  tabPanelProps,
  TimerSettings,
  cn,
  useSpectatorPrompt,
  useConfirm,
  useAbandonGame,
  LobbySettings,
  NameDot,
  timersLine,
  useWideScreen,
  LobbyLayout,
  LobbyPitch,
  LobbyStart,
  ProtectedImage,
  SeatHeading,
  SeatToggle,
} from '@vt/ui';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  CARD_SETS,
  MAX_CLUE_LENGTH,
  type ReverieAction,
  type ReverieView,
  TARGET_SCORES,
  cardsIn,
} from '../logic/types.ts';
import { guide } from '../logic/guide.ts';
import { GAME_ID, useManifest } from './assets.ts';
import { Card } from './Card.tsx';
import { cardSetChoices } from './sets.ts';
import {
  missedVoteNote,
  pointsBreakdown,
  revealHeadline,
  startBlocker,
  statusFor,
  targetReached,
} from './status.ts';

export type ReverieUiProps = GameUiProps<ReverieView, ReverieAction>;
type Act = (a: ReverieAction, options?: ActOptions) => Promise<boolean>;

/** The Take a seat / Sit out button in the Players panel. */
const SEAT_CONTROL_ID = 'reverie-seat';
/** Where the server's refusal of a story shows: under the clue form. */
const TELL_ANCHOR = 'reverie-tell';

/** Phones in play: the round (table and hand) and the players (scores and seats). */
type PlayTab = 'table' | 'players';
const PLAY_TABS_ID = 'reverie-play';
const PLAY_TABS: readonly TabBarItem<PlayTab>[] = [
  { id: 'table', label: 'Table', icon: 'layout-grid' },
  { id: 'players', label: 'Players', icon: 'users' },
];

/** Seats can only change between turns (and in the lobby or at the end). */
const seatsOpen = (view: ReverieView) =>
  view.phase === 'lobby' || view.turn?.phase === 'reveal' || view.phase === 'over';

const nameOf = (view: ReverieView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

export function ReverieGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
  pickColor,
}: ReverieUiProps) {
  const manifest = useManifest();
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const choices = cardSetChoices(manifest);
  const cardCount = CARD_SETS.filter((s) => view.settings.sets.includes(s.id)).reduce(
    (n, s) => n + cardsIn(s).length,
    0,
  );
  const blocker = startBlocker(view, cardCount);
  const status = statusFor(view, room.isHost, blocker, room);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const [tab, setTab] = useState<PlayTab>('table');

  // Watchers get the shell's "You're watching" banner, leading to Take a seat.
  const full = view.seats.filter((s) => s.playing).length >= 8;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? full
        ? { text: 'All 8 seats are taken.' }
        : seatsOpen(view)
          ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
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
    const backUrl =
      manifest && manifest !== 'unavailable' && manifest.back
        ? `/api/backroom/assets/${GAME_ID}/${manifest.back}`
        : null;
    return (
      <LobbyLayout
        pitch={
          <LobbyPitch
            title={room.gameName ?? 'Reverie'}
            emblem="🐇"
            art={
              backUrl && (
                <ProtectedImage
                  src={backUrl}
                  alt=""
                  className="aspect-[2/3] w-full -rotate-3 rounded-lg object-cover shadow-vt-2"
                />
              )
            }
          >
            {guide.tagline}
          </LobbyPitch>
        }
        rail={
          <>
            <LobbySettings
              editable={room.isHost}
              summary={[
                `play to ${view.settings.targetScore}`,
                `${view.settings.sets.length} card ${view.settings.sets.length === 1 ? 'set' : 'sets'}`,
                timersLine(view.settings, { clue: 'storyteller', guess: 'cards and votes' }),
              ]}
              className="space-y-4"
            >
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
                          'min-h-11 rounded-lg px-4 py-2 font-semibold ring-1 transition',
                          view.settings.targetScore === t
                            ? 'bg-accent-soft ring-2 ring-accent'
                            : 'ring-line hover:bg-sunk',
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
            </LobbySettings>
          </>
        }
        start={
          room.isHost && (
            <LobbyStart blocker={blocker} onStart={() => void act({ type: 'start' })} />
          )
        }
      >
        {status.text && <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>}
        <Seats view={view} online={online} act={act} hostId={room.hostId} pickColor={pickColor} />
        <GuideLink title={room.gameName ?? 'Reverie'} onClick={showGuide} />
      </LobbyLayout>
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
      pickColor={pickColor}
      tab={tab}
      setTab={setTab}
    />
  );
}

function Seats({
  view,
  online,
  act,
  hostId,
  pickColor,
}: {
  view: ReverieView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
  /** Opens the room's colour picker: your own seat does this. */
  pickColor?: () => void;
}) {
  const me = view.me;
  const recolor = pickColor;
  const tag = (s: (typeof view.seats)[number]) => {
    const name = (
      <PlayerTag
        name={s.name}
        host={s.id === hostId}
        you={s.id === me?.id}
        offline={!online(s.id)}
      />
    );
    if (s.id !== me?.id || !recolor) return name;
    return (
      <button
        type="button"
        onClick={recolor}
        aria-label={`${s.name} (you): change your colour`}
        className="-mx-1 inline-flex min-h-11 items-center rounded-lg px-1 hover:bg-card focus-visible:outline-2 focus-visible:outline-accent"
      >
        {name}
      </button>
    );
  };
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const canChange = seatsOpen(view);
  // Say what a tap on Take a seat / Sit out did, since the list change is easy to miss.
  const [note, setNote] = useState<string | null>(null);
  const sit = async (playing: boolean) => {
    if (!(await act({ type: 'sit', playing }))) return;
    setNote(
      !playing
        ? 'You’re watching now.'
        : view.phase === 'playing'
          ? 'You’re seated. You’ll get cards at the next turn.'
          : 'You’re seated.',
    );
  };
  return (
    <Panel className="space-y-2">
      <SeatHeading title={`Players (${playing.length}/8)`}>
        {me && canChange && (
          <SeatToggle
            id={SEAT_CONTROL_ID}
            playing={me.playing}
            onChange={(playing) => void sit(playing)}
          />
        )}
      </SeatHeading>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center">
            {tag(s)}
          </li>
        ))}
        {playing.length === 0 && <li className="text-ink-muted italic">Nobody seated yet</li>}
      </ul>
      {me && recolor && (
        <p className="text-xs text-ink-muted">Pick your name to change your colour.</p>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <span className="font-semibold">Watching:</span>
        {watching.map((s) => (
          <span key={s.id} className="inline-flex">
            {tag(s)}
          </span>
        ))}
        {watching.length === 0 && <span className="italic">nobody</span>}
      </div>
      {note && (
        <p role="status" className="text-sm font-semibold text-success-ink">
          {note}
        </p>
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

/** The turn, the target, the draw pile and the clock: the line above the table. */
function RoundLine({ view, clockOffset }: { view: ReverieView; clockOffset: number }) {
  const turn = view.turn;
  return (
    <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted sm:text-sm">
      <span>
        {turn && view.phase === 'playing' ? `Turn ${turn.round}` : 'Game over'} · to{' '}
        {view.settings.targetScore} points · {view.drawPile} cards left to draw
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
  );
}

/** Everyone's score, who tells the story and who is still deciding (Players on phones). */
function Scoreboard({ view }: { view: ReverieView }) {
  const turn = view.turn;
  const playing = view.seats.filter((s) => s.playing);
  return (
    <div className="space-y-1">
      <ul className="flex flex-wrap gap-1.5" aria-label="Scores">
        {playing.map((s) => {
          const story = turn?.storyteller === s.id;
          const gained = turn?.results?.[s.id]?.points;
          return (
            <li
              key={s.id}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm ring-1',
                story ? 'bg-accent-soft ring-accent' : 'bg-card ring-line',
                turn && turn.phase !== 'reveal' && !s.done && !story && 'text-ink-muted',
              )}
              title={story ? 'Storyteller' : s.done ? 'Done' : 'Still deciding'}
            >
              <PlayerDot color={s.color} label={false} />
              <span className="max-w-24 truncate font-medium">{s.name}</span>
              {story && (
                <span className="text-xs font-semibold text-accent-text">📖 storyteller</span>
              )}
              <b className="tabular-nums">{s.score}</b>
              {gained !== undefined && gained > 0 && (
                <span className="text-xs font-bold text-success-ink">+{gained}</span>
              )}
            </li>
          );
        })}
      </ul>
      {turn && view.phase === 'playing' && (
        <p className="text-xs text-ink-muted" data-testid="next-storyteller">
          {turn.phase !== 'reveal' && 'Faded names are still deciding. '}
          {turn.nextStoryteller !== turn.storyteller && (
            <>
              Next storyteller: <b>{nameOf(view, turn.nextStoryteller)}</b>
            </>
          )}
        </p>
      )}
      {turn?.reshuffled && view.phase === 'playing' && (
        <p className="text-xs text-ink-muted" data-testid="reshuffled">
          🔀 The draw pile ran out, so the used cards were shuffled back in.
        </p>
      )}
    </div>
  );
}

/** Full-size card with the action that fits the moment. */
function CardViewer({
  card,
  title,
  onClose,
  action,
}: {
  card: number | null;
  title: string;
  onClose: () => void;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <Modal
      open={card !== null}
      onClose={onClose}
      title={card === null ? '' : title}
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
  pickColor,
  tab,
  setTab,
}: {
  view: ReverieView;
  room: ReverieUiProps['room'];
  act: Act;
  status: ReturnType<typeof statusFor>;
  online: (id: string) => boolean;
  pickColor?: () => void;
  tab: PlayTab;
  setTab: (tab: PlayTab) => void;
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
  const [confirm, confirmDialog] = useConfirm();
  const wide = useWideScreen();
  const [clue, setClue] = useState('');
  const [storyPick, setStoryPick] = useState<number | null>(null);
  const showHand = view.hand.length > 0 && view.phase === 'playing';

  const canTell = isStory && turn.phase === 'clue';
  // The hand matters while cards are being chosen; while voting and at the reveal it folds away
  // so it doesn't cover the table (a tap shows it again).
  const handNeeded = turn?.phase === 'clue' || turn?.phase === 'pick';
  const [handToggled, setHandToggled] = useState(false);
  const handOpen = handNeeded || handToggled;
  // A hint that the hand scrolls sideways while more cards are off to the right.
  const handList = useRef<HTMLUListElement>(null);
  const [handMore, setHandMore] = useState(false);
  const measureMore = () => {
    const el = handList.current;
    setHandMore(!!el && el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  };
  useEffect(() => {
    measureMore();
    const el = handList.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureMore);
    observer.observe(el);
    return () => observer.disconnect();
  }, [handOpen, view.hand.length]);
  const canNext = room.isHost && view.phase === 'playing' && turn?.phase === 'reveal';
  const canGive =
    !!turn && turn.phase === 'pick' && !isStory && !!me?.playing && turn.myCards.length === 0;
  // A vote can change until the last one is in (the reveal follows straight away).
  const canVote = !!turn && turn.phase === 'vote' && !isStory && !!me?.playing;
  const canSit = !!me && !me.playing && view.phase === 'playing' && turn?.phase === 'reveal';

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
      // One card to give: give it straight from the full-size view.
      if (view.cardsToGive === 1) {
        const card = viewing.card;
        return {
          label: 'Give this card',
          onClick: () => void act({ type: 'give', cards: [card] }).then(() => setViewing(null)),
        };
      }
      const on = picked.includes(viewing.card);
      return {
        label: on ? 'Put it back' : 'Pick this card',
        onClick: () => (togglePick(viewing.card), setViewing(null)),
      };
    }
    if (viewing.from === 'table' && canVote && viewing.index !== undefined) {
      const mine = turn.table[viewing.index]?.mine;
      const current = turn.myVote === viewing.index;
      return {
        label: mine
          ? "That's your card"
          : current
            ? 'Your vote'
            : turn.myVote === null
              ? `Vote for #${viewing.index + 1}`
              : `Change vote to #${viewing.index + 1}`,
        disabled: mine || current,
        onClick: () =>
          void act({ type: 'vote', index: viewing.index! }).then(() => setViewing(null)),
      };
    }
    return undefined;
  })();

  // The end: the scores, the awards, the last turn and the players one at a time, so it fits.
  const over = view.phase === 'over';
  const endTitle = winnersTitle(view.seats, me?.id) || 'Game over';
  const storyCard = turn?.table.find((t) => t.isStory) ?? null;
  const seats = (
    <Seats view={view} online={online} act={act} hostId={room.hostId} pickColor={pickColor} />
  );
  const clueLine = turn?.clue && (
    <p className="text-center text-lg">
      <span className="text-ink-muted">{nameOf(view, turn.storyteller)} says: </span>
      <b className="font-serif text-2xl">“{turn.clue}”</b>
    </p>
  );
  const tableSection = turn && turn.table.length > 0 && (
    <section aria-label="Table">
      <h3 className="mb-2 font-bold">On the table</h3>
      <ul
        className={cn(
          'grid max-h-[calc(100dvh-20rem)] grid-cols-2 gap-2 overflow-y-auto p-1 sm:grid-cols-3 lg:max-h-none lg:justify-center lg:gap-3',
          // Wide screens: a table of four or fewer stands in one row as tall as the window allows;
          // a bigger table keeps two rows that still fit.
          turn.table.length > 4 && 'lg:grid-cols-[repeat(auto-fit,minmax(10rem,min(14rem,24dvh)))]',
        )}
        style={
          !wide && turn.table.length <= 4
            ? {
                // Phones: a table of four or fewer fits the height above the hand bar, so every
                // card (and, at the reveal, its owner and votes) shows without scrolling.
                gridTemplateColumns: `repeat(2, minmax(0, min(50%, calc((100dvh - 23.5rem - ${
                  turn.phase === 'reveal' ? '7rem' : '2rem'
                }) / 2 * 366 / 512))))`,
                justifyContent: 'center',
              }
            : wide && turn.table.length <= 4
              ? {
                  // While everyone studies the table to vote, the cards take the height the
                  // collapsed hand leaves (a table of three or fewer grows to 22 rem; four fill
                  // the column's width).
                  gridTemplateColumns: `repeat(${turn.table.length}, minmax(0, ${
                    turn.phase === 'reveal'
                      ? 'min(18rem, 36dvh)'
                      : turn.phase === 'vote'
                        ? 'min(22rem, 46dvh)'
                        : 'min(16rem, 34dvh)'
                  }))`,
                }
              : undefined
        }
      >
        {turn.table.map((t, i) => (
          <li key={i} className="space-y-1">
            <Card
              card={t.card}
              label={i + 1}
              selected={turn.myVote === i}
              dimmed={canVote && t.mine}
              onClick={() => setViewing({ card: t.card, from: 'table', index: i })}
              className={cn(t.isStory && 'ring-4 ring-success')}
            />
            {turn.phase === 'reveal' && (
              <div className="text-center text-xs leading-snug">
                {t.isStory && <p className="font-bold text-success-ink">📖 Story card</p>}
                {t.owner && (
                  <p className="flex min-w-0 items-center justify-center gap-1 font-semibold">
                    <span className="min-w-0 truncate">{nameOf(view, t.owner)}</span>
                    <NameDot name={nameOf(view, t.owner)} className="order-first" />
                    {t.mine && <span className="shrink-0">(you)</span>}
                  </p>
                )}
                {turn.myVote === i && (
                  <p className="font-semibold text-accent-text">✋ Your vote</p>
                )}
                <p className="text-ink-muted">
                  {t.voters.length > 0 ? 'Votes: ' : 'No votes'}
                  {t.voters.map((v, n) => (
                    <span key={v}>
                      {n > 0 && ' '}
                      <span className="inline-flex max-w-full items-center gap-0.5 align-middle">
                        <span className="min-w-0 truncate">{nameOf(view, v)}</span>
                        <NameDot name={nameOf(view, v)} className="order-first" />
                      </span>
                    </span>
                  ))}
                </p>
              </div>
            )}
            {turn.phase !== 'reveal' && t.mine && (
              <p className="text-center text-xs text-ink-muted">yours</p>
            )}
            {turn.phase !== 'reveal' && turn.myVote === i && (
              <p className="text-center text-xs font-semibold text-accent-text">✋ your vote</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
  const results = turn?.phase === 'reveal' && turn.results && (
    <Panel className="space-y-1 text-sm">
      <p className="font-bold" data-testid="reveal-headline">
        {revealHeadline(view)}
      </p>
      {missedVoteNote(view) && <p className="text-ink-muted">{missedVoteNote(view)}</p>}
      <ul className="grid gap-x-4 sm:grid-cols-2">
        {view.seats
          .filter((s) => s.playing && turn.results![s.id])
          .map((s) => {
            const r = turn.results![s.id]!;
            return (
              <li key={s.id} className="flex justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="min-w-0">
                    {s.name}
                    {s.id === turn.storyteller && ' (storyteller)'}
                    <span className="text-ink-muted"> · {pointsBreakdown(view, s.id)}</span>
                  </span>
                  <NameDot name={s.name} className="order-first" />
                </span>
                <b className={cn('shrink-0', r.points > 0 ? 'text-success-ink' : 'text-ink-muted')}>
                  +{r.points}
                </b>
              </li>
            );
          })}
      </ul>
    </Panel>
  );

  // Phones and tablets in play: the round on one tab, the scores and seats on the other; wide
  // screens keep both, the players in the rail.
  const tabbed = !wide && view.phase === 'playing';
  const shown: PlayTab | null = tabbed ? tab : null;

  return (
    <div
      className={cn(!over && 'lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-6')}
    >
      <div
        className={cn('min-w-0 space-y-3', shown === 'players' && 'hidden')}
        {...(shown === 'table' && tabPanelProps(PLAY_TABS_ID, 'table'))}
      >
        {confirmDialog}
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        {/* Wide screens hold the round line in the rail, so the cards get the height. */}
        {!(wide && view.phase === 'playing') && (
          <RoundLine view={view} clockOffset={room.clockOffset} />
        )}
        {turn?.reshuffled && view.phase === 'playing' && (
          <p className="text-xs text-ink-muted" data-testid="reshuffled">
            🔀 The draw pile ran out, so the used cards were shuffled back in.
          </p>
        )}
        {canSit && (
          <div className="flex flex-wrap justify-center gap-2">
            {canSit && (
              <Button
                size="lg"
                variant={canNext ? 'secondary' : 'primary'}
                onClick={() => void act({ type: 'sit', playing: true })}
              >
                Take a seat
              </Button>
            )}
          </div>
        )}

        {!over && clueLine}

        {over && (
          <EndLayout
            hero={
              <EndHero
                title={endTitle}
                eyebrow={endTitle === 'Game over' ? null : undefined}
                // The last story card and its clue: the night's final picture.
                emblem={storyCard ? null : '🏆'}
                art={
                  storyCard && (
                    <figure className={cn('flex flex-col items-center gap-1.5', END_ART[1])}>
                      <Card
                        card={storyCard.card}
                        eager
                        onClick={() => setViewing({ card: storyCard.card, from: 'table' })}
                        className="shadow-vt-2 ring-4 ring-success"
                      />
                      {turn?.clue && (
                        <figcaption className="font-serif text-small text-ink-2 italic lg:text-body">
                          “{turn.clue}”
                        </figcaption>
                      )}
                    </figure>
                  )
                }
                superlatives={wide ? room.superlatives : undefined}
                actions={
                  room.isHost ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button
                        size="lg"
                        onClick={() =>
                          void (async () => {
                            if (
                              await confirm({
                                title: 'Start a new game with the same players?',
                                body: 'Scores go back to 0.',
                                confirmLabel: 'Play again',
                              })
                            ) {
                              void act({ type: 'start' });
                            }
                          })()
                        }
                      >
                        Play again
                      </Button>
                      <Button
                        variant="secondary"
                        size="lg"
                        onClick={() => void act({ type: 'back-to-lobby' })}
                      >
                        Change setup
                      </Button>
                    </div>
                  ) : (
                    <p>{waitingForHost(room, 'start the next game')}</p>
                  )
                }
              />
            }
          >
            <Panel className="space-y-3 text-center max-lg:p-3">
              <EndTabs
                tabs={[
                  {
                    id: 'scores',
                    label: '🏆 Scores',
                    content: (
                      <Standings
                        entries={view.seats
                          .filter((s) => s.playing || s.score > 0)
                          .map((s) => ({ id: s.id, name: s.name, score: s.score }))}
                        you={me?.id}
                        className="text-left"
                      />
                    ),
                  },
                  !wide &&
                    !!room.superlatives?.length && {
                      id: 'awards',
                      label: '✨ Awards',
                      content: <Superlatives lines={room.superlatives} />,
                    },
                  !!turn && {
                    id: 'turn',
                    label: '🃏 Turn',
                    content: (
                      <div className="space-y-3 text-left">
                        {clueLine}
                        {tableSection}
                        {results}
                      </div>
                    ),
                  },
                  { id: 'players', label: '👥 Players', content: seats },
                ]}
              />
            </Panel>
          </EndLayout>
        )}

        {!over && (tableSection || results) && (
          <FitArea phone plain min={128}>
            <div className="space-y-3">
              {tableSection}
              {results}
            </div>
          </FitArea>
        )}

        {showHand && (
          <StickyBar fixed refusal={canTell ? TELL_ANCHOR : undefined}>
            {canNext && (
              <Button
                size="lg"
                className="mb-2 w-full sm:w-auto"
                onClick={() => void act({ type: 'next-turn' })}
              >
                {targetReached(view) ? 'See final scores' : 'Next turn'}
              </Button>
            )}
            <section aria-label="Your hand" className="space-y-2">
              {canTell && storyPick !== null && (
                <form onSubmit={(e) => void tell(e)} className="flex items-end gap-2 sm:gap-3">
                  <div className="w-12 shrink-0 sm:w-24">
                    <Card
                      card={storyPick}
                      onClick={() => setViewing({ card: storyPick, from: 'hand' })}
                    />
                  </div>
                  <label className="min-w-0 flex-1">
                    <span className="text-sm font-semibold">Your clue</span>
                    <Input
                      autoFocus
                      value={clue}
                      maxLength={MAX_CLUE_LENGTH}
                      onChange={(e) => setClue(e.target.value)}
                      placeholder="A word, a line, a feeling…"
                      className="mt-1"
                    />
                  </label>
                  <Button type="submit" size="lg" disabled={!clue.trim()}>
                    Tell
                  </Button>
                </form>
              )}
              <div
                className={cn(
                  'flex min-h-8 items-center justify-between gap-2 text-xs font-semibold text-ink-muted',
                  // While the hand is the screen, wide screens drop the label row (the hint above
                  // already says what to tap) so the cards get its height; giving two cards keeps
                  // it for its button.
                  handNeeded && !(canGive && view.cardsToGive === 2) && 'lg:hidden',
                )}
              >
                <span>
                  Your hand
                  {handOpen && handMore && !handNeeded && (
                    <span className="font-normal"> · swipe for more →</span>
                  )}
                </span>
                {canGive && view.cardsToGive === 2 ? (
                  picked.length === 2 ? (
                    <Button
                      size="sm"
                      onClick={() =>
                        void act({ type: 'give', cards: picked }).then((ok) => ok && setPicked([]))
                      }
                    >
                      Give these cards
                    </Button>
                  ) : (
                    <span className="text-accent-text">Pick {2 - picked.length} more</span>
                  )
                ) : canGive ? (
                  <span className="text-accent-text">Tap a card to give it</span>
                ) : (
                  !handNeeded && (
                    <button
                      type="button"
                      aria-expanded={handOpen}
                      onClick={() => setHandToggled((t) => !t)}
                      className="-my-1 min-h-11 rounded-lg px-2 text-accent-text"
                    >
                      {handOpen ? 'Hide ▾' : `Show (${view.hand.length}) ▴`}
                    </button>
                  )
                )}
              </div>
              {handOpen && (
                <div className="relative">
                  <ul
                    ref={handList}
                    onScroll={measureMore}
                    className={cn(
                      handNeeded
                        ? // While cards are being chosen the hand is the screen's art: a grid that
                          // takes the free height (two across a phone, scrolling down if it must;
                          // three across a tablet; the whole hand in one row on a wide screen),
                          // not a strip under an empty table.
                          cn(
                            'mx-auto grid max-w-[48rem] grid-cols-2 gap-3 px-1 py-1.5 sm:grid-cols-3',
                            // Wide screens: while the table is still empty (the storyteller
                            // choosing), the hand is two rows of three sized to the window's
                            // height; once cards are on the table, one row under them.
                            turn && turn.table.length === 0 && !(storyPick !== null && canTell)
                              ? turn.clue
                                ? // The clue line shares the height while cards are picked.
                                  'lg:max-w-[calc((100dvh-14.25rem)*1.07)] lg:gap-3'
                                : 'lg:max-w-[calc((100dvh-11.5rem)*1.07)] lg:gap-3'
                              : 'lg:max-w-none lg:grid-flow-col lg:grid-cols-none lg:auto-cols-[minmax(0,13rem)] lg:justify-center',
                            'max-sm:overflow-y-auto',
                            // What else shares the phone's height: the clue form once the
                            // storyteller has picked, the table's face-down cards while others pick.
                            turn?.phase === 'pick' && turn.table.length > 0
                              ? 'max-sm:max-h-[calc(100dvh-28rem)]'
                              : turn?.phase === 'pick'
                                ? 'max-sm:max-h-[calc(100dvh-22rem)]'
                                : storyPick !== null
                                  ? 'max-sm:max-h-[calc(100dvh-26rem)]'
                                  : 'max-sm:max-h-[calc(100dvh-19rem)]',
                          )
                        : 'flex gap-2 overflow-x-auto px-1 py-1.5',
                    )}
                  >
                    {view.hand.map((card) => (
                      <li key={card} className={cn(!handNeeded && 'w-24 shrink-0 sm:w-36')}>
                        <Card
                          card={card}
                          eager
                          selected={picked.includes(card) || storyPick === card}
                          label={picked.includes(card) ? '✓' : undefined}
                          onClick={() => setViewing({ card, from: 'hand' })}
                        />
                      </li>
                    ))}
                  </ul>
                  {handMore && !handNeeded && (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-panel"
                    />
                  )}
                </div>
              )}
            </section>
          </StickyBar>
        )}
      </div>

      <aside
        className={cn(
          'space-y-3',
          shown === 'table' && 'hidden',
          over && 'hidden',
          !tabbed && !over && 'max-lg:mt-3',
        )}
        {...(shown === 'players' && tabPanelProps(PLAY_TABS_ID, 'players'))}
      >
        {view.phase === 'playing' && (
          <Panel>
            {wide && (
              <div className="mb-3">
                <RoundLine view={view} clockOffset={room.clockOffset} />
              </div>
            )}
            <Scoreboard view={view} />
          </Panel>
        )}
        {seats}
      </aside>
      {tabbed && (
        <TabBar
          id={PLAY_TABS_ID}
          label="Reverie"
          items={PLAY_TABS}
          value={tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
      <CardViewer
        card={viewing?.card ?? null}
        title={
          viewing?.from === 'table' && viewing.index !== undefined
            ? `Card #${viewing.index + 1}`
            : 'Your card'
        }
        onClose={() => setViewing(null)}
        action={viewerAction}
      />
    </div>
  );
}
