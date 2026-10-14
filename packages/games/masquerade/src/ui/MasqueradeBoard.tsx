import { type GameRoomInfo, type GameUiProps, waitingFor, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  ProtectedImage,
  Standings,
  Superlatives,
  TimeoutNote,
  cn,
  useSecondsLeft,
  useSpectatorPrompt,
} from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import {
  ANSWER_TIP,
  GENERIC_QUESTIONS,
  SPY_BLUFF_TIPS,
  SPY_FISHING_QUESTIONS,
  SPY_SAFE_QUESTIONS,
} from '../content/questions.ts';
import type { MasqueradeAction, MasqueradeView, RoundView, Stage } from '../logic/types.ts';
import type { LocationDisplay } from './display.ts';
import { Peek } from './peek.tsx';
import { Lobby, Players } from './Lobby.tsx';
import { useMarks } from './notes.ts';
import {
  listNames,
  nameOf,
  noNameReason,
  nudgeFor,
  pointsRule,
  statusFor,
  voteTally,
} from './status.ts';

export type MasqueradeUiProps = GameUiProps<MasqueradeView, MasqueradeAction>;
type Act = (a: MasqueradeAction) => Promise<boolean>;
type Tab = 'play' | 'locations' | 'ideas';

// ---- Locations ----

/** A location's picture: its art when there is some, else its emoji or a numbered placeholder. */
function LocationPicture({
  id,
  display,
  className,
  artClassName = className,
}: {
  id: string;
  display: LocationDisplay;
  className?: string;
  /** Classes when there is art (landscape, 5:3), in place of `className`. */
  artClassName?: string;
}) {
  const art = display.art(id);
  const [failed, setFailed] = useState(false);
  if (art && !failed) {
    return (
      <ProtectedImage
        src={art}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={cn('object-cover', artClassName)}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={cn(
        'flex items-center justify-center bg-gradient-to-br from-violet-100 to-amber-100 dark:from-violet-950 dark:to-stone-900',
        className,
      )}
    >
      {display.emoji(id) ?? '📍'}
    </span>
  );
}

// ---- Top of the screen ----

/** What the round clock times, and what happens at 0:00 (Masquerade's timers always act). */
const CLOCK: Partial<Record<Stage, { label: string; atZero: string }>> = {
  talk: { label: 'to talk', atZero: 'then everyone votes' },
  vote: { label: 'to vote', atZero: 'no vote = abstain' },
  guess: { label: 'to guess the place', atZero: 'no guess = wrong' },
};

function TopBar({ view, room }: { view: MasqueradeView; room: GameRoomInfo }) {
  const round = view.round;
  if (!round) return null;
  const live = view.phase === 'playing' && round.stage !== 'reveal';
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-stone-600 dark:text-stone-400">
        <span>
          Round {round.number}/{view.totalRounds}
        </span>
        {/* Only watching is said up here: a player's card stays behind its peek. */}
        {round.role === 'watching' && (
          <span className="rounded-full bg-stone-200 px-2 py-0.5 text-xs font-bold dark:bg-stone-800">
            👀 Watching
          </span>
        )}
        {round.spyCount > 1 && <span className="text-xs">2 spies</span>}
        {round.spyCount === 1 && view.settings.twoSpies && (
          // Two spies is on, but too few are playing for it this round: say so.
          <span className="text-xs" data-testid="one-spy-note">
            1 spy ({round.players.length} playing)
          </span>
        )}
      </div>
      <Countdown
        deadline={live ? round.deadline : null}
        clockOffset={room.clockOffset}
        label={CLOCK[round.stage]?.label}
        atZero={CLOCK[round.stage]?.atZero}
      />
    </div>
  );
}

function Nudge({ view, room }: { view: MasqueradeView; room: GameRoomInfo }) {
  const round = view.round;
  const live = view.phase === 'playing' && round && round.stage !== 'reveal';
  const left = useSecondsLeft(live ? round.deadline : null, room.clockOffset);
  const text = nudgeFor(view, left);
  return (
    <p
      aria-live="polite"
      data-testid="nudge"
      className={cn(
        'rounded-lg bg-special-soft px-3 py-1.5 text-center text-sm font-medium text-violet-900 dark:bg-violet-500/10 dark:text-violet-200',
        !text && 'hidden',
      )}
    >
      {text}
    </p>
  );
}

