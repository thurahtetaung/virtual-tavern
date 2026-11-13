import type { ActOptions } from '@vt/game-sdk';
import { Button, Input, Notice, Panel, Peek, PlayerTag, Row, Rows, StickyBar, cn } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { clueProblem, usedClues } from '../logic/game.ts';
import type { EnigmaAction, EnigmaView, TransmissionView } from '../logic/types.ts';
import { MAX_CLUE_LENGTH, TOKENS_TO_END } from '../logic/types.ts';
import { cluesByKeyword, lockedOnText } from './status.ts';
import { TEAM_LABEL, TEAM_LINE, TEAM_PANEL, TEAM_TEXT, formatCode } from './theme.ts';

type Act = (a: EnigmaAction, options?: ActOptions) => Promise<boolean>;

/** Where the server's refusal of a set of clues shows: with Send clues (in the sticky bar on phones). */
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
        <span className="text-small text-ink-muted">Your secret code</span>
        <Peek
          what="your code"
          className="mt-1"
          onShownChange={setShown}
          cover={
            <span className="block rounded-lg bg-sunk px-3 py-2 text-center text-small text-ink-muted">
              🔒 Covered so your teammates can’t read it over your shoulder: hold to see it
            </span>
          }
        >
          <span className="block font-mono text-3xl font-black tracking-widest">
            {formatCode(tx.code)}
          </span>
        </Peek>
      </div>
      {tx.code?.map((digit, i) => (
        <label key={i} className="block">
          <span className="text-small font-semibold">
            Clue {i + 1}
            {shown && (
              <>
                {' '}
                points to <b>#{digit}</b>{' '}
                <span className="font-bold uppercase">{keywords[digit - 1]}</span>
              </>
            )}
          </span>
          <Input
            value={clues[i]}
            maxLength={MAX_CLUE_LENGTH}
            autoFocus={i === 0}
            onChange={(e) => setClues((c) => c.map((x, j) => (j === i ? e.target.value : x)))}
            placeholder="A hint only your team will get"
            invalid={!!problems[i]}
            className="mt-1"
          />
          {problems[i] && (
            <span role="alert" className="mt-1 block text-small text-danger-ink">
              {problems[i]}
            </span>
          )}
        </label>
      ))}
      {alone && (
        <Notice tone="info">
          Nobody else is on your team right now, so nobody could decode your clues. If a teammate
          comes back before you send them, they decode as usual.
        </Notice>
      )}
      {view.settings.timerMode === 'strict' && view.settings.clueSeconds !== null && (
        <p className="text-caption text-ink-muted">
          ⏱ Strict timer: send before it runs out. Clues that aren't sent don't count, and your team
          gets a miscommunication 💥.
        </p>
      )}
      <StickyBar fixed refusal={CLUES_ANCHOR}>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={busy || clues.some((c) => !c.trim()) || problems.some(Boolean)}
        >
          Send clues
        </Button>
      </StickyBar>
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
          className="inline-flex size-4 items-center justify-center rounded-sm bg-card text-caption leading-none font-bold tabular-nums ring-1 ring-line-strong"
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
    <div className="rounded-xl bg-sunk px-3 py-2">
      <p className="text-caption font-semibold text-ink-muted">Your team's picks</p>
      <Rows className="text-small">
        {tx.voters.map((id) => {
          const v = tx.teamVotes[id];
          return (
            <Row key={id} className="min-h-9 justify-between gap-2 py-1">
              <PlayerTag name={nameOf(view, id)} offline={!online(id)} />
              <span className={cn('shrink-0', v?.locked && 'font-semibold text-success-ink')}>
                {v ? <PickBoxes draft={v.draft} /> : 'picking…'} {v?.locked ? '🔒' : ''}
              </span>
            </Row>
          );
        })}
      </Rows>
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
          <p className="text-small">
            Clue {row + 1}: <b className="font-display text-sub">“{clue}”</b>
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
                    'min-h-11 min-w-0 rounded-lg px-1 py-1 text-center ring-1 transition disabled:cursor-not-allowed',
                    draft[row] === digit
                      ? 'bg-accent font-bold text-accent-fg ring-accent'
                      : 'bg-card text-ink ring-line-strong hover:bg-panel',
                  )}
                >
                  <span className="block text-lg leading-none font-black">{digit}</span>
                  {hint && (
                    <span className="block truncate text-caption leading-tight uppercase">
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
        <Notice tone="success" className="font-semibold">
          🔒 {lockedOnText(tx)}
        </Notice>
      )}

      {tx.disagree && (
        <Notice tone="danger" role="alert" className="font-semibold">
          Your team disagrees: everyone locked in, but not on the same code. Compare picks!
        </Notice>
      )}

      {/* Your own team's code sits in the sticky bar on phones; an interception keeps its button here. */}
      <StickyBar fixed off={!decoding} className="flex gap-2">
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
      </StickyBar>
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
    <div className="rounded-xl bg-sunk p-2">
      <p className="mb-1 text-caption font-semibold text-ink-muted">Their past clues</p>
      <div className="grid grid-cols-4 gap-1">
        {columns.map((clues, i) => (
          <div key={i} className="min-w-0" aria-label={`Their past clues for keyword ${i + 1}`}>
            <p className="truncate text-caption font-black">
              {i + 1}
              {guesses[i] && (
                <span className="ml-1 font-semibold text-ink-muted uppercase">{guesses[i]}</span>
              )}
            </p>
            <ul className="text-caption leading-snug break-words">
              {clues.map((c) => (
                <li key={`${c.round}-${c.clue}`}>{c.clue}</li>
              ))}
              {clues.length === 0 && <li className="text-ink-muted">–</li>}
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

/** A rubber-stamp word in the line's own colour: the round's verdict at a glance. */
function Stamp({ children }: { children: string }) {
  return (
    <span className="mr-2 inline-block -rotate-3 rounded border-2 border-current px-1.5 align-middle text-caption font-black tracking-widest uppercase max-sm:mb-1.5 max-sm:block max-sm:w-fit">
      {children}
    </span>
  );
}

function RevealSummary({ view, tx }: { view: EnigmaView; tx: TransmissionView }) {
  const r = tx.result;
  if (!r) return null;
  const sender = TEAM_LABEL[tx.team];
  const receiverTeam = tx.team === 'red' ? 'blue' : 'red';
  const receiver = TEAM_LABEL[receiverTeam];
  const canIntercept = view.round >= 2;
  return (
    <div className="space-y-2">
      <div className="text-center">
        <p className="text-small text-ink-muted">
          The code was<span className="sr-only"> {formatCode(tx.code)}</span>
        </p>
        {/* The big moment: the three numbers as tiles in the sending team's colours. */}
        <ol aria-hidden className="mt-1 flex justify-center gap-2">
          {(tx.code ?? [0, 0, 0]).map((digit, i) => (
            <li
              key={i}
              className={cn(
                'flex size-14 items-center justify-center rounded-xl font-display text-display font-black tabular-nums shadow-vt-1-edge ring-1 lg:size-16',
                TEAM_PANEL[tx.team],
                TEAM_TEXT[tx.team],
              )}
            >
              {digit || '?'}
            </li>
          ))}
        </ol>
      </div>
      {tx.expired && (
        <p className="text-center text-small font-semibold">
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
                {keyword && <span className="text-small text-ink-muted uppercase"> {keyword}</span>}
              </li>
            );
          })}
        </ul>
      )}
      <p
        className={cn(
          'rounded-lg px-3 py-2 font-semibold ring-1 ring-inset',
          r.decoded
            ? 'bg-success-soft text-success-ink ring-success-line'
            : 'bg-danger-soft text-danger-ink ring-danger-line',
        )}
      >
        <Stamp>{r.decoded ? 'Decoded' : 'Missed'}</Stamp>
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
            'rounded-lg px-3 py-2 font-semibold ring-1 ring-inset',
            // An interception is the other team's moment: it wears their colours.
            r.intercepted
              ? cn(TEAM_PANEL[receiverTeam], TEAM_TEXT[receiverTeam], 'text-sub shadow-vt-1')
              : 'bg-sunk text-ink ring-line',
          )}
        >
          {r.intercepted && <Stamp>Intercepted</Stamp>}
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
        <p className="text-center text-small text-ink-muted">
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
    <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-small">
      {offline.map((id) => (
        <Button
          key={id}
          size="sm"
          variant="quiet"
          // One line however long the name: the name gives way.
          className="max-w-full gap-0"
          onClick={() => void act({ type: 'skip-voter', team: tx.team, player: id })}
        >
          <span className="truncate">Skip {nameOf(view, id)}</span>
          <span className="shrink-0">'s vote (offline)</span>
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
        <p className="text-center text-ink-2">
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
              <span className="text-ink-muted">{i + 1}.</span>{' '}
              <b className="font-display text-sub">“{c}”</b>
            </li>
          ))}
        </ol>
        <p className="text-small text-ink-2">
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
      className={cn('border-t-2 ring-1', TEAM_PANEL[tx.team], TEAM_LINE[tx.team])}
      aria-label={`${TEAM_LABEL[tx.team]}'s transmission`}
    >
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className={cn('font-bold', TEAM_TEXT[tx.team])}>{TEAM_LABEL[tx.team]}'s code</h3>
        <span className="text-caption text-ink-muted">Encryptor: {encryptor}</span>
      </header>
      {body}
      {isHost && view.stage === 'guess' && !tx.revealed && (
        <SkipOffline view={view} tx={tx} act={act} online={online} />
      )}
    </Panel>
  );
}
