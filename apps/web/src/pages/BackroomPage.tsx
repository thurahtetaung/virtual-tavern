import { Button, cn } from '@vt/ui';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import type { GameSummary } from '@vt/protocol';
import { CategoryFilter, NoGamesMatch } from '../components/CategoryFilter.tsx';
import { GameCard } from '../components/GameCard.tsx';
import { RoomOpening } from '../components/Layout.tsx';
import { type ClientGame, loadPrivateGames, offeredPrivateGames } from '../games/registry.ts';
import { ApiFailure, api } from '../lib/api.ts';
import { doorOf, lockedLine, useBackroom } from '../lib/backroom.ts';
import { chipsOf, shows, useCategoryFilter } from '../lib/categories.ts';
import { saveName, savedName } from '../lib/identity.ts';
import { usePageTitle } from '../lib/title.ts';
import { useToast } from '../lib/toast.tsx';
import { useCreateRoom } from '../lib/useCreateRoom.ts';
import { fetchGames } from '../lib/games.ts';

/** The private games this server actually offers, with their UIs (loaded only once unlocked). */
function usePrivateGames(unlocked: boolean) {
  const [games, setGames] = useState<{ ui: ClientGame[]; offered: GameSummary[] } | null>(null);
  useEffect(() => {
    if (!unlocked) return;
    void Promise.all([fetchGames(), loadPrivateGames()]).then(([offered, ui]) =>
      setGames({ ui: offeredPrivateGames(offered, ui), offered: offered.filter((g) => g.private) }),
    );
  }, [unlocked]);
  return games;
}

function Lobby({ onLock, admin = false }: { onLock: () => void; admin?: boolean }) {
  const loaded = usePrivateGames(true);
  const chips = useMemo(() => chipsOf(loaded?.offered ?? []), [loaded]);
  const filter = useCategoryFilter('vt.categories.backroom', chips);
  const games = loaded?.ui.filter((g) => {
    const summary = loaded.offered.find((s) => s.id === g.id);
    return !summary?.off && shows(filter.chosen, summary?.categories ?? []);
  });
  const [name, setName] = useState(savedName);
  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('backroom-name')?.focus(),
  );
  return (
    <div className="w-full max-w-3xl space-y-6">
      {creating && <RoomOpening />}
      <header className="space-y-1 text-center">
        <p className="text-5xl" aria-hidden>
          🕯️
        </p>
        <h1 className="font-serif text-4xl font-bold tracking-wide">The Back Room</h1>
        <p className="text-ink-muted dark:text-amber-200/70">
          You're on the list. Pull up a chair.
        </p>
      </header>
      <label className="mx-auto block max-w-sm">
        <span className="text-sm text-ink-muted dark:text-amber-200/70">Your name</span>
        <input
          id="backroom-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && saveName(name)}
          placeholder="What should we call you?"
          autoComplete="nickname"
          className="mt-1 h-11 w-full rounded-lg bg-card px-4 text-ink ring-1 ring-line-strong placeholder:text-ink-muted/60 focus:ring-accent dark:bg-stone-900 dark:text-amber-50 dark:ring-amber-900 dark:placeholder:text-amber-200/30 dark:focus:ring-amber-500"
        />
      </label>
      <CategoryFilter
        chips={chips}
        chosen={filter.chosen}
        onToggle={filter.toggle}
        onClear={filter.clear}
        backroom
      />
      <section aria-label="Back room games" className="grid gap-4 sm:grid-cols-2">
        {games?.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            creating={creating}
            onCreate={(id) => void create(id)}
            backroom
          />
        ))}
        {games?.length === 0 && filter.chosen.length > 0 && (
          <NoGamesMatch onClear={filter.clear} backroom />
        )}
        {loaded && !loaded.offered.some((g) => !g.off) && (
          <p className="col-span-full rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-muted italic dark:border-amber-900/60 dark:text-amber-200/60">
            Nothing back here yet… The tables are still being set.
          </p>
        )}
        {!games && (
          <p className="col-span-full text-center text-ink-muted dark:text-amber-200/50">…</p>
        )}
      </section>
      <div className="flex flex-col items-center gap-2">
        {admin ? (
          <p className="text-sm text-ink-muted dark:text-amber-200/60" data-testid="admin-key">
            You're signed in as the admin, so the door is always open to you.
          </p>
        ) : (
          <button
            type="button"
            onClick={onLock}
            className="min-h-11 rounded-lg px-3 py-1.5 text-sm font-semibold text-ink-muted transition hover:bg-accent-soft hover:text-accent-text dark:text-amber-200/60 dark:hover:bg-amber-950 dark:hover:text-amber-200"
          >
            Lock the door on this device
          </button>
        )}
        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-accent-text dark:text-amber-200/50 dark:hover:text-amber-200"
        >
          ← Back to the tavern
        </Link>
      </div>
    </div>
  );
}

