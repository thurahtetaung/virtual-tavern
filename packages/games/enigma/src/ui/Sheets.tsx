import { sameAnswer } from '@vt/game-sdk';
import { Button, NameDot, Panel, RefusalSlot, cn } from '@vt/ui';
import { type FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EnigmaAction, EnigmaView, NoteItem, Team } from '../logic/types.ts';
import { LEGACY_NOTE_ID, MAX_NOTE_ITEM_LENGTH, MAX_NOTE_LENGTH } from '../logic/types.ts';
import { chatMuted, cluesByKeyword } from './status.ts';
import { TEAM_LABEL, TEAM_PANEL, TEAM_TEXT } from './theme.ts';

type Act = (a: EnigmaAction, options?: { anchor?: string }) => Promise<boolean>;

/**
 * One of the team's keyword guesses. While you're in the field it keeps your own text, so a
 * teammate's update never yanks the cursor; it's saved when you leave the field or press Enter,
 * never per keystroke. If a teammate changed it meanwhile, the server refuses (it never
 * overwrites their guess): the field shows theirs and yours stays one tap away.
 */
function GuessField({
  slot,
  value,
  label,
  anchor,
  act,
  disabled,
}: {
  slot: number;
  value: string;
  label: string;
  anchor: string;
  act: Act;
  disabled: boolean;
}) {
  // `draft` is non-null while you're editing; `base` is the value you started from.
  const [draft, setDraft] = useState<string | null>(null);
  const [base, setBase] = useState('');
  // Your text, sent but not yet shown back by the server: it applies only while the server still
  // holds the value it was saved over, so any change from the server supersedes it.
  const [sent, setSent] = useState<{ text: string; over: string } | null>(null);
  const pending = sent && sent.over === value ? sent.text : null;
  // Your text that lost to a teammate's.
  const [mine, setMine] = useState<string | null>(null);

  const save = useCallback(
    (text: string, from: string) => {
      setSent({ text, over: from });
      void act({ type: 'set-note', slot, text, base: from }, { anchor }).then((ok) => {
        // The server sends the new state before it answers, so it is already on screen.
        setSent(null);
        setMine(ok ? null : text);
      });
    },
    [act, slot, anchor],
  );

  // Leaving the screen mid-edit still saves it.
  const unsaved = useRef<{ draft: string | null; base: string; save: typeof save }>(null);
  useEffect(() => {
    unsaved.current = { draft, base, save };
  });
  useEffect(() => {
    return () => {
      const u = unsaved.current;
      if (u && u.draft !== null && u.draft.trim() !== u.base) u.save(u.draft.trim(), u.base);
    };
  }, []);

  const commit = () => {
    if (draft !== null && draft.trim() !== base) save(draft.trim(), base);
    setDraft(null);
  };

  return (
    <div>
      <input
        aria-label={label}
        value={draft ?? pending ?? value}
        disabled={disabled}
        maxLength={MAX_NOTE_LENGTH}
        placeholder="We think it's…"
        enterKeyHint="done"
        onFocus={() => {
          // Mid-save, start from what you sent: that's what the server will hold.
          setDraft(pending ?? value);
          setBase(pending ?? value);
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-full rounded-md bg-white/80 px-2 py-1 text-sm ring-1 ring-stone-300 placeholder:text-stone-400 disabled:opacity-50 dark:bg-stone-900/60 dark:ring-stone-600"
      />
      <RefusalSlot anchor={anchor} className="mt-1 px-2 py-1 text-xs" />
      {mine !== null && mine !== value && (
        <p className="mt-1 text-xs text-stone-600 dark:text-stone-300">
          Your version: <q className="font-semibold break-words">{mine}</q>{' '}
          <button
            type="button"
            className="font-semibold text-amber-700 underline disabled:opacity-50 dark:text-amber-400"
            disabled={disabled}
            onClick={() => save(mine, value)}
          >
            (use it)
          </button>
        </p>
      )}
    </div>
  );
}

/** The team's notes, each with who wrote it and a ✕. Memoised: typing a new note doesn't redraw it. */
const NoteList = memo(function NoteList({
  items,
  names,
  onRemove,
  disabled,
}: {
  items: NoteItem[];
  names: ReadonlyMap<string, string>;
  onRemove: (id: string) => void;
  disabled: boolean;
}) {
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => {
    // Block body: scrollIntoView may return a Promise, which React must not treat as a cleanup.
    void end.current?.scrollIntoView({ block: 'nearest' });
  }, [items.length]);
  return (
    // Focusable, so the list scrolls from the keyboard too.
    <ul
      aria-label="Team notes"
      tabIndex={0}
      className="max-h-48 space-y-1 overflow-y-auto rounded-md bg-white/60 p-1 text-sm ring-1 ring-stone-200 dark:bg-stone-900/40 dark:ring-stone-700"
    >
      {items.map((n) => (
        <li
          key={n.id}
          className="flex items-start gap-2 rounded px-1.5 py-1 odd:bg-stone-100/70 dark:odd:bg-stone-800/50"
        >
          <p className="min-w-0 flex-1 break-words whitespace-pre-wrap">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted">
              {names.get(n.by) ?? (n.id === LEGACY_NOTE_ID ? 'Earlier notes' : 'Someone who left')}:
              {names.has(n.by) && <NameDot name={names.get(n.by)!} className="order-first" />}
            </span>{' '}
            {n.text}
          </p>
          <button
            type="button"
            aria-label={`Remove note: ${n.text}`}
            title="Remove"
            disabled={disabled}
            onClick={() => onRemove(n.id)}
            className="-my-0.5 shrink-0 rounded px-1.5 text-ink-muted hover:bg-stone-200 hover:text-rose-700 disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-stone-500 dark:hover:bg-stone-700"
          >
            ✕
          </button>
        </li>
      ))}
      {items.length === 0 && (
        <li className="px-1.5 py-1 text-xs text-ink-muted italic dark:text-stone-400">
          No notes yet. Jot down hunches about their keywords.
        </li>
      )}
      <li ref={end} aria-hidden />
    </ul>
  );
});

const ADD_NOTE_ANCHOR = 'enigma-add-note';
const MUTED_HINT = 'The Encryptor can’t edit notes until the codes are revealed.';

/** Adds one note. Its typing state stays here, so nothing else redraws per keystroke. */
function AddNote({ act, disabled }: { act: Act; disabled: boolean }) {
  const [text, setText] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    const note = text.trim();
    if (!note) return;
    setText('');
    if (!(await act({ type: 'add-note', text: note }, { anchor: ADD_NOTE_ANCHOR }))) setText(note);
  };
  return (
    <>
      <form onSubmit={(e) => void add(e)} className="mt-2 flex gap-2">
        <input
          value={text}
          disabled={disabled}
          maxLength={MAX_NOTE_ITEM_LENGTH}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a note"
          aria-label="Add a note"
          enterKeyHint="send"
          className="h-10 min-w-0 flex-1 rounded-lg bg-white px-3 text-sm ring-1 ring-stone-300 disabled:opacity-50 dark:bg-stone-800 dark:ring-stone-600"
        />
        <Button type="submit" disabled={disabled || !text.trim()}>
          Add
        </Button>
      </form>
      <RefusalSlot anchor={ADD_NOTE_ANCHOR} />
    </>
  );
}

