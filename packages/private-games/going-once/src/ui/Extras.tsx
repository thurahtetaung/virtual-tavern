import { storageKey } from '@vt/game-sdk';
import { Button, PLAYER_DOT, PlayerTag, ProtectedImage, cn, usePlayerColor } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { money } from '../logic/lines.ts';
import { fillNames } from '../logic/names.ts';
import type { FinalView, GoingOnceView, Message } from '../logic/types.ts';
import type { Art } from './assets.ts';
import { type NameOf, SENDERS } from './text.ts';

/** What the host says now, as on-screen text (from the private host pack; nothing without it). */
export function HostStrip({ view }: { view: GoingOnceView }) {
  const host = view.game?.host;
  if (!host?.lines.length) return null;
  return (
    <p
      key={host.id}
      aria-live="polite"
      data-testid="go-host"
      className="flex items-start gap-2 rounded-xl bg-card px-3 py-2 text-sm italic ring-1 ring-line motion-safe:animate-[go-rise_0.25s_ease-out] dark:bg-stone-800/70 dark:ring-stone-700"
    >
      <span aria-hidden className="not-italic">
        🎙️
      </span>
      <span className="sr-only">The auctioneer: </span>
      <span>{host.lines.join(' ')}</span>
    </p>
  );
}

/** Keyframes for the small entrances (kept here so the package carries its own). */
export function GoingOnceStyles() {
  return (
    <style>{`@keyframes go-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`}</style>
  );
}

/**
 * A player's paddle: their silhouette from the manifest in their room colour on the wooden
 * handle, or their colour dot without the art.
 */
export function Paddle({
  name,
  shape,
  art,
  raised = false,
  className,
}: {
  name: string;
  shape: number | undefined;
  art: Art;
  raised?: boolean;
  className?: string;
}) {
  const color = usePlayerColor(name);
  const src = shape === undefined ? null : art.paddle(shape);
  const handle = art.ui('handle');
  if (!src || !color) return null;
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-flex w-9 shrink-0 flex-col items-center transition-transform',
        raised && 'motion-safe:-translate-y-1',
        className,
      )}
    >
      <span
        className={cn('block aspect-square w-full', PLAYER_DOT[color])}
        style={{
          maskImage: `url("${src}")`,
          WebkitMaskImage: `url("${src}")`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }}
      />
      {handle && <ProtectedImage src={handle} alt="" className="-mt-1 h-5 w-auto object-contain" />}
    </span>
  );
}

const SENDER_ART: Partial<Record<Message['from'], string>> = {
  buyer1: 'buyer-0',
  buyer2: 'buyer-1',
  buyer3: 'buyer-2',
  bank: 'bank',
};

/** Who sent a hint: the buyer's or the bank's portrait from the manifest, else an emoji. */
export function SenderIcon({
  from,
  art,
  size = 'md',
}: {
  from: Message['from'];
  art: Art;
  size?: 'sm' | 'md';
}) {
  const key = SENDER_ART[from];
  const src = key ? art.ui(key) : null;
  const sender = SENDERS[from];
  const label = from === 'bank' ? fillNames('{Bank}', art.names) : sender.label;
  if (src)
    return (
      <ProtectedImage
        src={src}
        alt={label}
        className={cn(
          'shrink-0 rounded-full bg-card object-cover object-top ring-1 ring-line dark:bg-stone-700 dark:ring-stone-600',
          size === 'sm' ? 'size-6' : 'size-9',
        )}
      />
    );
  return (
    <span
      role="img"
      aria-label={label}
      className={size === 'sm' ? 'text-base' : 'text-lg leading-none'}
    >
      {sender.icon}
    </span>
  );
}

const HOWTO_KEY = 'go.howto.v1';

const HOWTO: [string, string][] = [
  [
    '💵',
    'You each start with $3,000 to buy art. Spend it well: art you buy counts at its true value at the end.',
  ],
  [
    '🎨',
    'Some drawings are worth a lot to the art buyers, others very little. Each artist’s two add up to $4,500.',
  ],
  [
    '📜',
    'The buyers each tell you what three drawings are worth: your wish list. Work out which picture is which.',
  ],
  [
    '🔨',
    'Bid on anything you think is worth more than the price, or that you just like the look of.',
  ],
  ['🏆', 'Whoever has the most money at the end (cash, plus art, minus loans) wins.'],
];

