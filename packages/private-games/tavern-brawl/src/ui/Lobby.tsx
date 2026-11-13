import { type GameRoomInfo, lobbyStatus, playersNeeded } from '@vt/game-sdk';
import {
  Button,
  GuideLink,
  Hint,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  StickyBar,
  TimerSettings,
  cn,
  LobbySettings,
  usePhone,
  timersLine,
} from '@vt/ui';
import { memo, useState } from 'react';
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
export const Portrait = memo(function Portrait({
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
});

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
      <span className="text-xs text-ink-muted">🎲 picks from:</span>
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
              ? 'bg-accent-soft text-accent-text ring-accent-line'
              : 'bg-card text-ink-muted ring-line',
          )}
        >
          {on.includes(id) ? '✓ ' : ''}
          {art.set(id) ?? SETS[id].label}
        </button>
      ))}
    </div>
  );
}

/** The settings' summary of the random picks: every set, or the ones it picks from. */
function setsLine(view: TavernBrawlView, art: Art): string {
  const on = view.settings.sets ?? [...SET_IDS];
  if (on.length === SET_IDS.length) return 'random from every hero';
  return `random from ${on.map((id) => art.set(id) ?? SETS[id].label).join(', ')}`;
}

export function startBlocker(view: TavernBrawlView): string | null {
  const seated = view.seats.filter((s) => s.playing);
  if (seated.length < MIN_PLAYERS) return playersNeeded(MIN_PLAYERS, seated.length);
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
  // Phones get small portrait tiles that open the hero's sheet (its powers, and Pick from there),
  // so all twelve fit one screen with the rest of the lobby.
  const phone = usePhone();
  const detailsTaker = details ? takenBy.get(details) : undefined;

  // The shared lobby line once you have a hero; a host who can't start yet reads why under Start
  // (not before picking: the line above already says what to do, and the phone has no room for both).
  const lobbyLine = !me
    ? { text: 'Watching the table.', me: false }
    : !me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : !me.hero
        ? { text: 'Pick your hero below, or 🎲 for a random one.', me: true }
        : lobbyStatus(room, blocker);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3">
      {lobbyLine && <Hint tone={lobbyLine.me ? 'action' : 'neutral'}>{lobbyLine.text}</Hint>}

      <Panel className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2" data-seat={s.id}>
              <Portrait hero={s.hero} art={art} size={phone ? 28 : 36} />
              <div className="min-w-0 flex-1">
                <PlayerTag
                  name={s.name}
                  host={s.id === room.hostId}
                  you={s.id === room.you}
                  offline={offline(s.id)}
                />
                <div className="truncate text-xs text-ink-muted">
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
                    Watch instead
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
            <span>Watching:</span>
            {watching.map((s) => (
              <PlayerTag key={s.id} name={s.name} />
            ))}
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
      {/* Phones have the room bar's Rules button, and this lobby must fit the screen. */}
      <GuideLink
        title={room.gameName ?? 'Tavern Brawl'}
        onClick={showGuide}
        className="max-sm:hidden"
      />

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
        {seated.length >= ZONE_PLAYERS && (
          <p className="rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line">
            Five or more players: regular attacks only reach your neighbours, and knocked-out
            players come back as ghosts who attack once a turn.
          </p>
        )}
        <ul
          className={cn(
            'grid gap-2 sm:grid-cols-3 lg:grid-cols-4',
            phone ? 'grid-cols-4 gap-1' : 'grid-cols-2',
          )}
          aria-label="Heroes"
        >
          {ENABLED_HEROES.map((h) => {
            const taker = takenBy.get(h);
            const mine = taker?.id === room.you;
            const free = !taker;
            const box = art.heroClass(h);
            if (phone)
              return (
                <li key={h} style={heroVars(h)}>
                  <button
                    type="button"
                    onClick={() => setDetails(h)}
                    aria-pressed={mine}
                    data-hero={h}
                    aria-label={`${art.hero(h)}${taker ? `, taken by ${taker.name}` : ''}: mighty powers and deck`}
                    className={cn(
                      'flex w-full flex-col items-center gap-0.5 rounded-xl bg-card px-1 pt-1 pb-0.5 ring-1 ring-line',
                      mine && 'ring-4 ring-[var(--hero)] dark:ring-[var(--hero-dark)]',
                      !free && !mine && 'opacity-55',
                    )}
                  >
                    <Portrait hero={h} art={art} size={36} />
                    <span className="line-clamp-2 w-full text-center text-xs leading-tight font-semibold">
                      {art.hero(h)}
                    </span>
                    <span className="w-full truncate text-center text-xs leading-tight text-ink-muted">
                      {mine ? '✓ You' : taker ? taker.name : '✦ Powers'}
                    </span>
                  </button>
                </li>
              );
            return (
              <li
                key={h}
                style={heroVars(h)}
                className={cn(
                  'flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-line',
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
                    canPick && (free || mine) && 'hover:bg-panel',
                  )}
                >
                  <span className="flex items-center gap-2">
                    <Portrait hero={h} art={art} size={40} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 block text-sm leading-tight font-semibold">
                        {art.hero(h)}
                      </span>
                      <span className="block truncate text-xs text-ink-muted">
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
                  className="flex min-h-9 w-full items-center gap-1 border-t border-line px-2 py-1 text-left text-xs hover:bg-panel"
                  data-powers={h}
                >
                  {/* Every power named in full: wrapped, never cut mid-word. */}
                  <span className="min-w-0 flex-1">
                    <span aria-hidden className="text-accent-text">
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
        summary={[
          setsLine(view, art),
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
        <SetFilter view={view} room={room} act={act} art={art} />
        {room.isHost && <h3 className="mt-3 mb-2 font-bold">Timer</h3>}
        <div className={room.isHost ? undefined : 'mt-3'}>
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
          {blocker && !(me?.playing && !me.hero) && (
            <p className="mt-1.5 text-caption text-ink-muted">{blocker}</p>
          )}
          <RefusalSlot anchor="tb-start" />
        </StickyBar>
      )}
    </div>
  );
}
