import {
  type Drawing,
  type GameRoomInfo,
  type GameUiProps,
  waitingFor,
  waitingForHost,
} from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  Switch,
  cn,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { money } from '../logic/lines.ts';
import { fillNames } from '../logic/names.ts';
import {
  DRAW_SECONDS,
  type GoingOnceAction,
  type GoingOnceView,
  LOAN_CASH,
  LOAN_DEBT,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PACES,
  type Pace,
  SOUND_MODES,
  type SoundMode,
} from '../logic/types.ts';
import type { Act } from './act.ts';
import { soundModeIn } from './audio.ts';
import { PhoneShow } from './PhoneShow.tsx';
import { type Art, artFor, useManifest } from './assets.ts';
import { Auction, useLocalHidden, useSeenDrawings } from './Auction.tsx';
import { Draw } from './Draw.tsx';
import { Alerts, GoingOnceStyles, HostStrip, RackUp, useScrewBanner, useBeats } from './Extras.tsx';
import { Picture } from './Picture.tsx';
import { Practice } from './Practice.tsx';
import { type NameOf, statusFor, unquote } from './text.ts';
import { GoLobbySound, GoSoundButton } from './Sound.tsx';
import { useGoVolumes, useSound } from './useSound.ts';

export type GoingOnceUiProps = GameUiProps<GoingOnceView, GoingOnceAction>;

export function GoingOnceGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
  profile = 'phone-full',
}: GoingOnceUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  const status = statusFor(view, room.you, name, art.names);
  const [volumes] = useGoVolumes();
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const inGame = !!view.game?.players.some((p) => p.id === room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !inGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? { text: 'Take a seat to play.', action: () => void act({ type: 'sit', playing: true }) }
        : { text: 'You can join from the next game.' }
      : null,
  );
  useSound({
    view,
    manifest,
    you: inGame ? room.you : null,
    isHost: room.isHost,
    clockOffset: room.clockOffset,
    volumes,
    colours: room.players.flatMap((p) => (p.color ? [p.color] : [])),
    stagePresent: room.stage?.present === true,
  });
  // Seen here so the gallery keeps drawings from lots this tab watched.
  const seen = useSeenDrawings(view);
  const g = view.game;
  // During play the sliders open from a corner; the lobby has its own Sound section.
  const sound = <GoSoundButton view={view} room={room} act={act} manifest={manifest} />;
  const wide = g && (g.stage === 'auction' || g.stage === 'sold' || g.stage === 'done');

  const quiet = profile === 'phone-quiet';
  const screwBanner = useScrewBanner({
    view,
    name,
    you: room.you,
    clockOffset: room.clockOffset,
  });
  return (
    <PhoneShow view={view} you={room.you} clockOffset={room.clockOffset} profile={profile}>
      <div
        className={cn(
          'mx-auto flex w-full flex-col gap-3',
          wide ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl',
        )}
      >
        {view.phase === 'lobby' || !g ? (
          <Lobby view={view} room={room} act={act} showGuide={showGuide} manifest={manifest} />
        ) : (
          <>
            <GoingOnceStyles />
            <div className="flex items-start gap-1">
              <div className="min-w-0 flex-1">
                {/* A quiet phone's Sold card says it all, and a screw's banner takes the
                    status line's place there, so the bidding still fits the screen. */}
                {quiet && screwBanner
                  ? screwBanner
                  : !(quiet && g.stage === 'sold') && (
                      <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
                    )}
              </div>
              {sound}
            </div>
            {/* While drawing, during a lot and at the end a quiet phone leaves the auctioneer's
                words to the table screen. */}
            {!(
              quiet &&
              (g.stage === 'draw' ||
                g.stage === 'auction' ||
                g.stage === 'sold' ||
                g.stage === 'done')
            ) && <HostStrip view={view} art={art} name={name} clockOffset={room.clockOffset} />}
            {g.stage === 'draw' && g.redraw && (
              <p className="rounded-xl bg-warn-soft px-4 py-2 text-center text-sm text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40">
                Nobody drew anything, so here are new titles. If nobody draws this time, the game
                ends.
              </p>
            )}
            <Alerts view={view} you={room.you} />
            {!quiet && screwBanner}
            {g.stage === 'intro' && <Intro view={view} room={room} act={act} />}
            {g.introSkipped &&
              (g.stage === 'practice' ||
                (g.stage === 'auction' && g.auction?.lot === 0 && g.auction.close === 'intro')) && (
                <IntroSkipped />
              )}
            {g.stage === 'draw' && <Draw view={view} room={room} act={act} quiet={quiet} />}
            {g.stage === 'practice' && g.practice && (
              <Practice view={view} room={room} act={act} art={art} name={name} />
            )}
            {(g.stage === 'auction' || g.stage === 'sold') && (
              <>
                {g.stage === 'sold' && (
                  <SoldCard view={view} room={room} act={act} name={name} quiet={quiet} />
                )}
                <Auction
                  view={view}
                  room={room}
                  act={act}
                  art={art}
                  name={name}
                  seen={seen}
                  quiet={quiet}
                />
              </>
            )}
            {g.stage === 'halftime' && <Halftime view={view} room={room} act={act} />}
            {g.stage === 'bank' && <Bank view={view} room={room} act={act} art={art} />}
            {g.stage === 'done' && (
              <End view={view} room={room} act={act} art={art} name={name} seen={seen} />
            )}
          </>
        )}
      </div>
    </PhoneShow>
  );
}