/** The how-to, shown in a room's first game only, until the viewer skips it. */
export function HowTo({ view }: { view: GoingOnceView }) {
  const [skipped, setSkipped] = useState(() => {
    try {
      return localStorage.getItem(storageKey(HOWTO_KEY)) === '1';
    } catch {
      return false;
    }
  });
  const [step, setStep] = useState(0);
  if (!view.game?.firstGame || skipped) return null;
  const skip = () => {
    try {
      localStorage.setItem(storageKey(HOWTO_KEY), '1');
    } catch {
      // Blocked storage: hidden for this visit.
    }
    setSkipped(true);
  };
  const [icon, text] = HOWTO[step]!;
  return (
    <aside
      aria-label="How it works"
      className="flex flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">
          How it works ({step + 1} of {HOWTO.length})
        </p>
        <Button variant="ghost" size="sm" onClick={skip}>
          Skip
        </Button>
      </div>
      <p className="flex gap-2">
        <span aria-hidden className="text-lg">
          {icon}
        </span>
        <span>{text}</span>
      </p>
      <div className="flex justify-end gap-2">
        {step > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
            Back
          </Button>
        )}
        <Button
          size="sm"
          variant="soft"
          onClick={() => (step + 1 < HOWTO.length ? setStep(step + 1) : skip())}
        >
          {step + 1 < HOWTO.length ? 'Next' : 'Got it'}
        </Button>
      </div>
    </aside>
  );
}

/**
 * The end rack-up: each buyer in turn with their drawings (title and value), then everyone's
 * cash, art and (only if anyone borrowed) debt, a beat at a time; Skip shows it all at once.
 */
export function RackUp({
  view,
  art,
  name,
  you,
  children,
}: {
  view: GoingOnceView;
  art: Art;
  name: NameOf;
  you: string;
  /** The standings, shown once the rack-up is done. */
  children: ReactNode;
}) {
  const g = view.game!;
  const final = g.final ?? [];
  const buyers = final.filter((f) => f.bought.length > 0);
  const anyDebt = final.some((f) => f.debt > 0);
  const steps = buyers.length + 1 + (anyDebt ? 1 : 0);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown >= steps) return;
    const id = setTimeout(() => setShown((n) => n + 1), 1800 * (view.rig?.scale ?? 1));
    return () => clearTimeout(id);
  }, [shown, steps, view.rig?.scale]);
  if (shown >= steps) return <>{children}</>;
  const results = new Map(g.results.map((r) => [r.item, r]));
  const row = (f: FinalView, withDebt: boolean) => (
    <li key={f.id} className="flex items-center justify-between gap-2 py-1">
      <PlayerTag name={name(f.id)} you={f.id === you} />
      <span className="text-sm tabular-nums">
        {money(f.cash)} + {money(f.art)}
        {withDebt && f.debt > 0 && (
          <span className="text-danger-ink dark:text-rose-300"> − {money(f.debt)}</span>
        )}
      </span>
    </li>
  );
  const current = shown < buyers.length ? buyers[shown] : null;
  return (
    <section aria-label="The scores" className="flex flex-col gap-3" data-testid="go-rackup">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">Let’s count the money</h3>
        <Button variant="ghost" size="sm" onClick={() => setShown(steps)}>
          Skip
        </Button>
      </div>
      {current ? (
        <div
          key={current.id}
          className="flex flex-col gap-1 motion-safe:animate-[go-rise_0.25s_ease-out]"
        >
          <PlayerTag name={name(current.id)} you={current.id === you} className="font-semibold" />
          <ul className="flex flex-col gap-0.5 text-sm">
            {current.bought.map((item) => {
              const r = results.get(item);
              return (
                <li key={item} className="flex justify-between gap-2">
                  <span>{r?.title}</span>
                  <span className="font-semibold tabular-nums">{money(r?.value ?? 0)}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {shown > buyers.length && anyDebt && art.ui('bank-bite') && (
            <ProtectedImage
              src={art.ui('bank-bite')!}
              alt=""
              className="mx-auto h-16 w-auto object-contain"
            />
          )}
          <p className="text-sm text-ink-muted dark:text-stone-400">
            {shown > buyers.length ? 'Cash + art − loans' : 'Cash + art'}
          </p>
          <ul className="divide-y divide-line dark:divide-stone-700">
            {final.map((f) => row(f, shown > buyers.length))}
          </ul>
        </div>
      )}
    </section>
  );
}
