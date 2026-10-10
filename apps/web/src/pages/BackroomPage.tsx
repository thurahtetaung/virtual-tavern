import { Button } from '@vt/ui';
import { type FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api.ts';
import { useBackroom } from '../lib/backroom.ts';
import { useToast } from '../lib/toast.tsx';

/** Only allow returning to pages on this site. */
const safeNext = (next: string | null) => (next && /^\/[\w/-]*$/.test(next) ? next : '/');

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
      void navigate(next);
    } catch (err) {
      toast((err as Error).message);
      setWord('');
    }
    setBusy(false);
  };

  const lock = async () => {
    await api('/api/backroom/lock', { method: 'POST' });
    toast('The door clicks shut behind you.', 'info');
    void refresh();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-stone-950 p-4 text-amber-100 [background-image:radial-gradient(ellipse_at_center,rgb(120_53_15/0.35),transparent_65%)]">
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
        ) : status.unlocked ? (
          <div className="space-y-4">
            <p className="text-amber-200/80">You're on the list. Pull up a chair.</p>
            <div className="flex flex-col gap-2">
              <Button size="lg" onClick={() => void navigate(next)}>
                Go in
              </Button>
              <Button
                variant="ghost"
                className="text-amber-200/70 hover:bg-amber-950"
                onClick={() => void lock()}
              >
                Lock the door on this device
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void knock(e)} className="space-y-3">
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
