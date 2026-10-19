import type {
  AdminGame,
  AdminGameMusic,
  AdminGamesResponse,
  GameCategoryDef,
  GameSettingsBody,
  MusicMap,
  MusicPhase,
} from '@vt/protocol';
import { MAX_CATEGORY_NAME } from '@vt/protocol';
import { Button, cn } from '@vt/ui';
import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { findGame, usePrivateGames } from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { AdminSection } from './AdminSection.tsx';
import { AdminSwitch } from './AdminSwitch.tsx';

const FIELD =
  'h-11 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

const plural = (n: number, noun: string, many = `${noun}s`) => `${n} ${n === 1 ? noun : many}`;

type Change = (method: 'POST' | 'PUT' | 'DELETE', url: string, body?: object) => Promise<boolean>;

/**
 * The Games page: the category list, then one card per game with the settings that apply to it
 * (on/off and categories for every game, a title for back-room games, music for games with music).
 * Every change saves at once and answers with the whole page.
 */
export function GamesAdmin() {
  const toast = useToast();
  const [data, setData] = useState<AdminGamesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  // The back room's games, for their icons (the admin always has the back room).
  const privateGames = usePrivateGames(true);
  useEffect(() => {
    void api<AdminGamesResponse>('/api/admin/games')
      .then(setData)
      .catch((e: Error) => toast(e.message));
  }, [toast]);

  const change: Change = async (method, url, body) => {
    setBusy(true);
    try {
      setData(await api<AdminGamesResponse>(url, { method, body }));
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <p className="text-ink-muted">Loading…</p>;
  const { categories, games } = data;
  const off = games.filter((g) => !g.settings.enabled).length;
  return (
    <div className="space-y-6">
      <CategoryEditor categories={categories} games={games} busy={busy} change={change} />
      <section aria-labelledby="games-heading" className="space-y-3">
        <div>
          <h2 id="games-heading" className="text-xl font-bold">
            Games
          </h2>
          <p className="text-sm text-ink-muted">
            {plural(games.length, 'game')}
            {off ? `, ${off} off` : ', all on'}. A game that is off leaves the game lists and opens
            no new rooms; rooms already open finish their game, and you can still playtest it.
          </p>
        </div>
        <ul className="grid gap-3 lg:grid-cols-2">
          {games.map((g) => (
            <GameSettingsCard
              key={g.gameId}
              game={g}
              icon={
                findGame(g.gameId)?.icon ??
                privateGames.find((p) => p.id === g.gameId)?.icon ??
                '🎲'
              }
              categories={categories}
              busy={busy}
              save={(body: GameSettingsBody) =>
                change('PUT', `/api/admin/games/${encodeURIComponent(g.gameId)}`, body)
              }
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function GameSettingsCard({
  game,
  icon,
  categories,
  busy,
  save,
}: {
  game: AdminGame;
  icon: string;
  categories: readonly GameCategoryDef[];
  busy: boolean;
  save: (body: GameSettingsBody) => Promise<boolean>;
}) {
  const { settings } = game;
  const shown = settings.title || game.name;
  const id = `game-${game.gameId}`;
  const tick = (category: string) =>
    void save({
      categories: settings.categories.includes(category)
        ? settings.categories.filter((c) => c !== category)
        : [...settings.categories, category],
    });
  return (
    <li
      aria-labelledby={id}
      data-testid={`game-card-${game.gameId}`}
      className={cn(
        'space-y-3 rounded-2xl bg-card/85 p-4 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        !settings.enabled && 'opacity-80',
      )}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl" aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className="font-bold">
            {shown}
          </h3>
          <p className="text-xs text-ink-muted">
            {game.private ? 'Back room' : 'Front room'}
            {settings.title && ` · code name ${game.name}`}
            {' · '}
            <span
              className={cn(!settings.enabled && 'font-semibold text-warn-ink dark:text-amber-300')}
            >
              {settings.enabled ? 'On' : 'Off: hidden, no new rooms'}
            </span>
          </p>
        </div>
        <AdminSwitch
          checked={settings.enabled}
          busy={busy}
          aria-label={`${shown} on`}
          onChange={(on) => void save({ enabled: on })}
        />
      </div>

      {settings.title !== undefined && (
        <TitleField
          key={settings.title ?? ''}
          gameId={game.gameId}
          name={game.name}
          title={settings.title}
          busy={busy}
          save={(title) => save({ title })}
        />
      )}

      <div>
        <p className="text-sm font-semibold">Categories</p>
        {categories.length === 0 ? (
          <p className="text-sm text-ink-muted">Add a category above to tag games.</p>
        ) : (
          <div role="group" aria-labelledby={id} className="mt-1 flex flex-wrap gap-1.5">
            {categories.map((c) => {
              const on = settings.categories.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  aria-busy={busy || undefined}
                  onClick={() => {
                    if (!busy) tick(c.id);
                  }}
                  className={cn(
                    'inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm ring-1 transition',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
                    on
                      ? 'bg-accent font-semibold text-accent-fg ring-accent'
                      : 'bg-card text-ink-muted ring-line-strong hover:bg-accent-soft dark:hover:bg-stone-800',
                  )}
                >
                  <span aria-hidden>{on ? '✓' : c.emoji}</span>
                  {c.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {game.musicPhases && (
        <details className="group rounded-xl ring-1 ring-line dark:ring-stone-800">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden>🎵</span> Music
            <span className="font-normal text-ink-muted">
              {settings.music ? 'your own picks' : 'the default picks'}
            </span>
          </summary>
          <div className="space-y-3 px-3 pb-3">
            <MusicEditor gameId={game.gameId} phases={game.musicPhases} save={save} />
          </div>
        </details>
      )}
    </li>
  );
}

function TitleField({
  gameId,
  name,
  title,
  busy,
  save,
}: {
  gameId: string;
  name: string;
  title: string | null;
  busy: boolean;
  save: (title: string | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(title ?? '');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save(draft.trim() || null);
  };
  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
      <label htmlFor={`title-${gameId}`} className="w-full text-sm font-semibold">
        Title for unlocked players
      </label>
      <input
        id={`title-${gameId}`}
        value={draft}
        maxLength={80}
        placeholder={name}
        onChange={(e) => setDraft(e.target.value)}
        className={cn(FIELD, 'min-w-0 flex-1 basis-40')}
      />
      <Button
        type="submit"
        size="sm"
        className="min-h-11"
        aria-label={`Save the title of ${name}`}
        disabled={busy || draft.trim() === (title ?? '')}
      >
        Save
      </Button>
    </form>
  );
}

const clock = (s?: number) =>
  s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Which background tracks a game plays in each phase, with a preview player. The audio comes
 * through an admin route, so no back-room unlock is needed here.
 */
function MusicEditor({
  gameId,
  phases,
  save,
}: {
  gameId: string;
  phases: readonly MusicPhase[];
  save: (body: GameSettingsBody) => Promise<boolean>;
}) {
  const toast = useToast();
  const [info, setInfo] = useState<AdminGameMusic | null>(null);
  const [draft, setDraft] = useState<MusicMap>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.5);
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = useCallback(
    () =>
      void api<AdminGameMusic>(`/api/admin/games/${encodeURIComponent(gameId)}/music`)
        .then((r) => {
          setInfo(r);
          setDraft(r.effective ?? {});
        })
        .catch((e: Error) => toast(e.message)),
    [gameId, toast],
  );
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (audio.current) audio.current.volume = volume;
  }, [volume]);
  useEffect(() => {
    return () => {
      audio.current?.pause();
    };
  }, []);

  const preview = (file: string) => {
    audio.current?.pause();
    if (playing === file) {
      setPlaying(null);
      return;
    }
    const el = new Audio(`/api/admin/backroom-assets/${gameId}/${file}`);
    el.volume = volume;
    el.loop = true;
    audio.current = el;
    setPlaying(file);
    void el.play().catch(() => setPlaying(null));
  };
  const toggle = (phase: string, file: string) =>
    setDraft((d) => {
      const list = d[phase] ?? [];
      return {
        ...d,
        [phase]: list.includes(file) ? list.filter((f) => f !== file) : [...list, file],
      };
    });
  const put = async (music: MusicMap | null) => {
    if (await save({ music })) {
      toast(
        music ? 'Music saved. Rooms pick it up at their next phase.' : 'Back to the defaults.',
        'info',
      );
      load();
    }
  };

  const tracks = info?.tracks ? Object.values(info.tracks) : null;
  if (!info) return <p className="text-sm text-ink-muted">Loading…</p>;
  if (!tracks?.length)
    return (
      <p className="text-sm text-ink-muted italic">
        No tracks uploaded yet. Upload the game’s assets to choose music.
      </p>
    );
  return (
    <>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        The background tracks each phase plays, on the devices that narrate. Each game moves on to
        the next track in a phase’s list.
      </p>
      <label className="flex items-center gap-2 text-sm">
        Preview volume
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(volume * 100)}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
        />
      </label>
      <ul className="flex flex-wrap gap-1.5" aria-label="Tracks">
        {tracks.map((t) => (
          <li key={t.file}>
            <button
              type="button"
              onClick={() => preview(t.file)}
              aria-pressed={playing === t.file}
              className={cn(
                'inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm ring-1 ring-stone-300 dark:ring-stone-700',
                playing === t.file &&
                  'bg-accent text-accent-fg ring-accent dark:bg-amber-500 dark:text-stone-950',
              )}
            >
              {playing === t.file ? '■' : '▶'} {t.name ?? t.file}{' '}
              <span className="text-xs opacity-70">{clock(t.duration)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="space-y-3">
        {phases.map((phase) => (
          <fieldset key={phase.id} className="space-y-1">
            <legend className="text-sm font-semibold">{phase.label}</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {tracks.map((t) => (
                <label key={t.file} className="flex min-h-11 items-center gap-1 text-sm">
                  <input
                    type="checkbox"
                    checked={draft[phase.id]?.includes(t.file) ?? false}
                    onChange={() => toggle(phase.id, t.file)}
                  />
                  {t.name ?? t.file}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void put(draft)}>Save music</Button>
        <Button variant="secondary" onClick={() => void put(null)}>
          Reset to defaults
        </Button>
      </div>
    </>
  );
}

/** The category list: add, rename, re-emoji, order and delete. */
function CategoryEditor({
  categories,
  games,
  busy,
  change,
}: {
  categories: readonly GameCategoryDef[];
  games: readonly AdminGame[];
  busy: boolean;
  change: Change;
}) {
  const tagged = games.filter((g) => g.settings.categories.length).length;
  const move = (index: number, by: number) => {
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    void change('PUT', '/api/admin/games/categories/order', { ids });
  };
  return (
    <AdminSection
      id="categories"
      title="🗂️ Categories"
      label="Categories"
      summary={
        categories.length
          ? `${plural(categories.length, 'category', 'categories')}, ${plural(tagged, 'game')} tagged`
          : 'No categories yet'
      }
    >
      <p className="text-sm text-stone-600 dark:text-stone-400">
        The filter chips above the game lists. A list only shows the chips its games have, and the
        front room never shows a category only back-room games use.
      </p>
      {categories.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="no-categories">
          No categories yet. Add one below.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Categories">
          {categories.map((c, i) => (
            <CategoryRow
              key={`${c.id}:${c.name}:${c.emoji}`}
              category={c}
              busy={busy}
              first={i === 0}
              last={i === categories.length - 1}
              onSave={(body) =>
                change('PUT', `/api/admin/games/categories/${encodeURIComponent(c.id)}`, body)
              }
              onMove={(by) => move(i, by)}
              onDelete={() => {
                const used = games.filter((g) => g.settings.categories.includes(c.id)).length;
                if (
                  window.confirm(
                    `Delete "${c.name}"?${used ? ` It comes off ${plural(used, 'game')}.` : ''}`,
                  )
                )
                  void change('DELETE', `/api/admin/games/categories/${encodeURIComponent(c.id)}`);
              }}
            />
          ))}
        </ul>
      )}
      <AddCategory
        busy={busy}
        onAdd={(body) => change('POST', '/api/admin/games/categories', body)}
      />
    </AdminSection>
  );
}

function CategoryRow({
  category,
  busy,
  first,
  last,
  onSave,
  onMove,
  onDelete,
}: {
  category: GameCategoryDef;
  busy: boolean;
  first: boolean;
  last: boolean;
  onSave: (body: { name: string; emoji: string }) => Promise<boolean>;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState(category.emoji);
  const changed = name.trim() !== category.name || emoji.trim() !== category.emoji;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (changed) void onSave({ name, emoji });
  };
  return (
    <li>
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`${category.name} emoji`}
          value={emoji}
          maxLength={16}
          onChange={(e) => setEmoji(e.target.value)}
          className={cn(FIELD, 'w-14 text-center text-lg')}
        />
        <input
          aria-label={`${category.name} name`}
          value={name}
          maxLength={MAX_CATEGORY_NAME}
          onChange={(e) => setName(e.target.value)}
          className={cn(FIELD, 'min-w-0 flex-1 basis-24')}
        />
        <span className="flex gap-1">
          {changed && (
            <Button
              type="submit"
              size="sm"
              className="min-h-11"
              aria-label={`Save ${category.name}`}
              disabled={busy}
            >
              Save
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Move ${category.name} up`}
            disabled={first || busy}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Move ${category.name} down`}
            disabled={last || busy}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Delete ${category.name}`}
            disabled={busy}
            onClick={onDelete}
          >
            ✕
          </Button>
        </span>
      </form>
    </li>
  );
}

function AddCategory({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (body: { name: string; emoji: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await onAdd({ name, emoji })) {
      setName('');
      setEmoji('');
    }
  };
  return (
    <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2 pt-1">
      <input
        aria-label="New category emoji"
        placeholder="🎲"
        value={emoji}
        maxLength={16}
        onChange={(e) => setEmoji(e.target.value)}
        className={cn(FIELD, 'w-14 text-center text-lg')}
      />
      <input
        aria-label="New category name"
        placeholder="New category"
        value={name}
        maxLength={MAX_CATEGORY_NAME}
        onChange={(e) => setName(e.target.value)}
        className={cn(FIELD, 'min-w-0 flex-1 basis-32')}
      />
      <Button
        type="submit"
        size="sm"
        className="min-h-11"
        disabled={!name.trim() || !emoji.trim() || busy}
      >
        Add
      </Button>
    </form>
  );
}
