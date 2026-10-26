import { type Drawing, listNames, storageKey } from '@vt/game-sdk';
import { Button, NameDot, RefusalSlot, cn } from '@vt/ui';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { lieProblem, tidyLie } from '../logic/game.ts';
import { revealOrder, revealProgress } from '../logic/reveal.ts';
import {
  ARTIST_POINTS,
  FOOL_POINTS,
  MAX_LIE_LENGTH,
  type OptionView,
  type SketchyView,
  TRUTH_POINTS,
  type TurnView,
} from '../logic/types.ts';
import type { Act } from './act.ts';
import { PhoneCard, usePhoneTarget } from './PhoneShow.tsx';
import { Replay } from './Replay.tsx';
import { nameOf, points } from './status.ts';

const LIE_ANCHOR = 'sketchy-lie';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface RevealState {
  order: number[];
  /** Where the one-by-one reveal is, or null once the whole board is out. */
  progress: { step: number; flipped: boolean } | null;
}

/**
 * Paces the reveal on the server clock, so every phone turns the same answer over at the same
 * moment. With reduced motion (or when the host skipped it) the whole board shows at once.
 */
export function useReveal(turn: TurnView | null, clockOffset: number): RevealState {
  const start = turn?.revealAt ?? null;
  const options = turn?.options;
  const order = useMemo(() => (options ? revealOrder(options) : []), [options]);
  const [now, setNow] = useState(() => Date.now());
  const [ticking, setTicking] = useState(start);
  if (ticking !== start) {
    setTicking(start);
    // eslint-disable-next-line react-hooks/purity -- a fresh reading for the new reveal's first render
    setNow(Date.now());
  }
  const [reduced] = useState(reducedMotion);
  const running =
    start !== null && !reduced && !revealProgress(order.length, now + clockOffset - start).done;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(id);
    };
  }, [running]);
  if (!running || start === null) return { order, progress: null };
  const { step, flipped } = revealProgress(order.length, now + clockOffset - start);
  return { order, progress: { step, flipped } };
}

// ---- Hiding a drawing on your own screen ----

const HIDDEN_KEY = 'sketchy.hidden';
const signature = (d: Drawing) => JSON.stringify(d).slice(0, 80);

function readHidden(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(HIDDEN_KEY)) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

function useLocalHide(drawing: Drawing | null): [boolean, (hide: boolean) => void] {
  const [hidden, setHidden] = useState(readHidden);
  const sig = drawing ? signature(drawing) : null;
  const toggle = (hide: boolean) => {
    if (!sig) return;
    const next = hide ? [...hidden, sig].slice(-50) : hidden.filter((s) => s !== sig);
    setHidden(next);
    try {
      localStorage.setItem(storageKey(HIDDEN_KEY), JSON.stringify(next));
    } catch {
      // Storage blocked: it stays hidden until the page reloads.
    }
  };
  return [sig !== null && hidden.includes(sig), toggle];
}

/** The drawing on the table, big, with the hide controls under it. */
export function TableDrawing({
  view,
  turn,
  isHost,
  act,
}: {
  view: SketchyView;
  turn: TurnView;
  isHost: boolean;
  act: Act;
}) {
  const [mineHidden, hideMine] = useLocalHide(turn.drawing);
  const artist = turn.artist ? nameOf(view, turn.artist) : null;
  const veiled = turn.hidden || mineHidden;
  return (
    <figure
      className={cn(
        'mx-auto w-full space-y-1',
        // Big while titles are written; smaller once the board needs the room on a phone.
        view.game?.stage === 'write' ? 'max-w-[16rem] sm:max-w-md' : 'max-w-[13rem] sm:max-w-sm',
      )}
    >
      <Replay
        key={`${view.game?.round}-${turn.number}`}
        replayKey={`${view.game?.round}-${turn.number}-${JSON.stringify(turn.drawing).slice(0, 60)}`}
        drawing={veiled ? null : turn.drawing}
        label={artist ? `${artist}’s drawing` : 'The drawing on the table'}
        className="w-full shadow-md ring-1 ring-line"
      >
        {veiled && (
          <div className="absolute inset-0 grid place-items-center bg-stone-200/90 text-center text-sm font-semibold text-stone-700">
            {turn.hidden ? '🙈 The host hid this drawing' : '🙈 Hidden on your screen'}
          </div>
        )}
      </Replay>
      <figcaption className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        {turn.mine && <span className="font-semibold text-ink">🎨 Your drawing</span>}
        {!turn.hidden && turn.drawing && (
          <button type="button" className="h-11 underline" onClick={() => hideMine(!mineHidden)}>
            {mineHidden ? 'Show it again' : 'Hide on my screen'}
          </button>
        )}
        {isHost && (
          <button
            type="button"
            className="h-11 underline"
            onClick={() => void act({ type: 'hide', hidden: !turn.hidden })}
          >
            {turn.hidden ? 'Show it to everyone' : 'Hide for everyone'}
          </button>
        )}
      </figcaption>
    </figure>
  );
}

