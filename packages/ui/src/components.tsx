import {
  Children,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ComponentProps,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn as join } from './cn.ts';
import { Icon, type IconName } from './icon.tsx';

/*
 * The core parts of every screen ("Lamplight"). Colours come only from the semantic tokens in
 * apps/web/src/index.css, so each part looks right in both themes without a `dark:` override; every
 * control is at least 44 × 44 px and shows the one focus ring (3 px `focus`, 2 px out).
 */

/** The focus ring every control shares. */
export const FOCUS_RING =
  'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * `primary` is the one main action on a screen (accent fill). `secondary` is a card with a strong
 * border, `quiet` is text only (an extra link-like action), `tint` is the accent's soft surface for
 * actions that repeat down a list (one per card), `danger` destroys something, and `team-a` /
 * `team-b` are a team's own colour. `ghost`, `soft`, `red` and `blue` are older names for `quiet`,
 * `tint`, `team-a` and `team-b`.
 */
export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'quiet'
  | 'tint'
  | 'danger'
  | 'team-a'
  | 'team-b'
  | 'ghost'
  | 'soft'
  | 'red'
  | 'blue';
/**
 * Every size is at least 44 px tall: `sm` is narrower and quieter, `md` the default, `lg` 52 px for
 * the sticky bar's main action, and `icon` a square 44 px target for icon-only buttons.
 */
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

// A hover one step darker that keeps light text on a chromatic fill readable in both themes.
const DARKER = (token: string) => `hover:bg-[color-mix(in_oklab,var(--vt-${token})_86%,black)]`;

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-vt-1 hover:bg-accent-hover',
  secondary: 'border-line-strong bg-card text-ink shadow-vt-1-edge hover:bg-panel',
  quiet: 'text-accent-text hover:bg-accent-soft',
  tint: 'border-accent-line bg-accent-soft text-accent-text hover:border-accent hover:shadow-vt-1',
  danger: `bg-danger text-on-fill shadow-vt-1 ${DARKER('danger')}`,
  'team-a': `bg-team-a text-on-fill shadow-vt-1 ${DARKER('team-a')}`,
  'team-b': `bg-team-b text-on-fill shadow-vt-1 ${DARKER('team-b')}`,
  ghost: '',
  soft: '',
  red: '',
  blue: '',
};
VARIANTS.ghost = VARIANTS.quiet;
VARIANTS.soft = VARIANTS.tint;
VARIANTS.red = VARIANTS['team-a'];
VARIANTS.blue = VARIANTS['team-b'];

const SIZES: Record<ButtonSize, string> = {
  // 32 px at heart, held at 44 by its minimum. Where a screen lowers that minimum to fit, an
  // invisible band centred on the button still makes it a 44 px target on touch screens; the band
  // is never taller than 44 px or the button itself, so it doesn't reach over its neighbours.
  sm: "h-8 min-h-11 min-w-11 px-3 text-small pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2 pointer-coarse:after:h-[max(100%,2.75rem)] pointer-coarse:after:-translate-y-1/2 pointer-coarse:after:content-['']",
  md: 'min-h-11 min-w-11 px-4',
  lg: 'min-h-13 min-w-13 rounded-xl px-6 text-sub',
  icon: 'size-11 shrink-0 text-lg',
};

/** The classes of a `Button`, for a link or a label that should look like one. */
export function buttonClass({
  variant = 'primary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return join(
    'relative inline-flex items-center justify-center gap-2 rounded-lg border border-transparent font-semibold leading-tight',
    'transition-[background-color,border-color,color,box-shadow,transform] duration-[120ms] ease-out motion-safe:active:scale-[0.98]',
    FOCUS_RING,
    VARIANTS[variant],
    // Off, yet still readable: the reason a button is off is often written on it.
    'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunk disabled:text-ink-2 disabled:shadow-none disabled:hover:bg-sunk motion-safe:disabled:active:scale-100',
    SIZES[size],
    className,
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  sending = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Its move is on the way: a progress edge runs under the label, which stays as it is. */
  sending?: boolean;
}) {
  return (
    <button
      type="button"
      data-ui="button"
      aria-busy={sending || undefined}
      className={buttonClass({
        variant,
        size,
        className: join(
          sending &&
            'cursor-progress before:absolute before:inset-x-2.5 before:bottom-1 before:h-0.5 before:rounded-full before:bg-current before:opacity-50 motion-safe:before:animate-pulse',
          className,
        ),
      })}
      {...props}
    />
  );
}

