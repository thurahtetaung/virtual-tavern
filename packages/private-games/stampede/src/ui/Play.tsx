import { type ActOptions, type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Panel,
  PlayerTag,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  cn,
  useConfirm,
  useSecondsLeft,
} from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { answerProblem } from '../logic/game.ts';
import { tidyAnswer } from '../logic/match.ts';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import {
  type GroupView,
  MAX_ANSWER_LENGTH,
  type MergeStep,
  type RoundView,
  type StampedeAction,
  type StampedeView,
} from '../logic/types.ts';
import { CowCount, PinkMark } from './parts.tsx';
import { missingIds, nameOf, who } from './status.ts';

type Act = (a: StampedeAction, options?: ActOptions) => Promise<boolean>;

interface Props {
  view: StampedeView;
  room: GameRoomInfo;
  act: Act;
  names: Names;
  online: (id: string) => boolean;
}

const ANSWER_ANCHOR = 'stampede-answer';
const MERGE_ANCHOR = 'stampede-merge';
const PICK_ANCHOR = 'stampede-pick';

export function Question({ prompt, small = false }: { prompt: string; small?: boolean }) {
  return (
    <p
      data-testid="question"
      className={cn(
        'text-center leading-snug font-bold text-balance break-words',
        small ? 'text-lg sm:text-xl' : 'text-2xl sm:text-3xl lg:text-4xl',
      )}
    >
      {prompt}
    </p>
  );
}

const INPUT =
  'block h-12 w-full rounded-lg bg-white px-3 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

function AnswerForm({ round, act }: { round: RoundView; act: Act }) {
  const [text, setText] = useState(round.myAnswer ?? '');
  const [busy, setBusy] = useState(false);
  const trimmed = tidyAnswer(text);
  const sent = round.myAnswer !== null;
  const unchanged = sent && trimmed === round.myAnswer;
  const problem = trimmed ? (answerProblem(trimmed)?.message ?? null) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || problem || unchanged) return;
    setBusy(true);
    await act({ type: 'answer', text: trimmed }, { anchor: ANSWER_ANCHOR });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <label className="block">
        <span className="sr-only">Your answer</span>
        <input
          data-testid="answer-input"
          value={text}
          maxLength={MAX_ANSWER_LENGTH}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck
          enterKeyHint="send"
          aria-invalid={problem ? true : undefined}
          onChange={(e) => setText(e.target.value)}
          placeholder="Your answer"
          className={cn(INPUT, problem && 'ring-2 ring-danger dark:ring-rose-500')}
        />
        <span className="mt-1 block text-xs text-ink-muted">
          One or two words is best. Nobody sees it until everyone has answered.
        </span>
        {problem && (
          <span role="alert" className="mt-1 block text-sm text-rose-700 dark:text-rose-400">
            {problem}
          </span>
        )}
      </label>
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || !trimmed || problem !== null || unchanged}
        data-testid="answer-send"
      >
        {sent ? (unchanged ? `✓ Locked in: ${round.myAnswer}` : 'Change my answer') : 'Lock in 🐮'}
      </Button>
      <RefusalSlot anchor={ANSWER_ANCHOR} resetKey={round.number} />
    </form>
  );
}

