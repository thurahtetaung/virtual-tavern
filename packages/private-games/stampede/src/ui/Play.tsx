import { type ActOptions, type GameRoomInfo, listNames, waitingForHost } from '@vt/game-sdk';
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
  EndHero,
  EndLayout,
  EndTabs,
  useWideScreen,
} from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { answerProblem } from '../logic/game.ts';
import { tidyAnswer } from '../logic/match.ts';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import {
  type GroupView,
  MAX_ANSWER_LENGTH,
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
const PICK_ANCHOR = 'stampede-pick';

export function Question({ prompt, small = false }: { prompt: string; small?: boolean }) {
  return (
    <p
      data-testid="question"
      className={cn(
        'text-center leading-snug font-bold text-balance break-words',
        small
          ? 'font-display text-xl sm:text-2xl lg:text-3xl'
          : 'font-display text-3xl sm:text-4xl lg:py-4 lg:text-5xl',
      )}
    >
      {prompt}
    </p>
  );
}

const INPUT =
  'block h-12 w-full rounded-lg border border-line-input bg-card px-3.5 text-lg text-ink placeholder:text-ink-faint focus:border-focus';

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
    <StickyBar fixed refusal={ANSWER_ANCHOR} refusalKey={round.number}>
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
            className={cn(INPUT, problem && 'ring-2 ring-danger')}
          />
          <span className="mt-1 block text-xs text-ink-muted">
            One or two words is best. Nobody sees it until everyone has answered.
          </span>
          {problem && (
            <span role="alert" className="mt-1 block text-sm text-danger-ink">
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
          {sent
            ? unchanged
              ? `✓ Locked in: ${round.myAnswer}`
              : 'Change my answer'
            : 'Lock in 🐮'}
        </Button>
      </form>
    </StickyBar>
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
          className="inline-flex items-center gap-1 rounded-full bg-card px-2.5 py-1 text-sm shadow-vt-1 ring-1 ring-line lg:px-3.5 lg:py-1.5 lg:text-base"
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
  // The host who is still to answer just does it: never a button to skip themself.
  if (missing.length === 0 || missing.includes(room.you)) return null;
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
    // Wide screens: one block the width of the question card, so the form reads with it.
    <div className="space-y-4 lg:mx-auto lg:w-full lg:max-w-3xl">
      {dialog}
      {/* The question as the round's card, the herd waiting under it. */}
      <div className="rounded-2xl bg-card px-4 py-3 shadow-vt-2 ring-1 ring-line sm:py-8 lg:py-12 lg:shadow-[var(--vt-shadow-2),var(--vt-edge)]">
        <p
          aria-hidden
          className="pb-1 text-center text-3xl leading-none sm:pb-2 sm:text-5xl lg:text-6xl"
        >
          🐄🐄🐄
        </p>
        <Question prompt={round.prompt} />
      </div>
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

/**
 * A round saved mid-check by the version that had a host check: the host reveals it as it
 * stands (any action would too).
 */
function OldCheck({ view, room, act }: Props) {
  const round = view.round!;
  return (
    <div className="space-y-4 text-center">
      <Question prompt={round.prompt} small />
      {room.isHost ? (
        <Button size="lg" onClick={() => void act({ type: 'reveal' })} data-testid="reveal">
          Reveal 🐄
        </Button>
      ) : (
        <p className="text-ink-muted">All answers are in. Revealing…</p>
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
        // The herd is the big card across the board; the strays are smaller cards beside it.
        herd
          ? 'bg-success-soft px-4 py-4 text-success-ink shadow-vt-2 ring-success-line lg:col-span-2 lg:px-8 lg:py-10'
          : 'bg-card shadow-vt-1 ring-line',
        mine && !herd && 'ring-2 ring-accent',
      )}
    >
      <p
        className={cn(
          'font-bold',
          // The herd's answer in the display face, big on phones too; strays in it, smaller.
          'font-display',
          herd
            ? 'flex flex-wrap items-center gap-x-3 text-[2.125rem] leading-tight lg:gap-5 lg:text-5xl'
            : 'text-xl lg:text-2xl',
        )}
      >
        {herd && (
          <span aria-hidden className="text-6xl leading-none lg:text-7xl">
            🐄
          </span>
        )}
        <span className="whitespace-nowrap">
          {g.label} <span className="font-normal opacity-70">×{g.members.length}</span>
        </span>
        {alone && (
          <span className="ml-1 text-base font-normal" title="On its own">
            🐺
          </span>
        )}
        {/* The herd's member line already marks you, so its big row keeps to the answer. */}
        {mine && !herd && (
          <span className="ml-2 self-center whitespace-nowrap font-sans text-sm font-normal">
            (you)
          </span>
        )}
      </p>
      <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm">
        {g.members.map((id) => (
          <li key={id} className="inline-flex items-center gap-1">
            <PlayerTag name={nameOf(view, id)} you={id === view.me?.id} />
            {(g.answers[id] ?? '').toLowerCase() !== g.label.toLowerCase() && (
              <span className="opacity-70">“{g.answers[id]}”</span>
            )}
            {herd && (
              <span className="sp-fly font-semibold text-ink" aria-label={`+1 ${names.cow}`}>
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
      className="rounded-xl bg-special-soft px-3 py-2 text-center font-semibold text-special-ink ring-1 ring-special-line"
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
            <p key={id} className="rounded-lg bg-card px-3 py-2 ring-1 ring-line">
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
          className="rounded-xl bg-warn-soft px-3 py-2 text-center font-semibold text-warn-ink ring-1 ring-warn-line"
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
        <p className="rounded-xl bg-info-soft px-3 py-2 text-center text-sm font-semibold text-info-ink ring-1 ring-info-line">
          {f(`A tie at the target! Now it’s first to ${cowCount(names, r.raisedTo)}.`)}
        </p>
      )}
      {round.stage === 'pick' && (
        <PickPanel view={view} room={room} act={act} names={names} online={() => true} />
      )}
      {!final && round.stage === 'reveal' && room.isHost && (
        <StickyBar fixed>
          <div className="sm:border-t sm:border-line sm:pt-3">
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
      return <OldCheck {...props} />;
    case 'pick':
    case 'reveal':
      return <Reveal {...props} />;
  }
}

export function GameOver(props: Props) {
  const { view, room, act, names } = props;
  const wide = useWideScreen();
  const won = view.endReason === 'won' && view.winners.length > 0;
  const title = !won
    ? 'Game over'
    : view.winners.length === 1 && view.winners[0] === view.me?.id
      ? 'You win!'
      : `${listNames(view.winners.map((id) => who(view, id)))} ${view.winners.length > 1 ? 'win' : 'wins'}!`;
  return (
    <div className="space-y-4">
      <EndLayout
        hero={
          <EndHero
            title={title}
            eyebrow={won ? undefined : null}
            // A win shows the winner's herd: their cows, counted big.
            emblem={
              won ? (
                <span className="block font-display font-black tabular-nums">
                  <span className="text-6xl leading-none lg:text-7xl" aria-hidden>
                    🐄
                  </span>
                  <span className="ml-2 text-[3.5rem] leading-none lg:text-[4.5rem]">
                    {view.scores.find((s) => s.id === view.winners[0])?.cows ?? 0}
                  </span>
                </span>
              ) : (
                '🐄'
              )
            }
            superlatives={wide ? room.superlatives : undefined}
            actions={
              room.isHost ? (
                <StickyBar>
                  <div className="flex gap-2 [&>*]:whitespace-nowrap max-sm:[&>*]:flex-1 max-sm:[&>*]:px-3 sm:justify-center">
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
                </StickyBar>
              ) : (
                <p className="text-center">{waitingForHost(room, 'start the next game')}</p>
              )
            }
          >
            {view.endReason === 'too-few' && (
              <p className="font-semibold">Too few players left: the game ended with no winner.</p>
            )}
          </EndHero>
        }
      >
        <Panel className="space-y-4 max-lg:space-y-3 max-lg:p-3">
          <EndTabs
            tabs={[
              {
                id: 'scores',
                label: '🏆 Scores',
                content: (
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
                ),
              },
              !wide &&
                !!room.superlatives?.length && {
                  id: 'awards',
                  label: '✨ Awards',
                  content: <Superlatives lines={room.superlatives} />,
                },
            ]}
          />
        </Panel>
        {/* The last question's herd, under the standings on every screen. */}
        {view.round?.result && (
          <Panel>
            <h3 className="mb-2 font-bold">The last question</h3>
            <Reveal {...props} final />
          </Panel>
        )}
      </EndLayout>
    </div>
  );
}

export { CowCount };