/** A group of parts on the page: the panel surface and a hairline, no shadow. */
export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={join('rounded-xl bg-panel p-4 ring-1 ring-line', className)} {...props} />;
}

/** One thing that stands on its own (a game, a result): the card surface, lit from above. */
export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={join('rounded-xl bg-card p-4 shadow-vt-1-edge ring-1 ring-line', className)}
      {...props}
    />
  );
}

/** A fold: a `details` with a 48 px summary and a chevron (settings, sound). */
export function Fold({
  summary,
  children,
  open,
  onToggle,
  className,
  bodyClassName,
  testId,
}: {
  summary: ReactNode;
  children: ReactNode;
  open?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  bodyClassName?: string;
  testId?: string;
}) {
  return (
    <details
      open={open}
      onToggle={onToggle && ((e) => onToggle(e.currentTarget.open))}
      data-testid={testId}
      className={join('group rounded-xl bg-panel ring-1 ring-line', className)}
    >
      <FoldSummary>{summary}</FoldSummary>
      <div className={join('px-4 pb-4', bodyClassName)}>{children}</div>
    </details>
  );
}

/** A fold's 48 px summary line with its chevron, for a `details` that lays out its own body. */
export function FoldSummary({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <summary
      data-ui="fold"
      className={join(
        'relative flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-xl px-4 py-2 text-small [&::-webkit-details-marker]:hidden',
        FOCUS_RING,
        className,
      )}
    >
      {children}
      <Icon
        name="chevron-down"
        size={16}
        // Small and tucked into the padding, so the summary keeps its width.
        className="-mr-1 ml-auto text-ink-2 transition-transform duration-[180ms] group-open:rotate-180"
      />
    </summary>
  );
}

const TAG_TONES = {
  neutral: 'bg-sunk text-ink-2',
  accent: 'bg-accent-soft text-accent-text',
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-warn-soft text-warn-ink',
  success: 'bg-success-soft text-success-ink',
  danger: 'bg-danger-soft text-danger-ink',
  special: 'bg-special-soft text-special-ink',
} as const;
export type TagTone = keyof typeof TAG_TONES;

