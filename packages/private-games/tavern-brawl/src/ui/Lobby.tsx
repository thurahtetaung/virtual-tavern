import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  TimerSettings,
  cn,
} from '@vt/ui';
import { ENABLED_HEROES, HEROES } from '../logic/cards.ts';
import {
  type HeroId,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type TavernBrawlAction,
  type TavernBrawlView,
} from '../logic/types.ts';
import { type Art, heroVars } from './assets.ts';

type Act = (action: TavernBrawlAction, options?: { anchor?: string }) => Promise<boolean>;

/** Portrait width as a multiple of the circle: enough to fill it with the face. */
const ZOOM = 2.4;
/** Portraits keep the printed card's shape. */
const PORTRAIT_RATIO = 630 / 400;

/** Places the portrait so its face sits in the middle of the circle, never leaving a gap. */
export function faceCrop([fx, fy]: [number, number], size: number): React.CSSProperties {
  const width = size * ZOOM;
  const height = width * PORTRAIT_RATIO;
  const clamp = (v: number, min: number) => Math.min(0, Math.max(min, v));
  return {
    width,
    height,
    left: clamp(size / 2 - fx * width, size - width),
    top: clamp(size / 2 - fy * height, size - height),
  };
}

/** A hero's face: the portrait from the manifest, or a disc in the hero's colour. */
export function Portrait({
  hero,
  art,
  size,
  className,
}: {
  hero: HeroId | null;
  art: Art;
  size: number;
  className?: string;
}) {
  const src = hero ? art.portrait(hero) : null;
  return (
    <span
      style={{ width: size, height: size, ...heroVars(hero) }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--hero)] font-bold text-white ring-2 ring-[var(--hero)] dark:bg-[var(--hero-dark)] dark:text-stone-950 dark:ring-[var(--hero-dark)]',
        className,
      )}
      aria-hidden
    >
      {src && hero ? (
        <ProtectedImage
          src={src}
          alt=""
          className="absolute max-w-none"
          style={faceCrop(art.focus(hero), size)}
        />
      ) : (
        <span style={{ fontSize: size * 0.42 }}>{hero ? HEROES[hero].label[0] : '?'}</span>
      )}
    </span>
  );
}

export function startBlocker(view: TavernBrawlView): string | null {
  const seated = view.seats.filter((s) => s.playing);
  if (seated.length < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed.`;
  if (seated.length > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  const missing = seated.filter((s) => !s.hero);
  if (missing.length) return `Waiting for ${missing.map((s) => s.name).join(', ')} to pick a hero.`;
  return null;
}

export function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: TavernBrawlView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const me = view.me;
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const takenBy = new Map(seated.flatMap((s) => (s.hero ? [[s.hero, s] as const] : [])));
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const blocker = startBlocker(view);
  const canPick = !!me?.playing;
  const pick = (hero: HeroId | 'random' | null) =>
    void act({ type: 'pick-hero', hero }, { anchor: 'tb-heroes' });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      <Hint tone={canPick && !me?.hero ? 'action' : 'neutral'}>
        {!me
          ? 'Watching the table.'
          : !me.playing
            ? 'You’re watching. Take a seat to play.'
            : !me.hero
              ? 'Pick your hero below, or tap 🎲 for a random one.'
              : blocker
                ? blocker
                : room.isHost
                  ? 'Everyone has a hero: start when you’re ready.'
                  : waitingForHost(room)}
      </Hint>

      <Panel className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={showGuide}>
            📖 Rules
          </Button>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2" data-seat={s.id}>
              <Portrait hero={s.hero} art={art} size={36} />
              <div className="min-w-0 flex-1">
                <PlayerTag
                  name={s.name}
                  host={s.id === room.hostId}
                  you={s.id === room.you}
                  offline={offline(s.id)}
                />
                <div className="truncate text-xs text-ink-muted dark:text-stone-400">
                  {s.hero ? art.hero(s.hero) : 'Picking a hero…'}
                </div>
              </div>
              {s.id === room.you && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => pick('random')}
                    aria-label="Random hero"
                  >
                    🎲
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void act({ type: 'sit', playing: false })}
                  >
                    Stand up
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="text-sm text-ink-muted dark:text-stone-400">
            Watching: {watching.map((s) => s.name).join(', ')}
          </p>
        )}
        {me && !me.playing && seated.length < MAX_PLAYERS && (
          <Button
            id="tb-sit"
            variant="soft"
            onClick={() => void act({ type: 'sit', playing: true })}
          >
            Take a seat
          </Button>
        )}
      </Panel>

      <Panel className="flex flex-col gap-2" id="tb-heroes">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Heroes</h2>
          {room.isHost && (
            <Button
              variant="secondary"
              size="sm"
              disabled={seated.length === 0}
              onClick={() => void act({ type: 'random-heroes' }, { anchor: 'tb-heroes' })}
            >
              🎲 Random for everyone
            </Button>
          )}
        </div>
        <RefusalSlot anchor="tb-heroes" />
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Heroes">
          {ENABLED_HEROES.map((h) => {
            const taker = takenBy.get(h);
            const mine = taker?.id === room.you;
            const free = !taker;
            const box = art.heroClass(h);
            return (
              <li key={h}>
                <button
                  type="button"
                  disabled={!canPick || (!free && !mine)}
                  onClick={() => pick(mine ? null : h)}
                  aria-pressed={mine}
                  data-hero={h}
                  aria-label={`${art.hero(h)}${taker ? `, taken by ${taker.name}` : ''}`}
                  style={heroVars(h)}
                  className={cn(
                    'flex h-full w-full flex-col gap-1.5 rounded-xl bg-card p-2 text-left ring-1 ring-line transition dark:bg-stone-800 dark:ring-stone-700',
                    mine && 'ring-4 ring-[var(--hero)] dark:ring-[var(--hero-dark)]',
                    !free && !mine && 'opacity-55',
                    canPick && (free || mine) && 'hover:bg-panel dark:hover:bg-stone-700',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Portrait hero={h} art={art} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm leading-tight font-semibold">
                        {art.hero(h)}
                      </span>
                      <span className="block truncate text-xs text-ink-muted dark:text-stone-400">
                        {box ?? HEROES[h].label}
                      </span>
                    </span>
                  </span>
                  <span className="line-clamp-2 block text-xs">
                    {taker ? (mine ? '✓ Your hero' : `Taken by ${taker.name}`) : HEROES[h].style}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <details className="rounded-2xl bg-card/85 p-4 ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800">
        <summary className="cursor-pointer font-bold">More options</summary>
        <div className="mt-3">
          <TimerSettings
            values={{
              clueSeconds: view.settings.seconds,
              guessSeconds: null,
              timerMode: view.settings.timerMode,
            }}
            editable={room.isHost}
            clueLabel="Decision timer"
            clueHelp="Time for each card to play and each choice to make."
            strictHelp="a random card is played (or a random choice made) for whoever is slow"
            onChange={(p) =>
              void act({
                type: 'update-settings',
                ...(p.clueSeconds !== undefined && { seconds: p.clueSeconds }),
                ...(p.timerMode !== undefined && { timerMode: p.timerMode }),
              })
            }
          />
          <p className="mt-2 text-xs text-ink-muted dark:text-stone-400">
            Animal noises and other honour-system prompts always get 20 seconds.
          </p>
        </div>
      </details>

      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'tb-start' })}
          >
            Start the brawl
          </Button>
          <RefusalSlot anchor="tb-start" />
        </StickyBar>
      )}
    </div>
  );
}