// ---- Writing ----

const INPUT =
  'block h-12 w-full rounded-lg bg-white px-3 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

function LieForm({ turn, act }: { turn: TurnView; act: Act }) {
  const [text, setText] = useState(turn.myLie ?? '');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const trimmed = tidyLie(text);
  const sent = turn.myLie !== null;
  const unchanged = sent && trimmed === turn.myLie;
  const problem = trimmed ? (lieProblem(trimmed)?.message ?? null) : null;
  const blocked = problem !== null || (refused !== null && refused === trimmed);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act({ type: 'lie', text: trimmed }, { anchor: LIE_ANCHOR });
    setRefused(ok ? null : trimmed);
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <label className="block">
        <span className="text-sm font-semibold">Your fake title</span>
        <input
          value={text}
          maxLength={MAX_LIE_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          aria-invalid={blocked ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          placeholder="what could this be?"
          data-testid="sketchy-lie"
          className={cn(INPUT, 'mt-1', blocked && 'ring-2 ring-danger dark:ring-rose-500')}
        />
        {problem && (
          <span role="alert" className="mt-1 block text-sm text-rose-700 dark:text-rose-400">
            {problem}
          </span>
        )}
      </label>
      {turn.myLieShared && unchanged && (
        <p data-testid="lie-shared" className="text-sm text-amber-800 dark:text-amber-300">
          👯 Someone else wrote that too: it’ll be shared, and so will the points. Change it to keep
          them all.
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || unchanged || !trimmed || blocked}
      >
        {sent ? (unchanged ? '✓ Sent' : 'Change my title') : 'Send title'}
      </Button>
      <RefusalSlot anchor={LIE_ANCHOR} />
    </form>
  );
}

// ---- Picking and liking ----

function LikeButton({
  option,
  liked,
  disabled,
  onToggle,
}: {
  option: OptionView;
  liked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={liked}
      aria-label={`Like “${option.text}”`}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'grid size-12 shrink-0 place-items-center rounded-xl text-xl ring-1 transition',
        liked
          ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-500'
          : 'bg-white ring-stone-300 grayscale hover:grayscale-0 dark:bg-stone-800 dark:ring-stone-600',
      )}
    >
      👍
    </button>
  );
}

