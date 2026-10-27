import { PLAYER_COLOR_NAMES, type PlayerColor, storageKey } from '@vt/game-sdk';
import { Button, PLAYER_DOT, PlayerTag, ProtectedImage, cn, usePlayerColor } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { money } from '../logic/lines.ts';
import { fillNames } from '../logic/names.ts';
import {
  BUYERS,
  type Buyer,
  type FinalView,
  type GoingOnceView,
  type HostClip,
  type Message,
  type Sender,
} from '../logic/types.ts';
import type { Art } from './assets.ts';
import { RACKUP_BEAT_MS, clipNow } from './audio.ts';
import { type NameOf, SENDERS, whyLine } from './text.ts';

/**
 * What the host says now, as on-screen text: the text pack's lines, or in a voiced game the words
 * of the clip being said (`clipNow`), with a player the clip names by colour shown as their dot,
 * name and colour word ("You're screwed, ● Kim (yellow)!").
 */
export function HostStrip({
  view,
  art,
  name,
  clockOffset,
}: {
  view: GoingOnceView;
  art: Art;
  name: NameOf;
  clockOffset: number;
}) {
  const host = view.game?.host;
  const voicedLine = !!host?.clips?.length;
  const now = useClock(clockOffset, voicedLine);
  const clip = voicedLine ? clipNow(host, now, (c) => art.voiceWords(c.key, c.i) !== '') : null;
  if (!host || (!voicedLine && !host.lines.length) || (voicedLine && !clip)) return null;
  const close = view.game?.stage === 'auction' ? view.game.auction?.close : null;
  const big = close === 'once' || close === 'twice';
  return (
    <p
      key={voicedLine ? `${host.id}:${clip!.key}:${clip!.i}` : host.id}
      aria-live="polite"
      data-testid="go-host"
      className={cn(
        'flex items-start gap-2 rounded-xl bg-card px-3 py-2 ring-1 ring-line motion-safe:animate-[go-rise_0.25s_ease-out] dark:bg-stone-800/70 dark:ring-stone-700',
        big ? 'justify-center text-center text-xl font-extrabold' : 'text-sm italic',
      )}
    >
      <span aria-hidden className="not-italic">
        🎙️
      </span>
      <span className="sr-only">The auctioneer: </span>
      <span>
        {clip ? (
          <Subtitle words={art.voiceWords(clip.key, clip.i)} clip={clip} name={name} />
        ) : (
          host.lines.join(' ')
        )}
      </span>
    </p>
  );
}

/** Server time, ticking every 200 ms while `on`. */
function useClock(clockOffset: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [on]);
  return now + clockOffset;
}

/** The colour word a colour-named clip says ("Gray" in the recordings is our grey). */
const COLOR_WORD: Partial<Record<PlayerColor, string>> = { grey: 'gr[ae]y' };

/**
 * A clip's words, with the colour it says out loud shown as the player it names: their dot and
 * name, then the colour word, so everyone links the spoken colour to the person.
 */
export function Subtitle({ words, clip, name }: { words: string; clip: HostClip; name: NameOf }) {
  const color = clip.player ? (clip.key.split('-').at(-1) as PlayerColor) : null;
  if (!clip.player || !color || !PLAYER_COLOR_NAMES[color]) return <>{words}</>;
  const match = new RegExp(`\\b(${COLOR_WORD[color] ?? color})\\b`, 'i').exec(words);
  const who = (
    <span className="not-italic" data-testid="go-host-player">
      <PlayerTag name={name(clip.player)} /> ({PLAYER_COLOR_NAMES[color]})
    </span>
  );
  if (!match) return <>{words}</>;
  return (
    <>
      {words.slice(0, match.index)}
      {who}
      {words.slice(match.index + match[0].length)}
    </>
  );
}

