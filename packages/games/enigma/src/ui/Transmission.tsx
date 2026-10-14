import type { ActOptions } from '@vt/game-sdk';
import { Badge, Button, Panel, RefusalSlot, cn } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { clueProblem, usedClues } from '../logic/game.ts';
import type { EnigmaAction, EnigmaView, TransmissionView } from '../logic/types.ts';
import { MAX_CLUE_LENGTH, TOKENS_TO_END } from '../logic/types.ts';
import { cluesByKeyword, lockedOnText } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT, formatCode } from './theme.ts';

type Act = (a: EnigmaAction, options?: ActOptions) => Promise<boolean>;

/** Where the server's refusal of a set of clues shows, right under the form. */
const CLUES_ANCHOR = 'enigma-clues';

const nameOf = (view: EnigmaView, id: string) =>
  view.seats.find((s) => s.id === id)?.name ?? 'Someone';

/** Unsent clues survive a reload or reconnect: kept per round and team for this tab. */
const draftKey = (view: EnigmaView, tx: TransmissionView) =>
  `enigma-clues:${view.round}:${tx.team}:${formatCode(tx.code)}`;

function loadDraft(key: string): string[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (Array.isArray(saved) && saved.length === 3 && saved.every((c) => typeof c === 'string')) {
      return saved;
    }
  } catch {
    // Storage blocked or unreadable: start empty.
  }
  return ['', '', ''];
}

