import type { GameRoomInfo } from '@vt/game-sdk';
import { Button, ProtectedImage, RefusalSlot, cn, useSecondsLeft } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import type { Card } from '../logic/content.ts';
import { STYLES, genreInfo, missing, nounOf } from '../logic/genres.ts';
import { genreName } from '../logic/manifest.ts';
import {
  type CliffhangerAction,
  type CliffhangerView,
  DECIDE_MS,
  OPENING_MS,
  PLACE_MS,
  type RoundView,
  type SlotView,
  type TeamId,
  UNDO_MS,
  other,
} from '../logic/types.ts';
import { useArt } from './assets.ts';
import {
  ClockBar,
  GenreRace,
  RuleNote,
  StyleName,
  Tape,
  TeamChip,
  nameOf,
  teamName,
} from './parts.tsx';
import { buzz } from './useSound.ts';

type Act = (a: CliffhangerAction, o?: { anchor?: string }) => Promise<boolean>;

export interface PlayProps {
  view: CliffhangerView;
  room: GameRoomInfo;
  act: Act;
  /** Plays a cue on this device only (a switch of card, a press). */
  cue?: (key: string) => void;
}

/** The face-off's category: the card's art with the words on it, or a plain card. */
export function CategoryCard({
  text,
  big = false,
  className,
}: {
  text: string;
  big?: boolean;
  className?: string;
}) {
  const { faceoff } = useArt();
  const src = big ? faceoff.card : faceoff.thumb;
  if (src && faceoff.textBox) {
    const [x, y, w, h] = faceoff.textBox;
    return (
      <div
        role="img"
        aria-label={`Category: ${text}`}
        className={cn('relative aspect-[536/740] shrink-0 [container-type:size]', className)}
      >
        <ProtectedImage
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full rounded-md object-fill shadow-lg"
        />
        <div
          aria-hidden
          className="cl-upright absolute flex items-center justify-center p-[3%] text-center leading-tight font-black text-stone-900"
          style={{
            left: `${x * 100}%`,
            top: `${y * 100}%`,
            width: `${w * 100}%`,
            height: `${h * 100}%`,
            fontSize: `clamp(8px, ${text.length > 30 ? 6 : 8}cqh, 72px)`,
          }}
        >
          {text}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        'rounded-2xl bg-panel px-4 py-5 text-center ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
        className,
      )}
    >
      <p className="text-xs font-bold tracking-wide text-ink-muted uppercase">Category</p>
      <p className={cn('font-black', big ? 'text-4xl' : 'text-2xl')}>{text}</p>
    </div>
  );
}

/** The giant answer button: the buzzer's picture, else a big round button. */
function SaidIt({ onPress, disabled }: { onPress: () => void; disabled?: boolean }) {
  const { app } = useArt();
  const src = app('buzzer');
  return (
    <button
      type="button"
      data-testid="said-it"
      disabled={disabled}
      onClick={onPress}
      className={cn(
        'mx-auto grid aspect-square w-full max-w-72 place-items-center rounded-full font-black text-white transition active:scale-95 disabled:opacity-40',
        // vt-palette: the buzzer's own pink
        !src && 'bg-pink-600 text-4xl shadow-[0_10px_0_#9d174d] active:shadow-[0_4px_0_#9d174d]',
      )}
    >
      {src ? (
        <span className="relative block w-full">
          <ProtectedImage src={src} alt="" className="w-full" />
          <span className="absolute inset-x-0 bottom-[12%] text-3xl drop-shadow-[0_2px_2px_rgb(0_0_0/.6)]">
            Said it!
          </span>
        </span>
      ) : (
        'Said it!'
      )}
    </button>
  );
}