/** Keyframes for the small entrances (kept here so the package carries its own). */
export function GoingOnceStyles() {
  return (
    <style>{`@keyframes go-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}@keyframes go-psst{0%{opacity:0;transform:translateY(12px) scale(.96)}55%{opacity:1;transform:translateY(-2px) rotate(-1deg)}70%{transform:rotate(1deg)}85%{transform:rotate(-.5deg)}to{transform:none}}`}</style>
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

/** A sender's name: the buyer's from the manifest (or their placeholder), the bank's, or a label. */
export function senderName(from: Sender, art: Art): string {
  if (from === 'bank') return fillNames('{Bank}', art.names);
  const buyer = BUYERS.indexOf(from as Buyer);
  return buyer >= 0 ? art.names.buyers[buyer]! : SENDERS[from].label;
}

/**
 * A tip arriving: a chat bubble from its sender ("psst"), with a buzz where phones allow it the
 * first time it shows. Tips (true, useful) are bold from their sender; chatter reads as gossip.
 */
export function PsstBubble({
  message,
  art,
  name,
  big = false,
  fact,
}: {
  message: Message;
  art: Art;
  name: NameOf;
  big?: boolean;
  /** The plain fact behind a tip the engine didn't send (the practice lot's). */
  fact?: string;
}) {
  const why = fact ?? whyLine(message, name);
  const tip = why !== null;
  const [buzzed, setBuzzed] = useState<number | null>(null);
  if (big && buzzed !== message.id) {
    setBuzzed(message.id);
    vibrate([15, 60, 15]);
  }
  return (
    <div
      role="status"
      data-testid="go-psst"
      data-tip={tip}
      className={cn(
        'flex items-start gap-2 motion-safe:animate-[go-rise_0.3s_ease-out]',
        big && 'motion-safe:animate-[go-psst_0.5s_ease-out]',
      )}
    >
      <SenderIcon from={message.from} art={art} size={big ? 'md' : 'sm'} />
      <div
        className={cn(
          'relative min-w-0 rounded-2xl rounded-tl-sm px-3 py-2 ring-1',
          tip
            ? 'bg-info-soft text-info-ink ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30'
            : 'bg-panel text-ink-muted ring-line dark:bg-stone-800/70 dark:text-stone-400 dark:ring-stone-700',
          big ? 'text-base' : 'text-sm',
        )}
      >
        <span className="block text-xs">
          <b className={cn(!tip && 'font-semibold')}>{senderName(message.from, art)}</b>
          <span className="opacity-70">{tip ? ' · psst' : ' · gossip'}</span>
        </span>
        <span className={cn('block', tip ? 'font-semibold' : 'italic')}>{message.text}</span>
        {why && big && <span className="mt-0.5 block text-xs font-normal opacity-80">{why}</span>}
      </div>
    </div>
  );
}

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
  const label = senderName(from, art);
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
    const id = setTimeout(() => setShown((n) => n + 1), RACKUP_BEAT_MS * (view.rig?.scale ?? 1));
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

/** Whether the viewer asked for less motion (staged reveals then show at once). */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof matchMedia === 'function'
      ? matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const q = matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduced(q.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * The bid race: the bids before the current one on this lot, newest first, and "Ana vs Ben" when
 * the same two have traded the last three bids.
 */
export function BidLadder({
  view,
  art,
  name,
  you,
  rows = 3,
}: {
  view: GoingOnceView;
  art: Art;
  name: NameOf;
  you: string;
  /** How many earlier bids to list (a quiet phone has room for two). */
  rows?: number;
}) {
  const a = view.game?.auction;
  const recent = a?.recent ?? [];
  if (recent.length < 2) return null;
  const [x, y, z] = recent.slice(-3).reverse();
  const duel = z && x && y && x.by === z.by && x.by !== y.by ? [y.by, x.by] : null;
  return (
    <div className="flex flex-col gap-1" data-testid="go-ladder">
      {duel && (
        <span className="self-start rounded-full bg-warn-soft px-2 py-0.5 text-xs font-bold text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40">
          ⚔ {name(duel[0])} vs {name(duel[1])}
        </span>
      )}
      <ol aria-label="Earlier bids" className="flex flex-col gap-0.5">
        {recent
          .slice(0, -1)
          .reverse()
          .slice(0, rows)
          .map((r, i) => (
            <li
              key={`${r.by}-${r.amount}`}
              className={cn(
                'flex items-center gap-2 text-sm motion-safe:animate-[go-rise_0.25s_ease-out]',
                i === 0 ? 'opacity-80' : 'opacity-50',
              )}
            >
              <Paddle
                name={name(r.by)}
                shape={view.game!.paddles[r.by]}
                art={art}
                className="w-5"
              />
              <PlayerTag name={name(r.by)} you={r.by === you} />
              <span className="tabular-nums">{money(r.amount)}</span>
              {r.forced && <span aria-label="a forced bid">🔩</span>}
            </li>
          ))}
      </ol>
    </div>
  );
}

function vibrate(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not supported: the flash is enough.
  }
}

/**
 * Synced alerts: a flash round the screen edge (and a buzz where phones allow it) when the viewer
 * is outbid, at "going twice" on a lot they bid on but don't lead, and when they are screwed.
 */
export function Alerts({ view, you }: { view: GoingOnceView; you: string }) {
  const a = view.game?.stage === 'auction' ? view.game.auction : null;
  const [flash, setFlash] = useState<{ id: string; tone: 'accent' | 'danger' } | null>(null);
  const key = a ? `${a.lot}:${a.seq}:${a.close}:${a.bid?.by ?? ''}` : '';
  const [seen, setSeen] = useState({ key, lead: a?.bid?.by === you, close: a?.close });
  if (seen.key !== key) {
    const lead = a?.bid?.by === you;
    let next: typeof flash = null;
    if (a && seen.lead && !lead && a.bid) {
      next = { id: key, tone: 'accent' };
      vibrate(a.screwed?.target === you ? 60 : 30);
    } else if (a?.screwed?.target === you && a.bid?.by === you && !seen.lead) {
      next = { id: key, tone: 'danger' };
      vibrate(60);
    } else if (a?.close === 'twice' && seen.close !== 'twice' && !lead && a.bidders.includes(you)) {
      next = { id: key, tone: 'danger' };
      vibrate([20, 40, 20]);
    }
    setSeen({ key, lead, close: a?.close });
    if (next) setFlash(next);
  }
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), 700);
    return () => clearTimeout(id);
  }, [flash]);
  if (!flash) return null;
  return (
    <div
      key={flash.id}
      aria-hidden
      data-testid="go-alert"
      className={cn(
        'pointer-events-none fixed inset-0 z-50 ring-8 ring-inset motion-safe:animate-pulse',
        flash.tone === 'accent'
          ? 'ring-accent/70 dark:ring-amber-500/70'
          : 'ring-danger/70 dark:ring-rose-500/70',
      )}
    />
  );
}

