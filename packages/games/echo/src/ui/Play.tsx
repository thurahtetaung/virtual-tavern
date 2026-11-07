import {
  type ActOptions,
  type GameRoomInfo,
  waitingFor,
  sameClue,
  waitingForHost,
} from '@vt/game-sdk';
import {
  Button,
  FoldSummary,
  Input,
  NameDot,
  Panel,
  Row,
  Rows,
  StickyBar,
  Superlatives,
  cn,
} from '@vt/ui';
import { type FormEvent, type ReactNode, useState } from 'react';
import { clueProblem, rating } from '../logic/game.ts';
import {
  type ClueView,
  type EchoAction,
  type EchoView,
  MAX_CLUE_LENGTH,
  MAX_GUESS_LENGTH,
  type ResolvedCard,
  type TurnView,
} from '../logic/types.ts';
import { cancelReason, listNames, lossText, nameOf, stillWriting } from './status.ts';

type Act = (a: EchoAction, options?: ActOptions) => Promise<boolean>;

/** The secret word, big, for everyone who may see it. */
function SecretWord({ word, label = 'The word' }: { word: string; label?: string }) {
  return (
    <p className="text-center">
      <span className="block text-small text-ink-muted">{label}</span>
      <span
        data-testid="secret-word"
        className="block font-display text-title lg:text-[44px] font-bold tracking-wide break-words uppercase"
      >
        {word}
      </span>
    </p>
  );
}

/** "2 of 4 in · Waiting for: Ana, Ben (offline)": who the clues are waiting on, by name. */
function Progress({ turn, room, act }: { turn: TurnView; room: GameRoomInfo; act: Act }) {
  const left = stillWriting(turn);
  const done = turn.givers.length - left.length;
  const names = waitingFor(left, room.players, { you: room.you });
  // The host can stop waiting for a writer whose browser has gone away.
  const offline = left.some((id) => room.players.find((p) => p.id === id)?.connected === false);
  return (
    <div className="space-y-2 text-center">
      <p className="text-small text-ink-muted">
        {done} of {turn.givers.length} clues in{names && ` · ${names}`}
      </p>
      {room.isHost && offline && (
        <Button variant="secondary" onClick={() => void act({ type: 'skip-late-clues' })}>
          Go on without them
        </Button>
      )}
    </div>
  );
}

/** Five face-down words: the guesser taps one, everyone else sees them waiting. */
function PickCards({ turn, act, mine }: { turn: TurnView; act: Act; mine: boolean }) {
  return (
    <div className="mx-auto grid max-w-lg grid-cols-5 gap-2">
      {Array.from({ length: turn.cardSize }, (_, i) => (
        <button
          key={i}
          type="button"
          disabled={!mine}
          aria-label={`Pick word ${i + 1}`}
          onClick={() => void act({ type: 'pick', index: i })}
          className={cn(
            'flex aspect-[3/4] min-h-11 items-center justify-center rounded-xl text-3xl font-black ring-1 transition',
            'bg-accent text-accent-fg ring-accent-line shadow-vt-1',
            mine
              ? 'hover:scale-105 hover:bg-accent-hover focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus'
              : 'cursor-default opacity-60',
          )}
        >
          {i + 1}
        </button>
      ))}
    </div>
  );
}

