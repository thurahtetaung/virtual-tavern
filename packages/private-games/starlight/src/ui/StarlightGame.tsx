import { type ActOptions, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import { Card, cardSetChoices, useManifest } from '@vt/private-reverie/card';
import {
  Button,
  ChoicePicker,
  Countdown,
  Hint,
  LobbySettings,
  Modal,
  NameDot,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  TimerSettings,
  WordListPicker,
  cn,
  timersLine,
  useAbandonGame,
  useConfirm,
  useSpectatorPrompt,
  wordListsLine,
} from '@vt/ui';
import { useEffect, useState } from 'react';
import {
  CARD_SETS,
  COLUMNS,
  GRID,
  MAX_MARKS,
  MAX_PLAYERS,
  MIN_MARKS,
  ROUNDS,
  type RoundView,
  type Shown,
  type StarlightAction,
  type StarlightView,
  cardsIn,
} from '../logic/types.ts';
import {
  type Status,
  nameOf,
  names,
  roundName,
  showLine,
  startBlocker,
  statusFor,
} from './status.ts';
import {
  type ManifestState,
  firstScoutArt,
  lanternArt,
  useManifest as useTokens,
} from './assets.ts';
import { Tip } from './Tips.tsx';

export type StarlightUiProps = GameUiProps<StarlightView, StarlightAction>;
type Act = (a: StarlightAction, options?: ActOptions) => Promise<boolean>;
type Room = StarlightUiProps['room'];

const SEAT_CONTROL_ID = 'starlight-seat';
const SLATE_ANCHOR = 'starlight-slate';
const SHOW_ANCHOR = 'starlight-show';

const OUTCOME: Record<Shown['kind'], { icon: string; label: string }> = {
  spark: { icon: '✨', label: 'Spark' },
  super: { icon: '🌟', label: 'Super-Spark' },
  fall: { icon: '🌠', label: 'Fall' },
};

/** "B2": the column letter and the line number, as players say it across the table. */
export const posName = (pos: number) => `${'ABCDE'[pos % COLUMNS]}${Math.floor(pos / COLUMNS) + 1}`;

export function StarlightGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
  pickColor,
}: StarlightUiProps) {
  const manifest = useManifest();
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const cardCount = CARD_SETS.filter((s) => view.settings.sets.includes(s.id)).reduce(
    (n, s) => n + cardsIn(s).length,
    0,
  );
  const wordCount = view.wordLists
    .filter((l) => view.settings.wordListIds.includes(l.id))
    .reduce((n, l) => n + l.wordCount, 0);
  const blocker = startBlocker(view, cardCount, wordCount);
  const status = statusFor(view, room, blocker);
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const r = view.round;
  const seatsOpen = view.phase !== 'playing' || r?.stage === 'done';
  const full = view.seats.filter((s) => s.playing).length >= MAX_PLAYERS;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? full
        ? { text: `All ${MAX_PLAYERS} seats are taken.` }
        : seatsOpen
          ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
          : { text: 'You can take a seat when this round is scored.' }
      : null,
  );
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
        <Seats view={view} room={room} online={online} act={act} pickColor={pickColor} />
        <LobbySettings
          editable={room.isHost}
          summary={[
            wordListsLine(view.settings.wordListIds, view.wordLists),
            `${view.settings.sets.length} card ${view.settings.sets.length === 1 ? 'set' : 'sets'}`,
            timersLine(view.settings, { clue: 'marking', guess: 'Scouts' }),
          ]}
          className="space-y-4"
        >
          {room.isHost && <h3 className="text-lg font-bold">Game settings</h3>}
          <WordListPicker
            selectedIds={view.settings.wordListIds}
            wordLists={view.wordLists}
            editable={room.isHost}
            onSave={(ids) => act({ type: 'update-settings', wordListIds: ids })}
            summary={(chosen, total) =>
              `One word a round, drawn from ${chosen.length === 1 ? 'this list' : 'these lists'} (${total} words).`
            }
          />
          <ChoicePicker
            selectedIds={view.settings.sets}
            choices={cardSetChoices(manifest)}
            editable={room.isHost}
            onSave={(ids) => act({ type: 'update-settings', sets: ids })}
            labels={{
              title: 'Picture cards',
              unit: 'cards',
              noun: 'set',
              change: 'Change card sets',
              summary: (chosen, total) =>
                `Playing with ${chosen.length === 1 ? 'this set' : 'these sets'} (${total} cards; a game uses 30).`,
            }}
          />
          <TimerSettings
            values={view.settings}
            editable={room.isHost}
            onChange={(patch) => void act({ type: 'update-settings', ...patch })}
            clueLabel="Marking timer"
            guessLabel="Scout timer"
            clueHelp="Time to mark your slate. The rules say take as long as you like."
            guessHelp="Time for each Scout to show a card."
            strictHelp="open slates lock as they are, and a slow Scout shows a random card of theirs"
          />
          {room.isHost && (
            <StickyBar>
              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4 dark:border-stone-800">
                <Button
                  size="lg"
                  disabled={blocker !== null}
                  onClick={() => void act({ type: 'start' })}
                >
                  Start game
                </Button>
                {blocker && <span className="text-sm text-ink-muted">{blocker}</span>}
              </div>
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

  return (
    <Play
      key={`${r?.no ?? 0}`}
      view={view}
      room={room}
      act={act}
      status={status}
      online={online}
      pickColor={pickColor}
    />
  );
}

function Seats({
  view,
  room,
  online,
  act,
  pickColor,
}: {
  view: StarlightView;
  room: Room;
  online: (id: string) => boolean;
  act: Act;
  pickColor?: () => void;
}) {
  const me = view.me;
  const playing = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const tag = (s: StarlightView['seats'][number]) => {
    const name = (
      <PlayerTag
        name={s.name}
        host={s.id === room.hostId}
        you={s.id === me?.id}
        offline={!online(s.id)}
      />
    );
    if (s.id !== me?.id || !pickColor) return name;
    return (
      <button
        type="button"
        onClick={pickColor}
        aria-label={`${s.name} (you): change your colour`}
        className="-mx-1 inline-flex min-h-11 items-center rounded-lg px-1 hover:bg-card focus-visible:outline-2 focus-visible:outline-accent"
      >
        {name}
      </button>
    );
  };
  return (
    <Panel className="space-y-2">
      <h3 className="font-bold">
        Players ({playing.length}/{MAX_PLAYERS})
      </h3>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        {playing.map((s) => (
          <li key={s.id} className="inline-flex items-center">
            {tag(s)}
          </li>
        ))}
        {playing.length === 0 && <li className="text-ink-muted italic">Nobody seated yet</li>}
      </ul>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        <span className="font-semibold">Watching:</span>
        {watching.map((s) => (
          <span key={s.id} className="inline-flex">
            {tag(s)}
          </span>
        ))}
        {watching.length === 0 && <span className="italic">nobody</span>}
      </div>
      {me && (
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

/** What each step's clock is for, and what a strict timer does at 0:00. */
const STEP_TIMER: Partial<Record<RoundView['stage'], { label: string; atZero: string }>> = {
  mark: { label: 'to mark', atZero: 'then open slates lock as they are' },
  reveal: { label: 'to show a card', atZero: 'then a random card is shown' },
};

function Play({
  view,
  room,
  act,
  status,
  online,
  pickColor,
}: {
  view: StarlightView;
  room: Room;
  act: Act;
  status: Status;
  online: (id: string) => boolean;
  pickColor?: () => void;
}) {
  const r = view.round!;
  const me = view.me;
  const you = me?.id;
  const playing = !!you && r.players.includes(you) && !r.gone.includes(you);
  const locked = !!you && r.locked.includes(you);
  // The slate as you are drawing it: sent whole after each tap. Once locked (or past marking)
  // the server's copy is the slate.
  const [draft, setDraft] = useState<number[]>(r.myMarks);
  const canMark = r.stage === 'mark' && playing && !locked;
  const marks = canMark ? draft : r.myMarks;
  const [note, setNote] = useState<string | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [tab, setTab] = useState<'table' | 'stars'>('table');
  const [confirm, confirmDialog] = useConfirm();
  const shownAt = new Map(r.shown.map((s) => [s.pos, s]));
  const myLeft = marks.filter((p) => !shownAt.has(p));
  const isScout = r.stage === 'reveal' && r.scout === you;
  const last = r.shown.at(-1);

  const toggle = (pos: number) => {
    const next = marks.includes(pos) ? marks.filter((p) => p !== pos) : [...marks, pos];
    if (next.length > MAX_MARKS) {
      setNote(`At most ${MAX_MARKS} cards. Unmark one first.`);
      return;
    }
    setNote(null);
    const sorted = [...next].sort((a, b) => a - b);
    setDraft(sorted);
    void act({ type: 'mark', positions: sorted }, { anchor: SLATE_ANCHOR }).then((ok) => {
      if (!ok) setDraft(r.myMarks);
    });
  };

  const tap = (pos: number) => {
    if (canMark) toggle(pos);
    else setViewing(pos);
  };

  const viewerAction = (() => {
    if (viewing === null) return undefined;
    if (canMark) {
      const on = marks.includes(viewing);
      return {
        label: on ? 'Unmark it' : 'Mark it',
        onClick: () => (toggle(viewing), setViewing(null)),
      };
    }
    if (isScout && myLeft.includes(viewing)) {
      const pos = viewing;
      return {
        label: 'Show this card',
        onClick: () =>
          void act({ type: 'show', pos }, { anchor: SHOW_ANCHOR }).then(() => setViewing(null)),
      };
    }
    return undefined;
  })();

  const tokens = useTokens();
  const stars = <StarBoard view={view} room={room} online={online} pickColor={pickColor} />;

  return (
    <div className="space-y-3">
      {confirmDialog}
      <header className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold text-ink-muted sm:text-sm">
          <span className="flex items-center gap-1">
            {view.phase === 'over' ? 'Game over' : `Round ${roundName(r.no)} of ${ROUNDS}`} ·{' '}
            <Token tokens={tokens} src={firstScoutArt(tokens)} emoji="🔭" alt="First Scout pawn" />{' '}
            First Scout: {r.first === you ? 'you' : nameOf(view, r.first)}
          </span>
          {view.phase === 'playing' && (
            <Countdown
              deadline={r.stage === 'done' || (r.stage === 'mark' && locked) ? null : r.deadline}
              clockOffset={room.clockOffset}
              label={STEP_TIMER[r.stage]?.label}
              soft={view.settings.timerMode !== 'strict'}
              expiredHint="Just a reminder: the table waits."
              atZero={STEP_TIMER[r.stage]?.atZero}
            />
          )}
        </div>
        <p className="text-center" data-testid="starlight-word">
          <span className="block text-xs font-semibold tracking-wide text-ink-muted uppercase">
            The word
          </span>
          <b className="font-serif text-3xl sm:text-4xl">{r.word}</b>
        </p>
      </header>
      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
      {canMark && (
        <Tip id="marking">
          Tap a picture to mark it on your secret slate; tap again to unmark. 🔍 shows it full size.
        </Tip>
      )}
      {isScout && (
        <Tip id="scouting">
          Your unshown marks glow. Tap one, then Show it. If nobody else marked it, you fall.
        </Tip>
      )}

      {view.phase === 'over' && <Final view={view} room={room} act={act} confirm={confirm} />}

      {last && r.stage !== 'mark' && (
        <p
          role="status"
          data-testid="starlight-moment"
          className={cn(
            'rounded-xl px-3 py-2 text-center text-sm font-semibold ring-1',
            last.kind === 'fall'
              ? 'bg-danger-soft text-danger-ink ring-danger-line dark:bg-red-500/10 dark:text-red-200 dark:ring-red-500/30'
              : 'bg-special-soft text-special-ink ring-special-line dark:bg-violet-500/10 dark:text-violet-100 dark:ring-violet-500/30',
          )}
        >
          {last.scout === you ? 'You' : nameOf(view, last.scout)} showed {posName(last.pos)}.{' '}
          {showLine(view, last, you)}
          {last.auto && ' (Time ran out: it was picked at random.)'}
        </p>
      )}

      {r.stage !== 'done' && <DarkLine view={view} tokens={tokens} />}

      <div className="flex gap-1 rounded-xl bg-panel p-1 ring-1 ring-line sm:hidden dark:bg-stone-900 dark:ring-stone-800">
        {(
          [
            ['table', '🖼️ Table'],
            ['stars', '⭐ Stars'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'min-h-11 flex-1 rounded-lg text-sm font-semibold',
              tab === id ? 'bg-card shadow-sm dark:bg-stone-800' : 'text-ink-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="gap-4 sm:grid sm:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section
          aria-label="The cards"
          className={cn('space-y-2', tab !== 'table' && 'hidden sm:block')}
        >
          <ul
            // Three lines of cards fit the screen's height on any desktop.
            style={{ maxWidth: 'min(48rem, 68dvh)' }}
            className="mx-auto grid grid-cols-5 gap-1.5 sm:gap-2"
          >
            {Array.from({ length: GRID }, (_, pos) => (
              <GridCard
                key={pos}
                pos={pos}
                card={r.board[pos]!}
                marked={marks.includes(pos)}
                shown={shownAt.get(pos)}
                fresh={r.fresh.includes(pos) && r.stage !== 'done' && r.shown.length === 0}
                glow={isScout && myLeft.includes(pos)}
                dim={isScout && !myLeft.includes(pos)}
                view={view}
                onTap={() => tap(pos)}
                onZoom={() => setViewing(pos)}
              />
            ))}
          </ul>
          {r.stage === 'mark' && playing && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <span className="text-sm font-semibold" data-testid="starlight-count">
                {marks.length} marked
                <span className="font-normal text-ink-muted">
                  {' '}
                  ({MIN_MARKS}–{MAX_MARKS})
                </span>
              </span>
              {locked ? (
                <Button
                  variant="secondary"
                  onClick={() => void act({ type: 'unlock' }, { anchor: SLATE_ANCHOR })}
                >
                  Unlock to change
                </Button>
              ) : (
                <Button
                  disabled={marks.length < MIN_MARKS}
                  onClick={() => void act({ type: 'lock' }, { anchor: SLATE_ANCHOR })}
                >
                  Lock my slate
                </Button>
              )}
              {note && <p className="w-full text-center text-sm text-ink-muted">{note}</p>}
              <RefusalSlot anchor={SLATE_ANCHOR} resetKey={r.locked.length} />
            </div>
          )}
          {isScout && <RefusalSlot anchor={SHOW_ANCHOR} resetKey={r.shown.length} />}
        </section>
        <aside className={cn('mt-3 space-y-3 sm:mt-0', tab !== 'stars' && 'hidden sm:block')}>
          {stars}
        </aside>
      </div>

      {r.stage === 'done' && r.results && <RoundResults view={view} room={room} act={act} />}

      <Modal
        open={viewing !== null}
        onClose={() => setViewing(null)}
        title={viewing === null ? '' : `Card ${posName(viewing)}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setViewing(null)}>
              Close
            </Button>
            {viewerAction && <Button onClick={viewerAction.onClick}>{viewerAction.label}</Button>}
          </div>
        }
      >
        {viewing !== null && (
          <div className="space-y-2">
            <div className="mx-auto w-[min(100%,calc(55dvh*366/512))]">
              <Card card={r.board[viewing]!} big />
            </div>
            {shownAt.get(viewing) && (
              <p className="text-center text-sm">{showLine(view, shownAt.get(viewing)!, you)}</p>
            )}
            {marks.includes(viewing) && !shownAt.has(viewing) && (
              <p className="text-center text-sm text-ink-muted">✕ On your slate.</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function GridCard({
  pos,
  card,
  marked,
  shown,
  fresh,
  glow,
  dim,
  view,
  onTap,
  onZoom,
}: {
  pos: number;
  card: number;
  marked: boolean;
  shown: Shown | undefined;
  fresh: boolean;
  glow: boolean;
  dim: boolean;
  view: StarlightView;
  onTap: () => void;
  onZoom: () => void;
}) {
  const outcome = shown ? OUTCOME[shown.kind] : null;
  return (
    <li
      className="relative"
      data-testid={`starlight-card-${pos}`}
      data-marked={marked || undefined}
    >
      <button
        type="button"
        onClick={onTap}
        aria-label={`Card ${posName(pos)}${marked ? ', marked' : ''}${outcome ? `, ${outcome.label}` : ''}`}
        aria-pressed={marked}
        className={cn(
          'block w-full rounded-xl transition focus-visible:outline-2 focus-visible:outline-accent',
          dim && 'opacity-60',
        )}
      >
        <Card
          card={card}
          selected={marked || glow}
          className={cn(
            glow && 'animate-pulse motion-reduce:animate-none',
            shown?.kind === 'fall' && 'grayscale',
          )}
        />
      </button>
      <span className="pointer-events-none absolute top-1 left-1 rounded-full bg-stone-950/75 px-1.5 text-[0.65rem] font-bold text-white">
        {posName(pos)}
      </span>
      {marked && (
        <span
          aria-hidden
          className="pointer-events-none absolute top-1 right-1 flex size-6 items-center justify-center rounded-full bg-accent text-sm font-black text-accent-fg shadow"
        >
          ✕
        </span>
      )}
      {fresh && (
        <span className="pointer-events-none absolute inset-x-0 bottom-1 mx-auto w-fit rounded-full bg-stone-950/75 px-1.5 text-[0.65rem] font-bold text-white">
          New
        </span>
      )}
      {outcome && shown && (
        <span className="pointer-events-none absolute inset-x-1 top-7 flex flex-wrap items-center justify-center gap-0.5 rounded-lg bg-stone-950/80 px-1 py-0.5 text-[0.65rem] font-bold text-white">
          <span aria-hidden>{outcome.icon}</span>
          {shown.markers.map((id) => (
            <NameDot key={id} name={nameOf(view, id)} />
          ))}
        </span>
      )}
      <button
        type="button"
        onClick={onZoom}
        aria-label={`Zoom card ${posName(pos)}`}
        className="absolute right-0.5 bottom-0.5 flex size-7 items-center justify-center rounded-full bg-stone-950/60 text-xs text-white"
      >
        🔍
      </button>
    </li>
  );
}

/**
 * A token's picture from the private manifest, or its emoji without one (or if it can't load).
 * While the manifest is still loading it keeps the space empty, so no emoji flashes first.
 */
function Token({
  src,
  emoji,
  alt,
  tokens,
}: {
  src: string | null;
  emoji: string;
  alt: string;
  tokens: ManifestState;
}) {
  const [failed, setFailed] = useState(false);
  if (tokens === null) return <span aria-hidden className="inline-block size-6 shrink-0" />;
  if (!src || failed)
    return (
      <span role="img" aria-label={alt} className="inline-block w-5 text-center">
        {emoji}
      </span>
    );
  return (
    <ProtectedImage
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="inline-block size-6 shrink-0 object-contain align-middle"
    />
  );
}

/** Who is in the Dark, from the Announce on: the one thing the table must know before showing. */
function DarkLine({ view, tokens }: { view: StarlightView; tokens: ManifestState }) {
  const r = view.round!;
  if (!r.counts) return null;
  const top = Math.max(...Object.values(r.counts));
  const dark = r.dark ? view.seats.find((s) => s.id === r.dark) : undefined;
  const you = view.me?.id;
  return (
    <p
      data-testid="starlight-dark"
      className="flex items-center justify-center gap-2 text-center text-sm text-ink-muted"
    >
      {dark ? (
        <>
          <Token
            tokens={tokens}
            src={lanternArt(tokens, dark.color, 'dark')}
            emoji="🌑"
            alt="Dark lantern"
          />
          <span>
            <b className="text-ink">
              {dark.id === you ? 'You are' : `${dark.name} is`} in the Dark
            </b>{' '}
            with {top} marks: a fall costs a point per Spark.
          </span>
        </>
      ) : (
        <span>🏮 Nobody is in the Dark: the most marks ({top}) is shared.</span>
      )}
    </p>
  );
}

/** The table of stars: each player's step, count, the Dark, falls and scores. */
function StarBoard({
  view,
  room,
  online,
  pickColor,
}: {
  view: StarlightView;
  room: Room;
  online: (id: string) => boolean;
  pickColor?: () => void;
}) {
  const r = view.round!;
  const you = view.me?.id;
  const tokens = useTokens();
  const seats = view.seats.filter((s) => s.playing || r.players.includes(s.id));
  return (
    <Panel className="space-y-2 p-3">
      <h3 className="font-bold">Stars</h3>
      <ul className="space-y-1.5 text-sm">
        {seats.map((s) => {
          const inRound = r.players.includes(s.id);
          const gone = r.gone.includes(s.id);
          const chips: string[] = [];
          if (s.id === r.first) chips.push('First Scout');
          if (r.stage === 'reveal' && r.scout === s.id) chips.push('👉 Scout');
          if (r.stage === 'mark' && inRound)
            chips.push(r.locked.includes(s.id) ? '🔒 locked' : '✏️ marking');
          if (r.counts?.[s.id] !== undefined) chips.push(`✕ ${r.counts[s.id]}`);
          if (r.dark === s.id) chips.push('in the Dark');
          if (r.fallen.includes(s.id)) chips.push('🌠 fell');
          if (gone) chips.push('left');
          if (r.stage === 'reveal' && r.left?.[s.id] !== undefined && !r.fallen.includes(s.id))
            chips.push(`${r.left[s.id]} to show`);
          return (
            <li key={s.id} className="space-y-0.5" data-testid={`starlight-player-${s.id}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1">
                  {s.id === r.first && (
                    <Token
                      tokens={tokens}
                      src={firstScoutArt(tokens)}
                      emoji="🔭"
                      alt="First Scout pawn"
                    />
                  )}
                  {r.counts?.[s.id] !== undefined && (
                    <Token
                      tokens={tokens}
                      src={lanternArt(tokens, s.color, r.dark === s.id ? 'dark' : 'light')}
                      emoji={r.dark === s.id ? '🌑' : '🏮'}
                      alt={r.dark === s.id ? 'Lantern, Dark side' : 'Lantern, Light side'}
                    />
                  )}
                  <PlayerTag
                    name={s.name}
                    host={s.id === room.hostId}
                    you={s.id === you}
                    offline={!online(s.id)}
                  />
                </span>
                <span className="shrink-0 font-bold tabular-nums">
                  {inRound && r.stage !== 'done' && (
                    <span className="font-semibold text-amber-700 dark:text-amber-300">
                      +{r.stars[s.id] ?? 0}★{' '}
                    </span>
                  )}
                  {s.score} pts
                </span>
              </div>
              {chips.length > 0 && <p className="text-xs text-ink-muted">{chips.join(' · ')}</p>}
            </li>
          );
        })}
      </ul>
      {view.me && pickColor && (
        <button
          type="button"
          onClick={pickColor}
          className="min-h-11 text-xs font-semibold text-ink-muted underline"
        >
          Change your colour
        </button>
      )}
      <ScoreSlate view={view} />
    </Panel>
  );
}

/** The scoring slate: points per round. */
function ScoreSlate({ view }: { view: StarlightView }) {
  const seats = view.seats.filter((s) => s.rounds.length > 0);
  if (!seats.length) return null;
  return (
    <table className="w-full text-xs tabular-nums">
      <thead>
        <tr className="text-ink-muted">
          <th className="text-left font-semibold">Round</th>
          {Array.from({ length: ROUNDS }, (_, i) => (
            <th key={i} className="font-semibold">
              {roundName(i + 1)}
            </th>
          ))}
          <th className="font-semibold">Total</th>
        </tr>
      </thead>
      <tbody>
        {seats.map((s) => (
          <tr key={s.id}>
            <td className="max-w-20 truncate">{s.name}</td>
            {Array.from({ length: ROUNDS }, (_, i) => (
              <td key={i} className="text-center">
                {s.rounds[i] ?? '·'}
              </td>
            ))}
            <td className="text-center font-bold">{s.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RoundResults({ view, room, act }: { view: StarlightView; room: Room; act: Act }) {
  const r = view.round!;
  const results = r.results!;
  const you = view.me?.id;
  const over = view.phase === 'over';
  const counts = { spark: 0, super: 0, fall: 0 };
  for (const s of r.shown) counts[s.kind]++;
  return (
    <Panel className="space-y-3" data-testid="starlight-results">
      <h3 className="font-bold">
        Round {roundName(r.no)}: {counts.spark} ✨ · {counts.super} 🌟 · {counts.fall} 🌠
      </h3>
      <ul className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {Object.entries(results).map(([id, res]) => (
          <li key={id} className="flex justify-between gap-2">
            <span className="flex min-w-0 items-baseline gap-1.5">
              <NameDot name={nameOf(view, id)} />
              <span className="min-w-0">
                {id === you ? 'You' : nameOf(view, id)}
                <span className="text-ink-muted">
                  {' '}
                  · {res.stars} ★{res.dark && res.fell && ` − ${res.boxes} (fell in the Dark)`}
                  {res.dark && !res.fell && ' (in the Dark, never fell)'}
                  {!res.dark && res.fell && ' (fell)'}
                </span>
              </span>
            </span>
            <b
              className={cn(
                'shrink-0',
                res.points > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-ink-muted',
              )}
            >
              +{res.points}
            </b>
          </li>
        ))}
      </ul>
      {r.autoLocked.length > 0 && (
        <p className="text-sm text-ink-muted">
          ⏱ Time ran out: {names(view, r.autoLocked, you)} had{' '}
          {r.autoLocked.length === 1 && r.autoLocked[0] !== you ? 'their slate' : 'slates'} locked
          as they were.
        </p>
      )}
      {!over && room.isHost && (
        <div className="flex justify-center">
          <Button size="lg" onClick={() => void act({ type: 'next-round' })}>
            {r.no >= ROUNDS ? 'See final scores' : 'Next round'}
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Final({
  view,
  room,
  act,
  confirm,
}: {
  view: StarlightView;
  room: Room;
  act: Act;
  confirm: ReturnType<typeof useConfirm>[0];
}) {
  const you = view.me?.id;
  return (
    <Panel>
      <div className="space-y-3 text-center">
        <Standings
          entries={view.seats
            .filter((s) => s.playing || s.score > 0)
            .map((s) => ({ id: s.id, name: s.name, score: s.score }))}
          you={you}
          className="text-left"
        />
        <Superlatives lines={room.superlatives} />
        {room.isHost ? (
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
                  )
                    void act({ type: 'start' });
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
        )}
      </div>
    </Panel>
  );
}
