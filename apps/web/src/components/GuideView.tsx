import {
  type GameGuide,
  type GuideCard,
  type GuideCatalogGroup,
  type GuideContext,
  type GuideLevel,
  type GuideList,
  type GuideSection,
  type GuideStep,
  type GuideTile,
  type GuideTone,
  isOn,
  levelOf,
  stepsOf,
  withoutSecrets,
} from '@vt/game-sdk';
import {
  Button,
  Chip as FilterChip,
  Icon,
  Modal,
  Peek as SharedPeek,
  ProtectedImage,
  Tabs,
  cn,
  tabPanelProps,
} from '@vt/ui';
import {
  type CSSProperties,
  type ReactNode,
  type TouchEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ClientGame } from '../games/registry.ts';

/** Tailwind's `lg`: wide enough for Learn's rail. */
const DESKTOP = '(min-width: 1024px)';
const desktop = () => typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP).matches;
function onDesktopChange(change: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const q = window.matchMedia(DESKTOP);
  q.addEventListener('change', change);
  return () => {
    q.removeEventListener('change', change);
  };
}
/** Whether the screen is a desktop's width, kept up to date. */
const useDesktop = () => useSyncExternalStore(onDesktopChange, desktop, () => false);

/** Named guides already loaded this page, so a card or page mounted later shows them at once. */
const namedGuides = new Map<string, GameGuide>();

/**
 * A game's guide, named from its private manifest once that has loaded (back-room games that
 * offer `namedGuide`); the plain guide until then, or when it can't load. Cards, rules pages and
 * the rules drawer all read it, so a back-room game never shows its placeholder words to players
 * who can see the real ones.
 */
export function useGameGuide(game: ClientGame): GameGuide {
  const [named, setNamed] = useState<{ id: string; guide: GameGuide } | null>(null);
  useEffect(() => {
    if (!game.namedGuide || namedGuides.has(game.id)) return;
    let live = true;
    game
      .namedGuide()
      .then((guide) => {
        namedGuides.set(game.id, guide);
        if (live) setNamed({ id: game.id, guide });
      })
      .catch(() => {
        // No manifest: the plain guide stays.
      });
    return () => {
      live = false;
    };
  }, [game]);
  return (
    (named?.id === game.id ? named.guide : undefined) ??
    (game.namedGuide && namedGuides.get(game.id)) ??
    game.guide
  );
}

/** What the drawer knows about the room: the viewer's own view and id. */
export interface GuideRoomState {
  view: unknown;
  you: string;
}

/** The guide's reading of a room, or nothing when the game can't tell (or it throws). */
export function guideContext(guide: GameGuide, room: GuideRoomState | undefined) {
  if (!room || !guide.room) return undefined;
  try {
    return guide.room(room.view, room.you);
  } catch {
    return undefined;
  }
}

/** A game's guide (see `useGameGuide`), knowing the room when it's opened from one. */
export function GameGuideView({
  game,
  compact = false,
  room,
  focus,
  start,
  done,
  ready,
}: {
  game: ClientGame;
  compact?: boolean;
  room?: GuideRoomState;
  focus?: GuideFocus;
  /** The tab to open on (Learn by default). */
  start?: GuideTab;
  done?: ReactNode;
  /** "Ready to play?": under the guide, or in Learn's rail on a desktop. */
  ready?: ReactNode;
}) {
  const guide = useGameGuide(game);
  const context = guideContext(guide, room);
  return (
    <GuideView
      guide={guide}
      compact={compact}
      inRoom={room !== undefined}
      {...(context && { context })}
      {...(focus && { focus })}
      {...(start && { start })}
      done={done}
      ready={ready}
    />
  );
}

/** A role entry's anchor, so a game can open the guide at it: "Merlin (Good)" → "guide-role-merlin". */
export const roleAnchor = (name: string) =>
  `guide-role-${name
    .replace(/\s*\(.*\)$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')}`;

/** Asks the guide to open a tile's sheet (a tile id or a role anchor); `n` makes repeats count. */
export interface GuideFocus {
  topic: string;
  n: number;
}

type Tab = 'learn' | 'tiles' | 'cards' | 'rules' | 'ref';
export type GuideTab = Tab;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sectionWords = (s: GuideSection) =>
  words([...(s.paragraphs ?? []), ...(s.bullets ?? [])].join(' '));
const minutes = (n: number) => Math.max(1, Math.round(n / 200));

/** Finds the tile a topic names: its id, or the role anchor of its name. */
function tileFor(guide: GameGuide, topic: string): GuideTile | undefined {
  return guide.tiles?.items.find((t) => t.id === topic || roleAnchor(t.name) === topic);
}

/**
 * Renders any game's guide with the same structure, so every game reads alike: Learn (the goal
 * and a short stepper), the game's things to browse, the rules in three bands, and a cheat sheet.
 * `context` is what the room says (or nothing on the rules page, where presets stand in for it).
 */
