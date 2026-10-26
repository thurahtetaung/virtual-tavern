import type { Ack, AckWith, StageCode } from '@vt/protocol';
import { Button, clock, cn, useConfirm, useSecondsLeft } from '@vt/ui';
import { useState } from 'react';

/** The short address a TV can type. */
const stageUrl = () => `${window.location.host}/stage`;

/**
 * The host's "📺 Table screen": a pairing code for a TV or laptop, whether one is connected, and
 * removing it. Everyone else only sees that a table screen is here.
 */
export function TableScreen({
  present,
  isHost,
  clockOffset,
  call,
}: {
  present: boolean;
  isHost: boolean;
  clockOffset: number;
  call: (event: 'room:stage-code' | 'room:stage-remove') => Promise<Ack>;
}) {
  const [code, setCode] = useState<StageCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const left = useSecondsLeft(code?.expiresAt ?? null, clockOffset);
  const live = code && left !== null && left > 0 && !present ? code : null;

  if (!isHost) {
    return present ? (
      <p className="text-sm text-ink-muted">
        <span aria-hidden>📺</span> A table screen is showing this room.
      </p>
    ) : null;
  }

  const mint = async () => {
    setBusy(true);
    const res = (await call('room:stage-code')) as unknown as AckWith<StageCode>;
    setBusy(false);
    if (res.ok) {
      setCode(res.data);
      setError(null);
    } else setError(res.error.message);
  };
  const remove = async () => {
    const yes = await confirm({
      title: 'Remove the table screen?',
      body: 'It leaves the room at once. You can pair it again with a new code.',
      confirmLabel: 'Remove table screen',
      danger: true,
    });
    if (!yes) return;
    const res = await call('room:stage-remove');
    if (res.ok) setCode(null);
    else setError(res.error.message);
  };

  return (
    <section
      aria-labelledby="table-screen-heading"
      className="space-y-2 rounded-xl bg-stone-100 p-3 ring-1 ring-stone-200 dark:bg-stone-800 dark:ring-stone-700"
    >
      {confirmDialog}
      <div className="flex items-center justify-between gap-2">
        <h3 id="table-screen-heading" className="font-semibold">
          <span aria-hidden>📺</span> Table screen
        </h3>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 text-sm font-medium',
            present ? 'text-success-ink dark:text-emerald-300' : 'text-ink-muted',
          )}
          data-testid="stage-status"
        >
          <span
            aria-hidden
            className={cn(
              'size-2 rounded-full',
              present ? 'bg-success dark:bg-emerald-400' : 'bg-stone-400',
            )}
          />
          {present ? 'Connected' : 'Not connected'}
        </span>
      </div>
      {live ? (
        <div className="space-y-1 text-center">
          <p className="text-sm">
            On the TV or laptop, open <strong className="break-all">{stageUrl()}</strong> and type:
          </p>
          <p
            className="font-mono text-4xl font-bold tracking-[0.3em] tabular-nums"
            data-testid="stage-code"
            aria-label={`Code ${live.code.split('').join(' ')}`}
          >
            {live.code}
          </p>
          <p className="text-xs text-ink-muted">
            Works once, for {clock(left ?? 0)}. Only you can see it.
          </p>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          {present
            ? 'The big show plays on the table screen; phones keep their own controls and stay quieter.'
            : 'Put the room on a TV or laptop everyone can see. It never plays, and phones get quieter.'}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-danger-ink dark:text-rose-300">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!live && (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            disabled={busy}
            onClick={() => void mint()}
          >
            {present ? 'Pair another screen' : 'Show a pairing code'}
          </Button>
        )}
        {present && (
          <Button variant="danger" size="sm" className="min-h-11" onClick={() => void remove()}>
            Remove table screen
          </Button>
        )}
      </div>
    </section>
  );
}
