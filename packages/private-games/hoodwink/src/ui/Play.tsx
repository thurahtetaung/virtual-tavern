import { type ActOptions, type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, NameDot, Panel, RefusalSlot, Standings, Superlatives, cn } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { awards, lieProblem, tidyLie } from '../logic/game.ts';
import {
  AUTO_FOOL_POINTS,
  FOOL_POINTS,
  type HoodwinkAction,
  type HoodwinkView,
  MAX_LIE_LENGTH,
  type OptionView,
  type RoundView,
  TRUTH_POINTS,
} from '../logic/types.ts';
import { type RevealState, RevealSequence } from './Reveal.tsx';
import { listNames, nameOf, points, pointsBreakdown, splitPrompt } from './status.ts';

type Act = (a: HoodwinkAction, options?: ActOptions) => Promise<boolean>;

interface Props {
  view: HoodwinkView;
  act: Act;
  isHost: boolean;
}

interface StageProps extends Props {
  /** How far the one-by-one reveal has got. */
  reveal: RevealState;
}

/** Where the server's refusal of a lie shows: right under the lie form. */
const LIE_ANCHOR = 'hoodwink-lie';

const ANSWER_SIZE = {
  word: 'a word or two',
  phrase: 'a short phrase',
  sentence: 'a whole sentence',
} as const;

const PROMPT = 'text-center text-xl leading-snug font-bold text-balance break-words sm:text-2xl';

/**
 * The question, big, with its blank highlighted (or filled with the answer at the reveal). A
 * question without a blank ("…?") stays as it is: the truth tops the board right below.
 */
export function Prompt({ prompt, fill }: { prompt: string; fill?: string | null }) {
  const parts = splitPrompt(prompt);
  if (!parts) {
    return (
      <p data-testid="prompt" className={PROMPT}>
        {prompt}
      </p>
    );
  }
  return (
    <p data-testid="prompt" className={PROMPT}>
      {parts[0]}
      <span
        className={cn(
          'mx-0.5 inline-block min-w-[4ch] rounded-md px-1.5 align-baseline',
          fill
            ? 'bg-success-soft text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200'
            : 'border-b-4 border-accent dark:border-amber-500 bg-accent-soft text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
        )}
      >
        {fill ?? '\u00a0?\u00a0'}
      </span>
      {parts[1]}
    </p>
  );
}

function Progress({ done, of, verb }: { done: number; of: number; verb: string }) {
  return (
    <p className="text-center text-sm text-ink-muted">
      {done} of {of} {verb}
    </p>
  );
}

const INPUT =
  'block h-12 w-full rounded-lg bg-white px-3 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

