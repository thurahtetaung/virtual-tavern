import type {
  GameSummary,
  QuestionDeckDetail,
  QuestionDeckSummary,
  WordListDetail,
  WordListSummary,
} from '@vt/protocol';
import { MAX_WORDS_PER_LIST } from '@vt/protocol';
import { Badge, Button, Panel, cn } from '@vt/ui';
import { type FormEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AdminNav } from '../components/AdminNav.tsx';
import { Layout } from '../components/Layout.tsx';
import { GameTitlesAdmin, NightfallMusicAdmin } from '../components/PrivateGamesAdmin.tsx';
import { api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';
import { useToast } from '../lib/toast.tsx';
import { deckBackupZip, deckFile } from '../lib/question-deck-backup.ts';
import { backupFileName, backupZip, listFile, saveFile } from '../lib/word-list-backup.ts';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

export function AdminPage() {
  usePageTitle('Admin');
  const [session, setSession] = useState<Session | null>(null);
  const refresh = useCallback(() => void api<Session>('/api/admin/session').then(setSession), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <Layout>
      <h1 className="mb-6 text-3xl font-bold">Tavern keeper</h1>
      {!session ? (
        <p className="text-stone-500">Loading…</p>
      ) : !session.enabled ? (
        <Panel>The admin area is turned off. Set ADMIN_PASSWORD on the server to enable it.</Panel>
      ) : !session.signedIn ? (
        <Login onDone={refresh} />
      ) : (
        <div className="space-y-8">
          <AdminNav current="lists" />
          <BackroomAdmin />
          <RecapAdmin />
          <GameTitlesAdmin />
          <NightfallMusicAdmin />
          <WordLists onSignOut={refresh} />
          <QuestionDecks />
        </div>
      )}
    </Layout>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const toast = useToast();
  const [password, setPassword] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/admin/login', { method: 'POST', body: { password } });
      onDone();
    } catch (err) {
      toast((err as Error).message);
    }
  };
  return (
    <Panel className="mx-auto max-w-sm">
      <form onSubmit={(e) => void submit(e)} className="space-y-3">
        <label className="block">
          <span className="text-sm font-semibold">Admin password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 h-11 w-full rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
        </label>
        <Button type="submit" className="w-full" disabled={!password}>
          Sign in
        </Button>
      </form>
    </Panel>
  );
}

/** Same rules the server applies: trim, collapse spaces, drop case-insensitive duplicates. */
function parseWords(text: string) {
  const seen = new Set<string>();
  const words: string[] = [];
  let duplicates = 0;
  for (const raw of text.split(/[\n,;]+/)) {
    const word = raw.trim().replace(/\s+/g, ' ');
    if (!word) continue;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) duplicates++;
    else {
      seen.add(key);
      words.push(word);
    }
  }
  return { words, duplicates, tooLong: words.filter((w) => w.length > 40) };
}

/** The shared password for back-room (private) games. */
function BackroomAdmin() {
  const toast = useToast();
  const [open, setOpen] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const load = useCallback(
    () =>
      void api<{ open: boolean }>('/api/admin/backroom')
        .then((r) => setOpen(r.open))
        .catch((e: Error) => toast(e.message)),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/api/admin/backroom/password', { method: 'PUT', body: { password } });
      setPassword('');
      toast(
        open ? 'Password changed. Everyone has to knock again.' : 'The back room is open.',
        'info',
      );
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const signOutAll = async () => {
    if (!window.confirm('Sign everyone out of the back room? They will need the password again.'))
      return;
    try {
      await api('/api/admin/backroom/sign-out-all', { method: 'POST' });
      toast('Everyone has been signed out of the back room.', 'info');
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <Panel className="space-y-3">
      <div>
        <h2 className="text-xl font-bold">🕯️ Back room</h2>
        <p className="text-sm text-stone-600 dark:text-stone-400">
          One shared password unlocks private games for 30 days per device.{' '}
          {open === null
            ? ''
            : open
              ? 'The back room is open.'
              : 'No password yet, so the back room is closed.'}
        </p>
      </div>
      <form onSubmit={(e) => void save(e)} className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="backroom-password">
          Back room password
        </label>
        <input
          id="backroom-password"
          type="password"
          autoComplete="new-password"
          value={password}
          minLength={4}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={open ? 'New password' : 'Set a password'}
          className="h-11 flex-1 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
        />
        <Button type="submit" disabled={password.length < 4}>
          {open ? 'Change password' : 'Open the back room'}
        </Button>
      </form>
      {open && (
        <Button variant="secondary" size="sm" onClick={() => void signOutAll()}>
          Sign everyone out
        </Button>
      )}
    </Panel>
  );
}

/** Night recaps' on/off switch: off hides the recap chip, the end-screen strips and the wrap-up. */
function RecapAdmin() {
  const toast = useToast();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ enabled: boolean }>('/api/admin/recap')
      .then((r) => setEnabled(r.enabled))
      .catch((e: Error) => toast(e.message));
  }, [toast]);
  const change = async (on: boolean) => {
    setBusy(true);
    try {
      const r = await api<{ enabled: boolean }>('/api/admin/recap', {
        method: 'PUT',
        body: { enabled: on },
      });
      setEnabled(r.enabled);
      toast(r.enabled ? 'Night recaps are on.' : 'Night recaps are off.', 'info');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel className="flex items-start justify-between gap-3">
      <div>
        <h2 className="text-xl font-bold">🍻 Night recaps</h2>
        <p id="recap-switch-help" className="text-sm text-stone-600 dark:text-stone-400">
          Awards on every end screen, and a shareable recap of each room's night. Switching them off
          hides the recap everywhere straight away; nothing is deleted.
        </p>
      </div>
      {enabled !== null && (
        <Switch
          checked={enabled}
          busy={busy}
          onChange={(on) => void change(on)}
          aria-label="Night recaps"
          aria-describedby="recap-switch-help"
        />
      )}
    </Panel>
  );
}