// ---- Play tab ----

/** The status line, with the talk clock so "X asks first" fades into the asking rule. */
function StatusHint({ view, room }: { view: MasqueradeView; room: GameRoomInfo }) {
  const round = view.round;
  const talking = view.phase === 'playing' && round?.stage === 'talk';
  const left = useSecondsLeft(talking ? round.deadline : null, room.clockOffset);
  const status = statusFor(view, room.isHost, room, left);
  return <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>;
}

/**
 * Your card and its coaching, behind a peek: covered, it looks the same for the spy and the locals,
 * and nothing of it is in the page until you look.
 */
function MyCard({ round, display }: { round: RoundView; display: LocationDisplay }) {
  if (round.role === 'watching') return null;
  return (
    <section aria-label="Your card">
      <Peek
        what="your card"
        cover={
          <span
            data-testid="card-cover"
            className="flex min-h-24 items-center gap-3 rounded-2xl bg-gradient-to-br from-stone-700 to-stone-900 p-3 text-stone-100 shadow-sm ring-1 ring-stone-800"
          >
            <span aria-hidden className="text-4xl">
              🎴
            </span>
            <span className="min-w-0">
              <span className="block font-bold">Hold to see your card</span>
              <span className="block text-xs text-stone-300">
                Or tap Show. Keep it hidden from your neighbours.
              </span>
            </span>
          </span>
        }
      >
        <CardFace round={round} display={display} />
      </Peek>
    </section>
  );
}

function CardFace({ round, display }: { round: RoundView; display: LocationDisplay }) {
  const spy = round.role === 'spy';
  const location = round.location;
  return (
    <div className="space-y-2">
      <div
        data-testid="my-card"
        className={cn(
          'flex flex-wrap items-center gap-3 overflow-hidden rounded-2xl p-3 shadow-sm ring-1',
          spy
            ? 'bg-gradient-to-br from-violet-700 to-stone-900 text-white ring-violet-900'
            : 'bg-white ring-stone-200 dark:bg-stone-900 dark:ring-stone-700',
        )}
      >
        {spy ? (
          display.back ? (
            <ProtectedImage
              src={display.back}
              alt=""
              className="aspect-[20/13] w-24 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <span aria-hidden className="text-5xl">
              🎭
            </span>
          )
        ) : (
          location && (
            <LocationPicture
              id={location}
              display={display}
              className="size-20 shrink-0 rounded-xl text-5xl"
              artClassName="aspect-[5/3] w-full basis-full rounded-xl"
            />
          )
        )}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide uppercase opacity-70">
            {spy ? 'Your card' : 'The location'}
          </p>
          <p className="text-2xl leading-tight font-bold" data-testid="card-title">
            {spy ? 'You’re the spy' : location ? display.name(location) : ''}
          </p>
          <p className="text-xs opacity-80">
            {spy
              ? round.spyCount > 1
                ? 'There are two spies; you don’t know who the other is.'
                : 'Everyone else knows where you are.'
              : 'Everyone knows this except the spy.'}
          </p>
          {spy && round.stage === 'talk' && (
            <p className="mt-1 text-xs font-semibold" data-testid="spy-guess-rule">
              You can’t guess now. If the vote catches you, you get one guess; if it doesn’t, you
              score anyway.
            </p>
          )}
        </div>
      </div>
      <Coaching round={round} display={display} />
    </div>
  );
}

function Coaching({ round, display }: { round: RoundView; display: LocationDisplay }) {
  if (round.role === 'watching' || round.stage !== 'talk') return null;
  const tip =
    round.role === 'spy'
      ? 'Answer with feelings, not facts, and listen for answers that agree. Cross places off on the Locations board.'
      : (round.location && display.tip(round.location)) ||
        'Hint that you know the place, but keep it vague enough that the spy can’t work it out.';
  return (
    <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-amber-950 ring-1 ring-accent-line dark:bg-amber-500/10 dark:text-amber-100 dark:ring-amber-500/30">
      <b>💡 Coaching: </b>
      {tip}
    </p>
  );
}

