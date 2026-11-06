import {
  type CSSProperties,
  type ReactNode,
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../cn.ts';
import { clock, useSecondsLeft } from '../countdown.tsx';
import { Icon, type IconName } from '../icon.tsx';

// The table screen's poster: one shared frame for every game's TV, laid out in 1920 × 1080 units
// (the TV's own pixels, scaled to fit any other screen and letterboxed). Top to bottom: a bar with
// the game's emblem and name, the moment (eyebrow → headline → one sentence → the clock → the
// current choices as slates), the teams on either side, and a footer strip saying what the phones
// are doing. A game supplies the words and its art; the frame, sizes and colours are shared. It
// is read from across a room, so nothing in it is smaller than 24 px, and nothing in it is
// focusable.

/** The poster's size in its own units: the TV's pixels. */
export const POSTER_WIDTH = 1920;
export const POSTER_HEIGHT = 1080;

/** What the shell knows about the room on the table screen: the game's emblem, name and code. */
export interface PosterInfo {
  emblem: string;
  name: string;
  /** The room's code, shown small in the corner so late-comers can find it. */
  code?: string;
}

const PosterInfoContext = createContext<PosterInfo>({ emblem: '📺', name: 'Table screen' });

/** Set by the table-screen shell around a game's `Stage`, so every poster names the right game. */
export const PosterInfoProvider = PosterInfoContext.Provider;
export const usePosterInfo = () => useContext(PosterInfoContext);

/**
 * Scales a 1920 × 1080 box to fit its parent (which fills the screen), centred and letterboxed.
 * Measured only when the screen changes size.
 */
export function PosterScale({ children }: { children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () =>
      setK(Math.min(el.clientWidth / POSTER_WIDTH, el.clientHeight / POSTER_HEIGHT));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);
  return (
    <div ref={box} className="relative h-full w-full overflow-hidden bg-page">
      <div
        data-poster-scale={k || undefined}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: POSTER_WIDTH,
          height: POSTER_HEIGHT,
          transform: `translate(-50%, -50%) scale(${k})`,
          visibility: k ? 'visible' : 'hidden',
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** One footer pill: an icon and what the phones (or this screen) are doing. */
export interface PosterNote {
  icon?: IconName;
  text: ReactNode;
}

export function Poster({
  meta,
  eyebrow,
  headline,
  line,
  clock: timer,
  choices,
  children,
  left,
  right,
  footer,
  footerEnd,
  background,
  overlay,
  body,
  corner,
  testId,
  label,
  className,
}: {
  /** After the game's name in the bar: the round, the stage. */
  meta?: ReactNode;
  /** Above the headline, small capitals: whose turn, what kind of moment. */
  eyebrow?: ReactNode;
  /** The one big line (display face). */
  headline?: ReactNode;
  /** One sentence under the headline. */
  line?: ReactNode;
  /** The big clock (`PosterClock`). */
  clock?: ReactNode;
  /** The current choices, as slates (`PosterSlate`). */
  choices?: ReactNode;
  /** Anything else the moment shows (a card, the art), under the choices. */
  children?: ReactNode;
  /** The teams' columns (`PosterSide`), one either side of the moment. */
  left?: ReactNode;
  right?: ReactNode;
  /** The footer strip: what the phones are doing. */
  footer?: PosterNote | ReactNode;
  footerEnd?: PosterNote | ReactNode;
  /** Art behind everything (kept faint by the game). */
  background?: ReactNode;
  /** Above everything, in poster units (a moment's big word, a news card). */
  overlay?: ReactNode;
  /**
   * A dense table (a board, every hand) in place of the moment: fills the space between the bar
   * and the footer, laid out by the game in poster units.
   */
  body?: ReactNode;
  /** The bar's right end, in place of the room code. */
  corner?: ReactNode;
  /** The poster's accessible name. */
  label?: string;
  testId?: string;
  className?: string;
}) {
  const info = usePosterInfo();
  const sides = left !== undefined || right !== undefined;
  return (
    <PosterScale>
      <div
        className={cn(
          'relative grid h-full w-full grid-rows-[auto_minmax(0,1fr)_auto] gap-8 overflow-hidden bg-page text-ink',
          className,
        )}
        style={{
          padding: '48px 80px 56px',
          backgroundImage:
            'radial-gradient(120% 60% at 50% -10%, color-mix(in oklab, var(--vt-lamp) 150%, transparent), transparent 60%)',
        }}
        data-testid={testId}
        aria-label={label}
        data-poster=""
      >
        {background && <div className="pointer-events-none absolute inset-0">{background}</div>}
        <header className="relative flex items-center justify-between gap-8">
          <div className="flex min-w-0 items-center gap-5">
            <span className="text-[44px] leading-none" aria-hidden>
              {info.emblem}
            </span>
            <span className="truncate font-display text-[48px] leading-tight font-semibold">
              {info.name}
            </span>
            {meta && <span className="shrink-0 text-[28px] text-ink-muted">{meta}</span>}
          </div>
          {corner ??
            (info.code && (
              <span className="shrink-0 font-mono text-[24px] tracking-[0.08em] text-ink-muted">
                {info.code}
              </span>
            ))}
        </header>
        {body !== undefined ? (
          <main className="relative min-h-0">{body}</main>
        ) : (
          <main
            className={cn(
              'relative min-h-0',
              sides
                ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)] items-center gap-12'
                : 'flex flex-col items-center justify-center',
            )}
          >
            {sides && <div className="min-w-0 self-center">{left}</div>}
            <Moment
              eyebrow={eyebrow}
              headline={headline}
              line={line}
              clock={timer}
              choices={choices}
              narrow={sides}
            >
              {children}
            </Moment>
            {sides && <div className="min-w-0 self-center">{right}</div>}
          </main>
        )}
        {(footer || footerEnd) && (
          <footer className="relative flex items-center justify-between gap-8 text-[28px] text-ink-2">
            {footer ? <Note note={footer} /> : <span />}
            {footerEnd && <Note note={footerEnd} />}
          </footer>
        )}
        {overlay}
      </div>
    </PosterScale>
  );
}

const isNote = (n: unknown): n is PosterNote =>
  typeof n === 'object' && n !== null && 'text' in n && !('$$typeof' in n);

function Note({ note }: { note: PosterNote | ReactNode }) {
  if (!isNote(note)) return <div className="min-w-0">{note}</div>;
  return (
    <span className="inline-flex min-w-0 items-center gap-3 rounded-full border border-line bg-panel px-5 py-2">
      {note.icon && <Icon name={note.icon} size={32} />}
      <span className="min-w-0 text-balance">{note.text}</span>
    </span>
  );
}

function Moment({
  eyebrow,
  headline,
  line,
  clock: timer,
  choices,
  children,
  narrow,
}: {
  eyebrow?: ReactNode;
  headline?: ReactNode;
  line?: ReactNode;
  clock?: ReactNode;
  choices?: ReactNode;
  children?: ReactNode;
  narrow: boolean;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col items-center justify-center gap-5 text-center">
      {eyebrow && (
        <p className="text-[28px] font-semibold tracking-[0.12em] text-accent-text uppercase">
          {eyebrow}
        </p>
      )}
      {headline && (
        <h1
          className={cn(
            'max-w-full font-display leading-[1.08] font-semibold text-balance',
            narrow ? 'text-[72px]' : 'text-[96px]',
          )}
          data-testid="poster-headline"
        >
          {headline}
        </h1>
      )}
      {line && (
        <p
          className="max-w-[1400px] text-[36px] leading-snug font-medium text-balance text-ink-2"
          data-testid="poster-line"
        >
          {line}
        </p>
      )}
      {timer}
      {choices && <div className="flex flex-wrap justify-center gap-6">{choices}</div>}
      {children}
    </section>
  );
}

/**
 * The big clock: 120 px tabular digits, the danger colour in its last seconds. Pass a deadline (it
 * ticks by itself) or the seconds to show.
 */
export function PosterClock({
  deadline,
  clockOffset = 0,
  seconds,
  urgentBelow = 10,
  label,
  paused = false,
}: {
  deadline?: number | null;
  clockOffset?: number;
  seconds?: number;
  urgentBelow?: number;
  /** Under the digits, small: what the clock is for. */
  label?: ReactNode;
  paused?: boolean;
}) {
  const ticking = useSecondsLeft(deadline ?? null, clockOffset);
  const s = Math.max(0, seconds ?? ticking ?? 0);
  const urgent = !paused && s <= urgentBelow;
  return (
    <div className="flex flex-col items-center">
      <p
        role="timer"
        aria-label={`${s} seconds left${paused ? ', paused' : ''}`}
        className={cn(
          'text-[120px] leading-none font-semibold tracking-[-0.02em] tabular-nums',
          urgent ? 'text-danger-ink' : 'text-ink',
        )}
      >
        {paused && '⏸ '}
        {clock(s)}
      </p>
      {label && <p className="mt-2 text-[28px] text-ink-muted">{label}</p>}
    </div>
  );
}

/** One choice on the poster: a square slate, filled once it is won or done. */
export function PosterSlate({
  children,
  state = 'open',
  className,
  style,
  testId,
}: {
  children: ReactNode;
  state?: 'open' | 'on' | 'won' | 'lost';
  className?: string;
  style?: CSSProperties;
  testId?: string;
}) {
  return (
    <div
      className={cn(
        'grid min-h-[180px] min-w-[180px] place-items-center rounded-3xl border-2 p-4 text-center text-[28px] leading-tight font-semibold',
        state === 'won' && 'border-success bg-success-soft text-success-ink',
        state === 'lost' && 'border-danger-line bg-danger-soft text-danger-ink',
        state === 'on' && 'border-accent bg-accent-soft text-ink',
        state === 'open' && 'border-line-strong bg-sunk text-ink-2',
        className,
      )}
      style={style}
      data-testid={testId}
      data-state={state}
    >
      {children}
    </div>
  );
}

/** A team's column beside the moment: its name and score, then its art and its people. */
export function PosterSide({
  name,
  score,
  tone,
  children,
  testId,
}: {
  name: ReactNode;
  score?: ReactNode;
  /** The team's own colour for its name (`a` red, `b` blue), or plain ink. */
  tone?: 'a' | 'b';
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <section className="flex min-w-0 flex-col gap-5" data-testid={testId}>
      <h2
        className={cn(
          'flex items-center gap-4 font-display text-[44px] leading-tight font-semibold',
          tone === 'a' && 'text-team-a-ink',
          tone === 'b' && 'text-team-b-ink',
        )}
      >
        <span className="min-w-0 truncate">{name}</span>
        {score !== undefined && <span className="ml-auto tabular-nums">{score}</span>}
      </h2>
      {children}
    </section>
  );
}

/**
 * Runs the page in the table screen's theme while it is mounted (for a game's in-room table
 * screen, which lives inside the room page): dark unless this screen was switched to light on the
 * pairing page. The page's own theme comes back when it unmounts.
 */
export function useTableTheme(): void {
  useLayoutEffect(() => {
    const root = document.documentElement;
    let wanted: 'light' | 'dark' = 'dark';
    try {
      if (localStorage.getItem('vt.stage.theme') === 'light') wanted = 'light';
    } catch {
      // Storage blocked: dark.
    }
    let site = root.dataset.theme;
    const force = () => {
      if (root.dataset.theme !== wanted) {
        site = root.dataset.theme;
        root.dataset.theme = wanted;
      }
    };
    force();
    // The page's own theme switch may set it again (the OS changing); keep the screen's.
    const watch = new MutationObserver(force);
    watch.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => {
      watch.disconnect();
      if (site) root.dataset.theme = site;
    };
  }, []);
}

/**
 * A game's in-room table screen (a watcher turns their own browser into the table): the poster
 * over the whole page, in the table screen's theme, with the page behind it inert, so the
 * poster's own Leave is the only thing that can take focus.
 */
export function PosterOverlay({ children }: { children: ReactNode }) {
  useTableTheme();
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Everything beside the overlay, at every level up to the body, goes inert.
    const quiet: HTMLElement[] = [];
    for (
      let el: HTMLElement | null = box.current;
      el && el !== document.body;
      el = el.parentElement
    ) {
      for (const sib of el.parentElement?.children ?? [])
        if (sib !== el && sib instanceof HTMLElement && !sib.inert) {
          sib.inert = true;
          quiet.push(sib);
        }
    }
    // The page under it doesn't scroll, so its scrollbar doesn't narrow the poster.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      for (const el of quiet) el.inert = false;
      root.style.overflow = overflow;
    };
  }, []);
  return (
    <div ref={box} className="fixed inset-0 z-30">
      {children}
    </div>
  );
}