/** Your team's list of notes about the other team, shared with your team only. */
function NotesPanel({ view, act, muted }: { view: EnigmaView; act: Act; muted: boolean }) {
  const names = useMemo(() => new Map(view.seats.map((s) => [s.id, s.name])), [view.seats]);
  const onRemove = useCallback(
    (id: string) => void act({ type: 'remove-note', id }, { anchor: ADD_NOTE_ANCHOR }),
    [act],
  );
  if (!view.notes) return null;
  return (
    <section aria-label="Team notes panel" className="mt-3">
      <h4 className="text-sm font-semibold">Team notes</h4>
      <p className="mb-1 text-xs text-ink-muted">
        {muted ? MUTED_HINT : 'Shared with your team only. Anyone can add or remove a note.'}
      </p>
      <NoteList items={view.notes.items} names={names} onRemove={onRemove} disabled={muted} />
      <AddNote act={act} disabled={muted} />
    </section>
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
          <span className="shrink-0 text-[0.65rem] text-ink-muted">R{c.round}</span>
        </li>
      ))}
      {clues.length === 0 && <li className="text-xs text-ink-muted italic">No clues yet</li>}
    </ul>
  );
}

/** Your team's keywords, with every clue your Encryptors have given for each. */
export function OwnSheet({ view, team }: { view: EnigmaView; team: Team }) {
  const keywords = view.teams[team].keywords ?? [];
  const columns = cluesByKeyword(view, team);
  // At the end, the other team's keywords are shown beside what your team guessed they were.
  const guesses = view.me?.team && view.me.team !== team ? (view.notes?.guesses ?? []) : [];
  return (
    <Panel className={cn('ring-1', TEAM_PANEL[team])}>
      <h3 className={cn('mb-2 font-bold', TEAM_TEXT[team])}>
        {view.me?.team === team ? 'Your keywords' : `${TEAM_LABEL[team]}'s keywords`}
      </h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {keywords.map((word, i) => (
          <div key={i} className="rounded-xl bg-white/80 p-2 shadow-sm dark:bg-stone-900/70">
            <p className="text-xs font-bold text-ink-muted">#{i + 1}</p>
            <p className="text-base font-extrabold tracking-wide break-words uppercase sm:text-lg">
              {word}
            </p>
            {guesses[i]?.trim() && (
              <p className="text-xs text-stone-600 dark:text-stone-400">
                You guessed <b className="uppercase">{guesses[i]}</b>{' '}
                {sameAnswer(guesses[i], word) ? '✓' : '✗'}
              </p>
            )}
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
  // The server refuses notes from an Encryptor until their code is revealed: grey the fields out.
  const muted = notes !== null && chatMuted(view);
  return (
    <Panel>
      <h3 className={cn('mb-1 font-bold', TEAM_TEXT[team])}>{TEAM_LABEL[team]}'s clues</h3>
      <p className="mb-2 text-xs text-ink-muted">
        Their keywords are secret. Use their past clues to guess them, and to intercept their codes.
      </p>
      {muted && (
        <p className="mb-2 text-xs font-semibold text-amber-700 dark:text-amber-400">
          {MUTED_HINT}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {columns.map((clues, i) => (
          <div key={i} className="rounded-xl bg-stone-100 p-2 dark:bg-stone-800/70">
            <p className="text-xs font-bold text-ink-muted">#{i + 1} · ?</p>
            {notes && (
              <div className="mt-1">
                <GuessField
                  slot={i + 1}
                  label={`Our guess for ${TEAM_LABEL[team]} keyword ${i + 1}`}
                  anchor={`enigma-guess-${i + 1}`}
                  value={notes.guesses[i] ?? ''}
                  act={act}
                  disabled={muted}
                />
              </div>
            )}
            <ClueList clues={clues} />
          </div>
        ))}
      </div>
      {notes && <NotesPanel view={view} act={act} muted={muted} />}
    </Panel>
  );
}
