import {
  type GameGuide,
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
} from '@vt/game-sdk';
import { Button, Modal, ProtectedImage, cn } from '@vt/ui';
import {
  type ReactNode,
  type TouchEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ClientGame } from '../games/registry.ts';

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
  done,
}: {
  game: ClientGame;
  compact?: boolean;
  room?: GuideRoomState;
  focus?: GuideFocus;
  done?: ReactNode;
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
      done={done}
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

type Tab = 'learn' | 'tiles' | 'rules' | 'ref';

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
  done,
}: {
  guide: GameGuide;
  compact?: boolean;
  inRoom?: boolean;
  context?: GuideContext;
  focus?: GuideFocus;
  done?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('learn');
  const [sheet, setSheet] = useState<GuideTile | null>(null);
  const [preset, setPreset] = useState<string | null>(null);
  const ctx = context ?? guide.presets?.find((p) => p.id === preset)?.context;
  const tabsId = useId();
  const top = useRef<HTMLDivElement>(null);

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
        role="tablist"
        aria-label="Guide"
        className={cn(
          'sticky z-10 -mx-1 mb-4 flex gap-1 border-b border-line bg-page/95 px-1 py-1.5 backdrop-blur',
          compact ? 'top-[52px] bg-stone-50/95 dark:bg-stone-900/95' : 'top-0',
        )}
      >
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`${tabsId}-${key}`}
            aria-selected={tab === key}
            aria-controls={`${tabsId}-${key}-panel`}
            onClick={() => setTab(key)}
            className={cn(
              'min-h-11 flex-1 rounded-xl px-1 text-sm leading-tight font-semibold transition-colors',
              tab === key
                ? 'bg-card text-ink shadow-sm ring-1 ring-accent-line'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`${tabsId}-${tab}-panel`} aria-labelledby={`${tabsId}-${tab}`}>
        {!context &&
          guide.presets &&
          guide.presets.length > 0 &&
          (tab === 'tiles' || tab === 'rules') && (
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
        {tab === 'rules' && <Rules guide={guide} ctx={ctx} inRoom={inRoom} />}
        {tab === 'ref' && <Reference guide={guide} />}
      </div>

      <Modal open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.name ?? ''}>
        {sheet && <TileSheet tile={sheet} ctx={ctx} />}
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
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full px-3.5 text-sm font-semibold ring-1 transition-colors',
        on
          ? 'bg-accent text-accent-fg ring-accent'
          : 'bg-card text-ink ring-line hover:ring-accent',
      )}
    >
      {children}
    </button>
  );
}

const EYEBROW = 'text-xs font-bold tracking-wider text-accent-text uppercase';

/** Private art, or `fallback` (an emoji) when it can't load. */
function Art({
  src,
  className,
  fallback = null,
  focus,
}: {
  src: string;
  className?: string;
  fallback?: ReactNode;
  focus?: [number, number] | undefined;
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
      {...(focus && { style: { objectPosition: `${focus[0] * 100}% ${focus[1] * 100}%` } })}
    />
  );
}

