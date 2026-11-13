import { type ReactNode, useEffect, useState } from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';
import type { GameCover } from './game-card.tsx';
import { coverOf, loadManifest } from './manifest.ts';
import { ProtectedImage } from './protected-image.tsx';
import { StickyBar } from './sticky-bar.tsx';

/**
 * A lobby's frame. Phones stack it as always: the pitch, the lobby's own parts (status line,
 * seats, guide link), the settings and Start. Wide screens (`lg`) use the width: the pitch, the
 * lobby's parts and Start in the main column, and the settings and sound (`rail`) open in a right
 * rail beside them.
 */
export function LobbyLayout({
  pitch,
  children,
  rail,
  start,
  className,
}: {
  /** The game's pitch card (`LobbyPitch`), at the top. */
  pitch?: ReactNode;
  /** The lobby's own parts: status line, seats or teams, guide link. */
  children: ReactNode;
  /** Settings, sound and other folds: below the seats on phones, a right rail on wide screens. */
  rail?: ReactNode;
  /** The host's Start (`LobbyStart`), or the guests' waiting line. */
  start?: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-ui="lobby-layout"
      className={cn(
        'mx-auto grid max-w-3xl gap-4 lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-start lg:gap-x-6',
        className,
      )}
    >
      <div className="min-w-0 space-y-4">
        {pitch}
        {children}
      </div>
      {rail && (
        <aside
          aria-label="Lobby settings"
          className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          {rail}
        </aside>
      )}
      {start && <div className="min-w-0 lg:col-start-1">{start}</div>}
    </div>
  );
}

/** A back-room game's cover from its manifest, or null until loaded or when it names none. */
function useLobbyCover(gameId: string | undefined): GameCover | null {
  const [cover, setCover] = useState<GameCover | null>(null);
  useEffect(() => {
    if (!gameId) return;
    let live = true;
    void loadManifest(gameId).then((m) => {
      if (live) setCover(coverOf(gameId, m));
    });
    return () => {
      live = false;
    };
  }, [gameId]);
  return cover;
}

/**
 * The top of a lobby: the game's own art (box, cover, a card back or a few cards; existing art
 * only) beside its name and one-line pitch, on the `card` surface. A game with no art of its own
 * in play passes `coverFor` and shows its cover; without either the game's emblem sits on a
 * `sunk` tile.
 */
export function LobbyPitch({
  title,
  children,
  art,
  emblem,
  className,
  titleClassName,
  artClassName,
  coverFor,
}: {
  title: ReactNode;
  /** The one-line pitch, and anything small that belongs with it. */
  children?: ReactNode;
  /** The game's art, sized by the slot (64 px phones, 144 px wide screens). */
  art?: ReactNode;
  /** An emoji for a game without art. */
  emblem?: ReactNode;
  className?: string;
  /** Classes for the name (a game's own lettering). */
  titleClassName?: string;
  /** Classes for the art's slot, for art that isn't one card wide (`w-auto` for a fan). */
  artClassName?: string;
  /** A back-room game id whose manifest cover stands in for `art` (16:9, wider slot). */
  coverFor?: string;
}) {
  const cover = useLobbyCover(art ? undefined : coverFor);
  const [failed, setFailed] = useState(false);
  if (!art && cover && !failed) {
    art = (
      <div className="aspect-video overflow-hidden rounded-lg shadow-vt-1 ring-1 ring-line">
        <ProtectedImage
          src={cover.src}
          alt=""
          onError={() => setFailed(true)}
          className={cn('size-full object-cover', cover.dimInDark && 'dark:brightness-[0.87]')}
        />
      </div>
    );
    artClassName = cn('w-28 sm:w-36 lg:w-60', artClassName);
  }
  return (
    <section
      data-ui="lobby-pitch"
      className={cn(
        'vt-lobby-pitch relative overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-vt-1 sm:p-5 lg:p-6',
        className,
      )}
    >
      <div className="flex items-center gap-4 lg:gap-6">
        {art ? (
          <div className={cn('w-16 shrink-0 sm:w-20 lg:w-36', artClassName)}>{art}</div>
        ) : (
          emblem && (
            <div
              aria-hidden
              className="grid size-16 shrink-0 place-items-center rounded-xl bg-sunk text-4xl lg:size-24 lg:text-6xl"
            >
              {emblem}
            </div>
          )
        )}
        <div className="min-w-0 space-y-1">
          <h2
            className={cn(
              'font-display text-title font-semibold text-ink lg:text-[2.5rem] lg:leading-tight',
              titleClassName,
            )}
          >
            {title}
          </h2>
          {children && <div className="text-small text-ink-2 lg:text-body">{children}</div>}
        </div>
      </div>
    </section>
  );
}

/**
 * The host's Start, the same in every lobby: one large primary button across the bar (kept
 * reachable by `StickyBar`), greyed while it can't be pressed with the reason as one line under
 * it, and any secondary lobby actions (Shuffle teams) as quiet buttons above it.
 */
export function LobbyStart({
  label = 'Start game',
  onStart,
  blocker = null,
  busy = false,
  secondary,
  inline = false,
  refusal,
  refusalKey,
  testId,
}: {
  label?: ReactNode;
  onStart: () => void;
  /** Why Start can't be pressed yet ("Need 2 more players"); `null` when it can. */
  blocker?: ReactNode;
  busy?: boolean;
  /** Quiet buttons that belong with Start (Shuffle teams, Random for everyone). */
  secondary?: ReactNode;
  /** Put `secondary` beside Start on one row instead of above it, saving a row on a crowded lobby. */
  inline?: boolean;
  /** The anchor of Start's `RefusalSlot`. */
  refusal?: string;
  refusalKey?: string | number;
  testId?: string;
}) {
  return (
    <StickyBar refusal={refusal} refusalKey={refusalKey}>
      <div data-ui="lobby-start" className="mx-auto w-full space-y-2 sm:max-w-md">
        {secondary && !inline && (
          <div className="flex flex-wrap justify-center gap-2">{secondary}</div>
        )}
        <div className={cn(inline && !!secondary && 'flex items-center gap-2')}>
          <Button
            size="lg"
            className={inline && secondary ? 'min-w-0 flex-1' : 'w-full'}
            disabled={!!blocker}
            sending={busy}
            onClick={onStart}
            data-testid={testId}
          >
            {label}
          </Button>
          {inline && secondary}
        </div>
        {blocker && <p className="text-center text-caption text-ink-muted">{blocker}</p>}
      </div>
    </StickyBar>
  );
}