function FaceOff({ view, room, act }: PlayProps) {
  const r = view.round!;
  const fo = r.faceoff!;
  const me = view.me?.id;
  const inPair = me === r.pair.a || me === r.pair.b;
  const onMe = inPair && (fo.on === me || fo.on === null);
  const total =
    fo.answers === 0 && view.settings.openingClock
      ? OPENING_MS
      : view.settings.answerSeconds * 1000;
  // Without the card's art the category reads better as plain text alone.
  const { faceoff } = useArt();
  const card = !!(faceoff.thumb && faceoff.textBox);
  const press = () => {
    buzz(30);
    void act({ type: 'said' }, { anchor: 'cl-fo' });
  };
  return (
    <div className="space-y-3" data-testid="faceoff">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-black tracking-wide uppercase">
          {r.suddenDeath ? '⚡ Sudden death' : 'Face-off'}
        </span>
        <span>
          <span className="font-semibold">{nameOf(view, r.pair.a)}</span>
          <span className="text-ink-muted"> vs </span>
          <span className="font-semibold">{nameOf(view, r.pair.b)}</span>
        </span>
      </div>
      <div className="flex items-center gap-3">
        {card && <CategoryCard text={r.category?.text ?? ''} className="h-40 max-sm:h-32" />}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex flex-wrap items-center gap-x-2 text-xs font-bold tracking-wide text-ink-muted uppercase">
            Name a {nounOf(view.settings.deck)}
            {view.settings.noSequels && <RuleNote testId="rule-no-sequels">No sequels</RuleNote>}
          </p>
          <p className="text-xl font-black leading-tight sm:text-2xl" data-testid="category">
            {r.category?.text}
          </p>
          <p className="text-sm text-ink-muted" aria-live="polite">
            {fo.answers} {fo.answers === 1 ? 'answer' : 'answers'} so far
          </p>
        </div>
      </div>
      <ClockBar
        deadline={fo.deadline}
        paused={fo.deadline === null ? total : null}
        total={total}
        clockOffset={room.clockOffset}
        big
        label={
          fo.on
            ? fo.on === me
              ? 'You’re on the clock'
              : `${nameOf(view, fo.on)} is on the clock`
            : 'First to answer'
        }
      />
      {onMe ? (
        <SaidIt onPress={press} />
      ) : inPair ? (
        <p className="py-6 text-center text-lg font-semibold">{nameOf(view, fo.on)} must answer.</p>
      ) : null}
      <div className="flex flex-wrap justify-center gap-2">
        {inPair && fo.answers === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void act({ type: 'new-category' }, { anchor: 'cl-fo' })}
          >
            🔄 New category
          </Button>
        )}
      </div>
      <RefusalSlot anchor="cl-fo" />
    </div>
  );
}

function PickCategory({ view, act }: PlayProps) {
  const r = view.round!;
  const pick = r.pick!;
  if (pick.by !== view.me?.id || !pick.options) {
    return (
      <p className="py-8 text-center text-lg">
        {nameOf(view, pick.by)} is picking the face-off category…
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-center font-semibold">Your team is behind: pick the category.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {pick.options.map((c) => (
          <Button
            key={c.id}
            variant="secondary"
            size="lg"
            className="min-h-20 text-lg"
            onClick={() => void act({ type: 'pick-category', id: c.id }, { anchor: 'cl-pick' })}
          >
            {c.text}
          </Button>
        ))}
      </div>
      <RefusalSlot anchor="cl-pick" />
    </div>
  );
}