/**
 * "Ana screwed Ben: Ben bids $1,300" for everyone while the screw plays out (at least two
 * seconds), with a buzz on Ben; null while there is none.
 */
export function useScrewBanner({
  view,
  name,
  you,
  clockOffset,
}: {
  view: GoingOnceView;
  name: NameOf;
  you: string;
  clockOffset: number;
}) {
  const last = [...view.log].reverse().find((e) => e.kind === 'screw');
  const id = last?.id ?? 0;
  const [shown, setShown] = useState<number>(id);
  const [visible, setVisible] = useState(false);
  if (id !== shown) {
    setShown(id);
    if (last?.kind === 'screw' && last.outcome !== 'wasted') {
      setVisible(true);
      if (last.target === you && last.outcome === 'forced') vibrate(60);
    }
  }
  // Up while the screw plays out (the clock is paused till then), and at least 2 s.
  const until = view.game?.auction?.pausedUntil ?? 0;
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(
      () => setVisible(false),
      Math.max(SCREW_BANNER_MS, until - (Date.now() + clockOffset)),
    );
    return () => clearTimeout(t);
  }, [visible, shown, until, clockOffset]);
  if (!visible || last?.kind !== 'screw') return null;
  return (
    <p
      role="status"
      data-testid="go-screw-banner"
      className="rounded-xl bg-danger-soft px-4 py-3 text-center text-base font-bold text-danger-ink ring-1 ring-danger-line motion-safe:animate-[go-rise_0.25s_ease-out] dark:bg-rose-500/15 dark:text-rose-100 dark:ring-rose-500/40"
    >
      🔩{' '}
      {last.outcome === 'forced' ? (
        `${name(last.by)} screwed ${name(last.target)}: ${name(last.target)} bids ${money(last.amount ?? 0)}`
      ) : (
        <>
          Screw failed:{' '}
          {last.target ? <PlayerTag name={name(last.target)} you={last.target === you} /> : 'they'}{' '}
          could not pay {money(last.amount ?? 0)}
        </>
      )}
    </p>
  );
}

/** The least a screw's banner stays up. */
const SCREW_BANNER_MS = 2000;

/**
 * How many beats of a staged reveal to show: one more every `stepMs`, all at once when the viewer
 * asks for less motion or `instant` is set. Starts over when `key` changes.
 */
export function useBeats(key: string, beats: number, stepMs: number, instant: boolean): number {
  const reduced = useReducedMotion();
  const all = instant || reduced;
  const [state, setState] = useState({ key, shown: all ? beats : 1 });
  if (state.key !== key) setState({ key, shown: all ? beats : 1 });
  const shown = all ? beats : state.shown;
  useEffect(() => {
    if (all || shown >= beats) return;
    const id = setTimeout(() => setState((s) => ({ ...s, shown: s.shown + 1 })), stepMs);
    return () => clearTimeout(id);
  }, [all, shown, beats, stepMs, key]);
  return shown;
}