export function GuideView({
  guide,
  compact = false,
  inRoom = false,
  context,
  focus,
  start = 'learn',
  done,
  ready,
}: {
  guide: GameGuide;
  compact?: boolean;
  inRoom?: boolean;
  context?: GuideContext;
  focus?: GuideFocus;
  start?: Tab;
  done?: ReactNode;
  ready?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(start);
  const [sheet, setSheet] = useState<GuideTile | null>(null);
  const [card, setCard] = useState<GuideCard | null>(null);
  // A tile's sheet asked for its cards: the catalog opens at that group.
  const [jump, setJump] = useState<{ id: string; n: number } | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const full = context ?? guide.presets?.find((p) => p.id === preset)?.context;
  // A secret role stays out of the page until the viewer holds the peek or switches it on.
  const [peekOpen, setPeekOpen] = useState(false);
  const [peekHeld, setPeekHeld] = useState(false);
  const secret = !!full?.secret && !!(full.you || full.stepNotes);
  const peeking = peekOpen || peekHeld;
  const ctx = full && secret && !peeking ? withoutSecrets(full) : full;
  const tabsId = useId();
  const top = useRef<HTMLDivElement>(null);
  // On a desktop, Learn has a rail beside it that holds "Ready to play?".
  const rail = useDesktop() && !compact;

  // A game asked for a role ("What's my role?"): open its sheet on the browse tab.
  const [seenFocus, setSeenFocus] = useState<GuideFocus>();
  if (focus && focus !== seenFocus) {
    setSeenFocus(focus);
    const tile = tileFor(guide, focus.topic);
    if (tile) {
      setTab('tiles');
      setSheet(tile);
    }
  }

  const go = (t: Tab) => {
    setTab(t);
    top.current?.scrollIntoView({ block: 'start' });
  };
  const tabs: [Tab, string][] = [
    ['learn', 'Learn'],
    ...(guide.tiles?.items.length ? [['tiles', guide.tiles.label] as [Tab, string]] : []),
    ...(guide.catalog?.groups.length ? [['cards', guide.catalog.label] as [Tab, string]] : []),
    ['rules', 'Rules'],
    ['ref', 'Cheat sheet'],
  ];

  return (
    <article className="leading-relaxed" data-testid="guide">
      <div ref={top} className="scroll-mt-16" />
      {context?.summary && (
        <p className="mb-3 rounded-xl bg-accent-soft px-3 py-1.5 text-sm ring-1 ring-accent-line">
          <span aria-hidden>🏠 </span>
          In your room: {context.summary}
        </p>
      )}
      <div
        className={cn(
          'sticky z-10 mb-4',
          compact ? 'top-[52px] bg-panel' : 'top-0 bg-page/95 backdrop-blur',
        )}
      >
        <Tabs
          id={tabsId}
          label="Guide"
          tabs={tabs.map(([id, label]) => ({ id, label }))}
          value={tab}
          onChange={setTab}
        />
      </div>

      <div {...tabPanelProps(tabsId, tab)}>
        {!context &&
          guide.presets &&
          guide.presets.length > 0 &&
          (tab === 'tiles' || tab === 'cards' || tab === 'rules') && (
            <PresetPicker
              presets={guide.presets}
              value={preset}
              onChange={setPreset}
              summary={ctx?.summary}
            />
          )}
        {tab === 'learn' && (
          <Learn
            guide={guide}
            compact={compact}
            ctx={ctx}
            done={done}
            go={go}
            openTile={(t) => setSheet(t)}
            ready={rail ? ready : undefined}
            {...(secret && {
              peek: { shown: peeking, open: peekOpen, setOpen: setPeekOpen, setHeld: setPeekHeld },
            })}
          />
        )}
        {tab === 'tiles' && guide.tiles && (
          <Tiles
            key={`${preset}-${Object.keys(ctx?.inGame ?? {}).length > 0}`}
            guide={guide}
            ctx={ctx}
            open={(t) => setSheet(t)}
          />
        )}
        {tab === 'cards' && guide.catalog && (
          <Catalog
            key={`${preset}-${Object.keys(ctx?.inGame ?? {}).length > 0}-${jump?.n ?? 0}`}
            guide={guide}
            ctx={ctx}
            jump={jump?.id}
            open={setCard}
          />
        )}
        {/* Prose keeps a reading width when the guide is wide. */}
        {tab === 'rules' && (
          <div className={cn(!compact && 'xl:mx-auto xl:max-w-3xl')}>
            <Rules guide={guide} ctx={ctx} inRoom={inRoom} />
          </div>
        )}
        {tab === 'ref' && (
          <div className={cn(!compact && 'xl:mx-auto xl:max-w-3xl')}>
            <Reference guide={guide} />
          </div>
        )}
      </div>
      {ready && !(rail && tab === 'learn') && <div className="mt-8">{ready}</div>}

      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.name ?? ''}>
        {sheet && (
          <TileSheet
            tile={sheet}
            ctx={ctx}
            cards={
              sheet.catalog && guide.catalog?.groups.some((g) => g.id === sheet.catalog)
                ? () => {
                    setJump({ id: sheet.catalog!, n: (jump?.n ?? 0) + 1 });
                    setSheet(null);
                    setTab('cards');
                  }
                : undefined
            }
          />
        )}
      </Modal>
      <Modal open={card !== null} onClose={() => setCard(null)} title={card?.name ?? ''}>
        {card && <CardSheet card={card} />}
      </Modal>
    </article>
  );
}