function LieForm({ round, act }: { round: RoundView; act: Act }) {
  const [text, setText] = useState(round.myLie ?? '');
  const [busy, setBusy] = useState(false);
  // The answer never reaches the browser, so a lie that matches it is only refused by the server
  // (its message shows in the slot under the form); Send stays off until the lie changes.
  const [refused, setRefused] = useState<string | null>(null);
  const trimmed = tidyLie(text);
  const sent = round.myLie !== null;
  const unchanged = sent && trimmed === round.myLie;
  const problem = trimmed ? (lieProblem(trimmed)?.message ?? null) : null;
  const blocked = problem !== null || (refused !== null && refused === trimmed);
  // One pick per round, and only before you've sent a lie: the server works out whether a
  // ready-made lie was set aside for you.
  const offerLieForMe = round.canLieForMe;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act({ type: 'lie', text: trimmed }, { anchor: LIE_ANCHOR });
    setRefused(ok ? null : trimmed);
    setBusy(false);
  };
  const lieForMe = async (choice?: number) => {
    setBusy(true);
    await act({ type: 'lie-for-me', choice }, { anchor: LIE_ANCHOR });
    setRefused(null);
    setBusy(false);
  };
  const fakes = round.myFakes;
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <label className="block">
        <span className="text-sm font-semibold">Your lie</span>
        <input
          value={text}
          maxLength={MAX_LIE_LENGTH}
          autoComplete="off"
          spellCheck={false}
          enterKeyHint="send"
          aria-invalid={blocked ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          placeholder="Something believable…"
          className={cn(INPUT, 'mt-1', blocked && 'ring-2 ring-danger dark:ring-rose-500')}
        />
        {problem && (
          <span role="alert" className="mt-1 block text-sm text-rose-700 dark:text-rose-400">
            {problem}
          </span>
        )}
      </label>
      {fakes && (
        <fieldset data-testid="fake-choices" className="space-y-2">
          <legend className="text-sm font-semibold">
            🎲 Pick a ready-made lie{' '}
            <span className="font-normal text-ink-muted">(scores half)</span>
          </legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {fakes.map((fake, i) => {
              const chosen = round.myLie === fake;
              return (
                <button
                  key={fake}
                  type="button"
                  aria-pressed={chosen}
                  disabled={busy}
                  onClick={() => void lieForMe(i)}
                  className={cn(
                    'flex min-h-12 w-full items-center justify-between gap-2 rounded-xl px-4 py-2 text-left text-lg font-semibold ring-1 transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
                    chosen
                      ? 'bg-accent-soft ring-2 ring-accent dark:bg-amber-500/20 dark:ring-amber-500'
                      : 'bg-white ring-stone-300 hover:bg-accent-soft dark:bg-stone-800 dark:ring-stone-600 dark:hover:bg-stone-700',
                  )}
                >
                  <span className="min-w-0 break-words">{fake}</span>
                  {chosen && (
                    <span className="shrink-0 text-sm" aria-hidden>
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {round.myLie === null && (
            <p className="text-sm text-stone-600 dark:text-stone-400">
              Or type your own above: it scores in full.
            </p>
          )}
        </fieldset>
      )}
      {round.myLieAuto && unchanged && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          🎲 Picked for you: it scores half. Type your own to replace it.
        </p>
      )}
      {round.myLieShared && unchanged && (
        <p data-testid="lie-shared" className="text-sm text-amber-800 dark:text-amber-300">
          👯 Someone else wrote that too: it’ll be shared, and so will the points. Change it to keep
          them all.
        </p>
      )}
      <div className={cn('grid gap-2', offerLieForMe && 'grid-cols-[1fr_auto]')}>
        <Button type="submit" size="lg" disabled={busy || unchanged || !trimmed || blocked}>
          {sent ? (unchanged ? '✓ Sent' : 'Change my lie') : 'Send lie'}
        </Button>
        {offerLieForMe && (
          <Button
            variant="secondary"
            size="lg"
            className="px-3 whitespace-nowrap max-sm:text-base"
            disabled={busy}
            onClick={() => void lieForMe()}
          >
            🎲 Lie for me
          </Button>
        )}
      </div>
      <RefusalSlot anchor={LIE_ANCHOR} />
    </form>
  );
}

function OptionCard({
  option,
  chosen,
  disabled,
  filled,
  onPick,
}: {
  option: OptionView;
  chosen: boolean;
  disabled: boolean;
  /** The viewer's lie was filled in by the timer. */
  filled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || option.mine}
      aria-pressed={chosen}
      onClick={onPick}
      className={cn(
        'flex min-h-14 w-full items-center justify-between gap-2 rounded-xl px-4 py-3 text-left text-lg font-semibold ring-1 transition',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        option.mine
          ? 'cursor-not-allowed bg-stone-100 text-ink-muted ring-stone-200 dark:bg-stone-800/60 dark:text-stone-400 dark:ring-stone-700'
          : chosen
            ? 'bg-accent-soft ring-2 ring-accent dark:ring-amber-500 dark:bg-amber-500/20'
            : 'bg-white ring-stone-300 hover:bg-accent-soft dark:bg-stone-800 dark:ring-stone-600 dark:hover:bg-stone-700',
      )}
    >
      <span className="min-w-0 break-words">{option.text}</span>
      {option.mine && (
        <span className="shrink-0 text-xs font-medium">
          {filled ? 'Filled in for you' : 'Your lie'}
        </span>
      )}
      {chosen && !option.mine && (
        <span className="shrink-0 text-sm" aria-hidden>
          ✓
        </span>
      )}
    </button>
  );
}

function VoteBoard({ view, round, act }: { view: HoodwinkView; round: RoundView; act: Act }) {
  const [busy, setBusy] = useState(false);
  const canVote = round.voters.includes(view.me?.id ?? '');
  const pick = async (index: number) => {
    setBusy(true);
    await act({ type: 'vote', option: index });
    setBusy(false);
  };
  return (
    <ul aria-label="Answers" className="grid gap-2 sm:grid-cols-2">
      {round.options.map((o) => (
        <li key={o.index}>
          <OptionCard
            option={o}
            chosen={round.myVote === o.index}
            disabled={!canVote || busy}
            filled={round.myLieFilled}
            onPick={() => void pick(o.index)}
          />
        </li>
      ))}
    </ul>
  );
}

/** Who found the truth or fell for a lie, by name, each after their colour's dot. */
function Names({ view, ids, label }: { view: HoodwinkView; ids: string[]; label: string }) {
  if (ids.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-ink-muted">{label}</span>
      {ids.map((id) => (
        <span
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-stone-100 py-0.5 pr-2 pl-1.5 text-xs font-semibold dark:bg-stone-700/70"
        >
          {id === view.me?.id ? 'You' : nameOf(view, id)}
          <NameDot name={nameOf(view, id)} className="order-first" />
        </span>
      ))}
    </p>
  );
}

/** The whole board once the reveal is over: the truth first, then each lie with its authors. */
function RevealBoard({ view, round }: { view: HoodwinkView; round: RoundView }) {
  const ordered = [...round.options].sort(
    (a, b) =>
      Number(b.truth) - Number(a.truth) || (b.voters?.length ?? 0) - (a.voters?.length ?? 0),
  );
  const name = (id: string) => (id === view.me?.id ? 'you' : nameOf(view, id));
  return (
    <ul aria-label="Answers revealed" className="grid gap-2 sm:grid-cols-2">
      {ordered.map((o, i) => (
        <li
          key={o.index}
          style={{ transitionDelay: `${i * 120}ms` }}
          className={cn(
            'space-y-1 rounded-xl px-4 py-2 ring-1 motion-safe:transition motion-safe:duration-500 motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0',
            o.truth
              ? 'bg-success-soft ring-2 ring-success dark:ring-emerald-500 sm:col-span-2 dark:bg-emerald-500/10'
              : 'bg-white ring-stone-200 dark:bg-stone-800/70 dark:ring-stone-700',
          )}
        >
          <p className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 text-lg font-bold break-words">{o.text}</span>
            <span
              className={cn(
                'shrink-0 text-xs font-semibold',
                o.truth
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-rose-700 dark:text-rose-300',
              )}
            >
              {o.truth
                ? '✅ The truth'
                : o.house
                  ? '🏠 House fake'
                  : `🎭 Lie by ${listNames((o.authors ?? []).map(name))}`}
            </span>
          </p>
          {(o.auto?.length ?? 0) > 0 && (
            <p className="text-xs text-ink-muted">
              🎲 Picked by the game (half points)
              {(o.authors?.length ?? 0) > 1 && `: ${listNames((o.auto ?? []).map(name))}`}
            </p>
          )}
          {(o.voters?.length ?? 0) > 0 ? (
            <Names view={view} ids={o.voters ?? []} label={o.truth ? 'Found by' : 'Fooled'} />
          ) : (
            <p className="text-xs text-ink-muted">
              {o.truth ? 'Nobody found it!' : 'Nobody fell for it.'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

/** What the final round's ×2 means in points. */
function DoubleNote() {
  return (
    <p
      data-testid="double-note"
      className="text-center text-xs font-semibold text-amber-700 dark:text-amber-300"
    >
      Final round ×2: the truth scores {points(TRUTH_POINTS * 2)}, each player fooled{' '}
      {points(FOOL_POINTS * 2)} ({points(AUTO_FOOL_POINTS * 2)} for a ready-made lie).
    </p>
  );
}

/** Who scored this round, and why: each player's points with their reasons underneath. */
function RoundPoints({ view, round }: { view: HoodwinkView; round: RoundView }) {
  const gained = Object.entries(round.points ?? {})
    .filter(([, p]) => p > 0)
    .sort(([, a], [, b]) => b - a);
  if (gained.length === 0) {
    return <p className="text-center text-sm text-ink-muted">No points this round.</p>;
  }
  return (
    <div className="space-y-1">
      {round.double && <DoubleNote />}
      <ul aria-label="Points this round" className="grid gap-1.5 sm:grid-cols-2">
        {gained.map(([id, p]) => (
          <li
            key={id}
            className="rounded-lg bg-success-soft px-3 py-1.5 text-sm dark:bg-emerald-500/10"
          >
            <span className="flex items-center gap-1 font-semibold text-emerald-900 dark:text-emerald-200">
              <span className="min-w-0 flex-1 truncate">{nameOf(view, id)}</span>
              <NameDot name={nameOf(view, id)} className="order-first" />
              <span className="tabular-nums">+{points(p)}</span>
            </span>
            {pointsBreakdown(view, round, id).map((line, i) => (
              <span
                key={i}
                className="flex justify-between gap-2 text-xs text-stone-600 dark:text-stone-400"
              >
                <span className="min-w-0">{line.reason}</span>
                <span className="shrink-0 tabular-nums">+{points(line.points)}</span>
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The round in play, for whoever is looking. */
export function Stage({ view, act, isHost, reveal }: StageProps) {
  const round = view.round!;
  const me = view.me?.id ?? '';
  const roundKey = `${round.number}-${round.prompt}`;
  switch (round.stage) {
    case 'write':
      return (
        <div className="space-y-4">
          <Prompt prompt={round.prompt} />
          {round.answerSize && round.players.includes(me) && (
            <p className="text-center text-sm text-stone-600 dark:text-stone-400">
              💡 The real answer is {ANSWER_SIZE[round.answerSize]}: make your lie match.
            </p>
          )}
          {round.players.includes(me) && (
            <LieForm
              // A new "Lie for me" pick remounts the form, so the box shows it, ready to replace.
              key={`${roundKey}-${round.myLieAuto ? round.myLie : ''}`}
              round={round}
              act={act}
            />
          )}
          <Progress done={round.written.length} of={round.players.length} verb="lies in" />
        </div>
      );
    case 'vote':
      return (
        <div className="space-y-4">
          <Prompt prompt={round.prompt} />
          {round.double && <DoubleNote />}
          <VoteBoard view={view} round={round} act={act} />
          <Progress done={round.voted.length} of={round.voters.length} verb="voted" />
        </div>
      );
    case 'reveal':
      if (reveal.progress) {
        return (
          <div className="space-y-4">
            <Prompt prompt={round.prompt} />
            <RevealSequence
              view={view}
              round={round}
              reveal={reveal}
              isHost={isHost}
              onSkip={() => void act({ type: 'skip-reveal' })}
            />
          </div>
        );
      }
      return (
        <div className="space-y-4">
          <Prompt prompt={round.prompt} fill={round.answer} />
          <RevealBoard view={view} round={round} />
          <RoundPoints view={view} round={round} />
          {isHost && (
            <Button size="lg" className="w-full" onClick={() => void act({ type: 'next-round' })}>
              {round.number >= round.rounds ? 'Finish' : 'Next round'}
            </Button>
          )}
        </div>
      );
  }
}

/**
 * The shared podium and final standings, the awards, then Play again. The night recap's
 * superlatives replace the built-in Best liar / Truth seeker cards (they are award rules there);
 * with recaps off, the cards stay.
 */
export function GameOver({ view, act, isHost, room }: Props & { room: GameRoomInfo }) {
  const ranked = view.scores;
  const { bestLiar, truthSeeker } = awards(ranked);
  const names = (ids: string[]) => listNames(ids.map((id) => nameOf(view, id)));
  const stat = (id: string) => ranked.find((s) => s.id === id)!;
  const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <Panel className="space-y-4 text-center">
      {view.endReason === 'too-few' && (
        <p className="font-semibold">Too few players left: final scores so far.</p>
      )}
      <Standings
        entries={ranked.map((s) => ({
          id: s.id,
          name: s.left ? `${s.name} (left)` : s.name,
          score: s.score,
        }))}
        you={view.me?.id}
        scoreLabel={(n) => `${points(n)} pts`}
        className="text-left"
      />
      {room.superlatives?.length ? (
        <Superlatives lines={room.superlatives} />
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-danger-soft px-3 py-2 dark:bg-rose-500/10">
            <dt className="font-semibold">🎭 Best liar</dt>
            <dd>
              {bestLiar.length > 0
                ? `${names(bestLiar)}: fooled ${times(stat(bestLiar[0]!).fooled, 'player', 'players')}`
                : 'Nobody fooled anyone!'}
            </dd>
          </div>
          <div className="rounded-xl bg-success-soft px-3 py-2 dark:bg-emerald-500/10">
            <dt className="font-semibold">🔎 Truth seeker</dt>
            <dd>
              {truthSeeker.length > 0
                ? `${names(truthSeeker)}: found it ${times(stat(truthSeeker[0]!).truths, 'time', 'times')}`
                : 'Nobody found the truth!'}
            </dd>
          </div>
        </dl>
      )}
      {isHost ? (
        <div className="grid gap-2 sm:flex sm:justify-center">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change setup
          </Button>
        </div>
      ) : (
        <p>{waitingForHost(room, 'start the next game')}</p>
      )}
    </Panel>
  );
}
