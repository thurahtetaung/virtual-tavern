import { Panel, cn } from '@vt/ui';
import { useRef, useState } from 'react';
import type { EnigmaAction, EnigmaView, Team } from '../logic/types.ts';
import { MAX_GENERAL_NOTE_LENGTH, MAX_NOTE_LENGTH } from '../logic/types.ts';
import { cluesByKeyword } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';

type Act = (a: EnigmaAction) => Promise<boolean>;

/**
 * A shared text field: shows the team's saved value, but while you're typing it shows your own
 * text (sent after a short pause) so teammates' updates never yank the cursor.
 */
function SharedText({
  value,
  onSave,
  multiline,
  maxLength,
  placeholder,
  label,
}: {
  value: string;
  onSave: (text: string) => void;
  multiline?: boolean;
  maxLength: number;
  placeholder: string;
  label: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const shown = draft ?? value;
  const change = (text: string) => {
    setDraft(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => onSave(text), 400);
  };
  const commit = () => {
    clearTimeout(timer.current);
    if (draft !== null && draft !== value) onSave(draft);
    setDraft(null);
  };
  const common = {
    'aria-label': label,
    value: shown,
    maxLength,
    placeholder,
    onFocus: () => setDraft(value),
    onBlur: commit,
    className:
      'w-full rounded-md bg-white/80 px-2 py-1 text-sm ring-1 ring-stone-300 placeholder:text-stone-400 dark:bg-stone-900/60 dark:ring-stone-600',
  };
  return multiline ? (
    <textarea {...common} rows={3} onChange={(e) => change(e.target.value)} />
  ) : (
    <input {...common} onChange={(e) => change(e.target.value)} />
  );
}

function ClueList({ clues }: { clues: { round: number; clue: string }[] }) {
  return (
    <ul className="mt-2 space-y-1 text-sm">
      {clues.map((c, i) => (
        <li
          key={i}
          className="flex items-baseline justify-between gap-2 border-b border-stone-200/70 pb-0.5 dark:border-stone-700/70"
        >
          <span className="font-medium break-words">{c.clue}</span>
          <span className="shrink-0 text-[0.65rem] text-stone-500">R{c.round}</span>
        </li>
      ))}
      {clues.length === 0 && <li className="text-xs text-stone-500 italic">No clues yet</li>}
    </ul>
  );
}

/** Your team's keywords, with every clue your Encryptors have given for each. */
export function OwnSheet({ view, team }: { view: EnigmaView; team: Team }) {
  const keywords = view.teams[team].keywords ?? [];
  const columns = cluesByKeyword(view, team);
  return (
    <Panel className={cn('ring-1', TEAM_PANEL[team])}>
      <h3 className={cn('mb-2 font-bold', TEAM_TEXT[team])}>
        {view.me?.team === team ? 'Your keywords' : `${TEAM_LABEL[team]}'s keywords`}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keywords.map((word, i) => (
          <div key={i} className="rounded-xl bg-white/80 p-2 shadow-sm dark:bg-stone-900/70">
            <p className="text-xs font-bold text-stone-500">#{i + 1}</p>
            <p className="text-base font-extrabold tracking-wide break-words uppercase sm:text-lg">
              {word}
            </p>
            <ClueList clues={columns[i]!} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

/** The other team's clue history by keyword number, with your team's shared guesses and notes. */
export function OpponentSheet({ view, team, act }: { view: EnigmaView; team: Team; act: Act }) {
  const columns = cluesByKeyword(view, team);
  const notes = view.notes;
  const editor = notes?.editedBy ? view.seats.find((s) => s.id === notes.editedBy)?.name : null;
  return (
    <Panel>
      <h3 className={cn('mb-1 font-bold', TEAM_TEXT[team])}>{TEAM_LABEL[team]}'s clues</h3>
      <p className="mb-2 text-xs text-stone-500">
        Their keywords are secret. Use their past clues to guess them, and to intercept their codes.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {columns.map((clues, i) => (
          <div key={i} className="rounded-xl bg-stone-100 p-2 dark:bg-stone-800/70">
            <p className="text-xs font-bold text-stone-500">#{i + 1} · ?</p>
            {notes && (
              <div className="mt-1">
                <SharedText
                  label={`Our guess for ${TEAM_LABEL[team]} keyword ${i + 1}`}
                  value={notes.guesses[i] ?? ''}
                  maxLength={MAX_NOTE_LENGTH}
                  placeholder="We think it's…"
                  onSave={(text) => void act({ type: 'set-note', slot: i + 1, text })}
                />
              </div>
            )}
            <ClueList clues={clues} />
          </div>
        ))}
      </div>
      {notes && (
        <div className="mt-3">
          <label className="text-sm font-semibold">Team notes</label>
          <SharedText
            label="Team notes"
            multiline
            value={notes.general}
            maxLength={MAX_GENERAL_NOTE_LENGTH}
            placeholder="Shared with your team only…"
            onSave={(text) => void act({ type: 'set-note', slot: 'general', text })}
          />
          {editor && <p className="text-[0.7rem] text-stone-500">Last edited by {editor}</p>}
        </div>
      )}
    </Panel>
  );
}