function HowItWorks({ view, round }: { view: MasqueradeView; round: RoundView }) {
  const starter =
    round.starter === view.me?.id ? 'You start' : `${nameOf(view, round.starter)} starts`;
  // Open in the first round's talk, so first-timers read that the game is played out loud.
  return (
    <details
      open={round.number === 1 && round.stage === 'talk'}
      className="group rounded-xl bg-white/80 px-3 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>📋 How this round works · {starter}</span>
        <span aria-hidden className="text-stone-500 transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <ol className="list-decimal space-y-1 pb-3 pl-5 text-sm">
        <li>
          {starter}: ask anyone a question about the location, out loud. The app doesn’t track the
          talking.
        </li>
        <li>They answer, then ask someone else (not straight back).</li>
        <li>
          When the clock runs out, or everyone taps Ready to vote, you all vote once, in secret, for
          the spy.
        </li>
        <li>
          Nobody guesses during the talk. A spy the vote catches gets one guess at the location:
          right, and they steal the round. A spy who isn’t caught scores anyway.
        </li>
      </ol>
    </details>
  );
}

/**
 * "3 of 5 ready · Waiting for: Ana, Ben (offline)": counted, and the holdouts named. Without
 * `counted`, only the names (when the table nudge already shows the count).
 */
function Holdouts({
  round,
  done,
  verb,
  room,
  counted = true,
}: {
  round: RoundView;
  done: readonly string[];
  verb: string;
  room: GameRoomInfo;
  counted?: boolean;
}) {
  const left = round.players.map((p) => p.id).filter((id) => !done.includes(id));
  const names = waitingFor(left, room.players, { you: room.you });
  if (!counted) return <>{names}</>;
  return (
    <>
      {done.length} of {round.players.length} {verb}
      {names && ` · ${names}`}
    </>
  );
}

function ReadyToggle({ round, act, room }: { round: RoundView; act: Act; room: GameRoomInfo }) {
  if (round.stage !== 'talk' || round.role === 'watching') return null;
  return (
    <div className="space-y-1">
      <Button
        variant="secondary"
        aria-pressed={round.meReady}
        className="w-full"
        onClick={() => void act({ type: 'ready-to-vote', ready: !round.meReady })}
      >
        {round.meReady ? '✓ Ready to vote' : 'Done talking? Ready to vote'}
      </Button>
      <p className="text-center text-sm text-stone-600 tabular-nums dark:text-stone-400">
        <Holdouts round={round} done={round.readyIds} verb="ready" room={room} />
      </p>
      <p className="text-xs text-stone-500">
        The vote starts when everyone taps this, or when the clock runs out. Tap again to undo.
      </p>
    </div>
  );
}

function VotePanel({
  view,
  round,
  act,
  room,
}: {
  view: MasqueradeView;
  round: RoundView;
  act: Act;
  room: GameRoomInfo;
}) {
  if (round.stage !== 'vote' || round.role === 'watching') return null;
  const others = round.players.filter((p) => p.id !== view.me?.id);
  return (
    <section
      aria-label="Vote"
      className="space-y-2 rounded-2xl bg-white/80 p-4 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <h3 className="font-bold">🗳️ Who is the spy?</h3>
      <p className="text-xs text-stone-500">
        Secret until everyone has voted.{' '}
        <Holdouts round={round} done={round.votedIds} verb="voted" room={room} counted={false} />
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {others.map((p) => (
          <button
            key={p.id}
            type="button"
            aria-pressed={round.myVote === p.id}
            aria-label={`Vote for ${p.name}`}
            onClick={() => void act({ type: 'vote', target: p.id })}
            className={cn(
              'h-12 truncate rounded-lg px-3 font-semibold ring-1 transition',
              round.myVote === p.id
                ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
            )}
          >
            {round.myVote === p.id && '✓ '}
            {p.name}
          </button>
        ))}
      </div>
    </section>
  );
}

function GuessPanel({ round, onOpenBoard }: { round: RoundView; onOpenBoard: () => void }) {
  if (!round.canGuess) return null;
  return (
    <Panel className="space-y-2 text-center">
      <p className="text-lg font-bold">🎯 You were caught!</p>
      <p className="text-sm">
        One guess: pick the location on the board. Right, and you steal the round.
      </p>
      <Button size="lg" className="lg:hidden" onClick={onOpenBoard}>
        Open the Locations board
      </Button>
    </Panel>
  );
}

