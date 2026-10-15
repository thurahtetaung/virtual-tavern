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
  LobbySettings,
  timersLine,
} from '@vt/ui';
import { useState } from 'react';
import { ENABLED_HEROES, HEROES, SETS } from '../logic/cards.ts';
import { FACE_ZOOM, powersOf } from '../logic/guide.ts';
import {
  type HeroId,
  MAX_PLAYERS,
  SET_IDS,
  type SetId,
  ZONE_PLAYERS,
  MIN_PLAYERS,
  type TavernBrawlAction,
  type TavernBrawlView,
} from '../logic/types.ts';
import { type Art, heroVars } from './assets.ts';
import { HeroSheet } from './HeroSheet.tsx';

type Act = (action: TavernBrawlAction, options?: { anchor?: string }) => Promise<boolean>;

/** Portraits keep the printed card's shape. */
const PORTRAIT_RATIO = 630 / 400;

/** Places the portrait so its face sits in the middle of the circle, never leaving a gap. */
export function faceCrop([fx, fy]: [number, number], size: number): React.CSSProperties {
  const width = size * FACE_ZOOM;
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

/** The host ticks which sets random picks draw from; everyone sees the choice. */
function SetFilter({
  view,
  room,
  act,
  art,
}: {
  view: TavernBrawlView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const on = view.settings.sets ?? [...SET_IDS];
  const toggle = (id: SetId) => {
    const next = on.includes(id) ? on.filter((x) => x !== id) : [...on, id];
    if (next.length > 0) void act({ type: 'update-settings', sets: next }, { anchor: 'tb-heroes' });
  };
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Random picks from"
    >
      <span className="text-xs text-ink-muted dark:text-stone-400">🎲 picks from:</span>
      {SET_IDS.map((id) => (
        <button
          key={id}
          type="button"
          disabled={!room.isHost}
          aria-pressed={on.includes(id)}
          onClick={() => toggle(id)}
          className={cn(
            'min-h-8 rounded-full px-3 text-xs font-semibold ring-1',
            on.includes(id)
              ? 'bg-accent-soft text-accent-text ring-accent-line dark:bg-amber-500/20 dark:text-amber-100 dark:ring-amber-500/40'
              : 'bg-card text-ink-muted ring-line dark:bg-stone-800 dark:text-stone-400 dark:ring-stone-700',
          )}
        >
          {on.includes(id) ? '✓ ' : ''}
          {art.set(id) ?? SETS[id].label}
        </button>
      ))}
    </div>
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
  const [details, setDetails] = useState<HeroId | null>(null);
  const detailsTaker = details ? takenBy.get(details) : undefined;

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
        <SetFilter view={view} room={room} act={act} art={art} />
        {seated.length >= ZONE_PLAYERS && (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
            Five or more players: regular attacks only reach your neighbours, and knocked-out
            players come back as ghosts who attack once a turn.
          </p>
        )}
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4" aria-label="Heroes">
          {ENABLED_HEROES.map((h) => {
            const taker = takenBy.get(h);
            const mine = taker?.id === room.you;
            const free = !taker;
            const box = art.heroClass(h);
            return (
              <li
                key={h}
                style={heroVars(h)}
                className={cn(
                  'flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
                  mine && 'ring-4 ring-[var(--hero)] dark:ring-[var(--hero-dark)]',
                )}
              >
                <button
                  type="button"
                  disabled={!canPick || (!free && !mine)}
                  onClick={() => pick(mine ? null : h)}
                  aria-pressed={mine}
                  data-hero={h}
                  aria-label={`${art.hero(h)}${taker ? `, taken by ${taker.name}` : ''}`}
                  className={cn(
                    'flex w-full flex-1 flex-col gap-1.5 p-2 text-left transition',
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
                  {taker ? (
                    <span className="block truncate text-xs font-medium">
                      {mine ? '✓ Your hero' : `Taken by ${taker.name}`}
                    </span>
                  ) : (
                    <span className="line-clamp-2 hidden text-xs sm:block">{HEROES[h].style}</span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setDetails(h)}
                  aria-label={`Mighty powers and deck: ${art.hero(h)}`}
                  className="flex min-h-9 w-full items-center gap-1 border-t border-line px-2 py-1 text-left text-xs hover:bg-panel dark:border-stone-700 dark:hover:bg-stone-700"
                  data-powers={h}
                >
                  <span className="line-clamp-2 min-w-0 flex-1">
                    <span aria-hidden className="text-accent-text dark:text-amber-300">
                      ✦{' '}
                    </span>
                    {powersOf(h)
                      .map((c) => art.card(c.id))
                      .join(' · ')}
                  </span>
                  <span aria-hidden className="shrink-0 text-ink-muted">
                    ›
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>

      <HeroSheet
        hero={details}
        art={art}
        who={detailsTaker ? (detailsTaker.id === room.you ? 'You' : detailsTaker.name) : undefined}
        onClose={() => setDetails(null)}
        footer={
          details && canPick && (!detailsTaker || detailsTaker.id === room.you) ? (
            <Button
              className="w-full"
              variant={detailsTaker ? 'secondary' : 'primary'}
              onClick={() => {
                pick(detailsTaker ? null : details);
                setDetails(null);
              }}
            >
              {detailsTaker ? 'Pick another hero' : `Pick ${art.hero(details)}`}
            </Button>
          ) : undefined
        }
      />

      <LobbySettings
        editable={room.isHost}
        title="Timer"
        summary={[
          timersLine(
            {
              clueSeconds: view.settings.seconds,
              guessSeconds: null,
              timerMode: view.settings.timerMode,
            },
            { clue: 'decisions', guess: null },
          ),
        ]}
      >
        {room.isHost && <h3 className="mb-2 font-bold">Timer</h3>}
        <div>
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
      </LobbySettings>

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