function WordLists({ onSignOut }: { onSignOut: () => void }) {
  const toast = useToast();
  // null until the first load answers, so an empty server isn't confused with a slow one.
  const [lists, setLists] = useState<WordListSummary[] | null>(null);
  const [editing, setEditing] = useState<WordListDetail | 'new' | null>(null);
  // The games a list can be offered in ("Used by").
  const [games, setGames] = useState<GameSummary[]>([]);
  useEffect(() => {
    void api<GameSummary[]>('/api/games')
      .then((all) => setGames(all.filter((g) => g.wordLists)))
      .catch(() => {});
  }, []);

  const load = useCallback(
    () =>
      void api<WordListSummary[]>('/api/admin/word-lists')
        .then(setLists)
        .catch((e: Error) => {
          toast(e.message);
          setLists((l) => l ?? []);
        }),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const open = async (id: string) => {
    try {
      setEditing(await api<WordListDetail>(`/api/admin/word-lists/${id}`));
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const download = async (id: string) => {
    try {
      const { name, blob } = listFile(await api<WordListDetail>(`/api/admin/word-lists/${id}`));
      saveFile(blob, name);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const [zipping, setZipping] = useState(false);
  const downloadAll = async () => {
    setZipping(true);
    try {
      const all = await api<WordListDetail[]>('/api/admin/word-lists/export');
      saveFile(await backupZip(all), backupFileName(new Date()));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setZipping(false);
    }
  };

  // Lists with a switch request in flight; further taps on them wait for it to settle.
  const [switching, setSwitching] = useState<ReadonlySet<string>>(new Set());
  const setEnabled = async (id: string, enabled: boolean) => {
    if (switching.has(id)) return;
    const flip = (on: boolean) =>
      setLists((ls) => ls?.map((l) => (l.id === id ? { ...l, enabled: on } : l)) ?? ls);
    flip(enabled);
    setSwitching((s) => new Set(s).add(id));
    try {
      await api(`/api/admin/word-lists/${id}`, { method: 'PATCH', body: { enabled } });
    } catch (err) {
      flip(!enabled);
      toast((err as Error).message);
    } finally {
      setSwitching((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  if (editing) {
    return (
      <Editor
        list={editing === 'new' ? null : editing}
        games={games}
        onClose={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold">Word lists</h2>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setEditing('new')}>+ New list</Button>
          <Button
            variant="secondary"
            onClick={() => void downloadAll()}
            disabled={zipping || !lists?.length}
          >
            {zipping ? 'Zipping…' : 'Download all (.zip)'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => void api('/api/admin/logout', { method: 'POST' }).then(onSignOut)}
          >
            Sign out
          </Button>
        </div>
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Hosts choose from these lists when setting up a game. A game needs at least 25 words across
        the chosen lists. Switch a list off to hide it from hosts without deleting it.
      </p>
      {lists === null && <p className="text-stone-500 dark:text-stone-400">Loading lists…</p>}
      <ul className="space-y-2">
        {lists?.map((l) => (
          <li key={l.id}>
            <Panel
              className={cn(
                'flex items-center gap-1 p-0 pr-2 transition hover:ring-accent dark:hover:ring-amber-400',
                !l.enabled && 'bg-stone-100/80 dark:bg-stone-900/40',
              )}
            >
              <button
                type="button"
                onClick={() => void open(l.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span
                      id={`list-${l.id}`}
                      className={cn(
                        'font-bold',
                        !l.enabled && 'text-stone-500 dark:text-stone-400',
                      )}
                    >
                      {l.name}
                    </span>
                    {!l.enabled && <Badge>Disabled</Badge>}
                  </span>
                  <span className={cn('block', !l.enabled && 'opacity-60')}>
                    {l.description && (
                      <span className="block text-sm text-stone-500">{l.description}</span>
                    )}
                    <GameTags ids={l.games} games={games} />
                  </span>
                </span>
                <span
                  className={cn(
                    'shrink-0 text-sm',
                    l.wordCount < 25 && l.enabled
                      ? 'font-semibold text-rose-600'
                      : 'text-stone-500',
                  )}
                >
                  {l.wordCount} words
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${l.name} as .txt`}
                title="Download .txt"
                onClick={() => void download(l.id)}
              >
                <DownloadIcon />
              </Button>
              <Switch
                checked={l.enabled}
                busy={switching.has(l.id)}
                onChange={(on) => void setEnabled(l.id, on)}
                aria-label="Enabled"
                aria-describedby={`list-${l.id}`}
              />
            </Panel>
          </li>
        ))}
        {lists?.length === 0 && <li className="text-stone-500 italic">No lists yet.</li>}
      </ul>
    </div>
  );
}

/**
 * Trivia question decks. Their questions are private, so they are only imported (with
 * `scripts/import-question-decks.mjs`), switched on and off, downloaded and deleted here.
 */
function QuestionDecks() {
  const toast = useToast();
  const [decks, setDecks] = useState<QuestionDeckSummary[] | null>(null);
  const [games, setGames] = useState<GameSummary[]>([]);
  useEffect(() => {
    void api<GameSummary[]>('/api/games')
      .then(setGames)
      .catch(() => {});
  }, []);

  const load = useCallback(
    () =>
      void api<QuestionDeckSummary[]>('/api/admin/question-decks')
        .then(setDecks)
        .catch((e: Error) => {
          toast(e.message);
          setDecks((d) => d ?? []);
        }),
    [toast],
  );
  useEffect(() => {
    load();
  }, [load]);

  const download = async (id: string) => {
    try {
      const { name, blob } = deckFile(
        await api<QuestionDeckDetail>(`/api/admin/question-decks/${id}`),
      );
      saveFile(blob, name);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const [zipping, setZipping] = useState(false);
  const downloadAll = async () => {
    setZipping(true);
    try {
      const all = await api<QuestionDeckDetail[]>('/api/admin/question-decks/export');
      saveFile(await deckBackupZip(all), backupFileName(new Date(), 'question-decks'));
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setZipping(false);
    }
  };

  const remove = async (deck: QuestionDeckSummary) => {
    if (
      !window.confirm(
        `Delete "${deck.name}" and its ${deck.questionCount} questions? Download it first if you might want it back.`,
      )
    )
      return;
    try {
      await api(`/api/admin/question-decks/${deck.id}`, { method: 'DELETE' });
      toast(`Deleted "${deck.name}".`, 'info');
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  // Decks with a switch request in flight; further taps on them wait for it to settle.
  const [switching, setSwitching] = useState<ReadonlySet<string>>(new Set());
  const setEnabled = async (id: string, enabled: boolean) => {
    if (switching.has(id)) return;
    const flip = (on: boolean) =>
      setDecks((ds) => ds?.map((d) => (d.id === id ? { ...d, enabled: on } : d)) ?? ds);
    flip(enabled);
    setSwitching((s) => new Set(s).add(id));
    try {
      await api(`/api/admin/question-decks/${id}`, { method: 'PATCH', body: { enabled } });
    } catch (err) {
      flip(!enabled);
      toast((err as Error).message);
    } finally {
      setSwitching((s) => {
        const next = new Set(s);
        next.delete(id);
        return next;
      });
    }
  };

  return (
    <section aria-labelledby="question-decks-heading" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="question-decks-heading" className="text-xl font-bold">
          Question decks
        </h2>
        <Button
          variant="secondary"
          onClick={() => void downloadAll()}
          disabled={zipping || !decks?.length}
        >
          {zipping ? 'Zipping…' : 'Download all decks (.zip)'}
        </Button>
      </div>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        Trivia games draw their questions from these decks. The questions are private: import them
        with <code className="text-xs">scripts/import-question-decks.mjs</code>, never into the
        repository. Switch a deck off to hide it from hosts without deleting it.
      </p>
      {decks === null && <p className="text-stone-500 dark:text-stone-400">Loading decks…</p>}
      <ul className="space-y-2">
        {decks?.map((d) => (
          <li key={d.id}>
            <Panel
              className={cn(
                'flex items-center gap-1 p-0 py-2 pr-2 pl-4',
                !d.enabled && 'bg-stone-100/80 dark:bg-stone-900/40',
              )}
            >
              <div className="min-w-0 flex-1 py-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span
                    id={`deck-${d.id}`}
                    className={cn(
                      'font-bold break-words',
                      !d.enabled && 'text-stone-500 dark:text-stone-400',
                    )}
                  >
                    {d.name}
                  </span>
                  {d.adult && (
                    <span className="inline-flex items-center rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-rose-800 dark:bg-rose-900/50 dark:text-rose-200">
                      Adult
                    </span>
                  )}
                  {!d.enabled && <Badge>Disabled</Badge>}
                </span>
                <span className={cn('block', !d.enabled && 'opacity-60')}>
                  {d.description && (
                    <span className="block text-sm text-stone-500">{d.description}</span>
                  )}
                  <span className="block text-sm text-stone-500">
                    {d.questionCount} {d.questionCount === 1 ? 'question' : 'questions'}
                  </span>
                  <GameTags ids={d.games} games={games} />
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Download ${d.name} as .json`}
                title="Download .json"
                onClick={() => void download(d.id)}
              >
                <DownloadIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Delete ${d.name}`}
                title="Delete"
                onClick={() => void remove(d)}
              >
                <span className="text-rose-700 dark:text-rose-400">
                  <TrashIcon />
                </span>
              </Button>
              <Switch
                checked={d.enabled}
                busy={switching.has(d.id)}
                onChange={(on) => void setEnabled(d.id, on)}
                aria-label="Enabled"
                aria-describedby={`deck-${d.id}`}
              />
            </Panel>
          </li>
        ))}
        {decks?.length === 0 && <li className="text-stone-500 italic">No decks yet.</li>}
      </ul>
    </section>
  );
}

function TrashIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" />
    </svg>
  );
}

/**
 * An on/off switch with a 44 px tap target. Name it with `aria-label`, or with a `<label>`
 * pointing at `id`. While `busy`, taps are ignored (the switch stays focusable).
 */
function Switch({
  checked,
  onChange,
  busy = false,
  ...aria
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className={cn(
        'inline-flex h-11 min-w-14 shrink-0 items-center justify-center rounded-lg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        busy && 'cursor-wait',
      )}
      {...aria}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors',
          checked ? 'bg-accent dark:bg-amber-500' : 'bg-stone-300 dark:bg-stone-600',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </button>
  );
}

/** The games a list is offered in, as small chips (ids of games not on this server are skipped). */
function GameTags({ ids, games }: { ids: readonly string[]; games: readonly GameSummary[] }) {
  const names = games.filter((g) => ids.includes(g.id)).map((g) => g.name);
  if (!names.length) return null;
  return (
    <span className="mt-1 flex flex-wrap gap-1">
      {names.map((n) => (
        <span
          key={n}
          className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
        >
          {n}
        </span>
      ))}
    </span>
  );
}

function Editor({
  list,
  games,
  onClose,
}: {
  list: WordListDetail | null;
  /** Games that use word lists. */
  games: readonly GameSummary[];
  onClose: () => void;
}) {
  const toast = useToast();
  // null = untouched: an existing list keeps its tags, a new one is offered in every game.
  const [picked, setPicked] = useState<string[] | null>(null);
  const usedBy = picked ?? (list ? list.games : games.map((g) => g.id));
  const chosen = games.filter((g) => usedBy.includes(g.id)).map((g) => g.id);
  const toggle = (id: string) =>
    setPicked(chosen.includes(id) ? chosen.filter((g) => g !== id) : [...chosen, id]);
  const [name, setName] = useState(list?.name ?? '');
  const [enabled, setEnabled] = useState(list?.enabled ?? true);
  const switchId = useId();
  const [description, setDescription] = useState(list?.description ?? '');
  const [text, setText] = useState(list?.words.join('\n') ?? '');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseWords(text), [text]);

  const save = async () => {
    setSaving(true);
    try {
      // Untouched tags are left to the server, which keeps them (or uses its default).
      const body = {
        name,
        description,
        words: parsed.words,
        enabled,
        ...(picked ? { games: chosen } : {}),
      };
      if (list) await api(`/api/admin/word-lists/${list.id}`, { method: 'PUT', body });
      else await api('/api/admin/word-lists', { method: 'POST', body });
      toast('Saved', 'info');
      onClose();
    } catch (err) {
      toast((err as Error).message);
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!list || !window.confirm(`Delete "${list.name}"? Rooms using it will need another list.`))
      return;
    try {
      await api(`/api/admin/word-lists/${list.id}`, { method: 'DELETE' });
      onClose();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const importFile = async (file: File) => {
    const imported = await file.text();
    setText((t) => (t.trim() ? `${t.trim()}\n${imported}` : imported));
  };

  const exportFile = () => {
    const file = listFile({ name: name.trim() || 'word-list', words: parsed.words });
    saveFile(file.blob, file.name);
  };

  const noGames = games.length > 0 && chosen.length === 0;
  const invalid =
    !name.trim() ||
    parsed.words.length > MAX_WORDS_PER_LIST ||
    parsed.tooLong.length > 0 ||
    noGames;

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onClose}
        className="text-sm text-amber-700 hover:underline dark:text-amber-400"
      >
        ← Back to lists
      </button>
      <Panel className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-semibold">Name</span>
            <input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
            />
          </label>
          <label className="block">
            <span className="text-sm font-semibold">Description (optional)</span>
            <input
              value={description}
              maxLength={200}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 h-11 w-full rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
            />
          </label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={switchId} checked={enabled} onChange={setEnabled} />
          <label htmlFor={switchId} className="cursor-pointer">
            <span className="block text-sm font-semibold">Enabled</span>
            <span className="block text-xs text-stone-500">
              {enabled
                ? 'Hosts can pick this list.'
                : 'Hidden from hosts and rooms until switched back on.'}{' '}
              Saved with the list.
            </span>
          </label>
        </div>
        {games.length > 0 && (
          <fieldset>
            <legend className="text-sm font-semibold">Used by</legend>
            <div className="mt-1 flex flex-wrap gap-2">
              {games.map((g) => (
                <label
                  key={g.id}
                  className="flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
                >
                  <input
                    type="checkbox"
                    checked={chosen.includes(g.id)}
                    onChange={() => toggle(g.id)}
                    className="size-4 accent-amber-600"
                  />
                  {g.name}
                </label>
              ))}
            </div>
            {noGames && <p className="mt-1 text-sm text-rose-600">Pick at least one game.</p>}
          </fieldset>
        )}
        <label className="block">
          <span className="text-sm font-semibold">Words</span>
          <span className="block text-xs text-stone-500">
            One per line (commas work too). Paste as many as you like; duplicates are removed
            automatically.
          </span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={16}
            spellCheck={false}
            className="mt-1 w-full rounded-lg bg-white p-3 font-mono text-sm ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
        </label>
        <p className="text-sm">
          <b>{parsed.words.length}</b> unique words
          {parsed.duplicates > 0 && (
            <span className="text-stone-500">
              {' '}
              · {parsed.duplicates} duplicates will be dropped
            </span>
          )}
          {parsed.words.length < 25 && (
            <span className="text-amber-700 dark:text-amber-400">
              {' '}
              · fewer than 25, so mix it with another list
            </span>
          )}
          {parsed.tooLong.length > 0 && (
            <span className="text-rose-600">
              {' '}
              · too long (max 40 characters): {parsed.tooLong.slice(0, 3).join(', ')}
            </span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={invalid || saving}>
            {saving ? 'Saving…' : 'Save list'}
          </Button>
          <Button variant="secondary" onClick={() => fileInput.current?.click()}>
            Import .txt
          </Button>
          <Button variant="secondary" onClick={exportFile} disabled={parsed.words.length === 0}>
            Export .txt
          </Button>
          {list && (
            <Button variant="danger" className="ml-auto" onClick={() => void remove()}>
              Delete list
            </Button>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".txt,.csv,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void importFile(file);
              e.target.value = '';
            }}
          />
        </div>
      </Panel>
    </div>
  );
}