/** Everyone's vote, the tally and (once known) the spies, marked with an icon and text. */
function VotesList({
  view,
  votes,
  spies,
}: {
  view: MasqueradeView;
  votes: Record<string, string>;
  spies: readonly string[];
}) {
  const round = view.round!;
  const label = (id: string) => {
    const name = id === view.me?.id ? `${nameOf(view, id)} (you)` : nameOf(view, id);
    return spies.includes(id) ? `${name} 🎭 spy` : name;
  };
  const tally = voteTally(votes, round.players);
  return (
    <div className="space-y-1">
      {tally.length > 0 && (
        <p className="text-sm" data-testid="vote-tally">
          <b>Votes: </b>
          {tally.map((t) => `${label(t.id)} ${t.votes}`).join(' · ')}
        </p>
      )}
      <ul aria-label="Votes" className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm sm:grid-cols-2">
        {round.players.map((p) => (
          <li key={p.id} className="flex justify-between gap-2">
            <span className="truncate">{label(p.id)}</span>
            <span className="truncate text-stone-600 dark:text-stone-400">
              {votes[p.id] ? `→ ${label(votes[p.id]!)}` : 'abstained'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Reveal({
  view,
  display,
  act,
  room,
}: {
  view: MasqueradeView;
  display: LocationDisplay;
  act: Act;
  room: GameRoomInfo;
}) {
  const round = view.round!;
  const result = round.result;
  if (!result) return null;
  const who = (id: string) => (id === view.me?.id ? 'You' : nameOf(view, id));
  // With two spies each is scored on their own, so each line speaks for that spy only.
  const two = result.spies.length > 1;
  const line = (s: (typeof result.spyResults)[number]) => {
    const name = who(s.id);
    const was = name === 'You' ? 'were' : 'was';
    const plus = name === 'You' ? 'you score 2' : `${name} scores 2`;
    if (s.outcome === 'escaped') return `${name} escaped the vote: ${plus}.`;
    const them = name === 'You' ? 'you' : name;
    if (s.outcome === 'stole')
      return `${name} ${was} caught, then named the location${two ? '' : ' and stole the round'}: ${plus}, and votes against ${them} score nothing.`;
    const guessed = s.guess ? `guessed ${display.name(s.guess)}` : 'didn’t guess';
    return two
      ? `${name} ${was} caught and ${guessed}: the locals score for catching ${them}.`
      : `${name} ${was} caught and ${guessed}: the locals win the round.`;
  };
  const namedNames = result.named.map((id) => (id === view.me?.id ? 'you' : nameOf(view, id)));
  const scored = Object.entries(result.points).filter(([, n]) => n > 0);
  // The vote only ends early once everyone has voted, so a missing vote means the clock ran out.
  // When nobody voted at all, the no-name reason above already says so.
  const noVote = Object.keys(result.votes).length
    ? round.players.filter((p) => !result.votes[p.id]).map((p) => who(p.id))
    : [];
  const meSpy = !!view.me && result.spies.includes(view.me.id);
  const spyLine =
    meSpy && result.spies.length === 1 ? (
      <b>You were the spy</b>
    ) : (
      <>
        {result.spies.length > 1 ? 'The spies were' : 'The spy was'}{' '}
        <b>
          {listNames(result.spies.map((id) => (id === view.me?.id ? 'you' : nameOf(view, id))))}
        </b>
      </>
    );
  const noName = noNameReason(result);
  return (
    <Panel aria-label="Round result" className="space-y-3">
      <div className="flex items-center gap-3">
        <LocationPicture
          id={result.location}
          display={display}
          className="size-16 shrink-0 rounded-xl text-4xl"
          artClassName="aspect-[5/3] w-28 shrink-0 rounded-xl"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stone-500 uppercase">The location was</p>
          <p className="text-xl font-bold" data-testid="revealed-location">
            {display.name(result.location)}
          </p>
          <p className="text-sm">🎭 {spyLine}</p>
        </div>
      </div>
      {namedNames.length > 0 && (
        <p className="text-sm" data-testid="named-line">
          The vote named <b>{listNames(namedNames)}</b>.
        </p>
      )}
      <ul className="space-y-1 text-sm font-semibold">
        {result.spyResults.map((s) => (
          <li key={s.id}>{line(s)}</li>
        ))}
      </ul>
      {noName && (
        <p className="text-sm text-stone-600 dark:text-stone-400" data-testid="no-name-reason">
          {noName}
        </p>
      )}
      <VotesList view={view} votes={result.votes} spies={result.spies} />
      {noVote.length > 0 && (
        <TimeoutNote>
          {`${listNames(noVote)} didn’t vote, so ${noVote.length === 1 ? 'that counts' : 'those count'} as abstaining.`}
        </TimeoutNote>
      )}
      <div className="space-y-0.5 text-sm">
        <p>
          <b>Points: </b>
          {scored.length
            ? scored.map(([id, n]) => `${who(id)} +${n}`).join(', ')
            : 'nobody scored this round.'}
        </p>
        <p className="text-xs text-stone-600 dark:text-stone-400" data-testid="points-rule">
          {pointsRule(result)}
        </p>
      </div>
      {view.phase === 'playing' &&
        (room.isHost ? (
          <Button size="lg" className="w-full" onClick={() => void act({ type: 'next-round' })}>
            Next round
          </Button>
        ) : (
          <p className="text-center text-sm text-stone-500">
            {waitingForHost(room, 'deal the next round')}
          </p>
        ))}
    </Panel>
  );
}

function Scores({ view }: { view: MasqueradeView }) {
  const ranked = view.seats
    .filter((s) => s.playing || s.score > 0)
    .sort((a, b) => b.score - a.score);
  // Open by default once a round is scored; folded while people talk.
  const open = view.round?.stage === 'reveal';
  return (
    <details
      key={open ? 'open' : 'closed'}
      open={open}
      className="group rounded-xl bg-white/80 px-3 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>🏅 Scores</span>
        <span aria-hidden className="text-stone-500 transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <ol aria-label="Scores" className="space-y-0.5 pb-3 text-sm">
        {ranked.map((s) => (
          <li key={s.id} className="flex justify-between">
            <span>
              {s.name}
              {s.id === view.me?.id && ' (you)'}
            </span>
            <b className="tabular-nums">{s.score}</b>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The end screen: the shared podium and full standings (the winner line is the status above). */
function Podium({ view, act, room }: { view: MasqueradeView; act: Act; room: GameRoomInfo }) {
  const entries = view.seats
    .filter((s) => s.playing || s.score > 0)
    .map((s) => ({ id: s.id, name: s.name, score: s.score }));
  return (
    <Panel aria-label="Final scores" className="space-y-4">
      <Standings entries={entries} you={view.me?.id} />
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change settings
          </Button>
        </div>
      ) : (
        <p className="text-center">{waitingForHost(room, 'start the next game')}</p>
      )}
    </Panel>
  );
}

// ---- Locations tab ----

function LocationsBoard({
  view,
  display,
  act,
}: {
  view: MasqueradeView;
  display: LocationDisplay;
  act: Act;
}) {
  const round = view.round;
  const [marks, toggle] = useMarks(`${view.table}.${round?.deal ?? 0}`);
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const guessing = !!round?.canGuess;
  // The board never marks the real location: every player's board looks alike, and the marks on it
  // are the player's own guesses (kept in this browser only).
  const seated = !!round && round.role !== 'watching';
  const possible = view.locations.filter((l) => marks[l] !== 'crossed');
  const shortlist = [
    ...possible.filter((l) => marks[l] === 'starred'),
    ...possible.filter((l) => marks[l] !== 'starred'),
  ];
  const pickable = guessing && possible.length < view.locations.length && possible.length <= 12;
  // One list per chosen edition (in pack order), so two editions read as two labelled groups.
  const groups: { id: string; label: string; ids: string[] }[] = [];
  let from = 0;
  for (const e of view.editions) {
    if (!view.settings.editions.includes(e.id)) continue;
    const ids = view.locations.slice(from, from + e.count);
    from += e.count;
    groups.push({ id: e.id, label: display.editionLabel(e.id, e.label), ids });
  }
  if (from !== view.locations.length) {
    groups.length = 0;
    groups.push({ id: 'all', label: 'Locations', ids: view.locations });
  }
  const guess = async () => {
    if (!pick) return;
    setBusy(true);
    await act({ type: 'spy-guess', location: pick });
    setBusy(false);
  };
  return (
    <section aria-label="Locations" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">📍 Locations ({view.locations.length})</h3>
        <span className="text-xs text-stone-500">
          {guessing ? 'Tap your guess' : 'Tap to cross off · ☆ to star'}
        </span>
      </div>
      {guessing && (
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-xl bg-accent-soft p-2 ring-1 ring-accent-line dark:bg-amber-500/20 dark:ring-amber-500/40">
          <span className="min-w-0 flex-1 text-sm font-semibold">
            {pick
              ? `Your guess: ${display.name(pick)}`
              : '🎯 You were caught! Pick your one guess.'}
          </span>
          <Button disabled={!pick || busy} onClick={() => void guess()}>
            {pick ? `Guess ${display.name(pick)}` : 'Guess'}
          </Button>
        </div>
      )}
      {view.played.length > 0 && (
        <p className="text-xs text-stone-500" data-testid="played-note">
          Places marked “Played” came up earlier this game and won’t come up again until every place
          has been played.
        </p>
      )}
      {seated && !guessing && round?.stage === 'talk' && (
        <p className="rounded-lg bg-stone-100 px-3 py-1.5 text-xs text-stone-700 dark:bg-stone-800/70 dark:text-stone-300">
          Cross places off as you listen. Nobody guesses yet: a spy the vote catches gets one guess.
        </p>
      )}
      {pickable && (
        <div className="space-y-1" data-testid="guess-shortlist">
          <p className="text-sm font-semibold">Your shortlist</p>
          <div className="flex flex-wrap gap-2">
            {shortlist.map((l) => (
              <button
                key={l}
                type="button"
                aria-pressed={pick === l}
                onClick={() => setPick(l)}
                className={cn(
                  'min-h-11 rounded-full px-3 text-sm font-semibold ring-1',
                  pick === l
                    ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                    : 'bg-white ring-stone-300 dark:bg-stone-900 dark:ring-stone-700',
                )}
              >
                {marks[l] === 'starred' && '★ '}
                {display.name(l)}
              </button>
            ))}
          </div>
        </div>
      )}
      {seated && !guessing && (
        <p className="text-sm" data-testid="still-possible">
          <b>Still possible: {possible.length}</b>
          {possible.length <= 12 && possible.length < view.locations.length && (
            <span className="text-stone-600 dark:text-stone-400">
              {' '}
              · {shortlist.map((l) => display.name(l)).join(', ')}
            </span>
          )}
        </p>
      )}
      {groups.map((g) => (
        <div key={g.id} className="space-y-2">
          {groups.length > 1 && (
            <h4 className="flex items-center gap-2 pt-1 text-xs font-bold tracking-wide text-stone-500 uppercase after:h-px after:flex-1 after:bg-stone-300 dark:after:bg-stone-700">
              {g.label}
            </h4>
          )}
          <ul
            aria-label={groups.length > 1 ? g.label : undefined}
            className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-4 xl:grid-cols-5"
          >
            {g.ids.map((id) => {
              const mark = marks[id];
              const name = display.name(id);
              const selected = guessing && pick === id;
              return (
                <li key={id} className="relative">
                  <button
                    type="button"
                    aria-label={guessing ? `Pick ${name}` : name}
                    aria-pressed={guessing ? selected : mark === 'crossed'}
                    onClick={() => (guessing ? setPick(id) : toggle(id, 'crossed'))}
                    className={cn(
                      'flex w-full flex-col items-center gap-1 overflow-hidden rounded-xl p-1.5 pb-2 text-center ring-1 transition',
                      selected
                        ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/10'
                        : 'bg-white ring-stone-200 hover:bg-stone-50 dark:bg-stone-900 dark:ring-stone-700 dark:hover:bg-stone-800',
                      mark === 'crossed' && !selected && 'opacity-40',
                    )}
                  >
                    <LocationPicture
                      id={id}
                      display={display}
                      className="aspect-[2/1] w-full rounded-lg text-2xl"
                      artClassName="aspect-[5/3] w-full rounded-lg"
                    />
                    <span
                      className={cn(
                        'line-clamp-2 text-xs leading-tight font-semibold',
                        mark === 'crossed' && 'line-through',
                      )}
                    >
                      {name}
                    </span>
                    {view.played.includes(id) && (
                      <span className="absolute top-1 left-1 rounded-full bg-stone-600 px-1.5 py-0.5 text-[0.65rem] font-bold text-white shadow">
                        Played
                      </span>
                    )}
                  </button>
                  {guessing ? (
                    mark === 'starred' && (
                      <span
                        aria-label="Starred"
                        className="pointer-events-none absolute -top-1 -right-1 flex size-11 items-center justify-center"
                      >
                        <span
                          aria-hidden
                          className="flex size-7 items-center justify-center rounded-full bg-accent dark:bg-amber-400 text-base leading-none text-white shadow ring-1 ring-accent dark:ring-amber-500"
                        >
                          ★
                        </span>
                      </span>
                    )
                  ) : (
                    <button
                      type="button"
                      aria-label={`Star ${name}`}
                      aria-pressed={mark === 'starred'}
                      onClick={() => toggle(id, 'starred')}
                      className="absolute -top-1 -right-1 flex size-11 items-center justify-center"
                    >
                      <span
                        aria-hidden
                        className={cn(
                          'flex size-7 items-center justify-center rounded-full text-base leading-none shadow ring-1',
                          mark === 'starred'
                            ? 'bg-accent dark:bg-amber-400 text-white ring-accent dark:ring-amber-500'
                            : 'bg-white/90 text-stone-500 ring-stone-300 dark:bg-stone-800/90 dark:text-stone-300 dark:ring-stone-600',
                        )}
                      >
                        {mark === 'starred' ? '★' : '☆'}
                      </span>
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

// ---- Ideas tab ----

function IdeaList({
  title,
  items,
  open,
}: {
  title: ReactNode;
  items: readonly string[];
  open?: boolean;
}) {
  return (
    <details
      open={open}
      className="group rounded-xl bg-white/80 px-3 ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <span>{title}</span>
        <span aria-hidden className="text-stone-500 transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <ul className="list-disc space-y-1 pb-3 pl-5 text-sm">
        {items.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </details>
  );
}

function IdeasBoard({ view, display }: { view: MasqueradeView; display: LocationDisplay }) {
  const round = view.round;
  const seated = view.phase === 'playing' && !!round && round.role !== 'watching';
  return (
    <section aria-label="Question ideas" className="space-y-2">
      <h3 className="font-bold">💬 Question ideas</h3>
      <p className="rounded-lg bg-stone-100 px-3 py-2 text-xs text-stone-700 dark:bg-stone-800/70 dark:text-stone-300">
        <b>Answering? </b>
        {ANSWER_TIP}
      </p>
      {seated && (
        // The ideas for your card name the location (or show you're the spy), so they're peeked too.
        <Peek
          what="ideas for your card"
          cover={
            <span
              data-testid="ideas-cover"
              className="flex h-11 items-center gap-2 rounded-xl bg-stone-800 px-3 text-sm font-semibold text-stone-100 ring-1 ring-stone-700"
            >
              <span aria-hidden>🙈</span> Hold to see ideas for your card
            </span>
          }
        >
          <div className="w-full space-y-2" data-testid="card-ideas">
            <CardIdeas round={round} display={display} />
          </div>
        </Peek>
      )}
      {GENERIC_QUESTIONS.map((c) => (
        <IdeaList key={c.id} title={`${c.emoji} ${c.label}`} items={c.questions} />
      ))}
    </section>
  );
}

function CardIdeas({ round, display }: { round: RoundView; display: LocationDisplay }) {
  if (round.role === 'spy')
    return (
      <>
        <IdeaList title="🛡️ Safe questions (fit anywhere)" items={SPY_SAFE_QUESTIONS} open />
        <IdeaList title="🎣 Fishing questions (narrow it down)" items={SPY_FISHING_QUESTIONS} />
        <IdeaList title="🎭 Bluff tips" items={SPY_BLUFF_TIPS} />
      </>
    );
  const here = round.location;
  const pointed = here ? display.questions(here) : [];
  if (!here || pointed.length === 0)
    return (
      <p className="rounded-xl bg-white/80 px-3 py-2 text-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800">
        No ideas for this place: try the general ones below.
      </p>
    );
  return <IdeaList title={`📍 For ${display.name(here)}`} items={pointed} open />;
}

// ---- Phone tabs ----

function TabBar({
  tab,
  onChange,
  alert,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  alert: Tab | null;
}) {
  const items: { id: Tab; icon: string; label: string }[] = [
    { id: 'play', icon: '🎭', label: 'Play' },
    { id: 'locations', icon: '📍', label: 'Locations' },
    { id: 'ideas', icon: '💬', label: 'Ideas' },
  ];
  return (
    <nav
      aria-label="Game sections"
      className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-3 border-t border-stone-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden dark:border-stone-800 dark:bg-stone-950/95"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-current={tab === it.id ? 'page' : undefined}
          onClick={() => onChange(it.id)}
          className={cn(
            'flex flex-col items-center gap-0.5 py-2 text-xs font-semibold',
            tab === it.id ? 'text-amber-700 dark:text-amber-400' : 'text-stone-500',
          )}
        >
          <span className="flex items-center gap-1 text-lg leading-none">
            {it.icon}
            {alert === it.id && tab !== it.id && (
              <span className="size-2.5 rounded-full bg-accent dark:bg-amber-500" />
            )}
          </span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

// ---- The whole game ----

export function MasqueradeBoard({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  display,
}: MasqueradeUiProps & { display: LocationDisplay }) {
  // Each new step of the round opens on the tab it needs: Play, or the board for a caught spy.
  const stepKey = `${view.round?.deal ?? 0}-${view.round?.stage ?? view.phase}`;
  const [picked, setPicked] = useState<{ tab: Tab; key: string }>({ tab: 'play', key: stepKey });
  const tab: Tab =
    picked.key === stepKey ? picked.tab : view.round?.canGuess ? 'locations' : 'play';
  const setTab = (t: Tab) => setPicked({ tab: t, key: stepKey });
  const status = statusFor(view, room.isHost, room);
  // A full table: watchers get the shell's banner (there is no seat to take until a new game).
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing ? { text: 'The table is full, so you’re watching.' } : null,
  );
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;

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
        display={display}
      />
    );
  }

  const round = view.round;
  const onTab = (t: Tab) => (tab === t ? '' : 'hidden lg:block');
  const alert: Tab | null = round?.canGuess ? 'locations' : status.yourMove ? 'play' : null;

  return (
    <div className="space-y-3 pb-20 lg:pb-0">
      <TopBar view={view} room={room} />
      <Nudge view={view} room={room} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn('min-w-0 space-y-3', onTab('play'))}>
          <StatusHint view={view} room={room} />
          {round?.redealtAfter && round.stage === 'talk' && (
            <p className="text-center text-sm text-stone-600 dark:text-stone-400">
              {round.redealtAfter} left while a spy, so the round was dealt again.
            </p>
          )}
          {view.phase === 'over' && <Podium view={view} act={act} room={room} />}
          {round && round.stage === 'reveal' && (
            <Reveal view={view} display={display} act={act} room={room} />
          )}
          {round && round.stage !== 'reveal' && view.phase === 'playing' && (
            <>
              {/* The vote and the guess come before the card, so they're above the art on phones. */}
              <GuessPanel round={round} onOpenBoard={() => setTab('locations')} />
              <VotePanel view={view} round={round} act={act} room={room} />
              <MyCard key={round.deal} round={round} display={display} />
              <ReadyToggle round={round} act={act} room={room} />
              <HowItWorks view={view} round={round} />
              {round.stage === 'guess' && round.votes && (
                <Panel className="space-y-2">
                  <h3 className="text-sm font-bold">How everyone voted</h3>
                  <VotesList view={view} votes={round.votes} spies={round.caught ?? []} />
                </Panel>
              )}
            </>
          )}
          <Scores view={view} />
          <Panel>
            <Players view={view} online={online} hostId={room.hostId} />
          </Panel>
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
        </div>
        <div className="min-w-0 space-y-4">
          <div className={onTab('locations')}>
            <LocationsBoard view={view} display={display} act={act} />
          </div>
          <div className={onTab('ideas')}>
            <IdeasBoard view={view} display={display} />
          </div>
        </div>
      </div>
      <TabBar tab={tab} onChange={setTab} alert={alert} />
    </div>
  );
}
