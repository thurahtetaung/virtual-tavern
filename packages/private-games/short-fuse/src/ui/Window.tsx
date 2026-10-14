import { Button, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { ShortFuseAction, ShortFuseView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardFace } from './Card.tsx';
import { cap, pendingLine, who } from './text.ts';

/** Milliseconds left until `endsAt` on the server clock, ticking while it runs. */
function useMsLeft(endsAt: number, clockOffset: number): number {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, endsAt - (Date.now() + clockOffset)));
    tick();
    const id = window.setInterval(tick, 100);
    return () => {
      window.clearInterval(id);
    };
  }, [endsAt, clockOffset]);
  return left;
}

/**
 * The reaction panel: everyone sees the same play and the same burning fuse, and only players
 * holding a Nope get the button. It docks between the table and the hand, never over them.
 */
export function NopePanel({
  view,
  c,
  clockOffset,
  act,
}: {
  view: ShortFuseView;
  c: Content;
  clockOffset: number;
  act: (a: ShortFuseAction, o?: { anchor?: string }) => Promise<boolean>;
}) {
  const g = view.game!;
  const w = g.window!;
  const p = g.pending!;
  const left = useMsLeft(w.endsAt, clockOffset);
  const total = w.seconds * 1000;
  const n = w.chain.length;
  // A stamp for each new Nope: NOPE on odd links, YUP on even ones.
  const [stampState, setStampState] = useState({ n, on: false });
  if (stampState.n !== n) setStampState({ n, on: n > 0 });
  const stamp = stampState.on ? { n: stampState.n, at: stampState.n } : null;
  useEffect(() => {
    if (!stampState.on) return;
    const id = window.setTimeout(() => setStampState((s) => ({ ...s, on: false })), 900);
    return () => {
      window.clearTimeout(id);
    };
  }, [stampState.on, stampState.n]);
  const nope = c.name('nope');
  return (
    <section
      aria-label={`${nope} countdown`}
      aria-live="polite"
      className="relative overflow-hidden rounded-2xl bg-warn-soft p-3 ring-1 ring-warn-line"
      data-testid="nope-panel"
    >
      <div className="flex items-center gap-3">
        <span className="flex shrink-0 -space-x-6">
          {p.cards.slice(0, 3).map((card) => (
            <CardFace key={card.id} card={card} art={g.art} c={c} size="sm" label={false} />
          ))}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-snug font-semibold text-warn-ink">
            {pendingLine(view, c, p)}
          </p>
          <p className="mt-0.5 text-xs text-warn-ink" data-testid="nope-state">
            {n === 0
              ? `Going ahead in ${Math.ceil(left / 1000)}…`
              : `${nope} ×${n}: ${w.cancelled ? 'cancelled' : 'going ahead'} (${Math.ceil(left / 1000)}…)`}
          </p>
        </div>
      </div>
      <div
        className="mt-2 h-2 overflow-hidden rounded-full bg-card ring-1 ring-warn-line"
        aria-hidden
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-warn to-danger transition-[width] duration-100 ease-linear"
          style={{ width: `${Math.min(100, (left / total) * 100)}%` }}
        />
      </div>
      {g.canNope && (
        <>
          <Button
            variant="danger"
            size="lg"
            className="mt-2 min-h-14 w-full text-xl tracking-wide"
            // Held for a moment after each Nope, so two quick taps don't cancel each other out.
            disabled={stampState.on}
            onClick={() => void act({ type: 'nope', window: w.id }, { anchor: 'nope' })}
            data-testid="nope-button"
          >
            ✋ {nope.toUpperCase()}
            {n > 0 && (
              <span className="text-sm font-medium normal-case">
                {w.cancelled ? '(make it go ahead)' : '(cancel it again)'}
              </span>
            )}
          </Button>
          <RefusalSlot anchor="nope" />
        </>
      )}
      {stamp && (
        <span
          key={stamp.at}
          aria-hidden
          className={cn(
            'sf-stamp pointer-events-none absolute inset-0 m-auto flex h-14 w-44 items-center justify-center rounded-xl border-4 text-3xl font-black tracking-widest',
            stamp.n % 2 === 1 ? 'border-danger text-danger' : 'border-success text-success',
          )}
        >
          {stamp.n % 2 === 1 ? `${nope.toUpperCase()}!` : 'YUP!'}
        </span>
      )}
      {n > 0 && (
        <p className="sr-only">
          {cap(who(view, w.chain.at(-1)))} played {nope}.
        </p>
      )}
    </section>
  );
}
