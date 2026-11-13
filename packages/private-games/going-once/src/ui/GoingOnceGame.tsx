import { useHostVolumes } from '@vt/ui/sound';
import {
  type Drawing,
  type GameRoomInfo,
  type GameUiProps,
  listNames,
  lobbyStatus,
  playersNeeded,
  waitingFor,
  waitingForHost,
} from '@vt/game-sdk';
import {
  Button,
  cn,
  Countdown,
  END_ART,
  EndHero,
  EndLayout,
  EndTabs,
  FitArea,
  GuideLink,
  Hint,
  LobbyLayout,
  LobbyPitch,
  LobbySettings,
  LobbyStart,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  SeatHeading,
  SeatToggle,
  Standings,
  StickyBar,
  Superlatives,
  Switch,
  TabBar,
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
import { type Art, GAME_ID, artFor, useManifest } from './assets.ts';
import { Auction, GO_TABS, GO_TABS_ID, type GoTab, LotLog, useSeenDrawings } from './Auction.tsx';
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
  const [volumes, setVolume] = useGoVolumes();
  useHostVolumes({
    game: GAME_ID,
    host: view.settings.hostVolumes,
    isHost: room.isHost,
    setVolume,
  });
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
  const wide =
    g &&
    (g.stage === 'auction' ||
      g.stage === 'sold' ||
      g.stage === 'done' ||
      g.stage === 'halftime' ||
      g.stage === 'bank');

  const quiet = profile === 'phone-quiet';
  // Phones during the lots: the auction, the wish list, the hints and the lots, from the tab bar.
  const wideScreen = useWideScreen();
  const lots = g?.stage === 'auction' || g?.stage === 'sold';
  const [tab, setTab] = useState<GoTab>('auction');
  const shown: GoTab | null = view.phase === 'playing' && lots && !wideScreen ? tab : null;
  const away = shown !== null && shown !== 'auction';
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
          wide || view.phase === 'lobby' || !g ? 'max-w-3xl lg:max-w-6xl' : 'max-w-3xl',
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
            {/* Phones: the play area takes the rest of the screen and scrolls inside when it
                must, so the page never does; the end has its own tabs. */}
            <FitArea
              on={!wideScreen && g.stage !== 'done'}
              resetKey={`${g.stage}-${shown ?? ''}`}
              className="flex flex-col gap-3"
            >
              {!(
                quiet &&
                (g.stage === 'draw' ||
                  g.stage === 'auction' ||
                  g.stage === 'sold' ||
                  g.stage === 'done')
              ) &&
                !away && (
                  <HostStrip view={view} art={art} name={name} clockOffset={room.clockOffset} />
                )}
              {g.stage === 'draw' && g.redraw && (
                <p className="rounded-xl bg-warn-soft px-4 py-2 text-center text-sm text-warn-ink ring-1 ring-warn-line">
                  Nobody drew anything, so here are new titles. If nobody draws this time, the game
                  ends.
                </p>
              )}
              <Alerts view={view} you={room.you} />
              {!quiet && screwBanner}
              {g.stage === 'intro' && <Intro view={view} room={room} act={act} />}
              {g.introSkipped &&
                (g.stage === 'practice' ||
                  (g.stage === 'auction' &&
                    g.auction?.lot === 0 &&
                    g.auction.close === 'intro')) && <IntroSkipped />}
              {g.stage === 'draw' && <Draw view={view} room={room} act={act} quiet={quiet} />}
              {g.stage === 'practice' && g.practice && (
                <Practice view={view} room={room} act={act} art={art} name={name} />
              )}
              {(g.stage === 'auction' || g.stage === 'sold') && (
                <>
                  {/* Phones: the Sold card above the lot. Wide screens: at the top of the bidding
                      column, so the lot and the bids stay where they were, above the fold. */}
                  {g.stage === 'sold' && !away && !wideScreen && (
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
                    tab={shown}
                    sold={
                      g.stage === 'sold' &&
                      !away &&
                      wideScreen && (
                        <SoldCard view={view} room={room} act={act} name={name} quiet={quiet} />
                      )
                    }
                  />
                </>
              )}
              {(g.stage === 'halftime' || g.stage === 'bank') && (
                // While the auction pauses: the lots so far, to study before it goes on
                // (under the card on phones, beside it on desktops).
                <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start lg:gap-6 lg:space-y-0">
                  {g.stage === 'halftime' ? (
                    <Halftime view={view} room={room} act={act} />
                  ) : (
                    <Bank view={view} room={room} act={act} art={art} />
                  )}
                  <Panel aria-label="The lots so far" className="space-y-2">
                    <h2 className="text-sm font-bold">🖼 The lots so far</h2>
                    <LotLog view={view} room={room} art={art} name={name} seen={seen} />
                  </Panel>
                </div>
              )}
            </FitArea>
            {g.stage === 'done' && (
              <End view={view} room={room} act={act} art={art} name={name} seen={seen} />
            )}
            {shown && (
              <TabBar
                id={GO_TABS_ID}
                label={room.gameName ?? 'Going Once'}
                items={GO_TABS}
                value={tab}
                onChange={setTab}
                className="lg:hidden"
              />
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
              'min-h-11 flex-1 rounded-lg px-3 text-sm font-semibold ring-1',
              'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus',
              v === value
                ? 'bg-accent text-accent-fg shadow-vt-1 ring-accent'
                : 'bg-card text-ink ring-line-strong hover:bg-panel',
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
      ? playersNeeded(MIN_PLAYERS, seated.length)
      : seated.length > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : noContent
          ? 'No title groups yet: an admin has to import them first.'
          : null;
  // The shared lobby line; a host who can't start yet reads why under Start game.
  const lobby = lobbyStatus(room, blocker);
  const status = !me
    ? { text: 'Watching the table.', me: false }
    : !me.playing
      ? { text: 'You’re watching. Take a seat to play.', me: false }
      : lobby;
  const easel = artFor(manifest).ui('easel');
  return (
    <LobbyLayout
      className="w-full"
      pitch={
        <LobbyPitch
          title={room.gameName ?? 'Going Once'}
          emblem="🔨"
          art={
            easel && (
              <ProtectedImage src={easel} alt="" className="w-full rounded-lg object-contain" />
            )
          }
        >
          Draw two quick pictures from secret titles, then bid on everyone’s art. Each artist’s two
          drawings are worth $4,500 together. Best with 4–6 players.
        </LobbyPitch>
      }
      rail={
        <>
          <LobbySettings
            editable={room.isHost}
            summary={[
              `${view.settings.drawSeconds} s to draw`,
              voiceSetsPace ? 'the auctioneer’s pace' : `${PACE_NAME[view.settings.pace]} pace`,
              soundNow === 'off'
                ? 'sound off'
                : `sound: ${SOUND_NAME[soundNow].toLowerCase()}${view.settings.voice ? ', with the voice' : ''}`,
              ...(view.gamesPlayed === 0 && view.settings.practice ? ['a practice lot first'] : []),
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
              <p className="text-xs text-ink-muted" data-testid="go-pace-help">
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
                label="Where sound plays"
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
              <p className="text-xs text-ink-muted">{SOUND_HELP[soundNow]}</p>
              <div className="grid gap-2">
                <Switch
                  on={view.settings.voice}
                  editable={room.isHost && view.settings.sound !== 'off'}
                  title="The auctioneer speaks and sets the pace"
                  help="A welcome, a short tutorial anyone can skip, every call, and players called by their colour. His chants set the auction’s pace. Each player sets their own volume under Sound."
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
        </>
      }
      start={
        room.isHost && (
          <LobbyStart
            blocker={blocker}
            onStart={() => void act({ type: 'start' }, { anchor: 'go-start' })}
            refusal="go-start"
            testId="go-start"
          />
        )
      }
    >
      {status && <Hint tone={status.me ? 'action' : 'neutral'}>{status.text}</Hint>}
      <Panel className="flex flex-col gap-3">
        <SeatHeading as="h2" title={`Bidders (${seated.length}/${MAX_PLAYERS})`}>
          {me && (me.playing || seated.length < MAX_PLAYERS) && (
            <SeatToggle
              playing={me.playing}
              onChange={(playing) => void act({ type: 'sit', playing })}
            />
          )}
        </SeatHeading>
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
      </Panel>
      <GuideLink title={room.gameName ?? 'Going Once'} onClick={showGuide} />
    </LobbyLayout>
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
      className="flex flex-col items-center gap-1 text-center ring-2 ring-accent-line"
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
                      profit > 0 ? 'text-success-ink' : profit < 0 ? 'text-danger-ink' : ''
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
                  profit > 0 ? 'text-success-ink' : profit < 0 ? 'text-danger-ink' : '',
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
              <span className="text-ink-muted">
                {' '}
                {r.artist ? `by ${who(r.artist)}` : '· a house picture'}
              </span>
            )}
          </p>
          {r.commission > 0 && r.artist && (!quiet || r.artist === room.you) && (
            <p className={cn('text-sm text-ink-muted', beat(4))}>
              {r.artist === room.you ? 'You earn' : `${name(r.artist)} earns`} {money(r.commission)}{' '}
              commission 🎨
            </p>
          )}
          {r.screwedBy && (
            <p className={cn('text-sm text-ink-muted', beat(1))}>
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
        <Button variant="secondary" size="sm" onClick={() => void act({ type: 'skip' })}>
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
      className="rounded-xl bg-panel px-4 py-2 text-center text-sm ring-1 ring-line"
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
    <Panel
      className="vt-end-hero mx-auto flex w-full max-w-xl flex-col items-center gap-2 text-center lg:max-w-none lg:gap-4 lg:px-12 lg:py-14"
      data-testid="go-halftime"
    >
      <p className="vt-end-pop text-5xl lg:text-8xl" aria-hidden>
        🔩
      </p>
      <h2 className="font-display text-title font-semibold text-balance">
        Half-time: screws are unlocked!
      </h2>
      <p className="max-w-md text-sm lg:text-body">
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
        <Button variant="secondary" size="sm" onClick={() => void act({ type: 'skip' })}>
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
      className="vt-end-hero mx-auto flex w-full max-w-xl flex-col items-center gap-3 text-center lg:max-w-none lg:gap-4 lg:px-12 lg:py-14"
      data-testid="go-bank"
    >
      <p className="vt-end-pop text-5xl lg:text-8xl" aria-hidden>
        🏦
      </p>
      <h2 className="font-display text-title font-semibold text-balance">{f('{Bank} is open')}</h2>
      {mine && !mine.bankDone ? (
        mine.canLoan ? (
          <>
            <p>
              You will receive <b>{money(LOAN_CASH)}</b> now, and owe <b>{money(LOAN_DEBT)}</b> at
              the end. ({mine.loans} of 3 loans taken.)
            </p>
            <StickyBar fixed refusal="go-bank" className="w-full">
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
            </StickyBar>
          </>
        ) : (
          <>
            <p>Bad credit: three loans is the limit.</p>
            <StickyBar fixed refusal="go-bank" className="w-full">
              <Button
                size="lg"
                variant="secondary"
                className="w-full"
                onClick={() => void act({ type: 'loan', take: false }, { anchor: 'go-bank' })}
              >
                Carry on
              </Button>
            </StickyBar>
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
      {/* While this player answers, the refusal shows with the bar's buttons. */}
      {!(mine && !mine.bankDone) && <RefusalSlot anchor="go-bank" />}
      {room.isHost && (
        <Button variant="secondary" size="sm" onClick={() => void act({ type: 'skip' })}>
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
  const final = g.final ?? [];
  // Phones show the scores, the awards or the gallery (a page of lots at a time), so the end fits
  // the screen; wider screens show them all.
  const awards = (room.superlatives?.length ?? 0) > 0;
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(g.results.length / END_PAGE));
  const first = Math.min(page, pages - 1) * END_PAGE;
  const onPage = (i: number) => i >= first && i < first + END_PAGE;
  // Phones: Play again under whichever tab is open, outside the tabs (wider screens: in the scores).
  const wide = useWideScreen();
  const endButtons = room.isHost ? (
    <StickyBar refusal="go-end">
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
    </StickyBar>
  ) : (
    <Hint>{waitingForHost(room, 'start the next game')}</Hint>
  );
  const scores = (
    <Panel className="flex flex-col gap-3">
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
            phoneTable
          />
        </RackUp>
      )}
      {wide && <Superlatives lines={room.superlatives} />}
      {wide && endButtons}
    </Panel>
  );
  const gallery = (
    <Panel className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">🖼 The gallery</h3>
        {pages > 1 && (
          <div className="flex items-center gap-1 lg:hidden" data-testid="go-gallery-pager">
            <Button
              variant="secondary"
              size="sm"
              disabled={first === 0}
              onClick={() => setPage(first / END_PAGE - 1)}
              aria-label="Earlier lots"
            >
              ‹
            </Button>
            <span className="text-sm tabular-nums text-ink-muted">
              Lots {first + 1}–{Math.min(first + END_PAGE, g.results.length)} of {g.results.length}
            </span>
            <Button
              variant="secondary"
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
                art={art}
                label={r.title}
                className="w-full shadow-vt-1 ring-1 ring-line"
              />
              <span className="truncate font-semibold">{r.title}</span>
              <span className="truncate text-xs text-ink-muted">
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
                    <b className={profit >= 0 ? 'text-success-ink' : 'text-danger-ink'}>
                      {profit >= 0 ? '+' : '−'}
                      {money(Math.abs(profit))}
                    </b>
                  </>
                ) : (
                  `Unsold · worth ${money(r.value)}`
                )}
              </span>
              {(g.knew?.by[r.item]?.length ?? 0) > 0 && (
                <span className="text-xs text-ink-muted" data-testid="go-knew">
                  📜 Wished for it:{' '}
                  {g.knew!.by[r.item]!.map((id) => (id === room.you ? 'you' : name(id))).join(', ')}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
  // The winners as the table screen names them; their total from the final count.
  const champs = g.winners.map((id) => ({ id }));
  const best = final.find((f) => f.id === g.winners[0])?.score;
  // The priciest lot of the night, large, beside the result.
  const star = [...g.results].filter((r) => r.buyer).sort((a, b) => b.price - a.price)[0];
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <EndLayout
        hero={
          g.ended !== 'no-drawings' &&
          champs.length > 0 && (
            <EndHero
              // Phones: the top lot, small, in place of the emblem; wide screens show it large.
              emblem={
                !wide && star ? (
                  <Picture
                    drawing={star.drawing ?? seen.get(star.item) ?? null}
                    house={star.house}
                    art={art}
                    label={star.title}
                    className="mx-auto w-24 shadow-vt-1 ring-1 ring-line"
                  />
                ) : (
                  '🔨'
                )
              }
              title={`${listNames(champs.map((f) => (f.id === room.you ? 'You' : name(f.id))))} ${champs.length > 1 || champs[0]!.id === room.you ? 'win' : 'wins'}!`}
              art={
                wide &&
                star && (
                  <figure className={cn('space-y-1', END_ART[1])}>
                    <Picture
                      drawing={star.drawing ?? seen.get(star.item) ?? null}
                      house={star.house}
                      art={art}
                      label={star.title}
                      className="w-full shadow-vt-2 ring-1 ring-line"
                    />
                    <figcaption className="text-small text-ink-2">
                      Top lot: <span className="font-semibold text-ink">{star.title}</span>,{' '}
                      {money(star.price)}
                    </figcaption>
                  </figure>
                )
              }
            >
              {money(best ?? 0)} at the final count, after {g.results.length} lots.
            </EndHero>
          )
        }
      >
        <EndTabs
          testId="go-end-tab"
          tabs={[
            { id: 'scores', label: '🏆 Scores', content: scores },
            !wide &&
              awards && {
                id: 'awards',
                label: '✨ Awards',
                content: (
                  <Panel data-testid="go-end-awards">
                    <Superlatives lines={room.superlatives} />
                  </Panel>
                ),
              },
            { id: 'gallery', label: '🖼 Gallery', content: gallery },
          ]}
        />
        {!wide && <div className="flex flex-col gap-2">{endButtons}</div>}
      </EndLayout>
    </div>
  );
}
