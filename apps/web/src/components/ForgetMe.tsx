import { Button, Field, Icon, Input } from '@vt/ui';
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
    <details id="forget-me" className="group rounded-xl bg-panel ring-1 ring-line">
      <summary className="flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-2 font-semibold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden">
        🧹 Forget me: delete my data from the server
        <Icon
          name="chevron-down"
          className="text-ink-faint transition-transform duration-[180ms] group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      {done ? (
        <p className="px-4 pt-1 pb-4 text-ink-2" role="status">
          Done. The tavern has forgotten you. Next time you visit, you’ll be a mysterious stranger
          again: pick a name and pull up a chair.
        </p>
      ) : (
        <div className="space-y-3 px-4 pt-1 pb-4 text-ink-2">
          <p>
            This deletes the play history and names the server keeps for{' '}
            <strong>this browser</strong>, and this browser forgets your name and seat. Your past
            games still happened, but your part in them becomes “forgotten”. It can’t be undone.
          </p>
          <p className="text-sm text-ink-muted">
            Played on another phone too? Do this there as well: each device is its own player.
          </p>
          <Field
            label={
              <>
                Type <q>{PHRASE}</q> to confirm
              </>
            }
          >
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="danger" disabled={!ready} onClick={() => void forget()}>
            {busy ? 'Forgetting…' : 'Delete my data'}
          </Button>
        </div>
      )}
    </details>
  );
}
