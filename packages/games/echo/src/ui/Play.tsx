import {
  type ActOptions,
  type GameRoomInfo,
  waitingFor,
  sameClue,
  waitingForHost,
} from '@vt/game-sdk';
import { Button, Panel, RefusalSlot, Superlatives, cn } from '@vt/ui';
import { type FormEvent, useState } from 'react';
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

const INPUT =
  'block h-12 w-full rounded-lg bg-white px-3 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

/** The secret word, big, for everyone who may see it. */
function SecretWord({ word, label = 'The word' }: { word: string; label?: string }) {
  return (
    <p className="text-center">
      <span className="block text-sm text-stone-500">{label}</span>
      <span
        data-testid="secret-word"
        className="block text-3xl font-black tracking-wide break-words uppercase sm:text-4xl"
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
      <p className="text-sm text-stone-500">
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
            'bg-gradient-to-br from-amber-500 to-amber-700 text-white ring-amber-800/40',
            mine
              ? 'hover:scale-105 hover:from-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-500'
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
  const [clues, setClues] = useState<string[]>(() =>
    Array.from({ length: turn.perGiver }, (_, i) => turn.myClues?.[i] ?? ''),
  );
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
          <span className="text-sm font-semibold">
            {turn.perGiver === 2 ? `Clue ${i + 1}` : 'Your clue'}
          </span>
          <input
            value={value}
            maxLength={MAX_CLUE_LENGTH}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={problems[i] ? true : undefined}
            onChange={(e) => setClues((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="One word"
            className={cn(INPUT, 'mt-1', problems[i] && 'ring-2 ring-rose-500')}
          />
          {problems[i] && (
            <span className="mt-1 block text-sm text-rose-700 dark:text-rose-400">
              {problems[i]}
            </span>
          )}
        </label>
      ))}
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
      <RefusalSlot anchor="echo-clues" />
      <p className="text-center text-xs text-stone-500">
        Keep your screen away from the guesser, and don’t discuss clues.
      </p>
    </form>
  );
}

