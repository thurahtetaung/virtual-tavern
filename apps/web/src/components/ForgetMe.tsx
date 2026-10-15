import { Button } from '@vt/ui';
import { useState } from 'react';
import { ApiFailure, api } from '../lib/api.ts';
import { forgetIdentity, playerToken } from '../lib/identity.ts';
import { useToast } from '../lib/toast.tsx';

const PHRASE = 'forget me';

/**
 * Deletes what the server keeps about this browser's player, then gives the browser a fresh
 * identity. Tucked away in a fold and guarded by a typed phrase, so nobody does it by accident.
 */
export function ForgetMe() {
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const ready = typed.trim().toLowerCase() === PHRASE && !busy;

  const forget = async () => {
    setBusy(true);
    try {
      await api('/api/me/forget', { method: 'POST', body: { token: playerToken() } });
      forgetIdentity();
      setDone(true);
    } catch (err) {
      toast(err instanceof ApiFailure ? err.message : 'That didn’t work. Try again in a minute.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <details
      id="forget-me"
      className="group rounded-xl px-4 py-3 ring-1 ring-stone-200 dark:ring-stone-800"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 font-semibold">
        🧹 Forget me: delete my data from the server
        <span
          aria-hidden
          className="text-ink-muted transition group-open:rotate-90 motion-reduce:transition-none"
        >
          ▸
        </span>
      </summary>
      {done ? (
        <p className="pt-2 text-stone-700 dark:text-stone-300" role="status">
          Done. The tavern has forgotten you. Next time you visit, you’ll be a mysterious stranger
          again: pick a name and pull up a chair.
        </p>
      ) : (
        <div className="space-y-3 pt-2 text-stone-700 dark:text-stone-300">
          <p>
            This deletes the play history and names the server keeps for{' '}
            <strong>this browser</strong>, and this browser forgets your name and seat. Your past
            games still happened, but your part in them becomes “forgotten”. It can’t be undone.
          </p>
          <p className="text-sm text-ink-muted">
            Played on another phone too? Do this there as well: each device is its own player.
          </p>
          <label className="block text-sm font-semibold">
            Type <q>{PHRASE}</q> to confirm
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 block h-11 w-full rounded-lg bg-white px-3 font-normal ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
            />
          </label>
          <Button variant="danger" disabled={!ready} onClick={() => void forget()}>
            {busy ? 'Forgetting…' : 'Delete my data'}
          </Button>
        </div>
      )}
    </details>
  );
}