/** Choosing and placing your three: tap a card for the next empty square, tap a square to clear it. */
function KeepSheet({ view, room, act }: PlayProps) {
  const r = view.round!;
  const hand = r.myHand!;
  const deck = view.settings.deck;
  const [slots, setSlots] = useState(hand.slots);
  const [sent, setSent] = useState(hand.slots.join());
  if (hand.slots.join() !== sent) {
    setSent(hand.slots.join());
    setSlots(hand.slots);
  }
  const team = view.myTeam!;
  const squares =
    r.board[team] ??
    r.styles.map((style): SlotView => ({ style, plays: style, card: null, got: null }));
  const save = (next: (string | null)[]) => {
    setSlots(next);
    setSent(next.join());
    void act({ type: 'arrange', slots: next }, { anchor: 'cl-keep' });
  };
  const tapCard = (c: Card) => {
    const at = slots.indexOf(c.id);
    if (at >= 0) return save(slots.map((x, i) => (i === at ? null : x)));
    const free = slots.indexOf(null);
    if (free >= 0) save(slots.map((x, i) => (i === free ? c.id : x)));
  };
  const full = slots.every((x) => x !== null);
  const byId = new Map(hand.offered.map((c) => [c.id, c]));
  return (
    <div className="space-y-3" data-testid="keep">
      <ClockBar
        deadline={hand.deadline}
        total={PLACE_MS}
        clockOffset={room.clockOffset}
        label={hand.choose ? 'Keep 3 and place them' : 'Place your 3'}
      />
      <ul className="grid grid-cols-3 gap-2" aria-label="Your squares">
        {r.styles.map((style, i) => {
          const id = slots[i];
          const card = id ? (byId.get(id) ?? null) : null;
          return (
            <li key={style + i} className="min-w-0">
              <button
                type="button"
                onClick={() => id && save(slots.map((x, j) => (j === i ? null : x)))}
                className="flex w-full flex-col items-center gap-1 rounded-xl bg-page p-1.5 ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700"
                aria-label={`${STYLES[squares[i]?.plays ?? style].name}: ${card ? card.title : 'empty'}`}
              >
                <StyleName style={squares[i]?.plays ?? style} className="truncate text-[11px]" />
                {card ? (
                  <Tape card={card} deck={deck} className="h-24" />
                ) : (
                  <span className="grid h-24 w-full place-items-center rounded-md border-2 border-dashed border-line text-xs text-ink-muted dark:border-stone-600">
                    empty
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-muted">
        {hand.choose
          ? 'Tap three to keep (the rest go back).'
          : 'Tap a card to put it on the next square.'}{' '}
        Tap a square to clear it.
      </p>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Your cards">
        {hand.offered.map((c) => {
          const at = slots.indexOf(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                data-testid="hand-card"
                aria-pressed={at >= 0}
                onClick={() => tapCard(c)}
                className={cn(
                  'relative rounded-md transition',
                  at >= 0 ? 'opacity-40' : 'hover:-translate-y-0.5',
                )}
              >
                <Tape card={c} deck={deck} className="h-28" />
                {c.tier === 'easy' && (
                  <span className="absolute -top-1 -right-1 rounded-full bg-success-soft px-1.5 text-[10px] font-bold text-success-ink ring-1 ring-success-line dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-500/40">
                    easy
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <Button
        size="lg"
        className="w-full"
        data-testid="lock-in"
        disabled={!full}
        onClick={() => void act({ type: 'lock', slots }, { anchor: 'cl-keep' })}
      >
        {full ? 'Lock in' : `Pick ${slots.filter((x) => x === null).length} more`}
      </Button>
      <RefusalSlot anchor="cl-keep" />
    </div>
  );
}

/** The three squares of a team, as the viewer may see them. */
export function Bays({
  view,
  team,
  focus,
  size = 'h-24',
  onTap,
}: {
  view: CliffhangerView;
  team: TeamId;
  focus?: string | null;
  size?: string;
  onTap?: (card: Card) => void;
}) {
  const slots = view.round?.board[team] ?? [];
  const deck = view.settings.deck;
  return (
    <ul
      className="grid grid-cols-3 gap-2"
      aria-label={`${teamName(team)}’s squares`}
      data-testid={`bays-${team}`}
    >
      {slots.map((s, i) => {
        const tappable = onTap && s.card && !s.got;
        const inner = (
          <>
            <StyleName style={s.plays} className="truncate text-[11px]" />
            <Tape
              card={s.card}
              deck={deck}
              className={size}
              got={s.got}
              label={`${STYLES[s.plays].name}: hidden`}
            />
            {s.got && s.got !== team && (
              <span className="text-[11px] font-bold text-danger">stolen</span>
            )}
          </>
        );
        return (
          <li
            key={i}
            className={cn(
              'flex min-w-0 flex-col items-center gap-1 rounded-xl p-1.5',
              focus &&
                s.card?.id === focus &&
                'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/10 dark:ring-amber-500',
            )}
          >
            {tappable ? (
              <button
                type="button"
                className="flex flex-col items-center gap-1"
                onClick={() => onTap(s.card!)}
              >
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** The describer: the card now, big, with Got it; the others to switch to. */
function Describer({ view, room, act, cue }: PlayProps) {
  const r = view.round!;
  const turn = r.turn!;
  const team = turn.team;
  const { names } = useArt();
  const deck = view.settings.deck;
  const open = (t: TeamId) => (r.board[t] ?? []).filter((s) => s.card && !s.got);
  const mine = open(team);
  const theirs = turn.stealOpen ? open(other(team)) : [];
  const cards = mine.length ? mine : theirs;
  const now = cards.find((s) => s.card!.id === turn.focus) ?? cards[0];
  const last = turn.gots.at(-1);
  const left = useSecondsLeft(turn.endsAt, room.clockOffset);
  // A short buzz at five seconds left.
  const buzzed = useRef(false);
  useEffect(() => {
    if (left === 5 && !buzzed.current) {
      buzzed.current = true;
      buzz(120);
    }
  }, [left]);
  const lastSlot = last
    ? (['a', 'b'] as const).flatMap((t) => r.board[t] ?? []).find((s) => s.card?.id === last)
    : undefined;
  const switchTo = (c: Card) => {
    cue?.('pass');
    void act({ type: 'focus', card: c.id }, { anchor: 'cl-turn' });
  };
  return (
    <div className="space-y-3" data-testid="describer">
      {now?.card ? (
        <div className="flex items-center gap-3">
          <Tape card={now.card} deck={deck} full className="h-48 max-sm:h-40" />
          <div className="min-w-0 flex-1 space-y-2">
            <StyleName style={now.plays} className="text-lg" />
            <p className="text-xs text-ink-muted">{STYLES[now.plays].how}</p>
            {view.settings.newWordsOnly && (now.plays === 'one-word' || now.plays === 'quote') && (
              <RuleNote testId="rule-new-words">No words from the title</RuleNote>
            )}
            <p
              className="text-2xl leading-tight font-black break-words sm:text-3xl"
              data-testid="now-title"
            >
              {now.card.title}
            </p>
            <p className="text-xs text-ink-muted">
              {genreInfo(now.card.genre, deck).emoji} {genreName(names, now.card.genre, deck)}
              {mine.length === 0 && ' · theirs: steal it!'}
            </p>
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-lg font-semibold">Every card is got! 🎉</p>
      )}
      {now?.card && (
        <Button
          size="lg"
          className="h-16 w-full text-2xl"
          data-testid="got-it"
          onClick={() => {
            buzz(30);
            void act({ type: 'got', card: now.card!.id }, { anchor: 'cl-turn' });
          }}
        >
          ✓ Got it
        </Button>
      )}
      {cards.length > 1 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-ink-muted">Stuck? Switch card:</p>
          <div className="flex flex-wrap gap-2">
            {cards
              .filter((s) => s !== now)
              .map((s) => (
                <Button
                  key={s.card!.id}
                  variant="secondary"
                  size="sm"
                  data-testid="switch"
                  onClick={() => switchTo(s.card!)}
                >
                  <StyleName style={s.plays} className="text-[11px]" /> {s.card!.title}
                </Button>
              ))}
          </div>
        </div>
      )}
      {last && lastSlot?.card && (
        <UndoButton key={last} card={last} title={lastSlot.card.title} act={act} />
      )}
      {!turn.stealOpen && mine.length > 0 && (r.board[other(team)] ?? []).some((s) => !s.got) && (
        <p className="text-xs text-ink-muted">Get all three of yours to steal theirs.</p>
      )}
      <RefusalSlot anchor="cl-turn" />
    </div>
  );
}

/** Undo for the last Got it, for a few seconds. */
function UndoButton({ card, title, act }: { card: string; title: string; act: Act }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    // A little under the server's window, so a late tap isn't refused.
    const id = setTimeout(() => setGone(true), UNDO_MS - 500);
    return () => {
      clearTimeout(id);
    };
  }, []);
  if (gone) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => void act({ type: 'undo', card }, { anchor: 'cl-turn' })}
    >
      ↩ Undo “{title}”
    </Button>
  );
}

/** The describing turn, as each viewer sees it. */
function Turn(props: PlayProps) {
  const { view, room } = props;
  const r = view.round!;
  const turn = r.turn!;
  const me = view.me?.id;
  const mine = view.myTeam;
  const total = view.settings.turnSeconds * 1000;
  const role =
    turn.describer === me
      ? 'describer'
      : mine === turn.team
        ? 'guesser'
        : mine
          ? 'rival'
          : 'watcher';
  return (
    <div className="space-y-3" data-testid={`turn-${role}`}>
      <ClockBar
        deadline={r.stage === 'turn' ? turn.endsAt : null}
        paused={r.stage === 'turn' ? null : 0}
        total={total}
        clockOffset={room.clockOffset}
        big
        label={
          <>
            <TeamChip team={turn.team} />{' '}
            {role === 'describer' ? 'You describe' : `${nameOf(view, turn.describer)} describes`}
          </>
        }
      />
      {role === 'describer' && <Describer {...props} />}
      {role === 'guesser' && (
        <>
          <Bays view={view} team={turn.team} />
          <p className="text-center text-xl font-black">Shout your guesses! 📣</p>
          {turn.stealOpen && (
            <>
              <p className="text-center text-sm font-semibold">All three! Now steal theirs:</p>
              <Bays view={view} team={other(turn.team)} size="h-20" />
            </>
          )}
        </>
      )}
      {role === 'rival' && (
        <>
          <Bays view={view} team={turn.team} />
          {turn.stealOpen && (
            <>
              <p className="text-center text-sm font-semibold text-danger">
                They’re stealing yours now!
              </p>
              <Bays view={view} team={other(turn.team)} size="h-20" />
            </>
          )}
          <p className="text-center text-xs text-ink-muted">
            Only {nameOf(view, turn.describer)} sees their cards. Slip-ups are for the table to
            settle out loud.
          </p>
        </>
      )}
      {role === 'watcher' && <Bays view={view} team={turn.team} />}
    </div>
  );
}

/** After a team's turn: what they got and missed. */
function Recap({ view }: PlayProps) {
  const r = view.round!;
  const result = r.results.at(-1);
  const deck = view.settings.deck;
  if (!result) return null;
  const next = r.order[r.turnNo];
  return (
    <div className="space-y-3" data-testid="recap">
      <p className="text-center text-lg font-black">
        {nameOf(view, result.describer)} got {result.got.length}
      </p>
      <ul className="flex flex-wrap justify-center gap-2">
        {result.got.map((g) => (
          <li key={g.card.id} className="flex flex-col items-center gap-1">
            <Tape card={g.card} deck={deck} className="h-28" got={result.team} />
            {g.steal && <span className="text-[11px] font-bold text-danger">stolen</span>}
          </li>
        ))}
        {result.missed.map((c) => (
          <li key={c.id} className="flex flex-col items-center gap-1 opacity-60">
            <Tape card={c} deck={deck} className="h-28" />
            <span className="text-[11px] text-ink-muted">missed</span>
          </li>
        ))}
      </ul>
      {next && (
        <p className="text-center text-sm text-ink-muted">
          Next: {nameOf(view, r.pair[next])} describes to {teamName(next)}.
        </p>
      )}
    </div>
  );
}

/** The 3-for-1 steal: three of a genre for one of the other team's cards. */
function Steal({ view, room, act }: PlayProps) {
  const r = view.round!;
  const s = r.steal!;
  const { names } = useArt();
  const deck = view.settings.deck;
  const [genre, setGenre] = useState<string | null>(null);
  const mineToo = view.myTeam === s.team;
  const counts = new Map<string, number>();
  for (const c of view.collections[s.team]) counts.set(c.genre, (counts.get(c.genre) ?? 0) + 1);
  const offer = [...counts].filter(([, n]) => n >= 3).map(([g]) => g);
  const need = missing(
    view.collections[s.team].map((c) => c.genre),
    view.target,
  );
  const theirs = view.collections[other(s.team)];
  return (
    <div className="space-y-3" data-testid="steal">
      <ClockBar
        deadline={s.deadline}
        total={DECIDE_MS}
        clockOffset={room.clockOffset}
        label={
          <>
            3-for-1: <TeamChip team={s.team} />
          </>
        }
      />
      {!mineToo ? (
        <p className="py-4 text-center">
          {teamName(s.team)} may trade three of a genre for one of your cards…
        </p>
      ) : (
        <>
          <p className="text-sm font-semibold">1. Give up three of:</p>
          <div className="flex flex-wrap gap-2">
            {offer.map((g) => (
              <Button
                key={g}
                variant={genre === g ? 'primary' : 'secondary'}
                size="sm"
                aria-pressed={genre === g}
                onClick={() => setGenre(g)}
              >
                {genreInfo(g, deck).emoji} {genreName(names, g, deck)} ×{counts.get(g)}
              </Button>
            ))}
          </div>
          <p className="text-sm font-semibold">2. Take one of theirs:</p>
          <ul className="flex flex-wrap gap-2">
            {theirs.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  disabled={!genre}
                  className="relative disabled:opacity-50"
                  onClick={() =>
                    genre && void act({ type: 'steal', genre, card: c.id }, { anchor: 'cl-steal' })
                  }
                >
                  <Tape card={c} deck={deck} className="h-24" />
                  {need.includes(c.genre) && (
                    <span className="absolute -top-1 -right-1 rounded-full bg-success-soft px-1.5 text-[10px] font-bold text-success-ink ring-1 ring-success-line dark:bg-emerald-500/20 dark:text-emerald-100 dark:ring-emerald-500/40">
                      needed
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            onClick={() => void act({ type: 'pass' }, { anchor: 'cl-steal' })}
          >
            No trade
          </Button>
        </>
      )}
      {room.isHost && <SkipWhenDue deadline={s.deadline} room={room} act={act} />}
      <RefusalSlot anchor="cl-steal" />
    </div>
  );
}

/** The host's skip for a soft step once its clock is up. */
function SkipWhenDue({ deadline, room, act }: { deadline: number; room: GameRoomInfo; act: Act }) {
  const left = useSecondsLeft(deadline, room.clockOffset);
  if (left !== 0) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
      Host: move on
    </Button>
  );
}

function CountdownNote({ view }: PlayProps) {
  const r = view.round!;
  if (r.after === 'faceoff') {
    return (
      <div className="space-y-2 py-4 text-center">
        <p className="text-lg font-black">
          Face-off: {nameOf(view, r.pair.a)} vs {nameOf(view, r.pair.b)}
        </p>
        <p className="text-sm text-ink-muted">The category turns over after the count.</p>
      </div>
    );
  }
  const next = r.order[r.turnNo];
  return (
    <div className="space-y-3 py-2 text-center">
      {next && (
        <p className="text-lg font-black">
          {nameOf(view, r.pair[next])} describes to {teamName(next)}
        </p>
      )}
      {next && <Bays view={view} team={next} size="h-20" />}
    </div>
  );
}

/** The round's step for this viewer. */
export function Stage(props: PlayProps) {
  const r = props.view.round;
  if (!r) return null;
  if (r.myHand) return <KeepSheet {...props} />;
  switch (r.stage) {
    case 'pick-category':
      return <PickCategory {...props} />;
    case 'countdown':
      return <CountdownNote {...props} />;
    case 'faceoff':
      return <FaceOff {...props} />;
    case 'keep':
      return <KeepWaiting {...props} />;
    case 'turn':
      return <Turn {...props} />;
    case 'recap':
      return <Recap {...props} />;
    case 'steal':
      return <Steal {...props} />;
  }
}

function KeepWaiting({ view }: PlayProps) {
  const r = view.round!;
  const fr = r.faceoffResult;
  return (
    <div className="space-y-2 py-4 text-center" data-testid="keep-waiting">
      {fr && (
        <p className="text-lg font-black">
          {nameOf(view, fr.winner)} wins the face-off
          {fr.answers > 0 && (
            <span className="font-normal text-ink-muted">
              {' '}
              after {fr.answers} {fr.answers === 1 ? 'answer' : 'answers'}
            </span>
          )}
        </p>
      )}
      <p className="text-sm text-ink-muted">
        {r.placing.map((id) => nameOf(view, id)).join(' and ')}{' '}
        {r.placing.length === 1 ? 'is' : 'are'} choosing their {nounOf(view.settings.deck, true)}…
      </p>
    </div>
  );
}

/** Both teams' races. */
export function Races({ view, compact }: { view: CliffhangerView; compact?: boolean }) {
  return (
    <div className="space-y-3">
      <GenreRace view={view} team="a" compact={compact} />
      <GenreRace view={view} team="b" compact={compact} />
    </div>
  );
}

export type { RoundView };
