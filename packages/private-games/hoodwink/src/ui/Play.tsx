import { Button, Panel, cn } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { awards, displayText, lieProblem, tidyLie } from '../logic/game.ts';
import {
  type HoodwinkAction,
  type HoodwinkView,
  MAX_LIE_LENGTH,
  type OptionView,
  type RoundView,
} from '../logic/types.ts';
import { listNames, nameOf, points, ranks, splitPrompt } from './status.ts';
import { Avatar } from './Table.tsx';

type Act = (a: HoodwinkAction) => Promise<boolean>;

interface Props {
  view: HoodwinkView;
  act: Act;
  isHost: boolean;
}

/** On a phone, a board of many long answers scrolls inside the viewport rather than the page. */
const BOARD_SCROLL =
  'max-sm:max-h-[58dvh] max-sm:overflow-y-auto max-sm:overscroll-contain max-sm:p-0.5';

const TRUTH_MESSAGE = 'That’s the real answer — write a lie!';

const PROMPT = 'text-center text-xl leading-snug font-bold text-balance break-words sm:text-2xl';

/**
 * The question, big, with its blank highlighted (or filled with the answer at the reveal). A
 * question without a blank ("…?") shows the answer underneath instead.
 */
export function Prompt({ prompt, fill }: { prompt: string; fill?: string | null }) {
  const parts = splitPrompt(prompt);
  if (!parts) {
    return (
      <div className="space-y-2 text-center">
        <p data-testid="prompt" className={PROMPT}>
          {prompt}
        </p>
        {fill && (
          <p className="mx-auto w-fit max-w-full rounded-md bg-emerald-100 px-3 py-1 text-lg font-bold break-words text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
            {displayText(fill)}
          </p>
        )}
      </div>
    );
  }
  return (
    <p data-testid="prompt" className={PROMPT}>
      {parts[0]}
      <span
        className={cn(
          'mx-0.5 inline-block min-w-[4ch] rounded-md px-1.5 align-baseline',
          fill
            ? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200'
            : 'border-b-4 border-amber-500 bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
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
    <p className="text-center text-sm text-stone-500">
      {done} of {of} {verb}
    </p>
  );
}

const INPUT =
  'block h-12 w-full rounded-lg bg-white px-3 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

function LieForm({ round, act }: { round: RoundView; act: Act }) {
  const [text, setText] = useState(round.myLie ?? '');
  const [busy, setBusy] = useState(false);
  // The answer never reaches the browser, so a lie that matches it is only refused by the server.
  const [refused, setRefused] = useState<string | null>(null);
  const trimmed = tidyLie(text);
  const sent = round.myLie !== null;
  const unchanged = sent && trimmed === round.myLie;
  const local = trimmed ? (lieProblem(trimmed)?.message ?? null) : null;
  const problem = local ?? (refused !== null && refused === trimmed ? TRUTH_MESSAGE : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const ok = await act({ type: 'lie', text: trimmed });
    setRefused(ok ? null : trimmed);
    setBusy(false);
  };
  const lieForMe = async () => {
    setBusy(true);
    await act({ type: 'lie-for-me' });
    setRefused(null);
    setBusy(false);
  };
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
          aria-invalid={problem ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          placeholder="Something believable…"
          className={cn(INPUT, 'mt-1', problem && 'ring-2 ring-rose-500')}
        />
        {problem && (
          <span role="alert" className="mt-1 block text-sm text-rose-700 dark:text-rose-400">
            {problem}
          </span>
        )}
      </label>
      {round.myLieAuto && unchanged && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          🤖 Picked for you: it scores half. Type your own to replace it.
        </p>
      )}
      <div className={cn('grid gap-2', round.canLieForMe && 'grid-cols-[1fr_auto]')}>
        <Button
          type="submit"
          size="lg"
          disabled={busy || unchanged || !trimmed || problem !== null}
        >
          {sent ? (unchanged ? '✓ Sent' : 'Change my lie') : 'Send lie'}
        </Button>
        {round.canLieForMe && (
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
    </form>
  );
}

function OptionCard({
  option,
  chosen,
  disabled,
  onPick,
}: {
  option: OptionView;
  chosen: boolean;
  disabled: boolean;
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
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500',
        option.mine
          ? 'cursor-not-allowed bg-stone-100 text-stone-500 ring-stone-200 dark:bg-stone-800/60 dark:text-stone-400 dark:ring-stone-700'
          : chosen
            ? 'bg-amber-100 ring-2 ring-amber-500 dark:bg-amber-500/20'
            : 'bg-white ring-stone-300 hover:bg-amber-50 dark:bg-stone-800 dark:ring-stone-600 dark:hover:bg-stone-700',
      )}
    >
      <span className="min-w-0 break-words">{option.text}</span>
      {option.mine && <span className="shrink-0 text-xs font-medium">Your lie</span>}
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
    <ul aria-label="Answers" className={cn('grid gap-2 sm:grid-cols-2', BOARD_SCROLL)}>
      {round.options.map((o) => (
        <li key={o.index}>
          <OptionCard
            option={o}
            chosen={round.myVote === o.index}
            disabled={!canVote || busy}
            onPick={() => void pick(o.index)}
          />
        </li>
      ))}
    </ul>
  );
}

function Avatars({ view, ids, label }: { view: HoodwinkView; ids: string[]; label: string }) {
  if (ids.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs text-stone-500">{label}</span>
      <span className="flex -space-x-1.5">
        {ids.map((id) => (
          <Avatar key={id} id={id} name={nameOf(view, id)} />
        ))}
      </span>
    </span>
  );
}

/** The truth first, then each lie with its authors and who fell for it. */
function RevealBoard({ view, round }: { view: HoodwinkView; round: RoundView }) {
  const ordered = [...round.options].sort(
    (a, b) =>
      Number(b.truth) - Number(a.truth) || (b.voters?.length ?? 0) - (a.voters?.length ?? 0),
  );
  const name = (id: string) => (id === view.me?.id ? 'you' : nameOf(view, id));
  return (
    <ul aria-label="Answers revealed" className={cn('grid gap-2 sm:grid-cols-2', BOARD_SCROLL)}>
      {ordered.map((o, i) => (
        <li
          key={o.index}
          style={{ transitionDelay: `${i * 120}ms` }}
          className={cn(
            'space-y-1 rounded-xl px-4 py-2 ring-1 motion-safe:transition motion-safe:duration-500 motion-safe:starting:translate-y-2 motion-safe:starting:opacity-0',
            o.truth
              ? 'bg-emerald-50 ring-2 ring-emerald-500 sm:col-span-2 dark:bg-emerald-500/10'
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
            <p className="text-xs text-stone-500">
              🤖 lie for me / filled in
              {(o.authors?.length ?? 0) > 1 && `: ${listNames((o.auto ?? []).map(name))}`}
            </p>
          )}
          {(o.voters?.length ?? 0) > 0 ? (
            <Avatars view={view} ids={o.voters ?? []} label={o.truth ? 'Found by' : 'Fooled'} />
          ) : (
            <p className="text-xs text-stone-500">
              {o.truth ? 'Nobody found it!' : 'Nobody fell for it.'}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}

function RoundPoints({ view, round }: { view: HoodwinkView; round: RoundView }) {
  const gained = Object.entries(round.points ?? {})
    .filter(([, p]) => p > 0)
    .sort(([, a], [, b]) => b - a);
  if (gained.length === 0) {
    return <p className="text-center text-sm text-stone-500">No points this round.</p>;
  }
  return (
    <ul aria-label="Points this round" className="flex flex-wrap justify-center gap-1.5">
      {gained.map(([id, p]) => (
        <li
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-sm font-semibold text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200"
        >
          {nameOf(view, id)} +{points(p)}
        </li>
      ))}
    </ul>
  );
}

/** The round in play, for whoever is looking. */
export function Stage({ view, act, isHost }: Props) {
  const round = view.round!;
  const me = view.me?.id ?? '';
  const roundKey = `${round.number}-${round.prompt}`;
  switch (round.stage) {
    case 'write':
      return (
        <div className="space-y-4">
          <Prompt prompt={round.prompt} />
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
          <VoteBoard view={view} round={round} act={act} />
          <Progress done={round.voted.length} of={round.voters.length} verb="voted" />
        </div>
      );
    case 'reveal':
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

const MEDALS = ['🥇', '🥈', '🥉'];
const STEP_HEIGHT = ['h-24', 'h-16', 'h-10'];

/** Top three on a podium (ties share a step), the awards, then Play again. */
export function GameOver({ view, act, isHost, hostName }: Props & { hostName: string }) {
  const ranked = view.scores;
  const place = ranks(ranked.map((s) => s.score));
  const podium = ranked.filter((_, i) => place[i]! <= 3);
  // Like a real podium: winners in the middle, the rest alternating left and right (2nd, 1st, 3rd),
  // so ties never push the winner to one side.
  const order: typeof podium = podium.filter((s) => place[ranked.indexOf(s)] === 1);
  podium
    .filter((s) => place[ranked.indexOf(s)]! > 1)
    .forEach((s, i) => {
      if (i % 2 === 0) order.unshift(s);
      else order.push(s);
    });
  const { bestLiar, truthSeeker } = awards(ranked);
  const names = (ids: string[]) => listNames(ids.map((id) => nameOf(view, id)));
  const stat = (id: string) => ranked.find((s) => s.id === id)!;
  const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <Panel className="space-y-4 text-center">
      {view.endReason === 'too-few' && (
        <p className="font-semibold">Too few players left: final scores so far.</p>
      )}
      <ol aria-label="Podium" className="flex items-end justify-center gap-2">
        {order.map((s) => {
          const rank = place[ranked.indexOf(s)]! - 1;
          return (
            <li key={s.id} className="flex w-24 min-w-0 flex-col items-center gap-1">
              <span className="text-2xl" aria-hidden>
                {MEDALS[rank]}
              </span>
              <Avatar id={s.id} name={s.name} className="size-10 text-base" />
              <span className="w-full truncate text-sm font-semibold">{s.name}</span>
              <span className="text-sm tabular-nums">{points(s.score)}</span>
              <span
                className={cn(
                  'w-full rounded-t-lg bg-amber-200 dark:bg-amber-500/30',
                  STEP_HEIGHT[rank],
                )}
              />
            </li>
          );
        })}
      </ol>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div className="rounded-xl bg-rose-50 px-3 py-2 dark:bg-rose-500/10">
          <dt className="font-semibold">🎭 Best liar</dt>
          <dd>
            {bestLiar.length > 0
              ? `${names(bestLiar)}: fooled ${times(stat(bestLiar[0]!).fooled, 'player', 'players')}`
              : 'Nobody fooled anyone!'}
          </dd>
        </div>
        <div className="rounded-xl bg-emerald-50 px-3 py-2 dark:bg-emerald-500/10">
          <dt className="font-semibold">🔎 Truth seeker</dt>
          <dd>
            {truthSeeker.length > 0
              ? `${names(truthSeeker)}: found it ${times(stat(truthSeeker[0]!).truths, 'time', 'times')}`
              : 'Nobody found the truth!'}
          </dd>
        </div>
      </dl>
      {isHost ? (
        <div className="grid gap-2 sm:flex sm:justify-center">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change settings
          </Button>
        </div>
      ) : (
        <p>Waiting for {hostName} to start the next game…</p>
      )}
    </Panel>
  );
}