function Board({ view, turn, act }: { view: SketchyView; turn: TurnView; act: Act }) {
  const [busy, setBusy] = useState(false);
  const canPick = turn.writing && view.game?.stage === 'vote';
  const pick = async (index: number) => {
    setBusy(true);
    await act({ type: 'vote', option: index }, { anchor: 'sketchy-vote' });
    setBusy(false);
  };
  const like = (o: OptionView) =>
    void act(
      { type: 'like', option: o.index, on: !turn.myLikes.includes(o.index) },
      { anchor: 'sketchy-vote' },
    );
  return (
    <div className="space-y-2">
      <ul aria-label="Titles" className="grid gap-2 sm:grid-cols-2" data-testid="sketchy-board">
        {turn.options.map((o) => {
          const chosen = turn.myVote === o.index;
          return (
            <li key={o.index} className="flex items-stretch gap-2">
              <button
                type="button"
                disabled={!canPick || busy || o.mine}
                aria-pressed={chosen}
                onClick={() => void pick(o.index)}
                className={cn(
                  'flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-xl px-4 py-2 text-left text-lg font-semibold ring-1 transition',
                  o.mine
                    ? 'cursor-not-allowed bg-stone-100 text-ink-muted ring-stone-200 dark:bg-stone-800/60 dark:text-stone-400 dark:ring-stone-700'
                    : chosen
                      ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-500'
                      : 'bg-white ring-stone-300 enabled:hover:bg-accent-soft dark:bg-stone-800 dark:ring-stone-600 dark:enabled:hover:bg-stone-700',
                )}
              >
                <span className="min-w-0 break-words">{o.text}</span>
                {o.mine && <span className="shrink-0 text-xs font-medium">Yours</span>}
                {chosen && !o.mine && <span aria-hidden>✓</span>}
              </button>
              {turn.canLike && !o.mine && (
                <LikeButton
                  option={o}
                  liked={turn.myLikes.includes(o.index)}
                  disabled={false}
                  onToggle={() => like(o)}
                />
              )}
            </li>
          );
        })}
      </ul>
      <RefusalSlot anchor="sketchy-vote" />
    </div>
  );
}

// ---- The reveal ----

function verdict(o: OptionView, name: (id: string) => string): string {
  if (o.truth) return '✅ The real title';
  if (o.house) return '🏠 House title';
  return `🎭 Fake by ${listNames((o.authors ?? []).map(name))}`;
}

