import { Badge, Button, Panel, cn } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import type { EnigmaAction, EnigmaView, TransmissionView } from '../logic/types.ts';
import { MAX_CLUE_LENGTH } from '../logic/types.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT, formatCode } from './theme.ts';

type Act = (a: EnigmaAction) => Promise<boolean>;

const nameOf = (view: EnigmaView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

function ClueForm({ view, tx, act }: { view: EnigmaView; tx: TransmissionView; act: Act }) {
  const [clues, setClues] = useState(['', '', '']);
  const [busy, setBusy] = useState(false);
  const keywords = view.teams[tx.team].keywords ?? [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act({ type: 'give-clues', clues: clues.map((c) => c.trim()) });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <p className="text-center">
        <span className="text-sm text-stone-500">Your secret code</span>
        <span className="block font-mono text-3xl font-black tracking-widest">
          {formatCode(tx.code)}
        </span>
      </p>
      {tx.code?.map((digit, i) => (
        <label key={i} className="block">
          <span className="text-sm">
            Clue {i + 1} points to <b>#{digit}</b>{' '}
            <span className="font-bold uppercase">{keywords[digit - 1]}</span>
          </span>
          <input
            value={clues[i]}
            maxLength={MAX_CLUE_LENGTH}
            autoFocus={i === 0}
            onChange={(e) => setClues((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="A hint only your team will get"
            className="mt-1 block w-full rounded-lg bg-white px-3 py-2 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
        </label>
      ))}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || clues.some((c) => !c.trim())}
      >
        Send clues
      </Button>
    </form>
  );
}

function CodePicker({ view, tx, act }: { view: EnigmaView; tx: TransmissionView; act: Act }) {
  const me = view.me!;
  const mine = tx.teamVotes[me.id];
  // Your own taps are kept locally: building each pick on the last server-confirmed draft would
  // drop taps made faster than a round trip. Socket messages arrive in order, so the server ends
  // up with exactly this draft, unless it rejects one, in which case the local copy is dropped
  // and the picks the server really holds show again.
  const [localDraft, setLocalDraft] = useState<number[] | null>(null);
  const draft = localDraft ?? mine?.draft ?? [0, 0, 0];
  const locked = mine?.locked ?? false;
  const decoding = tx.role === 'decoder';
  const ownKeywords = view.teams[tx.team].keywords;
  const ourGuesses = view.notes?.guesses ?? [];
  const complete = draft.every((d) => d > 0) && new Set(draft).size === 3;

  const pick = (row: number, digit: number) => {
    // Each keyword number can only appear once, so picking it here clears it elsewhere.
    const next = draft.map((d, i) => (i === row ? (d === digit ? 0 : digit) : d === digit ? 0 : d));
    setLocalDraft(next);
    void act({ type: 'set-guess', team: tx.team, draft: next }).then((ok) => {
      if (!ok) setLocalDraft(null);
    });
  };

  return (
    <div className="space-y-3">
      {tx.clues?.map((clue, row) => (
        <div key={row}>
          <p className="text-sm">
            Clue {row + 1}: <b className="text-base">“{clue}”</b>
          </p>
          <div className="mt-1 grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((digit) => {
              const hint = decoding ? ownKeywords?.[digit - 1] : ourGuesses[digit - 1];
              return (
                <button
                  key={digit}
                  type="button"
                  aria-pressed={draft[row] === digit}
                  aria-label={`Clue ${row + 1} is keyword ${digit}`}
                  disabled={locked}
                  onClick={() => pick(row, digit)}
                  className={cn(
                    'min-w-0 rounded-lg px-1 py-1.5 text-center ring-1 transition disabled:cursor-not-allowed',
                    draft[row] === digit
                      ? 'bg-amber-500 font-bold text-stone-950 ring-amber-600'
                      : 'bg-white ring-stone-300 hover:bg-stone-100 dark:bg-stone-800 dark:ring-stone-600 dark:hover:bg-stone-700',
                  )}
                >
                  <span className="block text-lg leading-none font-black">{digit}</span>
                  {hint && (
                    <span className="block truncate text-[0.6rem] uppercase opacity-80">
                      {hint}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="rounded-xl bg-stone-100 p-2 dark:bg-stone-800/70">
        <p className="mb-1 text-xs font-semibold text-stone-500">Your team's picks</p>
        <ul className="flex flex-wrap gap-1.5">
          {tx.voters.map((id) => {
            const v = tx.teamVotes[id];
            return (
              <li key={id}>
                <Badge
                  className={cn(
                    v?.locked &&
                      'bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100',
                  )}
                >
                  {nameOf(view, id)} {v ? formatCode(v.draft) : 'picking…'} {v?.locked ? '🔒' : ''}
                </Badge>
              </li>
            );
          })}
        </ul>
      </div>

      {tx.disagree && (
        <p
          role="alert"
          className="rounded-lg bg-rose-100 px-3 py-2 text-sm font-semibold text-rose-900 dark:bg-rose-950 dark:text-rose-100"
        >
          Your team disagrees: everyone locked in, but not on the same code. Compare picks!
        </p>
      )}

      <div className="flex gap-2">
        {locked ? (
          <Button
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => void act({ type: 'unlock-guess', team: tx.team })}
          >
            Change my pick
          </Button>
        ) : (
          <Button
            size="lg"
            className="w-full"
            disabled={!complete}
            onClick={() => void act({ type: 'lock-guess', team: tx.team })}
          >
            {complete ? `Lock in ${formatCode(draft)}` : 'Pick a number for each clue'}
          </Button>
        )}
      </div>
    </div>
  );
}

function RevealSummary({ view, tx }: { view: EnigmaView; tx: TransmissionView }) {
  const r = tx.result;
  if (!r) return null;
  const sender = TEAM_LABEL[tx.team];
  const receiver = TEAM_LABEL[tx.team === 'red' ? 'blue' : 'red'];
  const canIntercept = view.round >= 2;
  return (
    <div className="space-y-2">
      <p className="text-center">
        <span className="text-sm text-stone-500">The code was</span>
        <span className="block font-mono text-3xl font-black tracking-widest">
          {formatCode(tx.code)}
        </span>
      </p>
      {tx.expired && (
        <p className="text-center text-sm font-semibold">
          No clues were sent (time ran out, or nobody was left to decode them).
        </p>
      )}
      <p
        className={cn(
          'rounded-lg px-3 py-2 font-semibold',
          r.decoded ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white',
        )}
      >
        {r.decoded
          ? `✓ ${sender} decoded it.`
          : `✗ ${sender} missed it${r.decodeGuess ? ` (guessed ${formatCode(r.decodeGuess)})` : ''}: miscommunication!`}
      </p>
      {canIntercept && (
        <p
          className={cn(
            'rounded-lg px-3 py-2 font-semibold',
            r.intercepted ? 'bg-stone-950 text-white' : 'bg-stone-200 dark:bg-stone-800',
          )}
        >
          {r.intercepted
            ? `🕵️ ${receiver} intercepted it!`
            : `${receiver} didn't intercept${r.interceptGuess ? ` (guessed ${formatCode(r.interceptGuess)})` : ''}.`}
        </p>
      )}
    </div>
  );
}

/** One team's transmission this round: what the viewer should do, or how it turned out. */
export function TransmissionCard({
  view,
  tx,
  act,
}: {
  view: EnigmaView;
  tx: TransmissionView;
  act: Act;
}) {
  const encryptor = nameOf(view, tx.encryptor);
  let body;
  if (tx.revealed) body = <RevealSummary view={view} tx={tx} />;
  else if (view.stage === 'clue' || (!tx.clues && !tx.expired)) {
    body =
      tx.role === 'encryptor' && !tx.clues ? (
        <ClueForm view={view} tx={tx} act={act} />
      ) : (
        <p className="text-center text-stone-600 dark:text-stone-400">
          {tx.clues
            ? 'Clues sent. Waiting for the other Encryptor…'
            : `${encryptor} is writing clues…`}
        </p>
      );
  } else if ((tx.role === 'decoder' || tx.role === 'interceptor') && !tx.settled) {
    body = <CodePicker view={view} tx={tx} act={act} />;
  } else {
    body = (
      <div className="space-y-2 text-center">
        <ol className="space-y-1">
          {tx.clues?.map((c, i) => (
            <li key={i}>
              <span className="text-stone-500">{i + 1}.</span> <b>“{c}”</b>
            </li>
          ))}
        </ol>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          {tx.role === 'waiting'
            ? view.round < 2 && tx.team !== view.me?.team
              ? 'Interception starts in round 2. Just watch for now.'
              : 'You joined after guessing started. Watch this one; you play from the next clues.'
            : tx.role === 'encryptor'
              ? 'Your team is decoding. No hints!'
              : tx.settled && tx.voters.length > 0
                ? 'Your team has locked in. Waiting for everyone else…'
                : 'Teams are guessing…'}
        </p>
      </div>
    );
  }
  return (
    <Panel
      className={cn('ring-1', TEAM_PANEL[tx.team])}
      aria-label={`${TEAM_LABEL[tx.team]}'s transmission`}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className={cn('font-bold', TEAM_TEXT[tx.team])}>{TEAM_LABEL[tx.team]}'s code</h3>
        <span className="text-xs text-stone-500">Encryptor: {encryptor}</span>
      </header>
      {body}
    </Panel>
  );
}
