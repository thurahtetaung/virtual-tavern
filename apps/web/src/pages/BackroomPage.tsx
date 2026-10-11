import type { GameSummary } from '@vt/protocol';
import { Button } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { GameCard } from '../components/GameCard.tsx';
import { type ClientGame, loadPrivateGames, offeredPrivateGames } from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { useBackroom } from '../lib/backroom.ts';
import { saveName, savedName } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';
import { useCreateRoom } from '../lib/useCreateRoom.ts';

/** The private games this server actually offers, with their UIs (loaded only once unlocked). */
function usePrivateGames(unlocked: boolean) {
  const [games, setGames] = useState<ClientGame[] | null>(null);
  useEffect(() => {
    if (!unlocked) return;
    void Promise.all([api<GameSummary[]>('/api/games'), loadPrivateGames()]).then(([offered, ui]) =>
      setGames(offeredPrivateGames(offered, ui)),
    );
  }, [unlocked]);
  return games;
}

function Lobby({ onLock }: { onLock: () => void }) {
  const games = usePrivateGames(true);
  const [name, setName] = useState(savedName);
  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('backroom-name')?.focus(),
  );
  return (
    <div className="w-full max-w-3xl space-y-6">
      <header className="space-y-1 text-center">
        <p className="text-5xl" aria-hidden>
          🕯️
        </p>
        <h1 className="font-serif text-4xl font-bold tracking-wide">The Back Room</h1>
        <p className="text-amber-200/70">You're on the list. Pull up a chair.</p>
      </header>
      <label className="mx-auto block max-w-sm">
        <span className="text-sm text-amber-200/70">Your name</span>
        <input
          id="backroom-name"
          value={name}
          maxLength={24}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && saveName(name)}
          placeholder="What should we call you?"
          autoComplete="nickname"
          className="mt-1 h-11 w-full rounded-lg bg-stone-900 px-4 text-amber-50 ring-1 ring-amber-900 placeholder:text-amber-200/30 focus:ring-amber-500"
        />
      </label>
      <section aria-label="Back room games" className="grid gap-4 sm:grid-cols-2">
        {games?.map((game) => (
          <GameCard
            key={game.id}
            game={game}
            creating={creating}
            onCreate={(id) => void create(id)}
            dark
          />
        ))}
        {games?.length === 0 && (
          <p className="col-span-full rounded-2xl border border-dashed border-amber-900/60 p-8 text-center text-amber-200/60 italic">
            Nothing back here yet… The tables are still being set.
          </p>
        )}
        {!games && <p className="col-span-full text-center text-amber-200/50">…</p>}
      </section>
      <div className="flex flex-col items-center gap-2">
        <button
          type="button"
          onClick={onLock}
          className="rounded-lg px-3 py-1.5 text-sm font-semibold text-amber-200/60 transition hover:bg-amber-950 hover:text-amber-200"
        >
          Lock the door on this device
        </button>
        <Link to="/" className="text-sm text-amber-200/50 hover:text-amber-200">
          ← Back to the tavern
        </Link>
      </div>
    </div>
  );
}

/** The back room is always dark, whatever the site theme: native controls should match. */
const BACKROOM_SCHEME = { colorScheme: 'dark' } as const;

/** Only allow returning to pages on this site. */
const safeNext = (next: string | null) => (next && /^\/[\w/-]*$/.test(next) ? next : null);

export function BackroomPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const { status, refresh } = useBackroom();
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);

  const knock = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/api/backroom/unlock', { method: 'POST', body: { password: word } });
      // Came from a room link? Go straight back. Otherwise stay and show the back room.
      if (next) void navigate(next);
      else void refresh();
    } catch (err) {
      toast((err as Error).message);
      setWord('');
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

  if (status?.unlocked) {
    return (
      <div
        className="flex min-h-dvh justify-center bg-stone-950 px-4 py-10 text-amber-100 [background-image:radial-gradient(ellipse_at_top,rgb(120_53_15/0.35),transparent_65%)]"
        style={BACKROOM_SCHEME}
      >
        <Lobby onLock={() => void lock()} />
      </div>
    );
  }

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center bg-stone-950 p-4 text-amber-100 [background-image:radial-gradient(ellipse_at_center,rgb(120_53_15/0.35),transparent_65%)]"
      style={BACKROOM_SCHEME}
    >
      <div className="w-full max-w-sm space-y-6 text-center">
        <p className="text-6xl" aria-hidden>
          🕯️
        </p>
        <h1 className="font-serif text-4xl font-bold tracking-wide">The Back Room</h1>
        {!status ? (
          <p className="text-amber-200/60">…</p>
        ) : !status.open ? (
          <p className="text-amber-200/70">
            The door is locked and nobody answers. Try again another night.
          </p>
        ) : status.unlocked ? null : (
          <form onSubmit={(e) => void knock(e)} className="space-y-3">
            {next && (
              <p className="text-amber-200/70" data-testid="invite-note">
                Your friend's table is through this door. They know the word: ask them for it, then
                knock and you'll go straight to their game.
              </p>
            )}
            <p className="text-amber-200/80">Members only. What's the word?</p>
            <label className="sr-only" htmlFor="backroom-word">
              The word
            </label>
            <input
              id="backroom-word"
              type="password"
              autoFocus
              autoComplete="current-password"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              className="h-12 w-full rounded-lg bg-stone-900 px-4 text-center text-lg tracking-widest text-amber-50 ring-1 ring-amber-900 placeholder:text-amber-200/30 focus:ring-amber-500"
              placeholder="psst…"
            />
            <Button type="submit" size="lg" className="w-full" disabled={!word || busy}>
              Knock
            </Button>
          </form>
        )}
        <Link to="/" className="inline-block text-sm text-amber-200/50 hover:text-amber-200">
          ← Back to the tavern
        </Link>
      </div>
    </div>
  );
}