function RevealSequence({
  view,
  turn,
  reveal,
  isHost,
  onSkip,
}: {
  view: SketchyView;
  turn: TurnView;
  reveal: RevealState;
  isHost: boolean;
  onSkip: () => void;
}) {
  const { order, progress } = reveal;
  const index = progress ? order[progress.step] : undefined;
  // The answer in the spotlight pulses as it turns (a phone's own share of the reveal).
  const pulse = usePhoneTarget(index === undefined ? undefined : `board:${index}`);
  if (!progress) return null;
  const name = (id: string) => (id === view.me?.id ? 'you' : nameOf(view, id));
  const shown = order.slice(0, progress.step).map((i) => turn.options[i]!);
  const current = turn.options[order[progress.step]!]!;
  const voters = current.voters ?? [];
  return (
    <div className="space-y-3" data-testid="reveal-sequence">
      {shown.length > 0 && (
        <ul aria-label="Titles so far" className="space-y-1">
          {shown.map((o) => (
            <li
              key={o.index}
              className="flex items-baseline justify-between gap-2 rounded-lg bg-white px-3 py-1 text-sm ring-1 ring-stone-200 dark:bg-stone-800/70 dark:ring-stone-700"
            >
              <span className="min-w-0 font-semibold break-words">{o.text}</span>
              <span className="shrink-0 text-xs text-ink-muted">{verdict(o, name)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {current.truth ? 'And the real title is…' : `Title ${progress.step + 1} of ${order.length}`}
      </p>
      <PhoneCard />
      <div
        key={current.index}
        ref={pulse}
        aria-live="polite"
        className={cn(
          'space-y-3 rounded-2xl px-4 py-5 text-center ring-2 motion-safe:transition motion-safe:duration-500 motion-safe:starting:scale-95 motion-safe:starting:opacity-0',
          progress.flipped && current.truth
            ? 'bg-success-soft ring-success dark:bg-emerald-500/15 dark:ring-emerald-500'
            : progress.flipped
              ? 'bg-danger-soft ring-danger-line dark:bg-rose-500/15 dark:ring-rose-500/50'
              : 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600',
        )}
      >
        <p className="text-2xl font-bold text-balance break-words sm:text-3xl">{current.text}</p>
        <p className="text-sm">
          {voters.length > 0 ? (
            <>
              <span className="text-ink-muted">Picked by </span>
              <span className="font-semibold">{listNames(voters.map(name))}</span>
            </>
          ) : (
            <span className="text-ink-muted">Nobody picked it…</span>
          )}
        </p>
        {progress.flipped && (
          <p
            className={cn(
              'text-xl font-extrabold motion-safe:transition motion-safe:duration-300 motion-safe:starting:scale-150 motion-safe:starting:opacity-0',
              current.truth
                ? 'text-emerald-800 dark:text-emerald-200'
                : 'text-rose-800 dark:text-rose-200',
            )}
          >
            {verdict(current, name)}
            {current.truth && turn.artist && `, drawn by ${name(turn.artist)}`}
          </p>
        )}
      </div>
      {isHost && (
        <Button variant="ghost" className="h-11 w-full" onClick={onSkip}>
          Skip to the results ⏭
        </Button>
      )}
    </div>
  );
}

/** The artist's moment: whose drawing it was, the real title, and how many found it. */
function ArtistMoment({ view, turn }: { view: SketchyView; turn: TurnView }) {
  if (!turn.artist) return null;
  const truth = turn.options.find((o) => o.truth);
  const found = truth?.voters?.length ?? 0;
  const voters = turn.options.reduce((n, o) => n + (o.voters?.length ?? 0), 0);
  const artist = turn.artist === view.me?.id ? 'You' : nameOf(view, turn.artist);
  return (
    <div
      data-testid="artist-moment"
      className="flex items-center gap-3 rounded-2xl bg-success-soft px-4 py-3 ring-1 ring-success-line dark:bg-emerald-500/10 dark:ring-emerald-500/40"
    >
      <span aria-hidden className="text-3xl">
        🎨
      </span>
      <p className="min-w-0 text-sm">
        <span className="inline-flex items-center gap-1 font-bold">
          <NameDot name={nameOf(view, turn.artist)} />
          {artist} drew “{turn.prompt}”
        </span>
        <span className="block text-ink-muted">
          {found === 0
            ? 'Nobody found it!'
            : `${found} of ${voters} found it: +${points(found * ARTIST_POINTS)} to the artist.`}
        </span>
      </p>
    </div>
  );
}

function RevealBoard({ view, turn }: { view: SketchyView; turn: TurnView }) {
  const ordered = [...turn.options].sort(
    (a, b) =>
      Number(b.truth) - Number(a.truth) || (b.voters?.length ?? 0) - (a.voters?.length ?? 0),
  );
  const name = (id: string) => (id === view.me?.id ? 'you' : nameOf(view, id));
  return (
    <ul
      aria-label="Titles revealed"
      className="grid gap-2 sm:grid-cols-2"
      data-testid="reveal-board"
    >
      {ordered.map((o) => (
        <li
          key={o.index}
          className={cn(
            'space-y-1 rounded-xl px-4 py-2 ring-1',
            o.truth
              ? 'bg-success-soft ring-2 ring-success sm:col-span-2 dark:bg-emerald-500/10 dark:ring-emerald-500'
              : 'bg-white ring-stone-200 dark:bg-stone-800/70 dark:ring-stone-700',
          )}
        >
          <p className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 text-lg font-bold break-words">{o.text}</span>
            <span className="shrink-0 text-xs font-semibold">{verdict(o, name)}</span>
          </p>
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-ink-muted">
            <span>
              {(o.voters?.length ?? 0) > 0
                ? `${o.truth ? 'Found by' : 'Fooled'} ${listNames((o.voters ?? []).map(name))}`
                : o.truth
                  ? 'Nobody found it!'
                  : 'Nobody fell for it.'}
            </span>
            {(o.likes ?? 0) > 0 && <Likes index={o.index} n={o.likes ?? 0} />}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** An answer's likes, popping as another comes in. */
function Likes({ index, n }: { index: number; n: number }) {
  const ref = usePhoneTarget(`like:${index}`);
  return (
    <span ref={ref} className="inline-block">
      👍 {n}
    </span>
  );
}

/** Who scored on this drawing, and why. */
function TurnPoints({ view, turn }: { view: SketchyView; turn: TurnView }) {
  const gained = Object.entries(turn.points ?? {})
    .filter(([, p]) => p > 0)
    .sort(([, a], [, b]) => b - a);
  if (gained.length === 0)
    return <p className="text-center text-sm text-ink-muted">No points this time.</p>;
  const reasons = (id: string) => {
    const lines: string[] = [];
    const truth = turn.options.find((o) => o.truth);
    if (truth?.voters?.includes(id)) {
      const bonus = turn.streakBonus?.[id] ?? 0;
      lines.push(`found it (${points(TRUTH_POINTS)}${bonus ? ` + ${points(bonus)} streak` : ''})`);
    }
    if (turn.artist === id)
      lines.push(`drew it (${points(ARTIST_POINTS)} × ${truth?.voters?.length ?? 0})`);
    for (const o of turn.options) {
      if (o.truth || !(o.authors ?? []).includes(id) || !(o.voters?.length ?? 0)) continue;
      lines.push(
        `fooled ${o.voters!.length} (${points(FOOL_POINTS)} each${(o.authors?.length ?? 0) > 1 ? ', shared' : ''})`,
      );
    }
    return lines.join(' · ');
  };
  return (
    <ul aria-label="Points for this drawing" className="grid gap-1.5 sm:grid-cols-2">
      {gained.map(([id, p]) => (
        <li
          key={id}
          className="rounded-lg bg-success-soft px-3 py-1.5 text-sm dark:bg-emerald-500/10"
        >
          <span className="flex items-center gap-1 font-semibold text-emerald-900 dark:text-emerald-200">
            <NameDot name={nameOf(view, id)} />
            <span className="min-w-0 flex-1 truncate">{nameOf(view, id)}</span>
            <span className="tabular-nums">+{points(p)}</span>
          </span>
          <span className="block text-xs text-stone-600 dark:text-stone-400">{reasons(id)}</span>
        </li>
      ))}
    </ul>
  );
}

/** The drawing on the table, for whoever is looking: write, pick and like, then the reveal. */
export function TurnStage({
  view,
  act,
  isHost,
  reveal,
}: {
  view: SketchyView;
  act: Act;
  isHost: boolean;
  reveal: RevealState;
}) {
  const g = view.game!;
  const turn = g.turn!;
  const key = `${g.round}-${turn.number}`;
  const progressLine = (verb: string) => (
    <p className="text-center text-sm text-ink-muted" data-testid="sketchy-progress">
      {turn.done} of {turn.writerCount} {verb}
    </p>
  );
  const drawing = <TableDrawing view={view} turn={turn} isHost={isHost} act={act} />;
  if (g.stage === 'write') {
    return (
      <div className="space-y-4">
        {drawing}
        {turn.mine && turn.prompt && (
          <p className="text-center text-sm">
            You drew <span className="font-semibold">“{turn.prompt}”</span>. Shh!
          </p>
        )}
        {turn.writing && <LieForm key={key} turn={turn} act={act} />}
        {progressLine('titles in')}
      </div>
    );
  }
  if (g.stage === 'vote') {
    return (
      <div className="space-y-4">
        {drawing}
        {turn.mine && (
          <p className="text-center text-sm">Your drawing! Tap 👍 on the fakes you like.</p>
        )}
        <Board view={view} turn={turn} act={act} />
        {progressLine('picked')}
      </div>
    );
  }
  if (reveal.progress) {
    return (
      <div className="space-y-4">
        {drawing}
        <RevealSequence
          view={view}
          turn={turn}
          reveal={reveal}
          isHost={isHost}
          onSkip={() => void act({ type: 'skip-reveal' })}
        />
      </div>
    );
  }
  const last = turn.number >= turn.of && g.round >= g.rounds;
  return (
    <div className="space-y-4">
      {drawing}
      <ArtistMoment view={view} turn={turn} />
      <RevealBoard view={view} turn={turn} />
      <TurnPoints view={view} turn={turn} />
      {isHost && (
        <Button
          size="lg"
          className="w-full"
          onClick={() => void act({ type: 'next' })}
          data-testid="sketchy-next"
        >
          {last ? 'Finish' : turn.number >= turn.of ? 'Next round' : 'Next drawing'}
        </Button>
      )}
    </div>
  );
}