function ClueForm({ view, tx, act }: { view: EnigmaView; tx: TransmissionView; act: Act }) {
  const key = draftKey(view, tx);
  const [clues, setClues] = useState(() => loadDraft(key));
  const [busy, setBusy] = useState(false);
  // The code is covered until the Encryptor shows it, so a teammate's glance can't read it.
  const [shown, setShown] = useState(false);
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(clues));
    } catch {
      // Storage blocked: the draft just isn't kept.
    }
  }, [key, clues]);
  const keywords = view.teams[tx.team].keywords ?? [];
  const used = usedClues(view.teams[tx.team].history);
  const problems = clues.map((c) =>
    c.trim() ? clueProblem(c.trim(), keywords, used)?.message : null,
  );
  const alone = view.teams[tx.team].members.length < 2;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act({ type: 'give-clues', clues: clues.map((c) => c.trim()) }, { anchor: CLUES_ANCHOR });
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3">
      <div className="text-center">
        <span className="text-sm text-stone-500">Your secret code</span>
        {shown ? (
          <span className="block font-mono text-3xl font-black tracking-widest">
            {formatCode(tx.code)}
          </span>
        ) : (
          <span className="block text-sm text-stone-500">
            Covered so your teammates can’t read it over your shoulder.
          </span>
        )}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-1"
          aria-pressed={shown}
          onClick={() => setShown(!shown)}
        >
          {shown ? '🙈 Cover code' : '👁️ Show code'}
        </Button>
      </div>
      {tx.code?.map((digit, i) => (
        <label key={i} className="block">
          <span className="text-sm">
            Clue {i + 1}
            {shown && (
              <>
                {' '}
                points to <b>#{digit}</b>{' '}
                <span className="font-bold uppercase">{keywords[digit - 1]}</span>
              </>
            )}
          </span>
          <input
            value={clues[i]}
            maxLength={MAX_CLUE_LENGTH}
            autoFocus={i === 0}
            onChange={(e) => setClues((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="A hint only your team will get"
            aria-invalid={!!problems[i]}
            className="mt-1 block w-full rounded-lg bg-white px-3 py-2 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
          {problems[i] && (
            <span className="mt-1 block text-sm text-red-700 dark:text-red-400">{problems[i]}</span>
          )}
        </label>
      ))}
      {alone && (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
          Nobody else is on your team right now, so nobody could decode your clues. If a teammate
          comes back before you send them, they decode as usual.
        </p>
      )}
      {view.settings.timerMode === 'strict' && view.settings.clueSeconds !== null && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          ⏱ Strict timer: send before it runs out. Clues that aren't sent don't count, and your team
          gets a miscommunication 💥.
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={busy || clues.some((c) => !c.trim()) || problems.some(Boolean)}
      >
        Send clues
      </Button>
      <RefusalSlot anchor={CLUES_ANCHOR} />
    </form>
  );
}

/** A teammate's draft as three little boxes, empty where nothing is picked yet. */
function PickBoxes({ draft }: { draft: readonly number[] }) {
  const label = draft.map((d) => (d ? String(d) : 'not picked')).join(', ');
  return (
    <span role="img" aria-label={label} className="inline-flex gap-0.5 align-middle">
      {draft.map((d, i) => (
        <span
          key={i}
          aria-hidden
          className="inline-flex size-4 items-center justify-center rounded-sm bg-white text-[0.7rem] font-bold tabular-nums ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-600"
        >
          {d || ''}
        </span>
      ))}
    </span>
  );
}

/** Who on your side has picked what, with an offline dot; the host can skip an offline voter. */
function Picks({
  view,
  tx,
  online,
}: {
  view: EnigmaView;
  tx: TransmissionView;
  online: (id: string) => boolean;
}) {
  return (
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
                    'bg-success-soft text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100',
                )}
              >
                {!online(id) && (
                  <span
                    aria-label="offline"
                    className="mr-1 inline-block size-2 rounded-full bg-stone-400"
                  />
                )}
                {nameOf(view, id)} {v ? <PickBoxes draft={v.draft} /> : 'picking…'}{' '}
                {v?.locked ? '🔒' : ''}
              </Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function CodePicker({
  view,
  tx,
  act,
  online,
}: {
  view: EnigmaView;
  tx: TransmissionView;
  act: Act;
  online: (id: string) => boolean;
}) {
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

  const history = decoding ? null : cluesByKeyword(view, tx.team);
  return (
    <div className="space-y-3">
      {history && <PastClues columns={history} guesses={ourGuesses} />}
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
                      ? 'bg-accent dark:bg-amber-500 font-bold text-accent-fg dark:text-stone-950 ring-accent dark:ring-amber-600'
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

      <Picks view={view} tx={tx} online={online} />

      {lockedOnText(tx) && (
        <p
          role="status"
          className="rounded-lg bg-success-soft px-3 py-2 text-sm font-semibold text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100"
        >
          🔒 {lockedOnText(tx)}
        </p>
      )}

      {tx.disagree && (
        <p
          role="alert"
          className="rounded-lg bg-team-a-soft px-3 py-2 text-sm font-semibold text-rose-900 dark:bg-rose-950 dark:text-rose-100"
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

/**
 * The other team's clue history, filed under keyword numbers, right above the picker, so an
 * interceptor doesn't have to flip to the Clues tab for every clue.
 */
function PastClues({
  columns,
  guesses,
}: {
  columns: { round: number; clue: string }[][];
  guesses: string[];
}) {
  return (
    <div className="rounded-xl bg-stone-100 p-2 dark:bg-stone-800/70">
      <p className="mb-1 text-xs font-semibold text-stone-500">Their past clues</p>
      <div className="grid grid-cols-4 gap-1">
        {columns.map((clues, i) => (
          <div key={i} className="min-w-0" aria-label={`Their past clues for keyword ${i + 1}`}>
            <p className="truncate text-xs font-black">
              {i + 1}
              {guesses[i] && (
                <span className="ml-1 font-semibold text-stone-500 uppercase">{guesses[i]}</span>
              )}
            </p>
            <ul className="text-xs leading-snug break-words">
              {clues.map((c) => (
                <li key={`${c.round}-${c.clue}`}>{c.clue}</li>
              ))}
              {clues.length === 0 && <li className="text-stone-400">–</li>}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** "(1 of 2)": a team's token count up to and including this round, read from the clue history. */
function tokensSoFar(view: EnigmaView, tx: TransmissionView, kind: 'miss' | 'intercept'): number {
  return view.teams[tx.team].history.filter(
    (h) => h.round <= view.round && (kind === 'miss' ? !h.decoded : h.intercepted),
  ).length;
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
          {tx.timedOut
            ? `⏱ Time ran out before ${nameOf(view, tx.encryptor)} sent clues.`
            : 'No clues were sent: nobody was left on the team.'}
        </p>
      )}
      {tx.clues && tx.code && (
        // Which clue went with which keyword number: the heart of the game.
        <ul aria-label="Clues and their numbers" className="space-y-0.5 text-center">
          {tx.clues.map((clue, i) => {
            const keyword = view.teams[tx.team].keywords?.[tx.code![i]! - 1];
            return (
              <li key={i}>
                <b>“{clue}”</b> → <b className="font-mono">#{tx.code![i]}</b>
                {keyword && <span className="text-sm text-stone-500 uppercase"> {keyword}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p
        className={cn(
          'rounded-lg px-3 py-2 font-semibold',
          r.decoded
            ? 'bg-success dark:bg-emerald-600 text-white'
            : 'bg-team-a dark:bg-rose-600 text-white',
        )}
      >
        {r.decoded
          ? `✓ ${sender} decoded it.`
          : `✗ ${sender} ${
              tx.expired
                ? 'had nothing to decode'
                : tx.noDecoders
                  ? 'had nobody left to decode'
                  : r.decodeGuess
                    ? `missed it (guessed ${formatCode(r.decodeGuess)})`
                    : tx.guessTimedOut
                      ? "didn't agree on a code before time ran out"
                      : "didn't agree on a code"
            }: miscommunication! ${sender} gets 💥 (${tokensSoFar(view, tx, 'miss')} of ${TOKENS_TO_END}).`}
      </p>
      {canIntercept && (
        <p
          className={cn(
            'rounded-lg px-3 py-2 font-semibold',
            r.intercepted ? 'bg-stone-950 text-white' : 'bg-stone-200 dark:bg-stone-800',
          )}
        >
          {r.intercepted
            ? `🕵️ ${receiver} intercepted it! ${receiver} gets 🕵️ (${tokensSoFar(view, tx, 'intercept')} of ${TOKENS_TO_END}).`
            : `${receiver} didn't intercept${
                r.interceptGuess
                  ? ` (guessed ${formatCode(r.interceptGuess)})`
                  : tx.guessTimedOut && !tx.expired
                    ? ' (no agreed guess before time ran out)'
                    : ''
              }.`}
        </p>
      )}
      {view.phase === 'playing' && view.teams[tx.team].nextEncryptor && (
        <p className="text-center text-sm text-stone-500">
          Next {sender} Encryptor: <b>{nameOf(view, view.teams[tx.team].nextEncryptor!)}</b>
        </p>
      )}
    </div>
  );
}

/** For the host: offline players the vote is waiting on, each with a Skip button. */
function SkipOffline({
  view,
  tx,
  act,
  online,
}: {
  view: EnigmaView;
  tx: TransmissionView;
  act: Act;
  online: (id: string) => boolean;
}) {
  const offline = tx.waitingOn.filter((id) => !online(id));
  if (offline.length === 0) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
      {offline.map((id) => (
        <Button
          key={id}
          size="sm"
          variant="secondary"
          onClick={() => void act({ type: 'skip-voter', team: tx.team, player: id })}
        >
          Skip {nameOf(view, id)}'s vote (offline)
        </Button>
      ))}
    </div>
  );
}

/** One team's transmission this round: what the viewer should do, or how it turned out. */
export function TransmissionCard({
  view,
  tx,
  act,
  online = () => true,
  isHost = false,
}: {
  view: EnigmaView;
  tx: TransmissionView;
  act: Act;
  online?: (id: string) => boolean;
  isHost?: boolean;
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
  } else if ((tx.role === 'decoder' || tx.role === 'interceptor') && tx.clues) {
    // The picker stays up after the side agrees: nothing is final until every side agrees at once.
    body = <CodePicker view={view} tx={tx} act={act} online={online} />;
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
              ? tx.agreed
                ? `Your team is locked on ${formatCode(tx.agreed)}. They can still change it until the reveal, so no hints!`
                : 'Your team is decoding. No hints, in chat or notes!'
              : tx.expired
                ? 'No clues were sent, so there is nothing to guess.'
                : 'Teams are guessing…'}
        </p>
        {/* The Encryptor watches the team's picks, read-only. */}
        {tx.role === 'encryptor' && tx.voters.length > 0 && (
          <Picks view={view} tx={tx} online={online} />
        )}
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
      {isHost && view.stage === 'guess' && !tx.revealed && (
        <SkipOffline view={view} tx={tx} act={act} online={online} />
      )}
    </Panel>
  );
}