/**
 * Candlelight in the dark theme; a warm, dim parlour in the light one (the site's warm tokens, with
 * a stronger glow than the front room).
 */
const BACKROOM = 'bg-page text-ink dark:bg-stone-950 dark:text-amber-100';

/** Only allow returning to pages on this site. */
const safeNext = (next: string | null) => (next && /^\/[\w/-]*$/.test(next) ? next : null);

export function BackroomPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  // Sent back from a room: the word changed (a new password, or everyone signed out), or the
  // admin session it was open to ended.
  const locked = lockedLine(params);
  const { status, refresh } = useBackroom();
  const [word, setWord] = useState('');
  // Why the last knock failed, shown under the field until the next keystroke.
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // Seconds until the bouncer listens again, after too many wrong words.
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);
  usePageTitle('The Back Room');

  const knock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/backroom/unlock', { method: 'POST', body: { password: word } });
      // Came from a room link? Go straight back. Otherwise stay and show the back room.
      if (next) void navigate(next);
      else void refresh();
    } catch (err) {
      // Shown under the field only: a toast would say it twice.
      setRefusal((err as Error).message);
      if (err instanceof ApiFailure && err.retryAfter) setWait(err.retryAfter);
      // Keep the word, selected, so a typo can be fixed and a wrong word typed over.
      input.current?.focus();
      input.current?.select();
    }
    setBusy(false);
  };

  const lock = async () => {
    try {
      await api('/api/backroom/lock', { method: 'POST' });
      toast('The door clicks shut behind you.', 'info');
      void refresh();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const door = doorOf(status);
  if (door === 'member' || door === 'admin') {
    return (
      <div
        className={cn(
          'flex min-h-dvh justify-center px-4 py-10',
          BACKROOM,
          '[background-image:radial-gradient(ellipse_at_top,rgb(180_110_40/0.2),transparent_65%)] dark:[background-image:radial-gradient(ellipse_at_top,rgb(120_53_15/0.35),transparent_65%)]',
        )}
      >
        <Lobby onLock={() => void lock()} admin={door === 'admin'} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col items-center justify-center p-4',
        BACKROOM,
        '[background-image:radial-gradient(ellipse_at_center,rgb(180_110_40/0.2),transparent_65%)] dark:[background-image:radial-gradient(ellipse_at_center,rgb(120_53_15/0.35),transparent_65%)]',
      )}
    >
      <div className="w-full max-w-sm space-y-6 text-center">
        <p className="text-6xl" aria-hidden>
          🕯️
        </p>
        <h1 className="font-serif text-4xl font-bold tracking-wide">The Back Room</h1>
        {!status ? (
          <p className="text-ink-muted dark:text-amber-200/60">…</p>
        ) : !status.open ? (
          <p className="text-ink-muted dark:text-amber-200/70">
            The door is locked and nobody answers. Try again another night.
          </p>
        ) : status.unlocked ? null : (
          <form onSubmit={(e) => void knock(e)} className="space-y-3">
            {locked && (
              <p role="status" className="text-accent-text dark:text-amber-200">
                {locked}
              </p>
            )}
            {next && (
              <p className="text-ink-muted dark:text-amber-200/70" data-testid="invite-note">
                Your friend's table is through this door. They know the word: ask them for it, then
                knock and you'll go straight to their game.
              </p>
            )}
            <p className="text-ink-muted dark:text-amber-200/80">Members only. What's the word?</p>
            <label className="sr-only" htmlFor="backroom-word">
              The word
            </label>
            <input
              id="backroom-word"
              ref={input}
              type="password"
              autoFocus
              autoComplete="current-password"
              value={word}
              onChange={(e) => {
                setWord(e.target.value);
                setRefusal(null);
              }}
              aria-invalid={refusal !== null}
              aria-describedby={refusal ? 'backroom-refusal' : undefined}
              className="h-12 w-full rounded-lg bg-card px-4 text-center text-lg tracking-widest text-ink ring-1 ring-line-strong placeholder:text-ink-muted/60 focus:ring-accent dark:bg-stone-900 dark:text-amber-50 dark:ring-amber-900 dark:placeholder:text-amber-200/30 dark:focus:ring-amber-500"
              placeholder="psst…"
            />
            {refusal && (
              <p
                id="backroom-refusal"
                role="alert"
                className="text-sm font-semibold text-danger-ink dark:text-rose-300"
              >
                {refusal}
              </p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={!word || busy || wait > 0}>
              {wait > 0 ? `Knock again in ${wait} s` : 'Knock'}
            </Button>
          </form>
        )}
        <Link
          to="/"
          className="inline-flex min-h-11 items-center text-sm text-ink-muted hover:text-accent-text dark:text-amber-200/50 dark:hover:text-amber-200"
        >
          ← Back to the tavern
        </Link>
      </div>
    </div>
  );
}