function ClueForm({ turn, act }: { turn: TurnView; act: Act }) {
  const [typed, setClues] = useState<string[]>(() =>
    Array.from({ length: turn.perGiver }, (_, i) => turn.myClues?.[i] ?? ''),
  );
  // A writer leaving can change the count mid-card (down to two writers, two clues each).
  const clues = Array.from({ length: turn.perGiver }, (_, i) => typed[i] ?? '');
  const [busy, setBusy] = useState(false);
  const word = turn.word ?? '';
  const trimmed = clues.map((c) => c.trim());
  const problems = trimmed.map((c, i) => {
    if (!c) return null;
    const own = clueProblem(c, word)?.message;
    if (own) return own;
    const same = trimmed.findIndex((other, j) => j < i && other && sameClue(other, c));
    return same >= 0 ? 'Your two clues must be different words.' : null;
  });
  const sent = turn.myClues !== null;
  const unchanged = sent && trimmed.every((c, i) => c === turn.myClues?.[i]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act({ type: 'give-clues', clues: trimmed }, { anchor: 'echo-clues' });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      {clues.map((value, i) => (
        <label key={i} className="block">
          <span className="text-small font-semibold">
            {turn.perGiver === 2 ? `Clue ${i + 1}` : 'Your clue'}
          </span>
          <Input
            value={value}
            maxLength={MAX_CLUE_LENGTH}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            invalid={!!problems[i]}
            onChange={(e) => setClues(clues.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="One word"
            className="mt-1 text-sub"
          />
          {problems[i] && (
            <span role="alert" className="mt-1 block text-small text-danger-ink">
              {problems[i]}
            </span>
          )}
        </label>
      ))}
      <StickyBar fixed refusal="echo-clues">
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || unchanged || trimmed.some((c) => !c) || problems.some(Boolean)}
        >
          {sent
            ? unchanged
              ? '✓ Sent'
              : 'Change my clues'
            : turn.perGiver === 2
              ? 'Send clues'
              : 'Send clue'}
        </Button>
      </StickyBar>
      <p className="text-center text-caption text-ink-muted">
        Keep your screen away from the guesser, and don’t discuss clues.
      </p>
    </form>
  );
}

/** Every clue, with its author; cancelled ones struck through with the reason. */
function ClueList({ view, clues }: { view: EchoView; clues: ClueView[] }) {
  if (clues.length === 0) {
    return <p className="text-center text-small text-ink-muted italic">No clues were given.</p>;
  }
  return (
    <ul aria-label="Clues" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {clues.map((c, i) => (
        <li
          key={`${c.by}-${i}`}
          className={cn(
            'min-w-0 rounded-xl px-3 py-2 ring-1',
            c.cancelled ? 'bg-sunk ring-line' : 'bg-accent-soft ring-accent-line',
          )}
        >
          <span
            className={cn(
              'block truncate text-sub font-bold',
              c.cancelled && 'text-ink-muted line-through',
            )}
          >
            {c.text}
          </span>
          <span className="flex items-center gap-1 text-caption text-ink-muted">
            <span className="truncate">
              {c.name ?? nameOf(view, c.by)}
              {c.cancelled && ` · ${cancelReason(view, c)}`}
            </span>
            <NameDot name={c.name ?? nameOf(view, c.by)} className="order-first" />
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The surviving clues, big, without authors: what the guesser works from. */
function GuesserClues({ turn }: { turn: TurnView }) {
  return (
    <div className="space-y-2">
      {turn.clues.length > 0 ? (
        <div>
          {/* The shared rows, named so the list reads as the guesser's clues. */}
          <ul
            aria-label="Your clues"
            className="divide-y divide-accent-line rounded-xl bg-accent-soft px-4 ring-1 ring-accent-line"
          >
            {turn.clues.map((c, i) => (
              <Row key={i} className="justify-center text-heading font-bold">
                {c.text}
              </Row>
            ))}
          </ul>
        </div>
      ) : turn.cancelledCount > 0 ? (
        <p className="text-center font-semibold">Every clue was cancelled!</p>
      ) : (
        <p className="text-center font-semibold">No clues arrived in time.</p>
      )}
      {turn.cancelledCount > 0 && (
        <p className="text-center text-caption text-ink-muted">
          {turn.cancelledCount} {turn.cancelledCount === 1 ? 'clue was' : 'clues were'} cancelled.
        </p>
      )}
    </div>
  );
}

function GuessForm({ act, wordCount }: { act: Act; wordCount: number | null }) {
  const [guess, setGuess] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act({ type: 'guess', word: guess.trim() }, { anchor: 'echo-guess' });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <label className="block">
        <span className="text-small font-semibold">
          Your guess
          {wordCount !== null && wordCount > 1 && (
            <span className="font-normal text-ink-muted"> ({wordCount} words)</span>
          )}
        </span>
        <Input
          value={guess}
          maxLength={MAX_GUESS_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="The secret word"
          className="mt-1 text-sub"
        />
      </label>
      <StickyBar fixed refusal="echo-guess" className="grid grid-cols-[2fr_1fr] gap-2">
        <Button type="submit" size="lg" disabled={busy || !guess.trim()}>
          Guess
        </Button>
        <Button
          variant="secondary"
          size="lg"
          disabled={busy}
          onClick={() => void act({ type: 'pass' }, { anchor: 'echo-guess' })}
        >
          Pass
        </Button>
      </StickyBar>
    </form>
  );
}

const OUTCOME: Record<string, { icon: string; title: string; tone: string }> = {
  right: {
    icon: '🎉',
    title: 'Got it!',
    tone: 'bg-success-soft text-success-ink ring-success-line',
  },
  pass: {
    icon: '⏭️',
    title: 'Passed',
    tone: 'bg-sunk text-ink ring-line',
  },
  wrong: {
    icon: '💥',
    title: 'Not this time',
    tone: 'bg-danger-soft text-danger-ink ring-danger-line',
  },
  'pass-timeout': {
    icon: '⏱',
    title: 'Time ran out',
    tone: 'bg-sunk text-ink ring-line',
  },
};

/** One line under the result: what happened, in plain words. */
function outcomeLine(view: EchoView, turn: TurnView): string {
  const guesser = nameOf(view, turn.guesser);
  if (turn.outcome === 'pass') {
    return turn.timedOut
      ? `${guesser} didn't answer in time: counts as a pass.`
      : `${guesser} passed.`;
  }
  let line = `${guesser} guessed “${turn.guess ?? '—'}”.`;
  if (turn.outcome === 'wrong') line += ` ${lossText(view)}`;
  return line;
}

function Reveal({ view, turn, act, room }: Props & { turn: TurnView }) {
  const base = turn.outcome ?? 'wrong';
  const o = OUTCOME[turn.timedOut ? `${base}-timeout` : base] ?? OUTCOME[base]!;
  const missed = turn.missed.map((id) => nameOf(view, id));
  return (
    <div className="space-y-3">
      <div className={cn('rounded-xl px-3 py-2 text-center ring-1 ring-inset', o.tone)}>
        <p className="text-sub font-bold">
          {o.icon} {o.title}
        </p>
        <p className="text-small">{outcomeLine(view, turn)}</p>
      </div>
      {turn.word && <SecretWord word={turn.word} label="The word was" />}
      <ClueList view={view} clues={turn.clues} />
      {missed.length > 0 && (
        <p className="text-center text-small text-ink-muted">
          {turn.skipped
            ? `No clue from ${listNames(missed)}: the host went on without it.`
            : `⏱ No clue from ${listNames(missed)}: time ran out.`}
        </p>
      )}
      {(room.isHost || view.me?.playing) && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            onClick={() => void act({ type: 'next-card', cardsLeft: view.cardsLeft })}
          >
            {view.cardsLeft > 0 ? 'Next card' : 'Finish'}
          </Button>
        </StickyBar>
      )}
    </div>
  );
}

interface Props {
  view: EchoView;
  act: Act;
  room: GameRoomInfo;
}

/** The card in play, for whoever is looking. */
export function Stage({ view, act, room }: Props) {
  const turn = view.turn!;
  const guessing = view.role === 'guesser';
  const writer = turn.givers.includes(view.me?.id ?? '');
  const cardKey = `${view.cardsLeft}-${turn.guesser}-${turn.pick}`;
  switch (turn.stage) {
    case 'pick':
      return <PickCards turn={turn} act={act} mine={guessing} />;
    case 'clues':
      return (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
          {turn.word && <SecretWord word={turn.word} />}
          {writer ? <ClueForm key={cardKey} turn={turn} act={act} /> : null}
          <div className="lg:col-span-2">
            <Progress turn={turn} room={room} act={act} />
          </div>
        </div>
      );
    case 'guess':
      if (guessing) {
        return (
          <div className="space-y-4">
            <GuesserClues turn={turn} />
            <GuessForm key={cardKey} act={act} wordCount={turn.wordCount} />
          </div>
        );
      }
      return (
        <div className="grid gap-3 lg:grid-cols-2 lg:items-center">
          {turn.word && <SecretWord word={turn.word} />}
          <ClueList view={view} clues={turn.clues} />
        </div>
      );
    case 'reveal':
      return <Reveal view={view} turn={turn} act={act} room={room} />;
  }
}

const RESULT_ICON: Record<string, string> = { right: '✅', pass: '⏭️', wrong: '❌' };

/** Every card played so far: compact, so it can sit under the game on a phone. */
export function History({ history, open }: { history: ResolvedCard[]; open?: boolean }) {
  if (history.length === 0) return null;
  // Cards a wrong guess cost without being played, so the list adds up to the deck.
  const burned = history.filter((h) => h.burned).length;
  const forfeits = history.filter((h) => h.forfeit).length;
  // The won card a forfeit gave back: the last one won before it, shown as given back, not won.
  const givenBack = history.flatMap((h, i) =>
    h.forfeit ? [history.findLastIndex((w, j) => j < i && w.outcome === 'right')] : [],
  );
  return (
    <details className="group" open={open}>
      <FoldSummary className="px-0 text-body font-bold">
        Cards played ({history.length})
      </FoldSummary>
      <Rows className="text-small">
        {history.map((h, i) => (
          <Row key={i} className="min-h-9 items-baseline gap-2">
            {givenBack.includes(i) ? (
              <span aria-label="given back">↩️</span>
            ) : (
              <span aria-label={h.outcome}>{RESULT_ICON[h.outcome]}</span>
            )}
            <span className="font-semibold uppercase">{h.word}</span>
            <span className="min-w-0 truncate text-ink-muted">
              {h.guesserName}
              {h.outcome === 'pass'
                ? h.timedOut
                  ? ' ran out of time'
                  : ' passed'
                : ` guessed “${h.guess ?? '—'}”`}
            </span>
          </Row>
        ))}
        {burned > 0 && (
          <Row className="min-h-9 items-baseline gap-2 text-ink-muted">
            <span aria-hidden>🔥</span>
            {burned} {burned === 1 ? 'card' : 'cards'} lost to a wrong guess
          </Row>
        )}
        {forfeits > 0 && (
          <Row className="min-h-9 items-baseline gap-2 text-ink-muted">
            <span aria-hidden>↩️</span>
            {forfeits === 1 ? 'A won card was' : `${forfeits} won cards were`} given back for a
            wrong guess on the last card
          </Row>
        )}
      </Rows>
    </details>
  );
}

/** `details`: on phones, the awards, cards and players as tabs, in place of the awards. */
export function GameOver({ view, act, room, details }: Props & { details?: ReactNode }) {
  const deck = view.settings.deckSize;
  return (
    <>
      <Panel className="space-y-3 text-center max-lg:space-y-1 max-lg:p-3">
        <p className="text-5xl font-black tabular-nums max-lg:text-display">
          {view.score}
          <span className="text-heading text-ink-muted"> / {deck}</span>
        </p>
        <p className="font-display text-title font-bold">{rating(view.score, deck)}</p>
        {!details && <Superlatives lines={room.superlatives} />}
        {!details && <EndButtons view={view} act={act} room={room} />}
      </Panel>
      {details && (
        <>
          {details}
          <EndButtons view={view} act={act} room={room} />
        </>
      )}
    </>
  );
}

/** Play again and Change setup: in the sticky bar on phones; guests read who starts the next game. */
function EndButtons({ act, room }: Props) {
  return room.isHost ? (
    <StickyBar>
      <div className="flex gap-2 [&>*]:whitespace-nowrap max-sm:[&>*]:flex-1 max-sm:[&>*]:px-3 sm:justify-center">
        <Button size="lg" onClick={() => void act({ type: 'start' })}>
          Play again
        </Button>
        <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
          Change setup
        </Button>
      </div>
    </StickyBar>
  ) : (
    <p className="text-center text-small text-ink-2">
      {waitingForHost(room, 'start the next game')}
    </p>
  );
}