function Learn({
  guide,
  compact,
  ctx,
  done,
  go,
  openTile,
}: {
  guide: GameGuide;
  compact: boolean;
  ctx: GuideContext | undefined;
  done: ReactNode;
  go: (t: Tab) => void;
  openTile: (t: GuideTile) => void;
}) {
  const sectionCount = guide.sections.length + (guide.setup.length ? 1 : 0);
  const you = ctx?.you;
  const youTile = you?.tile ? guide.tiles?.items.find((t) => t.id === you.tile) : undefined;
  const youArt = you?.art ?? youTile?.art;
  const youText = you?.text ?? youTile?.text;
  const tiles = guide.tiles;
  const more = (
    <nav
      aria-label="More of the guide"
      className={cn('grid gap-2 sm:grid-cols-3', !compact && 'lg:grid-cols-1')}
    >
      {tiles && tiles.items.length > 0 && (
        <MoreButton
          title={tiles.label}
          sub={tiles.blurb ?? `${tiles.items.length} to browse`}
          onClick={() => go('tiles')}
        />
      )}
      <MoreButton
        title="Full rules"
        sub={`${sectionCount} topics, opened one at a time`}
        onClick={() => go('rules')}
      />
      <MoreButton
        title="Cheat sheet"
        sub={guide.reference?.length ? 'Tables, words and tips' : 'Words and tips'}
        onClick={() => go('ref')}
      />
    </nav>
  );
  return (
    <div className="space-y-3">
      {you && (
        <section
          aria-label="You are"
          className="flex gap-3 rounded-2xl bg-card p-3 ring-2 ring-accent"
        >
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
            {youText && <p className="text-sm">{youText}</p>}
            {you.now && <p className="mt-1 text-sm font-bold text-accent-text">{you.now}</p>}
          </div>
        </section>
      )}
      <div className="rounded-2xl bg-accent-soft/70 p-4 ring-1 ring-accent-line">
        <p className={EYEBROW}>
          <span aria-hidden>🎯 </span>The goal
        </p>
        <p className="mt-1 text-lg">{guide.goal}</p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
          <span>👥 {guide.players}</span>
          <span>⏳ {guide.duration}</span>
        </p>
      </div>
      <div
        className={cn(
          'space-y-3',
          !compact && 'lg:grid lg:grid-cols-[1.15fr_0.85fr] lg:items-start lg:gap-4 lg:space-y-0',
        )}
      >
        <div className="space-y-3">
          <Stepper
            guide={guide}
            ctx={ctx}
            done={done}
            more={tiles?.items.length ? () => go('tiles') : undefined}
            compact={compact}
          />
          {!tiles && guide.roles && guide.roles.length > 0 && <WhoIsWho guide={guide} />}
        </div>
        {more}
      </div>
    </div>
  );
}

function MoreButton({ title, sub, onClick }: { title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-2xl bg-card px-3 py-2 text-left ring-1 ring-line hover:ring-accent"
    >
      <span className="block font-bold">{title}</span>
      <span className="block text-sm text-ink-muted">{sub}</span>
    </button>
  );
}

