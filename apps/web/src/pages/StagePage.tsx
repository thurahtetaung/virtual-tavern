import { STAGE_CODE_LENGTH, type StagePaired } from '@vt/protocol';
import { Button } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ApiFailure, api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';
import { startShow } from '../stage/start.ts';

/**
 * `/stage`: a TV or laptop becomes a room's table screen. The host's phone shows a code; typed
 * here it pairs this screen with that room, and the big start button (which also unlocks sound)
 * opens the show.
 */
export function StagePage() {
  usePageTitle('Table screen');
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The room this screen is paired with (just now, or before a reload). */
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api<StagePaired>('/api/stage')
      .then((p) => {
        if (!stale) setRoomId(p.roomId);
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);

  const pair = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = await api<StagePaired>('/api/stage/pair', { method: 'POST', body: { code } });
      setRoomId(p.roomId);
    } catch (err) {
      setError(
        err instanceof ApiFailure
          ? err.message
          : "We couldn't reach the tavern. Check the connection and try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-page p-4 text-ink dark:bg-stone-950 dark:text-stone-100">
      <div className="w-full max-w-xl space-y-6 text-center">
        <p className="text-7xl" aria-hidden>
          📺
        </p>
        <h1 className="text-3xl font-bold sm:text-4xl">Table screen</h1>
        {roomId ? (
          <>
            <p className="text-lg text-ink-muted dark:text-stone-400">
              This screen is paired with the room. Start the show when everyone can see it.
            </p>
            <Button
              size="lg"
              className="h-20 w-full text-2xl"
              autoFocus
              onClick={() => {
                startShow();
                void navigate(`/stage/${roomId}`);
              }}
            >
              ▶ Start the show
            </Button>
            <button
              type="button"
              className="text-sm text-amber-700 underline dark:text-amber-400"
              onClick={() => {
                setRoomId(null);
                setCode('');
              }}
            >
              Pair with another room
            </button>
          </>
        ) : (
          <form onSubmit={(e) => void pair(e)} className="space-y-4">
            <p className="text-lg text-ink-muted dark:text-stone-400">
              The host finds a code under 👥 Players → 📺 Table screen. Type it here.
            </p>
            <label className="block">
              <span className="sr-only">Pairing code</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                maxLength={STAGE_CODE_LENGTH + 2}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                autoFocus
                placeholder="ABC123"
                aria-invalid={error !== null}
                className="h-20 w-full rounded-xl border-2 border-line bg-card text-center font-mono text-5xl font-bold tracking-[0.3em] uppercase placeholder:text-stone-300 focus:border-accent focus:outline-none dark:focus:border-amber-500 dark:border-stone-700 dark:bg-stone-900 dark:placeholder:text-stone-700"
              />
            </label>
            {error && (
              <p role="alert" className="font-medium text-danger-ink dark:text-rose-300">
                {error}
              </p>
            )}
            <Button
              size="lg"
              type="submit"
              className="h-16 w-full text-xl"
              disabled={busy || code.replace(/[\s-]/g, '').length !== STAGE_CODE_LENGTH}
            >
              Pair this screen
            </Button>
          </form>
        )}
        <p className="text-sm text-ink-muted dark:text-stone-500">
          A table screen shows the room to everyone. It never plays, and the phones keep their own
          secrets.
        </p>
      </div>
    </main>
  );
}