/** Who has answered (never what): a tick per player, so the room sees who it waits for. */
function AnswerTicks({
  view,
  round,
  names,
}: {
  view: StampedeView;
  round: RoundView;
  names: Names;
}) {
  const done = new Set(round.answered);
  return (
    <ul
      aria-label="Answers in"
      className="flex flex-wrap justify-center gap-1.5"
      data-testid="ticks"
    >
      {round.players.map((id) => (
        <li
          key={id}
          className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-sm ring-1 ring-line dark:bg-stone-800 dark:ring-0"
        >
          <PlayerTag name={nameOf(view, id)} you={id === view.me?.id} />
          {view.pinkCow === id && <PinkMark names={names} />}
          <span role="img" aria-label={done.has(id) ? 'answered' : 'writing'}>
            {done.has(id) ? '✅' : '✏️'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Answered players can moo at the ones still writing (the rulebook's way to hurry them). */
function MooButton({ round, act, view }: { round: RoundView; act: Act; view: StampedeView }) {
  const missing = missingIds(round);
  const me = view.me?.id;
  const canMoo =
    missing.length > 0 && (!me || !round.players.includes(me) || round.myAnswer !== null);
  if (!canMoo) return null;
  return (
    <div className="space-y-1 text-center">
      <Button
        variant="secondary"
        onClick={() => void act({ type: 'moo' }, { anchor: 'stampede-moo' })}
        data-testid="moo"
      >
        🐮 Moo at {missing.length === 1 ? nameOf(view, missing[0]) : 'them'}
      </Button>
      <RefusalSlot anchor="stampede-moo" resetKey={round.number} />
    </div>
  );
}

/** The host's way out when the round waits on someone who isn't coming. */
function ContinueWithout({ view, room, act, online }: Omit<Props, 'names'>) {
  const round = view.round;
  const left = useSecondsLeft(round?.deadline ?? null, room.clockOffset);
  if (!room.isHost || !round || round.stage !== 'answer') return null;
  const missing = missingIds(round);
  if (missing.length === 0) return null;
  const timeUp = left === 0;
  if (!timeUp && !missing.every((id) => !online(id))) return null;
  const list =
    missing.length > 3
      ? `${missing.length} players`
      : missing.map((id) => nameOf(view, id)).join(', ');
  return (
    <Panel className="space-y-2 text-center" data-testid="continue-without">
      <p className="text-sm">
        {timeUp ? '⏰ Time’s up. ' : '📴 '}Still waiting for {list}. Continue, and they have no
        answer this round.
      </p>
      <Button size="lg" className="w-full" onClick={() => void act({ type: 'continue-without' })}>
        Continue without them
      </Button>
    </Panel>
  );
}

function Answering(props: Props) {
  const { view, room, act } = props;
  const round = view.round!;
  const [confirm, dialog] = useConfirm();
  const me = view.me?.id ?? '';
  const playing = round.players.includes(me);
  const skip = async () => {
    if (
      round.answered.length > 0 &&
      !(await confirm({
        title: 'Swap this question?',
        body: 'Answers written so far are cleared. You can swap once a round.',
        confirmLabel: 'Swap question',
      }))
    )
      return;
    void act({ type: 'skip' }, { anchor: ANSWER_ANCHOR });
  };
  return (
    <div className="space-y-4">
      {dialog}
      <Question prompt={round.prompt} />
      {playing ? (
        <AnswerForm key={`${round.number}:${round.questionId}`} round={round} act={act} />
      ) : null}
      <AnswerTicks view={view} round={round} names={props.names} />
      <MooButton round={round} act={act} view={view} />
      <ContinueWithout {...props} />
      {room.isHost && round.canSkip && (
        <div className="text-center">
          <Button variant="ghost" onClick={() => void skip()} data-testid="skip">
            ↻ Skip this question
          </Button>
        </div>
      )}
    </div>
  );
}

// ---- Checking the groups (the host) ----

type Selected = { kind: 'group'; id: string } | { kind: 'member'; player: string } | null;

function MergeBoard({ view, act, room }: Props) {
  const round = view.round!;
  const groups = [...(round.groups ?? [])].sort((a, b) => b.members.length - a.members.length);
  const [selected, setSelected] = useState<Selected>(null);
  const send = async (action: StampedeAction) => {
    setSelected(null);
    await act(action, { anchor: MERGE_ANCHOR });
  };
  const label = (id: string) => round.groups?.find((g) => g.id === id)?.label ?? '';
  const suggestionFor = (id: string) => round.suggestions.find((s) => s.from === id);
  const selectedGroup = selected?.kind === 'group' ? selected.id : null;
  const selectedMember = selected?.kind === 'member' ? selected.player : null;
  const memberGroup = selectedMember
    ? groups.find((g) => g.members.includes(selectedMember))
    : undefined;
  const target = (g: GroupView) =>
    (selectedGroup && selectedGroup !== g.id) || (memberGroup && memberGroup.id !== g.id);
  const drop = (g: GroupView) =>
    selectedGroup
      ? send({ type: 'merge', from: selectedGroup, into: g.id })
      : send({ type: 'move', player: selectedMember!, into: g.id });
  const big = groups.filter((g) => g.members.length > 1);
  const alone = groups.filter((g) => g.members.length === 1);
  const moving = selectedGroup
    ? `“${label(selectedGroup)}”`
    : selectedMember
      ? `${nameOf(view, selectedMember)}’s answer`
      : null;

  const card = (g: GroupView) => {
    const suggestion = suggestionFor(g.id);
    const isSelected = selectedGroup === g.id;
    return (
      <li
        key={g.id}
        data-testid="merge-group"
        data-label={g.label}
        className={cn(
          'sp-rise space-y-2 rounded-xl bg-card p-3 ring-1 ring-line dark:bg-stone-800/70 dark:ring-stone-700',
          isSelected && 'ring-2 ring-accent dark:ring-amber-500',
        )}
      >
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-lg font-bold">
            {g.label} <span className="font-normal text-ink-muted">×{g.members.length}</span>
          </p>
          {target(g) ? (
            <Button size="sm" variant="soft" onClick={() => void drop(g)} data-testid="merge-here">
              Join here
            </Button>
          ) : (
            <Button
              size="sm"
              variant={isSelected ? 'primary' : 'secondary'}
              aria-pressed={isSelected}
              onClick={() => setSelected(isSelected ? null : { kind: 'group', id: g.id })}
              data-testid="merge-pick"
            >
              {isSelected ? 'Cancel' : 'Join into…'}
            </Button>
          )}
        </div>
        <ul className="flex flex-wrap gap-1.5">
          {g.members.map((id) => {
            const on = selectedMember === id;
            const raw = g.answers[id] ?? '';
            return (
              <li key={id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setSelected(on ? null : { kind: 'member', player: id })}
                  className={cn(
                    'inline-flex min-h-9 items-center gap-1 rounded-full bg-panel px-2.5 py-1 text-sm ring-1 ring-line dark:bg-stone-900 dark:ring-stone-700',
                    on && 'ring-2 ring-accent dark:ring-amber-500',
                  )}
                  title="Move this answer"
                >
                  <PlayerTag name={nameOf(view, id)} />
                  {raw.toLowerCase() !== g.label.toLowerCase() && (
                    <span className="text-ink-muted">“{raw}”</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {suggestion && !selected && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line px-2 py-1.5 text-sm dark:border-stone-600">
            <span>✏️ Looks like a typo of “{label(suggestion.into)}”</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void send({ type: 'merge', from: g.id, into: suggestion.into })}
              data-testid="merge-suggestion"
            >
              Join
            </Button>
          </p>
        )}
        {selectedMember && memberGroup?.id === g.id && g.members.length > 1 && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void send({ type: 'move', player: selectedMember, into: null })}
            data-testid="merge-split"
          >
            Put {nameOf(view, selectedMember)}’s answer on its own
          </Button>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3" data-testid="merge-board">
      <Question prompt={round.prompt} small />
      <p className="text-center text-sm text-ink-muted">
        Only you see the answers now. Every change you make is shown to everyone at the reveal.
      </p>
      {moving && (
        <p className="sticky top-2 z-10 flex items-center justify-between gap-2 rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40">
          <span>Moving {moving}: tap “Join here” on its group.</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
            Cancel
          </Button>
        </p>
      )}
      <ul className="grid gap-2 lg:grid-cols-2">{big.map(card)}</ul>
      {alone.length > 0 && (
        <section aria-label="Answers on their own" className="space-y-2">
          <h3 className="text-sm font-semibold">On their own ({alone.length})</h3>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{alone.map(card)}</ul>
        </section>
      )}
      {groups.length === 0 && <p className="text-center">Nobody answered this round.</p>}
      {round.late.length > 0 && (
        <p className="text-sm text-ink-muted">
          No answer from {round.late.map((id) => who(view, id)).join(', ')}.
        </p>
      )}
      <Changes steps={round.merges ?? []} />
      <RefusalSlot anchor={MERGE_ANCHOR} resetKey={round.number} />
      <StickyBar>
        <div className="grid grid-cols-[auto_1fr] gap-2 border-t border-line pt-3 dark:border-stone-800">
          <Button
            variant="secondary"
            size="lg"
            disabled={!(round.merges ?? []).some((m) => m.kind !== 'reset')}
            onClick={() => void send({ type: 'reset-groups' })}
          >
            Start again
          </Button>
          <Button size="lg" onClick={() => void send({ type: 'reveal' })} data-testid="reveal">
            Reveal answers
          </Button>
        </div>
      </StickyBar>
      {!room.isHost && <p className="text-sm text-ink-muted">You’re no longer the host.</p>}
    </div>
  );
}

function stepText(s: MergeStep): string {
  const [a = '', b = ''] = s.labels;
  switch (s.kind) {
    case 'merge':
      return `Joined “${a}” into “${b}”`;
    case 'move':
      return `Moved “${a}” to “${b}”`;
    case 'split':
      return `Took “${a}” out of “${b}”`;
    case 'reset':
      return 'Started again from the automatic groups';
  }
}

/** The host's checking steps (all of them are shown to everyone at the reveal). */
function Changes({ steps, title = 'Changes' }: { steps: MergeStep[]; title?: string }) {
  if (steps.length === 0) return null;
  return (
    <details className="text-sm" data-testid="merge-log">
      <summary className="cursor-pointer text-ink-muted">
        {title} ({steps.length})
      </summary>
      <ol className="mt-1 list-decimal space-y-0.5 pl-5">
        {steps.map((s, i) => (
          <li key={i}>{stepText(s)}</li>
        ))}
      </ol>
    </details>
  );
}

function WaitingForCheck({ view, room, act }: Props) {
  const round = view.round!;
  return (
    <div className="space-y-4 text-center">
      <Question prompt={round.prompt} small />
      <p className="text-5xl" aria-hidden>
        🐄🐄🐄
      </p>
      {round.myAnswer && (
        <p data-testid="my-answer">
          Your answer: <strong>{round.myAnswer}</strong>
        </p>
      )}
      {room.isHost ? (
        <Button size="lg" onClick={() => void act({ type: 'check' })} data-testid="check">
          Check the answers
        </Button>
      ) : (
        <p className="text-ink-muted">The host is grouping the answers. Get ready…</p>
      )}
    </div>
  );
}

// ---- The reveal ----

function GroupRow({
  g,
  view,
  mine,
  herd,
  names,
}: {
  g: GroupView;
  view: StampedeView;
  mine: boolean;
  herd: boolean;
  names: Names;
}) {
  const alone = g.members.length === 1;
  return (
    <li
      data-testid={herd ? 'herd' : 'group'}
      data-label={g.label}
      className={cn(
        'sp-rise rounded-xl px-3 py-2 ring-1',
        herd
          ? 'bg-success-soft text-success-ink ring-success-line dark:bg-emerald-500/15 dark:text-emerald-100 dark:ring-emerald-500/40'
          : 'bg-card ring-line dark:bg-stone-800/70 dark:ring-stone-700',
        mine && !herd && 'ring-2 ring-accent dark:ring-amber-500',
      )}
    >
      <p className={cn('font-bold', herd ? 'text-2xl lg:text-4xl' : 'text-lg lg:text-2xl')}>
        {herd && '🐄 '}
        {g.label} <span className="font-normal opacity-70">×{g.members.length}</span>
        {alone && (
          <span className="ml-1 text-base font-normal" title="On its own">
            🐺
          </span>
        )}
        {mine && <span className="ml-2 text-sm font-normal">(you)</span>}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {g.members.map((id) => (
          <li key={id} className="inline-flex items-center gap-1">
            <PlayerTag name={nameOf(view, id)} you={id === view.me?.id} />
            {herd && (
              <span className="sp-fly font-semibold" aria-label={`+1 ${names.cow}`}>
                +1 🐄
              </span>
            )}
          </li>
        ))}
      </ul>
    </li>
  );
}

function PinkLine({ view, round, names }: { view: StampedeView; round: RoundView; names: Names }) {
  const r = round.result!;
  const f = (s: string) => fillNames(s, names);
  if (round.stage === 'pick') return null;
  let text: string;
  if (r.pinkTo === r.pinkFrom) {
    text = r.pinkTo ? f(`stays with ${who(view, r.pinkTo)}`) : 'stays in the middle';
  } else if (r.pinkTo === null) {
    text = f(`goes back to the middle (${nameOf(view, r.pinkFrom)} left)`);
  } else {
    const from = r.pinkFrom ? `${who(view, r.pinkFrom)} → ` : 'middle → ';
    const how =
      r.pinkHow === 'picked' ? ' (picked)' : r.pinkHow === 'timeout' ? ' (⏱ picked at random)' : '';
    text = `${from}${who(view, r.pinkTo)}${how}`;
  }
  return (
    <p
      data-testid="pink-line"
      className="rounded-xl bg-special-soft px-3 py-2 text-center font-semibold text-special-ink ring-1 ring-special-line dark:bg-fuchsia-500/15 dark:text-fuchsia-100 dark:ring-fuchsia-500/40"
    >
      <PinkMark names={names} className={cn(r.pinkTo !== r.pinkFrom && 'sp-walk')} /> {names.pink}:{' '}
      {text}
    </p>
  );
}

function PickPanel({ view, room, act, names }: Props) {
  const round = view.round!;
  const pick = round.pick!;
  const holder = view.pinkCow;
  const me = view.me?.id;
  const f = (s: string) => fillNames(s, names);
  const answerOf = (id: string) => round.groups?.find((g) => g.members.includes(id))?.label ?? '';
  return (
    <Panel className="space-y-3 text-center" data-testid="pick">
      <p className="font-semibold">
        {holder === me
          ? f('Several answers stood alone. Who takes the {pink}?')
          : f(`${nameOf(view, holder)} is picking who takes the {pink} from these:`)}
      </p>
      <Countdown
        deadline={pick.deadline}
        clockOffset={room.clockOffset}
        label="to pick"
        atZero="then it’s picked at random"
      />
      <div className="grid gap-2 sm:grid-cols-2">
        {pick.options.map((id) =>
          holder === me ? (
            <Button
              key={id}
              size="lg"
              variant="secondary"
              onClick={() => void act({ type: 'pick', player: id }, { anchor: PICK_ANCHOR })}
              data-testid="pick-option"
            >
              {nameOf(view, id)} · “{answerOf(id)}”
            </Button>
          ) : (
            <p
              key={id}
              className="rounded-lg bg-card px-3 py-2 ring-1 ring-line dark:bg-stone-800 dark:ring-0"
            >
              {who(view, id)} · “{answerOf(id)}”
            </p>
          ),
        )}
      </div>
      <RefusalSlot anchor={PICK_ANCHOR} resetKey={round.number} />
    </Panel>
  );
}

export function Reveal({ view, room, act, names, final = false }: Props & { final?: boolean }) {
  const round = view.round!;
  const r = round.result!;
  const me = view.me?.id ?? '';
  const f = (s: string) => fillNames(s, names);
  const groups = [...(round.groups ?? [])].sort((a, b) => b.members.length - a.members.length);
  const herd = groups.find((g) => g.id === r.herd);
  const rest = groups.filter((g) => g !== herd);
  const top = groups[0]?.members.length ?? 0;
  const tied = r.tie ? groups.filter((g) => g.members.length === top) : [];
  return (
    <div className="space-y-3" data-testid="reveal-board">
      <Question prompt={round.prompt} small />
      {!herd && (
        <p
          data-testid="no-herd"
          className="rounded-xl bg-warn-soft px-3 py-2 text-center font-semibold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40"
        >
          {r.tie
            ? f(
                `Tie at the top: ${tied.map((g) => `“${g.label}”`).join(' and ')} with ${top} each. No {cows}.`,
              )
            : groups.length === 1
              ? f('Only one answer, and a herd needs two. No {cows}.')
              : groups.length === 0
                ? f('Nobody answered. No {cows}.')
                : f('Every answer was different. No {cows}.')}
        </p>
      )}
      <ul className="grid gap-2 lg:grid-cols-2">
        {herd && (
          <GroupRow g={herd} view={view} mine={herd.members.includes(me)} herd names={names} />
        )}
        {rest.map((g) => (
          <GroupRow
            key={g.id}
            g={g}
            view={view}
            mine={g.members.includes(me)}
            herd={false}
            names={names}
          />
        ))}
      </ul>
      {r.blanks.length > 0 && (
        <p className="text-sm text-ink-muted">
          No answer: {r.blanks.map((id) => who(view, id)).join(', ')}.
        </p>
      )}
      <PinkLine view={view} round={round} names={names} />
      {r.raisedTo && (
        <p className="rounded-xl bg-info-soft px-3 py-2 text-center text-sm font-semibold text-info-ink ring-1 ring-info-line dark:bg-sky-500/15 dark:text-sky-100 dark:ring-sky-500/40">
          {f(`A tie at the target! Now it’s first to ${cowCount(names, r.raisedTo)}.`)}
        </p>
      )}
      <Changes steps={round.merges ?? []} title="The host’s changes" />
      {round.stage === 'pick' && (
        <PickPanel view={view} room={room} act={act} names={names} online={() => true} />
      )}
      {!final && round.stage === 'reveal' && room.isHost && (
        <StickyBar>
          <div className="border-t border-line pt-3 dark:border-stone-800">
            <Button
              size="lg"
              className="w-full"
              onClick={() => void act({ type: 'next-round' })}
              data-testid="next"
            >
              Next question →
            </Button>
          </div>
        </StickyBar>
      )}
    </div>
  );
}

export function Stage(props: Props) {
  const round = props.view.round;
  if (!round) return null;
  switch (round.stage) {
    case 'answer':
      return <Answering {...props} />;
    case 'merge':
      return round.groups ? <MergeBoard {...props} /> : <WaitingForCheck {...props} />;
    case 'pick':
    case 'reveal':
      return <Reveal {...props} />;
  }
}

export function GameOver(props: Props) {
  const { view, room, act, names } = props;
  return (
    <div className="space-y-4">
      <Panel className="space-y-4">
        {view.endReason === 'too-few' && (
          <p className="text-center font-semibold">
            Too few players left: the game ended with no winner.
          </p>
        )}
        <Standings
          entries={view.scores.map((s) => ({
            id: s.id,
            name: s.left ? `${s.name} (left)` : s.name,
            score: s.cows,
            ...(view.pinkCow === s.id && { note: `🩷 ${names.pink}` }),
          }))}
          you={view.me?.id}
          scoreLabel={(n) => cowCount(names, n)}
        />
        <Superlatives lines={room.superlatives} />
        {room.isHost ? (
          <div className="grid gap-2 sm:flex sm:justify-center">
            <Button size="lg" onClick={() => void act({ type: 'start' })}>
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
          <p className="text-center">{waitingForHost(room, 'start the next game')}</p>
        )}
      </Panel>
      {view.round?.result && (
        <Panel>
          <h3 className="mb-2 font-bold">The last question</h3>
          <Reveal {...props} final />
        </Panel>
      )}
    </div>
  );
}

export { CowCount };