function WhoIsWho({ guide }: { guide: GameGuide }) {
  return (
    <section aria-label="Who's who" className="rounded-2xl bg-card p-4 ring-1 ring-line">
      <h3 className="mb-1 font-bold">Who’s who</h3>
      <dl className="space-y-2">
        {guide.roles!.map((r) => (
          <div key={r.name} id={roleAnchor(r.name)} className="scroll-mt-24">
            <dt className="font-semibold">
              {r.icon && <span aria-hidden>{r.icon} </span>}
              {r.name}
            </dt>
            <dd className="text-sm text-stone-700 dark:text-stone-300">{r.summary}</dd>
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
      className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-line"
      data-testid="guide-stepper"
    >
      <p className={cn(EYEBROW, 'flex justify-between gap-2')}>
        <span>
          <span aria-hidden>⚡ </span>
          {title}
        </span>
        <span className="tracking-normal text-ink-muted normal-case">
          {step ? `${i + 1} of ${last}` : 'Done'}
        </span>
      </p>
      <div className="mt-2 min-h-56" aria-live="polite" {...swipe}>
        {step ? (
          <div key={i} className="motion-safe:animate-[guide-in_.25s_ease]">
            <div
              className={cn(
                'mb-3 flex items-center justify-center overflow-hidden rounded-xl bg-page',
                compact ? 'h-28' : 'h-32 sm:h-40',
              )}
            >
              {step.art ? (
                <Art
                  src={step.art}
                  className="h-full w-auto max-w-full object-contain"
                  fallback={
                    <span aria-hidden className="text-6xl">
                      {step.icon ?? '🎲'}
                    </span>
                  }
                />
              ) : (
                <span aria-hidden className="text-6xl">
                  {step.icon ?? '🎲'}
                </span>
              )}
            </div>
            <h3 className="text-lg font-bold">
              {i + 1}. {step.title}
            </h3>
            {step.text && <p>{step.text}</p>}
            {note && (
              <p className="mt-2 rounded-lg bg-accent-soft px-3 py-1.5 text-sm">👉 {note}</p>
            )}
          </div>
        ) : (
          <div className="motion-safe:animate-[guide-in_.25s_ease]">
            <div className="mb-3 flex h-28 items-center justify-center rounded-xl bg-page">
              <span aria-hidden className="text-6xl">
                🎉
              </span>
            </div>
            <h3 className="text-lg font-bold">That’s the whole game</h3>
            <p>
              {guide.stepsDone ??
                'You know enough to play. The app guides each step on screen; come back here any time.'}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {onFinish && (
                <Button size="sm" className="min-h-11" onClick={onFinish}>
                  Got it, let’s play
                </Button>
              )}
              {done}
              {more && (
                <Button variant="secondary" size="sm" className="min-h-11" onClick={more}>
                  See the {guide.tiles?.label.toLowerCase() ?? 'roles'}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="min-h-11"
          disabled={i === 0}
          onClick={() => go(i - 1)}
        >
          ← Back
        </Button>
        <span className="flex gap-1.5" aria-hidden>
          {[...steps, null].map((_, k) => (
            <i
              key={k}
              className={cn(
                'h-2 rounded-full transition-all',
                k === i ? 'w-5 bg-accent' : 'w-2 bg-line dark:bg-stone-700',
              )}
            />
          ))}
        </span>
        <Button
          size="sm"
          className={cn('min-h-11', i === last && 'invisible')}
          onClick={() => go(i + 1)}
        >
          Next →
        </Button>
      </div>
    </section>
  );
}

const TONE: Record<GuideTone, string> = {
  good: 'border-t-team-b dark:border-t-blue-500',
  evil: 'border-t-team-a dark:border-t-red-500',
  own: 'border-t-special dark:border-t-violet-500',
  alien: 'border-t-success dark:border-t-emerald-500',
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
      (!term || `${t.name} ${t.text}`.toLowerCase().includes(term.toLowerCase())),
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
        <Chip on={filter === 'all'} onClick={() => setFilter('all')}>
          All {items.length}
        </Chip>
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

function TileIcon({ icon }: { icon: string | undefined }) {
  return (
    <span aria-hidden className="text-4xl">
      {icon ?? '🎴'}
    </span>
  );
}

function TileSheet({ tile, ctx }: { tile: GuideTile; ctx: GuideContext | undefined }) {
  const art = tile.card ?? tile.art;
  const off = !isOn(tile.option, ctx);
  return (
    <div className="space-y-2" data-testid="guide-sheet">
      {art ? (
        <Art
          src={art}
          className="mx-auto max-h-[46dvh] w-auto max-w-full rounded-xl bg-page object-contain"
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
  // Setup is how the app gets a game going: a detail for whoever hosts.
  const setup: GuideSection | undefined = guide.setup.length
    ? { title: 'Getting started', bullets: guide.setup, level: 'details' }
    : undefined;
  const all = setup ? [...guide.sections, setup] : guide.sections;
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
            <h3 className="mb-1.5 text-sm font-bold tracking-wider text-accent-text uppercase">
              {title}{' '}
              <small className="font-medium tracking-normal text-ink-muted normal-case">
                {sub}
              </small>
            </h3>
            <div className="space-y-1.5">
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
  const points = (s.paragraphs?.length ?? 0) + (s.bullets?.length ?? 0);
  const Bullets = numbered ? 'ol' : 'ul';
  return (
    <details
      open={defaultOpen}
      className={cn('group rounded-2xl bg-card ring-1 ring-line', off && 'opacity-60')}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-2 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <span>
          <span className="block font-bold">{s.title}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
            {off ? (
              <span className="rounded-full bg-page px-2 font-bold ring-1 ring-line">
                Not in this game
              </span>
            ) : (
              s.option && (
                <span className="rounded-full bg-accent-soft px-2 font-bold text-accent-text ring-1 ring-accent-line">
                  {s.option.label}
                </span>
              )
            )}
            <span>
              {points} {points === 1 ? 'point' : 'points'} · {minutes(sectionWords(s))} min
            </span>
          </span>
        </span>
        <span aria-hidden className="mt-1 text-ink-muted transition-transform group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="px-4 pb-3">
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
  const card = 'rounded-2xl bg-card p-4 ring-1 ring-line';
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
                        {c}
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
                <dd className="mb-2 text-stone-700 sm:mb-0 dark:text-stone-300">{g.meaning}</dd>
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
          className="rounded-2xl bg-stone-100 p-4 text-sm text-stone-700 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-800"
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
                  className="font-semibold text-amber-700 underline dark:text-amber-400"
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