const PACE_HELP: Record<Pace, string> = {
  relaxed: 'The original’s unhurried calls: 12 s to open and 12 s after each bid.',
  normal: '8 s to open, 4 s after a bid, then going once, going twice.',
  fast: 'For players who know the game (6 s to open, 3 s after a bid).',
};

function Segmented<T extends string | number>({
  label,
  values,
  value,
  format,
  editable,
  onChange,
}: {
  label: string;
  values: readonly T[];
  value: T;
  format: (v: T) => string;
  editable: boolean;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {values.map((v) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={v === value}
            disabled={!editable}
            onClick={() => onChange(v)}
            className={cn(
              'h-10 flex-1 rounded-lg px-3 text-sm font-semibold ring-1',
              v === value
                ? 'bg-accent text-accent-fg ring-accent dark:bg-amber-500 dark:text-stone-950 dark:ring-amber-500'
                : 'bg-card ring-line-strong hover:bg-panel dark:bg-stone-800 dark:ring-stone-600',
              !editable && 'cursor-default',
            )}
          >
            {format(v)}
          </button>
        ))}
      </div>
    </div>
  );
}

const PACE_NAME: Record<Pace, string> = { relaxed: 'Relaxed', normal: 'Normal', fast: 'Fast' };

const SOUND_NAME: Record<SoundMode, string> = {
  off: 'Off',
  host: 'Host’s device',
  all: 'Every device',
  stage: 'Table screen',
};

/** Who hears what, for each sound choice. */
const SOUND_HELP: Record<SoundMode, string> = {
  off: 'No device makes a sound.',
  host: 'Only the host’s device plays the sound: put it in the middle of the table. Hint rings still buzz on each player’s own device.',
  all: 'Every device plays the same sounds at the same moment, so each bid’s yelp goes round the table.',
  stage:
    'The table screen plays the music, the voice and every bid’s yelp; phones only ring for their own tips.',
};