function PresetPicker({
  presets,
  value,
  onChange,
  summary,
}: {
  presets: NonNullable<GameGuide['presets']>;
  value: string | null;
  onChange: (id: string | null) => void;
  summary: string | undefined;
}) {
  const id = useId();
  return (
    <div className="mb-3 rounded-2xl bg-card px-3 py-2 ring-1 ring-line">
      <label htmlFor={id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="font-semibold">
          <span aria-hidden>🎲 </span>Show the rules for
        </span>
        <select
          id={id}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="min-h-11 max-w-full rounded-lg bg-page px-2 font-semibold ring-1 ring-line"
        >
          <option value="">Everything</option>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {summary && <p className="mt-1 text-sm text-ink-muted">{summary}</p>}
    </div>
  );
}

function Chip({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <FilterChip pressed={on} onClick={onClick}>
      {children}
    </FilterChip>
  );
}

const EYEBROW = 'text-caption font-bold tracking-[0.08em] text-accent-text uppercase';

/** Private art, or `fallback` (an emoji) when it can't load. */
function Art({
  src,
  className,
  fallback = null,
  focus,
  zoom,
}: {
  src: string;
  className?: string;
  fallback?: ReactNode;
  focus?: [number, number] | undefined;
  /** How far to zoom in on `focus` (needs `object-cover` and a frame that clips). */
  zoom?: number | undefined;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (failed === src) return <>{fallback}</>;
  return (
    <ProtectedImage
      src={src}
      alt=""
      loading="lazy"
      className={className}
      onError={() => setFailed(src)}
      {...(focus && { style: focusStyle(focus, zoom) })}
    />
  );
}

/**
 * Crops a cover-fitted picture to its focus. Positioned at the focus, the focus sits at the same
 * fraction of the frame whatever the picture's shape; a zoom then scales around the point that
 * brings it to the middle, kept inside the frame so the picture never leaves a gap.
 */
function focusStyle([fx, fy]: [number, number], zoom = 1): CSSProperties {
  const style: CSSProperties = { objectPosition: `${fx * 100}% ${fy * 100}%` };
  if (zoom <= 1) return style;
  const origin = (f: number) => Math.min(1, Math.max(0, (zoom * f - 0.5) / (zoom - 1))) * 100;
  return {
    ...style,
    transform: `scale(${zoom})`,
    transformOrigin: `${origin(fx)}% ${origin(fy)}%`,
  };
}

/** The peek over a secret role: held (press and hold) or switched on with Show. */
interface Peek {
  shown: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  setHeld: (held: boolean) => void;
}

/**
 * Hidden information behind the shared hold-to-peek and Show/Hide switch. While it's hidden,
 * nothing secret is in the page at all: the room context has had its secrets taken out
 * (`withoutSecrets`).
 */
function PeekGate({ peek, children }: { peek: Peek; children: ReactNode }) {
  return (
    <div data-testid="guide-peek">
      <SharedPeek
        what="my role"
        open={peek.open}
        onOpenChange={peek.setOpen}
        onShownChange={peek.setHeld}
        cover={
          <span className="flex items-center gap-3 rounded-2xl bg-card p-3 ring-1 ring-line">
            <span aria-hidden className="w-14 shrink-0 text-center text-4xl">
              🎴
            </span>
            <span className="min-w-0">
              <span className={cn('block', EYEBROW)}>Your role</span>
              <span className="block text-sm text-ink-muted">
                Hidden so nobody reads it over your shoulder. Hold here to peek.
              </span>
            </span>
          </span>
        }
      >
        {children}
      </SharedPeek>
    </div>
  );
}

function Learn({
  guide,
  compact,
  ctx,
  done,
  go,
  openTile,
  peek,
  ready,
}: {
  guide: GameGuide;
  compact: boolean;
  ctx: GuideContext | undefined;
  done: ReactNode;
  go: (t: Tab) => void;
  openTile: (t: GuideTile) => void;
  /** "Ready to play?", in the rail on a desktop. */
  ready?: ReactNode;
  /** The room's role is secret: the card shows only while peeking. */
  peek?: Peek;
}) {
  const you = ctx?.you;
  const youTile = you?.tile ? guide.tiles?.items.find((t) => t.id === you.tile) : undefined;
  const youArt = you?.art ?? youTile?.art;
  const youText = you?.text ?? youTile?.text;
  const youSubtitle = you?.subtitle ?? youTile?.subtitle;
  const tiles = guide.tiles;
  const card = you && (
    <section aria-label="You are" className="flex gap-3 rounded-2xl bg-card p-3 ring-2 ring-accent">
      {youArt ? (
        <button
          type="button"
          className="w-20 shrink-0"
          onClick={() => youTile && openTile(youTile)}
          aria-label={`Read the ${you.name} card`}
          disabled={!youTile}
        >
          <Art src={youArt} className="w-full rounded-xl" />
        </button>
      ) : (
        <span aria-hidden className="w-14 shrink-0 text-center text-5xl">
          {you.icon ?? youTile?.icon ?? '🎴'}
        </span>
      )}
      <div className="min-w-0">
        <p className={EYEBROW}>You are</p>
        <p className="text-xl font-extrabold">{you.name}</p>
        {youSubtitle && <p className="text-sm font-semibold text-ink-muted">{youSubtitle}</p>}
        {youText && <p className="text-sm">{youText}</p>}
        {you.now && <p className="mt-1 text-sm font-bold text-accent-text">{you.now}</p>}
      </div>
    </section>
  );
  return (
    <div
      className={cn(
        'space-y-3',
        !compact &&
          !!ready &&
          'lg:grid lg:grid-cols-[1fr_18.75rem] lg:items-start lg:gap-4 lg:space-y-0',
      )}
    >
      <div className="space-y-3 lg:space-y-4">
        {peek ? <PeekGate peek={peek}>{card}</PeekGate> : card}
        <section
          aria-label="The goal"
          className="rounded-xl bg-accent-soft p-4 ring-1 ring-accent-line"
        >
          <p className={EYEBROW}>The goal</p>
          <p className="mt-1 text-sub font-medium">{guide.goal}</p>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-small text-ink-2">
            <span className="flex items-center gap-1.5">
              <Icon name="users" size={16} />
              {guide.players}
            </span>
            <span className="flex items-center gap-1.5">
              <Icon name="hourglass" size={16} />
              {guide.duration}
            </span>
          </p>
        </section>
        <Stepper
          guide={guide}
          ctx={ctx}
          done={done}
          more={tiles?.items.length ? () => go('tiles') : undefined}
          compact={compact}
        />
        {!tiles && guide.roles && guide.roles.length > 0 && <WhoIsWho guide={guide} />}
      </div>
      {ready && <div className="space-y-3 lg:space-y-4">{ready}</div>}
    </div>
  );
}

function WhoIsWho({ guide }: { guide: GameGuide }) {
  return (
    <section
      aria-label="Who's who"
      className="rounded-xl bg-card p-4 shadow-vt-1-edge ring-1 ring-line"
    >
      <h3 className="mb-1 font-bold">Who’s who</h3>
      <dl className="space-y-2">
        {guide.roles!.map((r) => (
          <div key={r.name} id={roleAnchor(r.name)} className="scroll-mt-24">
            <dt className="font-semibold">
              {r.icon && <span aria-hidden>{r.icon} </span>}
              {r.name}
            </dt>
            <dd className="text-sm text-ink-2">{r.summary}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * "How a game goes": one step at a time, with Back/Next, dots and swipe, ending on "That's the
 * whole game". Also the lobby's first-time intro (`title`, `onFinish`).
 */
/** A step's emoji on a `sunk` tile (a step with no art, or art that didn't load). */
function StepEmblem({ icon }: { icon?: string | undefined }) {
  return (
    <span
      aria-hidden
      className="flex size-24 items-center justify-center rounded-xl bg-sunk text-5xl ring-1 ring-line"
    >
      {icon ?? '🎲'}
    </span>
  );
}

export function Stepper({
  guide,
  ctx,
  done,
  more,
  compact = false,
  title = 'How a game goes',
  onFinish,
}: {
  guide: GameGuide;
  ctx?: GuideContext | undefined;
  done?: ReactNode;
  more?: (() => void) | undefined;
  compact?: boolean;
  title?: string;
  onFinish?: () => void;
}) {
  const steps = stepsOf(guide);
  const [i, setI] = useState(0);
  const last = steps.length;
  const go = (n: number) => setI(Math.max(0, Math.min(last, n)));
  const x0 = useRef<number | null>(null);
  const swipe = {
    onTouchStart: (e: TouchEvent) => {
      x0.current = e.touches[0]?.clientX ?? null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const start = x0.current;
      x0.current = null;
      const end = e.changedTouches[0]?.clientX;
      if (start === null || end === undefined || Math.abs(end - start) < 40) return;
      go(i + (end < start ? 1 : -1));
    },
  };
  if (!steps.length) return null;
  const step: GuideStep | undefined = steps[i];
  const note = ctx?.stepNotes?.[i];
  return (
    <section
      aria-label={title}
      className="rounded-xl bg-card p-4 shadow-vt-1-edge ring-1 ring-line"
      data-testid="guide-stepper"
    >
      <p className={cn(EYEBROW, 'flex justify-between gap-2 text-ink-2')}>
        <span>{title}</span>
        <span className="font-normal tracking-normal text-ink-muted normal-case">
          {step ? `${i + 1} of ${last}` : 'Done'}
        </span>
      </p>
      <div className="mt-2 min-h-56" aria-live="polite" {...swipe}>
        {step ? (
          <div key={i} className="motion-safe:animate-[guide-in_.25s_ease]">
            {step.art ? (
              <div
                className={cn(
                  // Art gets no backdrop of its own, so a tall card isn't a sliver in a wide box.
                  'mb-3 flex items-center justify-center overflow-hidden rounded-lg',
                  compact ? 'h-28' : 'h-32 sm:h-40 lg:h-52 xl:h-64',
                )}
              >
                <Art
                  src={step.art}
                  className="h-full w-auto max-w-full rounded-lg object-contain shadow"
                  fallback={<StepEmblem icon={step.icon} />}
                />
              </div>
            ) : (
              // No art: the step's emblem on a small tile, so the words sit high, not under a slab.
              <div className="mb-3 flex justify-center">
                <StepEmblem icon={step.icon} />
              </div>
            )}
            <h3 className="text-sub leading-snug font-semibold">
              <span className="font-display text-heading text-accent-text">{i + 1}.</span>{' '}
              {step.title}
            </h3>
            {step.text && <p className="mt-1 text-ink-2">{step.text}</p>}
            {note && (
              <p className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-sm">👉 {note}</p>
            )}
          </div>
        ) : (
          <div className="motion-safe:animate-[guide-in_.25s_ease]">
            <div className="mb-3 flex justify-center">
              <StepEmblem icon="🎉" />
            </div>
            <h3 className="text-sub font-semibold">That’s the whole game</h3>
            <p className="mt-1 text-ink-2">
              {guide.stepsDone ??
                'You know enough to play. The app guides each step on screen; come back here any time.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onFinish && (
                <Button size="sm" onClick={onFinish}>
                  Got it, let’s play
                </Button>
              )}
              {done}
              {more && (
                <Button variant="secondary" size="sm" onClick={more}>
                  See the {guide.tiles?.label.toLowerCase() ?? 'roles'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      {/* On phones Back/Next stay at the window's foot while the step is on screen, so the way on
          is never below the fold under a tall goal or step. */}
      <div className="-mx-4 mt-1 -mb-4 flex items-center justify-between gap-2 rounded-b-xl bg-card px-4 pt-3 pb-4 max-lg:sticky max-lg:bottom-0 max-lg:z-10 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button
          variant="secondary"
          size="sm"
          disabled={i === 0}
          // The first step has nothing to go back to: the button keeps its place, unseen (but
          // still announced as disabled).
          className={cn(i === 0 && 'opacity-0')}
          onClick={() => go(i - 1)}
        >
          <Icon name="arrow-left" size={16} />
          Back
        </Button>
        {/* One dot per step, as the "1 of 6" counts them; the closing slide fills them all. */}
        <span className="flex gap-1.5" aria-hidden data-testid="guide-dots">
          {steps.map((_, k) => (
            <i
              key={k}
              className={cn(
                'h-1.5 rounded-full transition-all duration-[180ms]',
                k === i
                  ? 'w-[18px] bg-accent'
                  : i === last
                    ? 'w-1.5 bg-accent'
                    : 'w-1.5 bg-line-strong',
              )}
            />
          ))}
        </span>
        <Button size="sm" className={cn(i === last && 'invisible')} onClick={() => go(i + 1)}>
          Next
          <Icon name="arrow-right" size={16} />
        </Button>
      </div>
    </section>
  );
}

const TONE: Record<GuideTone, string> = {
  good: 'border-t-team-b',
  evil: 'border-t-team-a',
  own: 'border-t-special',
  alien: 'border-t-success',
  neutral: 'border-t-line-strong',
};

function Tiles({
  guide,
  ctx,
  open,
}: {
  guide: GameGuide;
  ctx: GuideContext | undefined;
  open: (t: GuideTile) => void;
}) {
  const { items, intro, shape = 'square' } = guide.tiles!;
  // Nothing in play yet (no heroes picked): there is nothing to filter to.
  const inGame = ctx?.inGame && Object.keys(ctx.inGame).length ? ctx.inGame : undefined;
  const groups = useMemo(
    () => [...new Set(items.map((t) => t.group).filter((g): g is string => !!g))],
    [items],
  );
  const [filter, setFilter] = useState<string>(inGame ? 'in-game' : 'all');
  const [term, setTerm] = useState('');
  const shown = items.filter(
    (t) =>
      (filter === 'all' ||
        (filter === 'in-game' && inGame?.[t.id] !== undefined) ||
        t.group === filter) &&
      (!term ||
        `${t.name} ${t.subtitle ?? ''} ${t.text}`.toLowerCase().includes(term.toLowerCase())),
  );
  return (
    <div>
      {intro && <p className="mb-2 text-sm text-ink-muted">{intro}</p>}
      <div className="mb-3 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter">
        {inGame && (
          <Chip on={filter === 'in-game'} onClick={() => setFilter('in-game')}>
            In this game
          </Chip>
        )}
        {(inGame || groups.length > 1) && (
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
            All {items.length}
          </Chip>
        )}
        {groups.length > 1 &&
          groups.map((g) => (
            <Chip key={g} on={filter === g} onClick={() => setFilter(g)}>
              {g}
            </Chip>
          ))}
        {items.length > 20 && (
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search…"
            aria-label="Search"
            className="min-h-11 min-w-36 flex-1 rounded-full bg-card px-3 text-sm ring-1 ring-line"
          />
        )}
      </div>
      {shown.length === 0 && <p className="text-sm text-ink-muted">Nothing matches.</p>}
      <ul
        className={cn(
          'grid gap-2',
          shape === 'wide'
            ? 'grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]'
            : 'grid-cols-[repeat(auto-fill,minmax(6.25rem,1fr))] sm:grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))]',
        )}
      >
        {shown.map((t) => {
          const count = inGame?.[t.id];
          const off = !isOn(t.option, ctx);
          return (
            <li key={t.id}>
              <button
                type="button"
                id={roleAnchor(t.name)}
                onClick={() => open(t)}
                className={cn(
                  'relative flex h-full w-full flex-col overflow-hidden rounded-2xl border-t-4 bg-card text-left ring-1 ring-line hover:ring-accent',
                  t.tone ? TONE[t.tone] : 'border-t-transparent',
                  off && 'opacity-60',
                )}
              >
                <span
                  className={cn(
                    'flex w-full items-center justify-center overflow-hidden bg-page',
                    shape === 'wide'
                      ? 'aspect-[5/3]'
                      : shape === 'card'
                        ? 'aspect-[5/7]'
                        : 'aspect-square',
                  )}
                >
                  {t.art ? (
                    <Art
                      src={t.art}
                      focus={t.focus}
                      zoom={t.zoom}
                      className="h-full w-full object-cover"
                      fallback={<TileIcon icon={t.icon} />}
                    />
                  ) : (
                    <TileIcon icon={t.icon} />
                  )}
                </span>
                <span className="px-2 py-1.5 text-sm leading-tight font-bold">
                  {t.name}
                  {count !== undefined && count > 1 && (
                    <span className="font-semibold text-ink-muted"> ×{count}</span>
                  )}
                  {t.subtitle && (
                    <span className="block text-xs font-semibold text-ink-muted">{t.subtitle}</span>
                  )}
                </span>
                {t.badge && (
                  <span className="absolute top-1.5 left-1.5 rounded-full bg-black/65 px-2 text-xs font-bold text-white">
                    {t.badge}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A cell's first line, then any further lines smaller and muted (a hero's class). */
function TableCell({ text }: { text: string }) {
  const [first, ...rest] = text.split('\n');
  return (
    <>
      {first}
      {rest.map((line, i) => (
        <span key={i} className="block text-xs text-ink-muted">
          {line}
        </span>
      ))}
    </>
  );
}

function TileIcon({ icon }: { icon: string | undefined }) {
  return (
    <span aria-hidden className="text-4xl">
      {icon ?? '🎴'}
    </span>
  );
}

function TileSheet({
  tile,
  ctx,
  cards,
}: {
  tile: GuideTile;
  ctx: GuideContext | undefined;
  /** Opens the catalog at this tile's cards. */
  cards: (() => void) | undefined;
}) {
  const art = tile.card ?? tile.art;
  const off = !isOn(tile.option, ctx);
  return (
    <div className="space-y-2" data-testid="guide-sheet">
      {tile.subtitle && (
        <p className="-mt-1 text-sm font-semibold text-ink-muted">{tile.subtitle}</p>
      )}
      {art ? (
        <Art
          src={art}
          className={cn(
            'mx-auto w-auto max-w-full rounded-xl bg-page object-contain',
            // Abilities to read: a smaller picture keeps them in view on a phone.
            tile.highlights ? 'max-h-[26dvh]' : 'max-h-[46dvh]',
          )}
          fallback={
            <p aria-hidden className="text-center text-6xl">
              {tile.icon ?? '🎴'}
            </p>
          }
        />
      ) : (
        <p aria-hidden className="text-center text-6xl">
          {tile.icon ?? '🎴'}
        </p>
      )}
      {(tile.meta || tile.option) && (
        <p className="text-sm text-ink-muted">
          {[
            tile.meta,
            tile.option && (off ? `Not in this game (${tile.option.label})` : tile.option.label),
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      )}
      <p>{tile.text}</p>
      {tile.win && <p className="rounded-xl bg-accent-soft px-3 py-2">🏆 {tile.win}</p>}
      {tile.highlights && tile.highlights.items.length > 0 && (
        <section
          aria-label={tile.highlights.title}
          className="rounded-xl bg-accent-soft/60 p-3 ring-1 ring-accent-line"
        >
          <p className={EYEBROW}>{tile.highlights.title}</p>
          <ul className="mt-1 space-y-2">
            {tile.highlights.items.map((h) => (
              <li key={h.name} className="flex gap-2">
                {h.art && (
                  <Art
                    src={h.art}
                    className="aspect-[400/630] w-12 shrink-0 rounded-md bg-page object-cover"
                  />
                )}
                <span className="min-w-0">
                  <span className="block font-bold">{h.name}</span>
                  <span className="block text-sm">{h.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {cards && (
        <Button variant="secondary" size="sm" className="min-h-11 w-full" onClick={cards}>
          See every card, with what it does →
        </Button>
      )}
      {tile.more && (
        <div>
          <p className="font-semibold">{tile.more.title}</p>
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {tile.more.items.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The catalog: cards grouped under their hero (or faction), each group folding away, with chips
 * to jump to a group and the same filters as the tiles.
 */
function Catalog({
  guide,
  ctx,
  jump,
  open,
}: {
  guide: GameGuide;
  ctx: GuideContext | undefined;
  jump: string | undefined;
  open: (c: GuideCard) => void;
}) {
  const { groups, intro } = guide.catalog!;
  const inGame = ctx?.inGame && Object.keys(ctx.inGame).length ? ctx.inGame : undefined;
  const sets = useMemo(
    () => [...new Set(groups.map((g) => g.group).filter((g): g is string => !!g))],
    [groups],
  );
  const [filter, setFilter] = useState<string>(
    inGame && (!jump || inGame[jump] !== undefined) ? 'in-game' : 'all',
  );
  const [term, setTerm] = useState('');
  const shown = groups.filter(
    (g) =>
      filter === 'all' ||
      (filter === 'in-game' && inGame?.[g.id] !== undefined) ||
      g.group === filter,
  );
  const first = jump ?? ctx?.you?.tile ?? shown[0]?.id;
  const [opened, setOpened] = useState<Set<string>>(() => new Set(first ? [first] : []));
  const anchor = (id: string) => `guide-cards-${id}`;
  // Opened from a tile: start at its group.
  useEffect(() => {
    if (jump) document.getElementById(anchor(jump))?.scrollIntoView({ block: 'start' });
  }, [jump]);
  const goTo = (id: string) => {
    setOpened((o) => new Set(o).add(id));
    requestAnimationFrame(() => {
      document.getElementById(anchor(id))?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    });
  };
  const needle = term.trim().toLowerCase();
  const matches = (c: GuideCard) => !needle || `${c.name} ${c.text}`.toLowerCase().includes(needle);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  return (
    <div>
      {intro && <p className="mb-2 text-sm text-ink-muted">{intro}</p>}
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter">
        {inGame && (
          <Chip on={filter === 'in-game'} onClick={() => setFilter('in-game')}>
            In this game
          </Chip>
        )}
        {(inGame || sets.length > 1) && (
          <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
            All {groups.length}
          </Chip>
        )}
        {sets.length > 1 &&
          sets.map((g) => (
            <Chip key={g} on={filter === g} onClick={() => setFilter(g)}>
              {g}
            </Chip>
          ))}
        {total > 20 && (
          <input
            type="search"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search cards…"
            aria-label="Search cards"
            className="min-h-11 min-w-36 flex-1 rounded-full bg-card px-3 text-sm ring-1 ring-line"
          />
        )}
      </div>
      {shown.length > 1 && (
        <nav
          aria-label="Jump to"
          className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
        >
          {shown.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => goTo(g.id)}
              className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-card py-1 pr-3 pl-1 text-sm font-semibold ring-1 ring-line hover:ring-accent"
            >
              <GroupFace group={g} size="size-8" />
              <span className="max-w-32 min-w-0 leading-tight">
                <span className="block truncate">{g.name}</span>
                {g.subtitle && (
                  <span className="block truncate text-xs font-medium text-ink-muted">
                    {g.subtitle}
                  </span>
                )}
              </span>
            </button>
          ))}
        </nav>
      )}
      {shown.length === 0 && <p className="text-sm text-ink-muted">Nothing matches.</p>}
      <div className="space-y-2">
        {shown.map((g) => {
          const items = g.items.filter(matches);
          if (needle && !items.length) return null;
          const isOpen = !!needle || opened.has(g.id);
          return (
            <details
              key={g.id}
              id={anchor(g.id)}
              open={isOpen}
              onToggle={(e) => {
                const now = e.currentTarget.open;
                if (now === isOpen || needle) return;
                setOpened((o) => {
                  const next = new Set(o);
                  if (now) next.add(g.id);
                  else next.delete(g.id);
                  return next;
                });
              }}
              className="group scroll-mt-28 rounded-2xl bg-card ring-1 ring-line"
              data-testid="guide-card-group"
            >
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 px-3 py-2 [&::-webkit-details-marker]:hidden">
                <GroupFace group={g} size="size-11" />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">{g.name}</span>
                  {g.subtitle && (
                    <span className="block text-sm font-semibold text-ink-muted">{g.subtitle}</span>
                  )}
                  {g.meta && <span className="block text-xs text-ink-muted">{g.meta}</span>}
                </span>
                <span
                  aria-hidden
                  className="text-ink-muted transition-transform group-open:rotate-90"
                >
                  ▸
                </span>
              </summary>
              {/* Columns follow the room the guide has (the drawer or the page), not the screen. */}
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(15rem,100%),1fr))] gap-1.5 px-2 pb-2">
                {items.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => open(c)}
                      aria-label={`${c.name}: ${c.text}`}
                      className={cn(
                        'flex h-full w-full gap-2.5 rounded-xl bg-page p-1.5 text-left ring-1 ring-line hover:ring-accent',
                        c.mark && 'ring-accent-line',
                      )}
                    >
                      <span className="flex aspect-[400/630] w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-panel">
                        {c.art ? (
                          <Art
                            src={c.art}
                            className="h-full w-full object-cover"
                            fallback={<CardIcon card={c} />}
                          />
                        ) : (
                          <CardIcon card={c} />
                        )}
                      </span>
                      <span className="min-w-0 flex-1 py-0.5">
                        <span className="block text-sm leading-tight font-bold">
                          {c.name}
                          {c.count !== undefined && (
                            <span className="font-semibold text-ink-muted"> ×{c.count}</span>
                          )}
                        </span>
                        {c.mark && (
                          <span className="mt-0.5 inline-block rounded-full bg-accent-soft px-2 text-xs font-bold text-accent-text ring-1 ring-accent-line">
                            {c.mark.label}
                          </span>
                        )}
                        <span className="mt-0.5 block text-sm leading-snug">{c.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
      </div>
    </div>
  );
}

function GroupFace({ group, size }: { group: GuideCatalogGroup; size: string }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-page ring-1 ring-line',
        size,
      )}
    >
      {group.art ? (
        <Art
          src={group.art}
          focus={group.focus}
          zoom={group.zoom}
          className="h-full w-full object-cover"
          fallback={<span aria-hidden>{group.icon ?? '🎴'}</span>}
        />
      ) : (
        <span aria-hidden>{group.icon ?? '🎴'}</span>
      )}
    </span>
  );
}

function CardIcon({ card }: { card: GuideCard }) {
  return (
    <span aria-hidden className="px-0.5 text-center text-xs leading-tight font-bold">
      {card.symbols || '🎴'}
    </span>
  );
}

function CardSheet({ card }: { card: GuideCard }) {
  const art = card.card ?? card.art;
  return (
    <div className="space-y-2" data-testid="guide-card-sheet">
      {art && (
        <Art
          src={art}
          className="mx-auto max-h-[52dvh] w-auto max-w-full rounded-xl bg-page object-contain"
        />
      )}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
        {card.count !== undefined && <span>×{card.count} in the deck</span>}
        {card.symbols && <span className="font-semibold text-ink">{card.symbols}</span>}
        {card.mark && (
          <span className="rounded-full bg-accent-soft px-2 font-bold text-accent-text ring-1 ring-accent-line">
            {card.mark.label}
          </span>
        )}
      </p>
      <p className="text-lg">{card.text}</p>
      {card.mark?.text && <p className="text-sm text-ink-muted">{card.mark.text}</p>}
    </div>
  );
}

const BANDS: [GuideLevel, string, string][] = [
  ['basics', 'Basics', 'everyone should know'],
  ['details', 'Details', 'when it comes up'],
  ['edge', 'Options & edge cases', 'host settings, leaving, timers'],
];

function Rules({
  guide,
  ctx,
  inRoom,
}: {
  guide: GameGuide;
  ctx: GuideContext | undefined;
  inRoom: boolean;
}) {
  // Setup is how the app gets a game going: a detail for whoever hosts (unless the game says
  // otherwise), first in its band.
  const setup: GuideSection | undefined = guide.setup.length
    ? { title: 'Getting started', bullets: guide.setup, level: guide.setupLevel ?? 'details' }
    : undefined;
  const all = setup ? [setup, ...guide.sections] : guide.sections;
  const firstBasic = all.find((s) => levelOf(s) === 'basics');
  return (
    <div>
      <p className="mb-3 text-sm text-ink-muted">
        {ctx?.options
          ? `Open a topic when you need it. Parts that ${inRoom ? 'this game' : 'this setup'} doesn’t use are greyed out.`
          : 'Open a topic when you need it. Basics first; the rest is there for when it comes up.'}
      </p>
      {BANDS.map(([level, title, sub]) => {
        const list = all.filter((s) => levelOf(s) === level);
        if (!list.length) return null;
        return (
          <section key={level} aria-label={title} className="mb-4">
            <h3 className="mb-2 text-caption font-bold tracking-[0.08em] text-ink-2 uppercase">
              {title}{' '}
              <small className="text-caption font-normal tracking-normal text-ink-muted normal-case">
                · {sub}
              </small>
            </h3>
            <div className="space-y-2">
              {list.map((s) => (
                <RuleSection
                  key={s.title}
                  section={s}
                  ctx={ctx}
                  defaultOpen={s === firstBasic}
                  numbered={s === setup}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RuleSection({
  section: s,
  ctx,
  defaultOpen,
  numbered,
}: {
  section: GuideSection;
  ctx: GuideContext | undefined;
  defaultOpen: boolean;
  numbered: boolean;
}) {
  const off = !isOn(s.option, ctx);
  const list: GuideList | undefined = ctx?.lists?.[s.title] ?? s.list;
  const Bullets = numbered ? 'ol' : 'ul';
  return (
    <details
      open={defaultOpen}
      className={cn('group rounded-xl bg-panel ring-1 ring-line', off && 'opacity-60')}
    >
      <summary
        className={cn(
          'flex min-h-13 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3.5 py-2 [&::-webkit-details-marker]:hidden',
          'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
      >
        <span>
          <span className="block font-semibold">{s.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-caption text-ink-muted">
            {off ? (
              <span className="rounded-full bg-sunk px-2 font-bold text-ink-2">
                Not in this game
              </span>
            ) : (
              s.option && (
                <span className="rounded-full bg-accent-soft px-2 font-bold text-accent-text ring-1 ring-accent-line">
                  {s.option.label}
                </span>
              )
            )}
            <span>{minutes(sectionWords(s))} min</span>
          </span>
        </span>
        <Icon
          name="chevron-down"
          className="shrink-0 text-ink-faint transition-transform duration-[180ms] group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-line px-3.5 pt-3 pb-3.5 text-ink-2">
        {s.paragraphs?.map((p) => (
          <p key={p} className="mb-2">
            {p}
          </p>
        ))}
        {s.bullets && (
          <Bullets className={cn('space-y-1 pl-5', numbered ? 'list-decimal' : 'list-disc')}>
            {s.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </Bullets>
        )}
        {list && <ListBlock list={list} />}
      </div>
    </details>
  );
}

function ListBlock({ list }: { list: GuideList }) {
  const body = (
    <ol className="mt-1 space-y-0.5">
      {list.items.map((item, k) => (
        <li
          key={`${k}-${item.label}`}
          className={cn(
            'flex items-center gap-2 border-b border-dashed border-line py-1 text-sm',
            item.you && 'font-extrabold text-accent-text',
          )}
        >
          <span className="w-6 shrink-0 text-right text-xs text-ink-muted">{k + 1}</span>
          {item.art && <Art src={item.art} className="size-7 rounded-md object-cover" />}
          <span>
            {item.label}
            {item.you && ' ← you'}
          </span>
        </li>
      ))}
    </ol>
  );
  return list.folded ? (
    <details className="mt-2">
      <summary className="min-h-11 cursor-pointer py-2 font-semibold">{list.title}</summary>
      {body}
    </details>
  ) : (
    <div className="mt-2">
      <p className="font-semibold">{list.title}</p>
      {body}
    </div>
  );
}

function Reference({ guide }: { guide: GameGuide }) {
  const card = 'rounded-xl bg-card p-4 shadow-vt-1-edge ring-1 ring-line';
  return (
    <div className="space-y-3">
      {guide.reference?.map((t) => (
        <section key={t.title} aria-label={t.title} className={card}>
          <h3 className="mb-1 font-bold">{t.title}</h3>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {t.head.map((h) => (
                    <th
                      key={h}
                      className="border-b border-line px-1 py-1 text-left font-semibold text-ink-muted"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j} className="border-b border-line px-1 py-1 align-top">
                        <TableCell text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.note && <p className="mt-1 text-sm text-ink-muted">{t.note}</p>}
        </section>
      ))}
      {guide.glossary && (
        <section aria-label="Words you’ll see" className={card}>
          <h3 className="mb-1 font-bold">Words you’ll see</h3>
          <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[max-content_1fr]">
            {guide.glossary.map((g) => (
              <div key={g.term} className="contents">
                <dt className="font-semibold">{g.term}</dt>
                <dd className="mb-2 text-ink-2 sm:mb-0">{g.meaning}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
      <section aria-label="Tips" className={card}>
        <h3 className="mb-1 font-bold">Tips</h3>
        <ul className="space-y-1">
          {guide.tips.map((t) => (
            <li key={t}>💡 {t}</li>
          ))}
        </ul>
      </section>
      {guide.footer && (
        <footer
          aria-label={guide.footer.title}
          className="rounded-xl bg-sunk p-4 text-sm text-ink-2 ring-1 ring-line"
        >
          <h3 className="mb-1 font-bold">{guide.footer.title}</h3>
          {guide.footer.paragraphs.map((p) => (
            <p key={p} className="mb-1">
              {p}
            </p>
          ))}
          {guide.footer.links && guide.footer.links.length > 0 && (
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {guide.footer.links.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-accent-text underline"
                >
                  {l.label}
                </a>
              ))}
            </p>
          )}
        </footer>
      )}
    </div>
  );
}
