import { Button, Input, Panel, Row, Rows, StickyBar, cn } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import type { EnigmaAction, EnigmaView, Team } from '../logic/types.ts';
import { KEYWORD_COUNT, MAX_NOTE_LENGTH } from '../logic/types.ts';
import { TEAM_LABEL, TEAM_TEXT } from './theme.ts';

type Act = (a: EnigmaAction, options?: { anchor?: string }) => Promise<boolean>;

const ANCHOR = 'enigma-showdown';
const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');
const nameOf = (view: EnigmaView, id: string | null) =>
  (id && view.seats.find((s) => s.id === id)?.name) || null;

/** The team's four final guesses, started from its shared guesses under Clues. */
function ShowdownForm({ view, team, act }: { view: EnigmaView; team: Team; act: Act }) {
  const them = other(team);
  const [guesses, setGuesses] = useState(() =>
    Array.from({ length: KEYWORD_COUNT }, (_, i) => view.notes?.guesses[i] ?? ''),
  );
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    await act(
      { type: 'showdown-guesses', guesses: guesses.map((g) => g.trim()) },
      { anchor: ANCHOR },
    );
    setBusy(false);
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {guesses.map((g, i) => (
          <label key={i} className="flex items-center gap-2">
            <span className={cn('w-6 text-right font-bold tabular-nums', TEAM_TEXT[them])}>
              {i + 1}
            </span>
            <Input
              value={g}
              maxLength={MAX_NOTE_LENGTH}
              aria-label={`Final guess for ${TEAM_LABEL[them]} keyword ${i + 1}`}
              onChange={(e) =>
                setGuesses((all) => all.map((x, j) => (j === i ? e.target.value : x)))
              }
              placeholder="Leave blank to skip"
            />
          </label>
        ))}
      </div>
      <p className="text-caption text-ink-muted">
        Agree in the team chat first: one press hands these in for the whole team, and they can’t be
        changed after.
      </p>
      <StickyBar fixed refusal={ANCHOR}>
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          Hand in our guesses
        </Button>
      </StickyBar>
    </form>
  );
}

/** One team's handed-in guesses, marked right or wrong once the game is over. */
function GuessList({ view, team }: { view: EnigmaView; team: Team }) {
  const showdown = view.showdown!;
  const guesses = showdown.guesses[team];
  const right = showdown.right?.[team];
  const by = nameOf(view, showdown.by[team]);
  if (!guesses) return null;
  return (
    <div className="space-y-1">
      <p className="text-small">
        <b className={TEAM_TEXT[team]}>{TEAM_LABEL[team]}</b>’s guesses at {TEAM_LABEL[other(team)]}
        ’s keywords
        {by ? ` (handed in by ${by})` : ' (from the team’s notes)'}
        {right ? `: ${right.filter(Boolean).length} right` : ''}
      </p>
      <Rows className="text-small">
        {guesses.map((g, i) => (
          <Row
            key={i}
            className={cn(
              'min-h-9 gap-2 rounded-lg px-2 py-1',
              right?.[i] && 'bg-success-soft text-success-ink',
            )}
          >
            <span className="text-ink-muted tabular-nums">{i + 1}</span>
            <span className="min-w-0 flex-1 font-bold uppercase">{g || '—'}</span>
            {right && <span>{right[i] ? '✓' : '✗'}</span>}
          </Row>
        ))}
      </Rows>
    </div>
  );
}

/** The tiebreak: each team names the other team's keywords. */
export function ShowdownPanel({ view, act }: { view: EnigmaView; act: Act }) {
  const showdown = view.showdown;
  if (!showdown) return null;
  const team = view.me?.team ?? null;
  if (view.phase === 'over') {
    return (
      <section aria-label="Showdown" className="mx-auto w-full max-w-lg space-y-3">
        {(['red', 'blue'] as const).map((t) => (
          <GuessList key={t} view={view} team={t} />
        ))}
      </section>
    );
  }
  return (
    <Panel className="space-y-3">
      <h3 className="text-center text-sub font-bold">🤝 Showdown</h3>
      <p className="text-center text-small">
        The score is level. Each team names the other team’s four keywords, one per number: the team
        with more right wins, and the same number right is a shared win.
      </p>
      {team && !showdown.done[team] ? (
        <ShowdownForm view={view} team={team} act={act} />
      ) : (
        team && <GuessList view={view} team={team} />
      )}
      <ul className="flex justify-center gap-4 text-small">
        {(['red', 'blue'] as const).map((t) => (
          <li key={t}>
            <b className={TEAM_TEXT[t]}>{TEAM_LABEL[t]}</b>:{' '}
            {showdown.done[t] ? 'handed in ✓' : 'still guessing…'}
          </li>
        ))}
      </ul>
    </Panel>
  );
}
