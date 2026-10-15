import { Button, cn } from '@vt/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { AdminSection } from './AdminSection.tsx';

interface TitleRow {
  gameId: string;
  name: string;
  title: string | null;
}

/** The titles back-room games show to unlocked players (the code only knows code names). */
export function GameTitlesAdmin() {
  const toast = useToast();
  const [rows, setRows] = useState<TitleRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  useEffect(() => {
    void api<TitleRow[]>('/api/admin/game-titles')
      .then((r) => {
        setRows(r);
        setDrafts(Object.fromEntries(r.map((x) => [x.gameId, x.title ?? ''])));
      })
      .catch((e: Error) => toast(e.message));
  }, [toast]);
  const save = async (gameId: string) => {
    try {
      const res = await api<{ title: string | null }>(`/api/admin/game-titles/${gameId}`, {
        method: 'PUT',
        body: { title: drafts[gameId]?.trim() || null },
      });
      setRows(
        (cur) => cur?.map((r) => (r.gameId === gameId ? { ...r, title: res.title } : r)) ?? null,
      );
      toast(res.title ? 'Title saved.' : 'Title cleared.', 'info');
    } catch (err) {
      toast((err as Error).message);
    }
  };
  if (!rows?.length) return null;
  return (
    <AdminSection
      id="game-titles"
      title="🏷️ Back-room titles"
      label="Back-room titles"
      summary={`${plural(rows.length, 'game')}, ${rows.filter((r) => r.title).length} with a title`}
    >
      <p className="text-sm text-stone-600 dark:text-stone-400">
        The name each back-room game shows to unlocked players. Leave it empty to use the code name.
      </p>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.gameId} className="flex flex-col gap-1 sm:flex-row sm:items-center">
            <label htmlFor={`title-${r.gameId}`} className="w-48 text-sm font-semibold">
              {r.name}
            </label>
            <input
              id={`title-${r.gameId}`}
              value={drafts[r.gameId] ?? ''}
              maxLength={80}
              placeholder={r.name}
              onChange={(e) => setDrafts((d) => ({ ...d, [r.gameId]: e.target.value }))}
              className="h-10 flex-1 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
            />
            <Button
              size="sm"
              disabled={(drafts[r.gameId] ?? '').trim() === (r.title ?? '')}
              onClick={() => void save(r.gameId)}
            >
              Save
            </Button>
          </li>
        ))}
      </ul>
    </AdminSection>
  );
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

const PHASES = ['lobby', 'night', 'day', 'vote', 'reveal'] as const;
type MusicPhase = (typeof PHASES)[number];
type MusicMap = Partial<Record<MusicPhase, string[]>>;
const PHASE_LABEL: Record<MusicPhase, string> = {
  lobby: 'Lobby and getting ready',
  night: 'Night',
  day: 'Day',
  vote: 'Vote',
  reveal: 'Reveal',
};

interface MusicInfo {
  override: MusicMap | null;
  defaults: MusicMap | null;
  effective: MusicMap | null;
  tracks: Record<string, { name?: string; file: string; duration?: number }> | null;
}

const clock = (s?: number) =>
  s === undefined ? '' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/**
 * Which background tracks Nightfall plays in each phase, with a preview player. The audio comes
 * through an admin route, so no back-room unlock is needed here.
 */
export function NightfallMusicAdmin() {
  const toast = useToast();
  const [info, setInfo] = useState<MusicInfo | null>(null);
  const [draft, setDraft] = useState<MusicMap>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.5);
  const audio = useRef<HTMLAudioElement | null>(null);
  const load = useCallback(
    () =>
      void api<MusicInfo>('/api/admin/game-music/nightfall')
        .then((r) => {
          setInfo(r);
          setDraft(r.effective ?? {});
        })
        .catch((e: Error) => toast(e.message)),
    [toast],
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
    const el = new Audio(`/api/admin/backroom-assets/nightfall/${file}`);
    el.volume = volume;
    el.loop = true;
    audio.current = el;
    setPlaying(file);
    void el.play().catch(() => setPlaying(null));
  };
  const toggle = (phase: MusicPhase, file: string) =>
    setDraft((d) => {
      const list = d[phase] ?? [];
      return {
        ...d,
        [phase]: list.includes(file) ? list.filter((f) => f !== file) : [...list, file],
      };
    });
  const put = async (music: MusicMap | null) => {
    try {
      await api('/api/admin/game-music/nightfall', { method: 'PUT', body: { music } });
      toast(
        music ? 'Music saved. Rooms pick it up at their next phase.' : 'Back to the defaults.',
        'info',
      );
      load();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const tracks = info?.tracks ? Object.values(info.tracks) : null;
  return (
    <AdminSection
      id="nightfall-music"
      title="🎵 Nightfall music"
      label="Nightfall music"
      summary={
        !info
          ? ''
          : !tracks?.length
            ? 'No tracks uploaded yet'
            : `${plural(tracks.length, 'track')}, ${info.override ? 'your own picks' : 'the default picks'}`
      }
    >
      <p className="text-sm text-stone-600 dark:text-stone-400">
        The background tracks each phase plays, on the devices that narrate. Each game moves on to
        the next track in a phase’s list.
      </p>
      {!info ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : !tracks?.length ? (
        <p className="text-sm text-ink-muted italic">
          Upload the Nightfall assets to choose music.
        </p>
      ) : (
        <>
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
                    'inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm ring-1 ring-stone-300 dark:ring-stone-700',
                    playing === t.file &&
                      'bg-accent dark:bg-amber-500 text-accent-fg dark:text-stone-950 ring-accent',
                  )}
                >
                  {playing === t.file ? '■' : '▶'} {t.name ?? t.file}{' '}
                  <span className="text-xs opacity-70">{clock(t.duration)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="space-y-3">
            {PHASES.map((phase) => (
              <fieldset key={phase} className="space-y-1">
                <legend className="text-sm font-semibold">{PHASE_LABEL[phase]}</legend>
                <div className="flex flex-wrap gap-x-3 gap-y-1">
                  {tracks.map((t) => (
                    <label key={t.file} className="flex items-center gap-1 text-sm">
                      <input
                        type="checkbox"
                        checked={draft[phase]?.includes(t.file) ?? false}
                        onChange={() => toggle(phase, t.file)}
                      />
                      {t.name ?? t.file}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void put(draft)}>Save</Button>
            <Button variant="secondary" onClick={() => void put(null)}>
              Reset to defaults
            </Button>
          </div>
        </>
      )}
    </AdminSection>
  );
}