/** A small pill of facts ("you", "host", "away 2 min"); a tone gives it a meaning's colours. */
export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: TagTone;
  className?: string;
}) {
  return (
    <span
      className={join(
        'inline-flex items-center gap-1 rounded-full px-2 py-px text-caption leading-normal font-semibold',
        TAG_TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
/** The design system's name for `Badge`. */
export const Tag = Badge;

const NOTICE_TONES = {
  info: 'bg-info-soft text-info-ink ring-info-line',
  warn: 'bg-warn-soft text-warn-ink ring-warn-line',
  danger: 'bg-danger-soft text-danger-ink ring-danger-line',
  success: 'bg-success-soft text-success-ink ring-success-line',
} as const;
export type NoticeTone = keyof typeof NOTICE_TONES;
const NOTICE_ICONS: Record<NoticeTone, IconName> = {
  info: 'info',
  warn: 'triangle-alert',
  danger: 'triangle-alert',
  success: 'check',
};

/** One line on a meaning's soft surface, with its icon if `icon` is set. */
export function Notice({
  tone = 'info',
  role = 'status',
  icon,
  dense = false,
  testId,
  className,
  children,
}: {
  tone?: NoticeTone;
  role?: 'status' | 'alert';
  /** `true` for the tone's own icon, or a named one. */
  icon?: boolean | IconName;
  /** Less padding on phones, for game screens that must fit one screen. */
  dense?: boolean;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const name = icon === true ? NOTICE_ICONS[tone] : icon || null;
  return (
    <div
      role={role}
      data-testid={testId}
      className={join(
        // A ring rather than a border, and snug lines: a notice takes no more height than its words.
        'flex items-start gap-2 rounded-xl px-3.5 text-small leading-snug ring-1 ring-inset',
        dense ? 'py-1.5 sm:py-2' : 'py-2',
        NOTICE_TONES[tone],
        className,
      )}
    >
      {name && <Icon name={name} className="mt-px" />}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/**
 * The status line: the one line under the room's header that says what is happening now ("Waiting
 * for: Ana, Ben"). `me` is the viewer's own move: the accent's soft surface, bolder, with a hand.
 * It replaces any separate "your turn" notice.
 */
export function StatusLine({
  children,
  me = false,
  icon,
  dense = false,
  className,
}: {
  children: ReactNode;
  /** It is the viewer's move. */
  me?: boolean;
  /** An icon for a neutral line (the `me` line always has the hand). */
  icon?: IconName;
  /** Less padding on phones, for game screens that must fit one screen. */
  dense?: boolean;
  className?: string;
}) {
  const name = me ? 'hand' : icon;
  return (
    <div
      role="status"
      data-ui="status"
      data-me={me || undefined}
      className={join(
        'flex items-start gap-2.5 rounded-xl border px-3.5 leading-snug',
        // Phones keep the line as snug as the screen needs; 16 px from `sm` up.
        dense ? 'py-1.5 sm:py-2.5' : 'py-2 sm:py-2.5',
        'text-small sm:text-body',
        me
          ? 'border-accent-line bg-accent-soft font-semibold text-accent-text'
          : 'border-line bg-panel text-ink-2',
        className,
      )}
    >
      {name && <Icon name={name} className="mt-px sm:size-6" />}
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

/** The "what should I do now?" line: a `StatusLine`, the viewer's own when `tone` is `action`. */
export function Hint({
  children,
  tone = 'neutral',
  dense = false,
}: {
  children: ReactNode;
  /** `action` (your move) is the `me` status line; `neutral` the plain one. */
  tone?: 'neutral' | 'action';
  dense?: boolean;
}) {
  return (
    <StatusLine me={tone === 'action'} dense={dense}>
      {children}
    </StatusLine>
  );
}

// Inputs: 48 px, the card surface and the input border (3.5:1). An error swaps the border for
// `danger` (its ink in dark mode, where the fill is too deep to see) and sets `aria-invalid`.
const FIELD = join(
  'block h-12 w-full min-w-0 rounded-lg border border-line-input bg-card px-3.5 text-body text-ink placeholder:text-ink-faint',
  'transition-[border-color] duration-[120ms] focus:border-focus',
  FOCUS_RING,
  'aria-invalid:border-2 aria-invalid:border-danger dark:aria-invalid:border-danger-ink',
  'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunk disabled:text-ink-2',
);

/** A one-line text box. `invalid` marks it wrong (red border, `aria-invalid`). */
export function Input({
  invalid = false,
  className,
  ...props
}: ComponentProps<'input'> & { invalid?: boolean }) {
  return (
    <input
      data-ui="input"
      aria-invalid={invalid || undefined}
      className={join(FIELD, 'read-only:border-dashed', className)}
      {...props}
    />
  );
}

/** A native select in the input's box, with a chevron. */
export function Select({
  invalid = false,
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <span className={join('relative block', className)}>
      <select
        data-ui="select"
        aria-invalid={invalid || undefined}
        className={join(FIELD, 'cursor-pointer appearance-none pr-10')}
        {...props}
      >
        {children}
      </select>
      <Icon
        name="chevron-down"
        className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-ink-2"
      />
    </span>
  );
}

/**
 * A label over its control, with an optional line of help and an error line under it. The label
 * wraps the control, so give it one control (an `Input` or a `Select`).
 */
export function Field({
  label,
  help,
  error,
  className,
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={join('grid gap-1.5', className)}>
      <span className="text-small font-semibold text-ink">{label}</span>
      {children}
      {help && <span className="text-caption text-ink-muted">{help}</span>}
      {error && (
        <span role="alert" className="flex items-center gap-1.5 text-small text-danger-ink">
          <Icon name="triangle-alert" size={16} />
          {error}
        </span>
      )}
    </label>
  );
}

const STEP_BUTTON = join(
  'grid min-h-11 w-11 shrink-0 place-items-center text-accent-text transition-colors duration-[120ms] hover:bg-accent-soft',
  'focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus',
  'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent',
);

/** A small count tapped up or down: `[−] 3 [+]`, 48 px tall with 44 px buttons. */
export function Stepper({
  value,
  onChange,
  label,
  min = 0,
  max = Number.POSITIVE_INFINITY,
  step = 1,
  disabled = false,
  format = String,
  fewerLabel = 'Fewer',
  moreLabel = 'More',
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  /** What is counted; screen readers hear it as the group's name. */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  format?: (value: number) => ReactNode;
  fewerLabel?: string;
  moreLabel?: string;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-ui="stepper"
      className={join(
        'inline-flex h-12 items-stretch overflow-hidden rounded-lg border border-line-input bg-card text-ink',
        disabled && 'border-line bg-sunk text-ink-2',
        className,
      )}
    >
      <button
        type="button"
        aria-label={fewerLabel}
        disabled={disabled || value - step < min}
        onClick={() => onChange(Math.max(min, value - step))}
        className={STEP_BUTTON}
      >
        <Icon name="minus" />
      </button>
      <output
        aria-live="polite"
        className="grid min-w-9 place-items-center px-1 font-semibold tabular-nums"
      >
        {format(value)}
      </output>
      <button
        type="button"
        aria-label={moreLabel}
        disabled={disabled || value + step > max}
        onClick={() => onChange(Math.min(max, value + step))}
        className={STEP_BUTTON}
      >
        <Icon name="plus" />
      </button>
    </div>
  );
}

/**
 * A strip of filter chips. Several may be on; on phones the strip scrolls sideways (no scrollbar)
 * instead of wrapping, from `sm` up it wraps.
 */
export function Chips({
  label,
  className,
  children,
}: {
  /** What the chips filter, for screen readers ("Filter games by category"). */
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      // The padding keeps the focus ring inside the scrolling box.
      className={join(
        '-mx-1.5 -mt-1.5 flex gap-2 overflow-x-auto p-1.5 [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** One filter chip: a 44 px pill, `ink` filled with `aria-pressed` when on (never the accent). */
export function Chip({
  pressed,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { pressed: boolean }) {
  return (
    <button
      type="button"
      data-ui="chip"
      aria-pressed={pressed}
      className={join(
        'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3.5 text-small font-semibold whitespace-nowrap',
        'transition-colors duration-[120ms] motion-safe:active:scale-[0.98]',
        FOCUS_RING,
        pressed
          ? 'border-ink bg-ink text-page'
          : 'border-line-strong bg-card text-ink hover:bg-panel',
        'disabled:cursor-not-allowed disabled:border-line disabled:bg-sunk disabled:text-ink-muted',
        className,
      )}
      {...props}
    />
  );
}

/** A list of 48 px rows with a hairline between them (people, settings, admin lists). */
export function Rows({ className, children }: { className?: string; children: ReactNode }) {
  return <ul className={join('divide-y divide-line', className)}>{children}</ul>;
}

/** One row: content, then trailing tags or buttons. `me` marks the viewer's own row. */
export function Row({
  me = false,
  className,
  children,
}: {
  me?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <li
      className={join(
        'flex min-h-12 items-center gap-3 py-1.5',
        me && '-mx-4 bg-accent-soft px-4',
        className,
      )}
    >
      {children}
    </li>
  );
}

/** A row's text button ("Make host", "Remove"): 44 px, accent text or `danger` ink. */
export function RowButton({
  danger = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="button"
      data-ui="row-button"
      className={join(
        'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-2 font-semibold transition-colors duration-[120ms]',
        FOCUS_RING,
        danger ? 'text-danger-ink hover:bg-danger-soft' : 'text-accent-text hover:bg-accent-soft',
        'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent',
        className,
      )}
      {...props}
    />
  );
}

/**
 * The stand-in for a list or screen that has nothing to show yet: `empty` (a dashed frame),
 * `error` (the danger surface, announced) or `loading` (three slow dots, still under reduced
 * motion). An icon or emoji, one sentence of title, an optional line and one action.
 */
export function Slate({
  kind = 'empty',
  icon,
  emoji,
  title,
  children,
  action,
  className,
}: {
  kind?: 'empty' | 'error' | 'loading';
  icon?: IconName;
  emoji?: string;
  title: ReactNode;
  children?: ReactNode;
  /** One `secondary` button, usually. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      aria-busy={kind === 'loading' || undefined}
      className={join(
        'grid justify-items-center gap-2 rounded-xl px-6 py-8 text-center text-small',
        kind === 'empty' && 'border border-dashed border-line-strong text-ink-muted',
        kind === 'error' && 'border border-danger-line bg-danger-soft text-danger-ink',
        kind === 'loading' && 'text-ink-muted',
        className,
      )}
    >
      {kind === 'loading' ? (
        <span aria-hidden className="inline-flex gap-1.5 py-3">
          {[0, 200, 400].map((delay) => (
            <span
              key={delay}
              style={{ animationDelay: `${delay}ms` }}
              className="size-2 rounded-full bg-accent opacity-70 motion-safe:animate-pulse"
            />
          ))}
        </span>
      ) : emoji ? (
        <span aria-hidden className="text-3xl leading-none">
          {emoji}
        </span>
      ) : icon ? (
        <Icon
          name={icon}
          size={32}
          className={kind === 'error' ? 'text-danger-ink' : 'text-ink-faint'}
        />
      ) : null}
      <span className={join('text-sub font-semibold', kind !== 'error' && 'text-ink')}>
        {title}
      </span>
      {Children.count(children) > 0 && <span>{children}</span>}
      {action && <span className="mt-1">{action}</span>}
    </div>
  );
}