function Lobby({
  view,
  room,
  act,
  showGuide,
  manifest,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  showGuide: () => void;
  manifest: ReturnType<typeof useManifest>;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const noContent = view.groupsAvailable < 2;
  const stagePresent = room.stage?.present === true;
  // The sound the room will play (a paired table screen takes it until the host picks one).
  const soundNow = soundModeIn(view.settings, stagePresent);
  // With the auctioneer's voice on, his lines and chants time the auction instead of the pace.
  const voiceSetsPace = view.settings.voice && view.settings.sound !== 'off';
  const blocker =
    seated.length < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${seated.length} seated).`
      : seated.length > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : noContent
          ? 'No title groups yet: an admin has to import them first.'
          : null;
  return (
    <>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <Hint tone={room.isHost && !blocker ? 'action' : 'neutral'}>
            {!me
              ? 'Watching the table.'
              : !me.playing
                ? 'You’re watching. Take a seat to play.'
                : blocker
                  ? blocker
                  : room.isHost
                    ? 'Everyone’s here? Start the game.'
                    : waitingForHost(room)}
          </Hint>
        </div>
      </div>
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Bidders ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span aria-hidden>🔨</span>
              <PlayerTag
                name={s.name}
                host={s.id === room.hostId}
                you={s.id === room.you}
                offline={offline(s.id)}
                className="flex-1"
              />
              {s.id === room.you && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void act({ type: 'sit', playing: false })}
                >
                  Stand up
                </Button>
              )}
            </li>
          ))}
        </ul>
        {watching.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted dark:text-stone-400">
            <span>Watching:</span>
            {watching.map((s) => (
              <PlayerTag key={s.id} name={s.name} />
            ))}
          </p>
        )}
        {me && !me.playing && seated.length < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <p className="text-sm text-ink-muted dark:text-stone-400">
          Draw two quick pictures from secret titles, then bid on everyone’s art. Each artist’s two
          drawings are worth $4,500 together. 4 to 6 players is best.
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          `${view.settings.drawSeconds} s to draw`,
          voiceSetsPace ? 'the auctioneer’s pace' : `${PACE_NAME[view.settings.pace]} pace`,
          soundNow === 'off'
            ? 'sound off'
            : `sound: ${SOUND_NAME[soundNow].toLowerCase()}${view.settings.voice ? ', with the voice' : ''}`,
          ...(view.gamesPlayed === 0 && view.settings.practice ? ['practice lot'] : []),
        ]}
        className="space-y-4"
      >
        <Segmented
          label="Drawing time (both drawings)"
          values={DRAW_SECONDS}
          value={view.settings.drawSeconds}
          format={(v) => `${v} s`}
          editable={room.isHost}
          onChange={(v) =>
            void act({ type: 'update-settings', drawSeconds: v }, { anchor: 'go-lobby' })
          }
        />
        <div className="flex flex-col gap-1">
          <div
            className={cn(voiceSetsPace && 'opacity-50')}
            aria-disabled={voiceSetsPace || undefined}
          >
            <Segmented
              label="Auction pace"
              values={PACES}
              value={view.settings.pace}
              format={(v) => PACE_NAME[v]}
              editable={room.isHost && !voiceSetsPace}
              onChange={(v) =>
                void act({ type: 'update-settings', pace: v }, { anchor: 'go-lobby' })
              }
            />
          </div>
          <p className="text-xs text-ink-muted dark:text-stone-400" data-testid="go-pace-help">
            {voiceSetsPace
              ? 'The auctioneer sets the pace: after each bid he says the amount and chants, about 10 to 15 seconds, then going once, going twice.'
              : PACE_HELP[view.settings.pace]}
            {!voiceSetsPace &&
              !view.settings.paceChosen &&
              ' Fast is the default at 3 players, Normal otherwise.'}
          </p>
        </div>
        <div className="flex flex-col gap-2" data-testid="go-sound-settings">
          <Segmented
            label="Sound"
            values={SOUND_MODES.filter(
              (m) => m !== 'stage' || stagePresent || soundNow === 'stage',
            )}
            value={soundNow}
            format={(v) => SOUND_NAME[v]}
            editable={room.isHost}
            onChange={(v) =>
              void act({ type: 'update-settings', sound: v }, { anchor: 'go-lobby' })
            }
          />
          <p className="text-xs text-ink-muted dark:text-stone-400">{SOUND_HELP[soundNow]}</p>
          <div className="grid gap-2">
            <Switch
              on={view.settings.voice}
              editable={room.isHost && view.settings.sound !== 'off'}
              title="The auctioneer speaks and sets the pace"
              help="A welcome, a short tutorial anyone can skip, every call, and players by their colour. His chants set the auction’s pace. Each player sets their own volume under Sound."
              onChange={(v) =>
                void act({ type: 'update-settings', voice: v }, { anchor: 'go-lobby' })
              }
              testId="go-voice"
            />
          </div>
        </div>
        <Switch
          on={view.settings.practice}
          editable={room.isHost && view.gamesPlayed === 0}
          title="Practice lot"
          help={
            view.gamesPlayed === 0
              ? 'In this room’s first game: one lot for play money before lot 1, teaching the four things to know. Anyone can skip it.'
              : 'Only in a room’s first game: this room has played already.'
          }
          onChange={(v) =>
            void act({ type: 'update-settings', practice: v }, { anchor: 'go-lobby' })
          }
          testId="go-practice-setting"
        />
        <RefusalSlot anchor="go-lobby" />
      </LobbySettings>
      <GoLobbySound view={view} room={room} act={act} manifest={manifest} />
      {view.rigAllowed && room.isHost && <RigPanel view={view} act={act} />}
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'go-start' })}
            data-testid="go-start"
          >
            Start the game
          </Button>
          <RefusalSlot anchor="go-start" />
        </StickyBar>
      )}
    </>
  );
}

/** Test servers only: a fixed deal and a quicker clock for browser tests. */
function RigPanel({ view, act }: { view: GoingOnceView; act: Act }) {
  return (
    <Panel className="flex flex-wrap items-center gap-2 text-sm" data-testid="go-rig">
      <span className="font-semibold">Test rig</span>
      <span className="text-ink-muted">
        {view.rig ? `on (×${view.rig.scale}, cash ${view.rig.cash ?? 'normal'})` : 'off'}
      </span>
      <Button
        size="sm"
        variant="secondary"
        onClick={() =>
          void act({ type: 'rig', scale: 0.5, closeScale: 1, fixed: true, cash: 1400 })
        }
      >
        Rig next game
      </Button>
    </Panel>
  );
}

function SoldCard({
  view,
  room,
  act,
  name,
  quiet = false,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  name: NameOf;
  /** A table screen shows the reveal: only the headline and this player's own money here. */
  quiet?: boolean;
}) {
  const r = view.game!.results.at(-1);
  // The reveal in beats inside the Sold card's few seconds: stamp, price, value, profit, artist.
  const beats = useBeats(r?.item ?? '', 5, 800, !!view.rig);
  if (!r) return null;
  const who = (id: string | null) => (id === room.you ? 'you' : name(id));
  const profit = r.value - r.price;
  const beat = (n: number) =>
    cn('transition-opacity duration-300', beats > n ? 'opacity-100' : 'opacity-0');
  return (
    <Panel
      className="flex flex-col items-center gap-1 text-center ring-2 ring-accent-line dark:ring-amber-500/50"
      role="status"
      data-testid="go-sold"
    >
      <p className="text-2xl font-black tracking-tight motion-safe:animate-[go-rise_0.25s_ease-out]">
        {r.buyer ? (
          <>
            SOLD to <PlayerTag name={name(r.buyer)} you={r.buyer === room.you} />
          </>
        ) : (
          'Unsold'
        )}
      </p>
      {r.buyer ? (
        <>
          {(!quiet || r.buyer === room.you) && (
            <>
              <p className={beat(1)}>
                Paid <b>{money(r.price)}</b>
                <span className={beat(2)}>
                  {' '}
                  · Worth{' '}
                  <b
                    className={
                      profit > 0
                        ? 'text-success-ink dark:text-emerald-300'
                        : profit < 0
                          ? 'text-danger-ink dark:text-rose-300'
                          : ''
                    }
                  >
                    {money(r.value)}
                  </b>
                </span>
              </p>
              <p
                className={cn(
                  'font-bold',
                  beat(3),
                  profit > 0
                    ? 'text-success-ink dark:text-emerald-300'
                    : profit < 0
                      ? 'text-danger-ink dark:text-rose-300'
                      : '',
                )}
              >
                {profit > 0
                  ? `PROFIT ${money(profit)}`
                  : profit < 0
                    ? `LOSS ${money(-profit)}`
                    : 'BROKE EVEN'}
              </p>
            </>
          )}
          <p className={cn('text-lg', beat(4))}>
            “<span className="font-semibold">{unquote(r.title)}</span>”
            {r.artistKnown && (
              <span className="text-ink-muted dark:text-stone-400">
                {' '}
                {r.artist ? `by ${who(r.artist)}` : '· a house picture'}
              </span>
            )}
          </p>
          {r.commission > 0 && r.artist && (!quiet || r.artist === room.you) && (
            <p className={cn('text-sm text-ink-muted dark:text-stone-400', beat(4))}>
              {r.artist === room.you ? 'You earn' : `${name(r.artist)} earns`} {money(r.commission)}{' '}
              commission 🎨
            </p>
          )}
          {r.screwedBy && (
            <p className={cn('text-sm text-ink-muted dark:text-stone-400', beat(1))}>
              🔩 A forced buy, thanks to {who(r.screwedBy)}
            </p>
          )}
        </>
      ) : (
        <>
          <p className={beat(1)}>Unsold – it was worth {money(r.value)}</p>
          <p className={cn('text-lg', beat(2))}>
            “<span className="font-semibold">{unquote(r.title)}</span>”
          </p>
        </>
      )}
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          Next lot ▸
        </Button>
      )}
    </Panel>
  );
}

/** "Skipping the introduction", for everyone, for the first few seconds of the drawing. */
function IntroSkipped() {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setShown(false), 6000);
    return () => clearTimeout(id);
  }, []);
  if (!shown) return null;
  return (
    <p
      role="status"
      data-testid="go-intro-skipped"
      className="rounded-xl bg-panel px-4 py-2 text-center text-sm ring-1 ring-line dark:bg-stone-800/70 dark:ring-stone-700"
    >
      ⏭ Skipping the introduction
    </p>
  );
}

/**
 * The auctioneer's tutorial after the drawing (voiced games, a room's first game), as the original:
 * the words show in the host strip above; anyone at the table can skip it for everyone.
 */
function Intro({ view, room, act }: { view: GoingOnceView; room: GameRoomInfo; act: Act }) {
  return (
    <Panel className="flex flex-col items-center gap-3 text-center" data-testid="go-intro">
      <p className="text-4xl" aria-hidden>
        🎙️
      </p>
      <h2 className="text-xl font-bold">How the auction works</h2>
      <p className="max-w-md text-sm">
        The auctioneer explains the auction. The first lot comes up as soon as he’s done.
      </p>
      <Countdown
        deadline={view.game!.until}
        clockOffset={room.clockOffset}
        label="until the first lot"
      />
      {view.mine && (
        <Button
          variant="secondary"
          onClick={() => void act({ type: 'skip-intro' }, { anchor: 'go-intro' })}
          data-testid="go-skip-intro"
        >
          Skip the introduction ▸
        </Button>
      )}
      <RefusalSlot anchor="go-intro" />
    </Panel>
  );
}

function Halftime({ view, room, act }: { view: GoingOnceView; room: GameRoomInfo; act: Act }) {
  return (
    <Panel className="flex flex-col items-center gap-2 text-center" data-testid="go-halftime">
      <p className="text-3xl" aria-hidden>
        🔩
      </p>
      <h2 className="text-xl font-bold">Half-time: screws are unlocked!</h2>
      <p className="max-w-md text-sm">
        Everyone has one screw for the rest of the game. Press Screw during a lot and pick a player:
        they must bid $100 more than the top bid ($400 if nobody has bid), the top bidder too.
        Nobody can screw again until someone makes a free bid.
      </p>
      <Countdown
        deadline={view.game!.until}
        clockOffset={room.clockOffset}
        label="until the next lot"
      />
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          Next lot ▸
        </Button>
      )}
    </Panel>
  );
}

function Bank({
  view,
  room,
  act,
  art,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const mine = view.mine;
  const g = view.game!;
  const f = (s: string) => fillNames(s, art.names);
  return (
    <Panel
      className="mx-auto flex w-full max-w-md flex-col items-center gap-3 text-center"
      data-testid="go-bank"
    >
      <p className="text-3xl" aria-hidden>
        🏦
      </p>
      <h2 className="text-xl font-bold">{f('{Bank} is open')}</h2>
      {mine && !mine.bankDone ? (
        mine.canLoan ? (
          <>
            <p>
              You will receive <b>{money(LOAN_CASH)}</b> now, and owe <b>{money(LOAN_DEBT)}</b> at
              the end. ({mine.loans} of 3 loans taken.)
            </p>
            <div className="flex w-full gap-2">
              <Button
                size="lg"
                className="flex-1"
                onClick={() => void act({ type: 'loan', take: true }, { anchor: 'go-bank' })}
                data-testid="go-take-loan"
              >
                Get a loan
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="flex-1"
                onClick={() => void act({ type: 'loan', take: false }, { anchor: 'go-bank' })}
              >
                No thanks
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>Bad credit: three loans is the limit.</p>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => void act({ type: 'loan', take: false }, { anchor: 'go-bank' })}
            >
              Carry on
            </Button>
          </>
        )
      ) : (
        <p className="text-sm">
          {mine
            ? `You have ${money(mine.cash)} cash${mine.debt ? ` and owe ${money(mine.debt)}` : ''}. `
            : ''}
          {waitingFor(g.bank?.waiting ?? [], room.players, { you: room.you })}
        </p>
      )}
      <Countdown deadline={g.until} clockOffset={room.clockOffset} label="until it closes" />
      <RefusalSlot anchor="go-bank" />
      {room.isHost && (
        <Button variant="ghost" size="sm" onClick={() => void act({ type: 'skip' })}>
          {f('Close {bank}')} ▸
        </Button>
      )}
    </Panel>
  );
}

/** Lots on a page of the gallery on phones. */
const END_PAGE = 2;

function End({
  view,
  room,
  act,
  art,
  name,
  seen,
}: {
  view: GoingOnceView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
  seen: ReadonlyMap<string, Drawing>;
}) {
  const g = view.game!;
  const [localHidden] = useLocalHidden();
  const final = g.final ?? [];
  // Phones show the scores, the awards or the gallery (a page of lots at a time), so the end fits
  // the screen; wider screens show them all.
  const [tab, setTab] = useState<'scores' | 'awards' | 'gallery'>('scores');
  const awards = (room.superlatives?.length ?? 0) > 0;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(g.results.length / END_PAGE));
  const first = Math.min(page, pages - 1) * END_PAGE;
  const onPage = (i: number) => i >= first && i < first + END_PAGE;
  // Phones: Play again under whichever tab is open, outside the tabs (wider screens: in the scores).
  const wide = useWideScreen();
  const endButtons = (
    <>
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'go-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'go-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next game')}</Hint>
      )}
      <RefusalSlot anchor="go-end" />
    </>
  );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] lg:items-start">
      <div
        role="tablist"
        aria-label="The end"
        className="flex gap-1 rounded-lg bg-page p-1 lg:hidden dark:bg-stone-900 [&>*]:flex-1"
      >
        {(
          [
            ['scores', '🏆 Scores'],
            ...(awards ? [['awards', '✨ Awards'] as const] : []),
            ['gallery', '🖼 Gallery'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            type="button"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            data-testid={`go-end-tab-${id}`}
            className={cn(
              'rounded-md px-2 py-1.5 text-sm font-semibold',
              tab === id
                ? 'bg-card shadow-sm dark:bg-stone-700'
                : 'text-ink-muted dark:text-stone-400',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Panel className={cn('flex flex-col gap-3', tab !== 'scores' && 'max-lg:hidden')}>
        {g.ended === 'no-drawings' ? (
          <p className="text-center" data-testid="go-no-drawings">
            Nobody drew anything, twice, so there was nothing to auction. Try again!
          </p>
        ) : (
          <RackUp view={view} art={art} name={name} you={room.you}>
            <Standings
              entries={final.map((f) => ({
                id: f.id,
                name: name(f.id),
                score: f.score,
                note: `cash ${money(f.cash)} + art ${money(f.art)}${f.debt ? ` − debt ${money(f.debt)}` : ''}`,
              }))}
              you={room.you}
              scoreLabel={(n) => money(n)}
              // Phones: the table alone (the podium repeats it), so the end fits the screen.
              className="max-lg:[&>ol:first-child]:hidden"
            />
          </RackUp>
        )}
        <Superlatives lines={room.superlatives} className="max-lg:hidden" />
        {wide && endButtons}
      </Panel>
      {awards && tab === 'awards' && (
        <Panel className="lg:hidden" data-testid="go-end-awards">
          <Superlatives lines={room.superlatives} />
        </Panel>
      )}
      <Panel className={cn('flex flex-col gap-2', tab !== 'gallery' && 'max-lg:hidden')}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-bold">🖼 The gallery</h3>
          {pages > 1 && (
            <div className="flex items-center gap-1 lg:hidden" data-testid="go-gallery-pager">
              <Button
                variant="ghost"
                size="sm"
                disabled={first === 0}
                onClick={() => setPage(first / END_PAGE - 1)}
                aria-label="Earlier lots"
              >
                ‹
              </Button>
              <span className="text-sm tabular-nums text-ink-muted dark:text-stone-400">
                Lots {first + 1}–{Math.min(first + END_PAGE, g.results.length)} of{' '}
                {g.results.length}
              </span>
              <Button
                variant="ghost"
                size="sm"
                disabled={first + END_PAGE >= g.results.length}
                onClick={() => setPage(first / END_PAGE + 1)}
                aria-label="Later lots"
              >
                ›
              </Button>
            </div>
          )}
        </div>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="go-gallery">
          {g.results.map((r, i) => {
            const profit = r.value - r.price;
            return (
              <li
                key={r.item}
                className={cn('flex flex-col gap-1 text-sm', !onPage(i) && 'max-lg:hidden')}
              >
                <Picture
                  drawing={r.drawing ?? seen.get(r.item) ?? null}
                  house={r.house}
                  hidden={r.hidden}
                  hiddenByMe={localHidden.has(r.item)}
                  art={art}
                  label={r.title}
                  className="w-full shadow-sm"
                />
                <span className="truncate font-semibold">{r.title}</span>
                <span className="truncate text-xs text-ink-muted dark:text-stone-400">
                  {r.artist
                    ? `by ${r.artist === room.you ? 'you' : name(r.artist)}`
                    : 'house picture'}
                </span>
                <span className="text-xs">
                  {r.buyer ? (
                    <>
                      {/* Cut short in its column: a long name never runs past the card. */}
                      <PlayerTag
                        name={name(r.buyer)}
                        you={r.buyer === room.you}
                        className="max-w-full"
                      />{' '}
                      paid {money(r.price)} · worth {money(r.value)}{' '}
                      <b
                        className={
                          profit >= 0
                            ? 'text-success-ink dark:text-emerald-300'
                            : 'text-danger-ink dark:text-rose-300'
                        }
                      >
                        {profit >= 0 ? '+' : '−'}
                        {money(Math.abs(profit))}
                      </b>
                    </>
                  ) : (
                    `Unsold · worth ${money(r.value)}`
                  )}
                </span>
                {(g.knew?.by[r.item]?.length ?? 0) > 0 && (
                  <span
                    className="text-xs text-ink-muted dark:text-stone-400"
                    data-testid="go-knew"
                  >
                    📜 Knew it:{' '}
                    {g
                      .knew!.by[r.item]!.map((id) => (id === room.you ? 'you' : name(id)))
                      .join(', ')}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
      {!wide && <div className="flex flex-col gap-2">{endButtons}</div>}
    </div>
  );
}
