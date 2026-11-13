import {
  Button,
  Drawer,
  FIT_SIZE_VAR,
  RefusalSlot,
  StickyBar,
  cn,
  useFitSize,
  useFreeHeight,
  useWideScreen,
} from '@vt/ui';
import { type CSSProperties, type ReactNode, useRef, useState } from 'react';
import { HOURS, type SeanceView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { Avatar } from './Card.tsx';
import { PickableCard, PickButton, cardsOf, useLook } from './Look.tsx';
import { PastGuesses } from './PastGuesses.tsx';
import { TableTab } from './Table.tsx';
import { Tip } from './Tips.tsx';
import { atTable, pastGuesses, roman } from './status.ts';

/** The least height a ghost screen keeps on a short window: below it the page scrolls instead. */
const MIN_HEIGHT_PX = 420;
/** The gap between cards (Tailwind's `gap-2`). */
export const GAP = '0.5rem';

/** The seven hours as small marks, the current one lit (the Table drawer has the full clock). */
export function HourDots({ hour }: { hour: number }) {
  return (
    <ol aria-label={`Hour ${roman(hour)} of VII`} className="flex items-center gap-0.5">
      {Array.from({ length: HOURS }, (_, i) => i + 1).map((h) => (
        <li
          key={h}
          aria-current={h === hour ? 'step' : undefined}
          className={cn(
            'h-2 w-3 rounded-sm',
            h < hour ? 'bg-line-strong' : h === hour ? 'bg-special' : 'bg-sunk ring-1 ring-line',
            h === HOURS && h !== hour && 'ring-danger/70',
          )}
        />
      ))}
    </ol>
  );
}

/** Ravens the ghost can still send now. */
export const ravensNow = (g: NonNullable<SeanceView['game']>) =>
  g.difficulty === 'easy' ? (g.ravenHour === g.hour ? 0 : 1) : g.ravensLeft;

/**
 * The ghost's turn line, the same on every stage: the hour (or the final), the one thing happening
 * now and what is left, then the stage's own clock and action, the ravens and hour marks, and the
 * Table drawer (the hours, ravens, track, everyone's progress, the last verdicts and each
 * psychic's past guesses). Under it the room's notices and the first-time silent tip.
 */
export function GhostTurnLine({
  view,
  content,
  lead,
  doing,
  rest,
  clock,
  clockOnPhone = false,
  actions,
  ravens = true,
  refusal,
  notes,
  hostTools,
}: {
  view: SeanceView;
  content: Content;
  /** "Hour II" or "The final". */
  lead: string;
  doing: string;
  rest?: string;
  /** The stage's clock (wide screens; phones put it in the bar at the foot, unless `clockOnPhone`). */
  clock?: ReactNode;
  clockOnPhone?: boolean;
  /** The stage's main action, in the line on wide screens. */
  actions?: ReactNode;
  /** The raven count (not in the vote, when no raven can be sent). */
  ravens?: boolean;
  /** The anchor of the line's action's refusal. */
  refusal?: string;
  notes: ReactNode;
  /** The host's own controls, in the Table drawer. */
  hostTools?: ReactNode;
}) {
  const g = view.game!;
  const wide = useWideScreen();
  const [drawer, setDrawer] = useState(false);
  const count = ravensNow(g);
  const withGuesses = atTable(g).filter((p) => pastGuesses(g, p.color).length > 0);
  return (
    <>
      <section
        aria-label="Your turn"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-special-soft px-3 py-2 ring-1 ring-special-line"
      >
        <p role="status" className="min-w-0 flex-1 text-sm lg:text-base">
          <span aria-hidden>👻 </span>
          <span className="font-bold">{lead}</span>
          <span className="text-ink-muted"> · </span>
          <span className="font-semibold">{doing}</span>
          {rest && <span className="text-ink-muted"> · {rest}</span>}
        </p>
        {(wide || clockOnPhone) && (clock || (wide && actions)) && (
          <div className="flex shrink-0 items-center gap-2">
            {clock}
            {wide && actions}
          </div>
        )}
        <div className="flex shrink-0 items-center gap-2 text-xs text-ink-2 lg:text-sm">
          {ravens && (
            <span className={cn(!wide && 'sr-only')}>
              🐦‍⬛ {count} raven{count === 1 ? '' : 's'}
            </span>
          )}
          {wide && <HourDots hour={g.hour} />}
          <Button
            size="sm"
            variant="secondary"
            aria-haspopup="dialog"
            onClick={() => setDrawer(true)}
          >
            {!wide && ravens && <span aria-hidden>🐦‍⬛ {count} · </span>}Table ›
          </Button>
        </div>
        {refusal && <RefusalSlot anchor={refusal} className="basis-full" />}
      </section>
      <Drawer open={drawer} onClose={() => setDrawer(false)} title="The table" className="max-w-md">
        {drawer && (
          <div className="space-y-3">
            {!wide && <HourDots hour={g.hour} />}
            <TableTab view={view} content={content} />
            {withGuesses.length > 0 && (
              <section aria-label="Past guesses" className="space-y-2">
                <h3 className="font-bold">Past guesses</h3>
                {withGuesses.map((p) => (
                  <div key={p.color} className="flex items-start gap-2">
                    <Avatar color={p.color} content={content} name={p.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{p.name}</p>
                      <PastGuesses g={g} p={p} content={content} compact />
                    </div>
                  </div>
                ))}
              </section>
            )}
            {hostTools}
          </div>
        )}
      </Drawer>
      {notes}
      <Tip id="ghost-silent">
        🤫 You’re the ghost: not a word, a nod or a sigh. Your pictures do the talking. Tap a card
        to see it full screen; Pick the cards for a psychic, then Send.
      </Tip>
    </>
  );
}

/**
 * The ghost's play area: the window's free height (no less on a wide screen, so a hand too tall
 * for it grows the page and `useFitSize` shrinks it back; exactly that on a phone, which the cards
 * size to), and the whole window's width on wide screens (`data-vt-full-width`, `index.css`).
 */
export function GhostFrame({
  children,
  className,
  name,
}: {
  children: ReactNode;
  className?: string;
  /** `data-ui` for tests and shots. */
  name: string;
}) {
  const wide = useWideScreen();
  const root = useRef<HTMLDivElement>(null);
  const free = useFreeHeight(root);
  const height = free === null ? undefined : Math.max(MIN_HEIGHT_PX, free);
  return (
    <div
      ref={root}
      style={wide ? { minHeight: height } : { height }}
      className={cn('flex min-h-0 flex-col gap-2', className)}
      data-ui={name}
      data-vt-full-width=""
    >
      {children}
    </div>
  );
}

/**
 * The ghost's hand: Raven at its head, the cards (a tap looks at one full screen; Pick, on the
 * card or in the full-screen view, which then closes, chooses it), anything the stage adds under
 * them, and its one action at the foot (the bar on phones). Wide screens: as tall as the window
 * lets it be (`useFitSize`), no wider than 45% of the screen (or `widthCap`).
 */
export function HandPanel({
  hand,
  content,
  sub,
  picked,
  pickable,
  onToggle,
  pickLabel,
  pickedLabel,
  raven,
  onRaven,
  ravenDisabled,
  ravenLabel,
  children,
  footer,
  refusal,
  label,
  className,
  style,
  widthCap = '45cqw',
  compactSub = false,
}: {
  hand: readonly number[];
  content: Content;
  sub: string;
  picked: readonly number[];
  /** Without it the cards are only looked at; with it, whether a card not picked may be. */
  pickable?: (card: number) => boolean;
  onToggle: (card: number) => void;
  pickLabel: string;
  pickedLabel: string;
  raven: boolean;
  onRaven: () => void;
  ravenDisabled: boolean;
  ravenLabel: string;
  children?: ReactNode;
  footer?: ReactNode;
  refusal: string;
  /** The panel's region name, when a stage gives it one. */
  label?: string;
  className?: string;
  style?: CSSProperties;
  /** The hand's widest on a wide screen, in units of the nearest container (the panel's own, when it is one). */
  widthCap?: string;
  /** Phones keep the sub line for screen readers only (a stage tight on height). */
  compactSub?: boolean;
}) {
  const wide = useWideScreen();
  const can = (c: number) => !!pickable && (picked.includes(c) || pickable(c));
  const { look, viewer } = useLook(content, (c, close) =>
    pickable ? (
      <PickButton
        kind="vision"
        n={c.n}
        on={picked.includes(c.n)}
        disabled={!can(c.n)}
        onToggle={() => {
          onToggle(c.n);
          close();
        }}
        label={pickLabel}
        onLabel={pickedLabel}
        big
      />
    ) : null,
  );
  const rows = Math.max(1, Math.ceil(hand.length / 4));
  const width = wide
    ? `min(var(${FIT_SIZE_VAR}, 160px) * 700 / 1024, (${widthCap} - 3 * ${GAP} - 1.5rem) / 4)`
    : `min((100cqw - 3 * ${GAP}) / 4, ((100cqh - ${rows - 1} * ${GAP}) / ${rows}) * 700 / 1024)`;
  const list = useRef<HTMLUListElement>(null);
  useFitSize(list, { on: wide, min: 80, max: 520 });
  return (
    <section
      role={label ? 'region' : undefined}
      aria-label={label}
      style={style}
      className={cn(
        'flex min-h-0 flex-col gap-1.5 rounded-xl bg-card p-2 ring-1 ring-line lg:p-3',
        className,
      )}
    >
      {viewer}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-bold">Your hand</h3>
          <p
            className={cn(
              'text-xs text-ink-muted',
              compactSub && 'max-lg:sr-only',
              'max-lg:truncate',
            )}
          >
            {sub}
          </p>
        </div>
        <Button
          size="sm"
          variant={raven ? 'primary' : 'secondary'}
          aria-pressed={raven}
          disabled={ravenDisabled}
          onClick={onRaven}
        >
          🐦‍⬛ {ravenLabel}
        </Button>
      </div>
      <div className={cn(wide ? 'shrink-0' : 'min-h-0 flex-1 [container-type:size]')}>
        <ul
          ref={list}
          aria-label="Your hand"
          className="grid content-start lg:justify-center"
          style={{ gridTemplateColumns: `repeat(4, ${width})`, gap: GAP }}
        >
          {hand.map((c, i) => (
            <li key={c}>
              <PickableCard
                kind="vision"
                n={c}
                content={content}
                onLook={() => look(cardsOf('vision', hand), i, 'Your hand')}
                pick={
                  pickable
                    ? {
                        on: picked.includes(c),
                        onToggle: () => onToggle(c),
                        label: pickLabel,
                        onLabel: pickedLabel,
                        disabled: !can(c),
                      }
                    : undefined
                }
              />
            </li>
          ))}
        </ul>
      </div>
      {children}
      {footer && (
        <div className="mt-auto">
          <StickyBar fixed refusal={refusal}>
            {footer}
          </StickyBar>
        </div>
      )}
    </section>
  );
}
