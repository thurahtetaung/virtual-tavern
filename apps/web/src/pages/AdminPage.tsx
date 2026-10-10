import type { WordListDetail, WordListSummary } from '@vt/protocol';
import { MAX_WORDS_PER_LIST } from '@vt/protocol';
import { Button, Panel, cn } from '@vt/ui';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Layout } from '../components/Layout.tsx';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

export function AdminPage() {
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
        <WordLists onSignOut={refresh} />
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

function WordLists({ onSignOut }: { onSignOut: () => void }) {
  const toast = useToast();
  const [lists, setLists] = useState<WordListSummary[]>([]);
  const [editing, setEditing] = useState<WordListDetail | 'new' | null>(null);

  const load = useCallback(
    () =>
      void api<WordListSummary[]>('/api/admin/word-lists')
        .then(setLists)
        .catch((e: Error) => toast(e.message)),
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

  if (editing) {
    return (
      <Editor
        list={editing === 'new' ? null : editing}
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
        <div className="flex gap-2">
          <Button onClick={() => setEditing('new')}>+ New list</Button>
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
        the chosen lists.
      </p>
      <ul className="space-y-2">
        {lists.map((l) => (
          <li key={l.id}>
            <button
              type="button"
              onClick={() => void open(l.id)}
              className="block w-full text-left"
            >
              <Panel className="flex items-center justify-between gap-2 transition hover:ring-amber-400">
                <span>
                  <span className="font-bold">{l.name}</span>
                  {l.description && (
                    <span className="block text-sm text-stone-500">{l.description}</span>
                  )}
                </span>
                <span
                  className={cn(
                    'text-sm',
                    l.wordCount < 25 ? 'font-semibold text-rose-600' : 'text-stone-500',
                  )}
                >
                  {l.wordCount} words
                </span>
              </Panel>
            </button>
          </li>
        ))}
        {lists.length === 0 && <li className="text-stone-500 italic">No lists yet.</li>}
      </ul>
    </div>
  );
}

function Editor({ list, onClose }: { list: WordListDetail | null; onClose: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(list?.name ?? '');
  const [description, setDescription] = useState(list?.description ?? '');
  const [text, setText] = useState(list?.words.join('\n') ?? '');
  const [saving, setSaving] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseWords(text), [text]);

  const save = async () => {
    setSaving(true);
    try {
      const body = { name, description, words: parsed.words };
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
    const blob = new Blob([parsed.words.join('\n') + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name.trim() || 'word-list'}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const invalid =
    !name.trim() || parsed.words.length > MAX_WORDS_PER_LIST || parsed.tooLong.length > 0;

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