/** Every clue, with its author; cancelled ones struck through with the reason. */
function ClueList({ view, clues }: { view: EchoView; clues: ClueView[] }) {
  if (clues.length === 0) {
    return <p className="text-center text-sm text-stone-500 italic">No clues were given.</p>;
  }
  return (
    <ul aria-label="Clues" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {clues.map((c, i) => (
        <li
          key={`${c.by}-${i}`}
          className={cn(
            'min-w-0 rounded-xl px-3 py-2 ring-1',
            c.cancelled
              ? 'bg-stone-100 ring-stone-200 dark:bg-stone-800/60 dark:ring-stone-700'
              : 'bg-amber-50 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40',
          )}
        >
          <span
            className={cn(
              'block truncate text-lg font-bold',
              c.cancelled && 'text-stone-400 line-through dark:text-stone-500',
            )}
          >
            {c.text}
          </span>
          <span className="block truncate text-xs text-stone-500">
            {c.name ?? nameOf(view, c.by)}
            {c.cancelled && ` · ${cancelReason(view, c)}`}
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
        <ul aria-label="Your clues" className="flex flex-wrap justify-center gap-2">
          {turn.clues.map((c, i) => (
            <li
              key={i}
              className="rounded-xl bg-amber-50 px-4 py-2 text-2xl font-bold ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
            >
              {c.text}
            </li>
          ))}
        </ul>
      ) : turn.cancelledCount > 0 ? (
        <p className="text-center font-semibold">Every clue was cancelled!</p>
      ) : (
        <p className="text-center font-semibold">No clues arrived in time.</p>
      )}
      {turn.cancelledCount > 0 && (
        <p className="text-center text-sm text-stone-500">
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
        <span className="text-sm font-semibold">
          Your guess
          {wordCount !== null && wordCount > 1 && (
            <span className="font-normal text-stone-500"> ({wordCount} words)</span>
          )}
        </span>
        <input
          value={guess}
          maxLength={MAX_GUESS_LENGTH}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => setGuess(e.target.value)}
          placeholder="The secret word"
          className={cn(INPUT, 'mt-1')}
        />
      </label>
      <div className="grid grid-cols-[2fr_1fr] gap-2">
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
      </div>
      <RefusalSlot anchor="echo-guess" />
    </form>
  );
}

const OUTCOME: Record<string, { icon: string; title: string; tone: string }> = {
  right: {
    icon: '🎉',
    title: 'Got it!',
    tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  counted: {
    icon: '🤝',
    title: 'Counted!',
    tone: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-200',
  },
  pass: {
    icon: '⏭️',
    title: 'Passed',
    tone: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  },
  wrong: {
    icon: '💥',
    title: 'Not this time',
    tone: 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200',
  },
  'pass-timeout': {
    icon: '⏱',
    title: 'Time ran out',
    tone: 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-200',
  },
  'wrong-timeout': {
    icon: '⏱',
    title: 'Time ran out',
    tone: 'bg-rose-100 text-rose-900 dark:bg-rose-500/15 dark:text-rose-200',
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
  if (turn.countedBy) line += ` ${nameOf(view, turn.countedBy)} counted it.`;
  if (turn.outcome === 'wrong') {
    if (turn.timedOut) line += ' Nobody decided in time, so it counts as wrong.';
    line += ` ${lossText(view)}`;
  }
  return line;
}

function Reveal({ view, turn, act, room }: Props & { turn: TurnView }) {
  const base = turn.outcome === 'right' && turn.countedBy ? 'counted' : (turn.outcome ?? 'wrong');
  const o = OUTCOME[turn.timedOut ? `${base}-timeout` : base] ?? OUTCOME[base]!;
  const missed = turn.missed.map((id) => nameOf(view, id));
  return (
    <div className="space-y-3">
      <div className={cn('rounded-xl px-3 py-2 text-center', o.tone)}>
        <p className="text-xl font-bold">
          {o.icon} {o.title}
        </p>
        <p className="text-sm">{outcomeLine(view, turn)}</p>
      </div>
      {turn.word && <SecretWord word={turn.word} label="The word was" />}
      <ClueList view={view} clues={turn.clues} />
      {missed.length > 0 && (
        <p className="text-center text-sm text-stone-500">
          {turn.skipped
            ? `No clue from ${listNames(missed)}: the host went on without it.`
            : `⏱ No clue from ${listNames(missed)}: time ran out.`}
        </p>
      )}
      {(room.isHost || view.me?.playing) && (
        <Button
          size="lg"
          className="w-full"
          onClick={() => void act({ type: 'next-card', cardsLeft: view.cardsLeft })}
        >
          {view.cardsLeft > 0 ? 'Next card' : 'Finish'}
        </Button>
      )}
    </div>
  );
}

function Judge({ view, turn, act, room }: Props & { turn: TurnView }) {
  const isHost = room.isHost;
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected !== false;
  const giver = turn.givers.includes(view.me?.id ?? '');
  const guesser = view.role === 'guesser';
  // The guesser doesn't judge their own guess. A host who is guessing only gets a way out when
  // no clue writer is around to decide.
  const nobodyToJudge = !turn.givers.some((g) => online(g));
  const canMoveOn = giver || (isHost && (!guesser || nobodyToJudge));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-center">
        <p className="rounded-xl bg-stone-100 px-2 py-3 dark:bg-stone-800/70">
          <span className="block text-sm text-stone-500">{nameOf(view, turn.guesser)} guessed</span>
          <span className="block text-2xl font-bold break-words">{turn.guess}</span>
        </p>
        <p className="rounded-xl bg-amber-50 px-2 py-3 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40">
          <span className="block text-sm text-stone-500">The word</span>
          <span
            data-testid="secret-word"
            className="block text-2xl font-black break-words uppercase"
          >
            {turn.word ?? '?'}
          </span>
        </p>
      </div>
      {canMoveOn && (
        <div className={cn('grid gap-2', giver && 'grid-cols-2')}>
          {giver && (
            <Button size="lg" onClick={() => void act({ type: 'count-it' })}>
              Count it
            </Button>
          )}
          <Button
            variant="secondary"
            size="lg"
            className="whitespace-nowrap"
            onClick={() => void act({ type: 'continue' })}
          >
            Doesn't count
          </Button>
        </div>
      )}
      {giver && (
        <p className="text-center text-xs text-stone-500">
          Count it only if the guess is really the word: a typo or a different spelling. For an
          answer of several words, only the whole answer counts (“Monsters” isn’t “Monsters Inc”).
          Doesn't count loses this card and the next.
        </p>
      )}
      {guesser && canMoveOn && (
        <p className="text-center text-xs text-stone-500">
          No clue writer is online to decide. Doesn't count moves on (this card and the next are
          lost).
        </p>
      )}
      {view.role !== 'guesser' && <ClueList view={view} clues={turn.clues} />}
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
        <div className="space-y-3">
          {turn.word && <SecretWord word={turn.word} />}
          {writer ? <ClueForm key={cardKey} turn={turn} act={act} /> : null}
          <Progress turn={turn} room={room} act={act} />
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
        <div className="space-y-3">
          {turn.word && <SecretWord word={turn.word} />}
          <ClueList view={view} clues={turn.clues} />
        </div>
      );
    case 'judge':
      return <Judge view={view} turn={turn} act={act} room={room} />;
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
  return (
    <details className="group" open={open}>
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between gap-2 font-bold [&::-webkit-details-marker]:hidden">
        Cards played ({history.length})
        <span aria-hidden className="font-normal text-stone-500 transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <ol className="space-y-1 text-sm">
        {history.map((h, i) => (
          <li key={i} className="flex items-baseline gap-2">
            <span aria-label={h.outcome}>{RESULT_ICON[h.outcome]}</span>
            <span className="font-semibold uppercase">{h.word}</span>
            <span className="min-w-0 truncate text-stone-500">
              {h.guesserName}
              {h.outcome === 'pass'
                ? h.timedOut
                  ? ' ran out of time'
                  : ' passed'
                : ` guessed “${h.guess ?? '—'}”`}
              {h.countedBy && ' (counted)'}
              {h.outcome === 'wrong' && h.timedOut && ' (undecided in time)'}
            </span>
          </li>
        ))}
        {burned > 0 && (
          <li className="flex items-baseline gap-2 text-stone-500">
            <span aria-hidden>🔥</span>
            {burned} {burned === 1 ? 'card' : 'cards'} lost to a wrong guess
          </li>
        )}
      </ol>
    </details>
  );
}

export function GameOver({ view, act, room }: Props) {
  const deck = view.settings.deckSize;
  return (
    <Panel className="space-y-3 text-center">
      <p className="text-5xl font-black tabular-nums">
        {view.score}
        <span className="text-2xl text-stone-500"> / {deck}</span>
      </p>
      <p className="text-2xl font-bold">{rating(view.score, deck)}</p>
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="grid gap-2 sm:flex sm:justify-center">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change settings
          </Button>
        </div>
      ) : (
        <p>{waitingForHost(room, 'start the next game')}</p>
      )}
    </Panel>
  );
}
