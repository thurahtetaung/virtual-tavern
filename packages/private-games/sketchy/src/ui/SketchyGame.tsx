import { useHostVolumes } from '@vt/ui/sound';
import { type GameRoomInfo, type GameUiProps, listNames, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  FitArea,
  Fold,
  Hint,
  Panel,
  Standings,
  StickyBar,
  Superlatives,
  TabBar,
  type TabBarItem,
  revealElement,
  cn,
  tabPanelProps,
  useAbandonGame,
  useSecondsLeft,
  useSpectatorPrompt,
  useWideScreen,
} from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { MAX_PLAYERS, type SketchyAction, type SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';
import { Draw } from './Draw.tsx';
import { Lobby } from './Lobby.tsx';
import {
  anyMissing,
  meMissing,
  missingIds,
  nameOf,
  points,
  startBlocker,
  statusFor,
} from './status.ts';
import { SEAT_CONTROL_ID, Scores, Table } from './Table.tsx';
import { TurnStage, useReveal } from './Turn.tsx';
import { GAME_ID, type SketchyManifest, manifestOf, useManifest } from './assets.ts';
import { ChipColours, paintsOf } from './paint.tsx';
import { PhoneShow, Toast } from './PhoneShow.tsx';
import { SketchyLobbySound, SketchySoundButton } from './Sound.tsx';
import { useSketchyVolumes } from './useSound.ts';

export type SketchyUiProps = GameUiProps<SketchyView, SketchyAction>;

/** Phones in play: the game, or the scores and players, from the tab bar. */
type PlayTab = 'play' | 'scores';
const PLAY_TABS_ID = 'sketchy-play';
const PLAY_TABS: readonly TabBarItem<PlayTab>[] = [
  { id: 'play', label: 'Play', icon: 'gamepad-2' },
  { id: 'scores', label: 'Scores', icon: 'list-ordered' },
];

const CLOCK_LABEL = { draw: 'to draw', write: 'to write a title', vote: 'to pick' } as const;
const AT_ZERO = {
  draw: 'whatever is drawn is sent',
  write: 'picking starts without the missing titles',
  vote: 'missing picks score nothing',
} as const;

/** One line on every play screen: the round, the drawing, the viewer's score and the timer. */
function Header({
  view,
  clockOffset,
  quiet = false,
}: {
  view: SketchyView;
  clockOffset: number;
  /** Phones: no reminder under a soft clock that ran out (the skip panel just below says it). */
  quiet?: boolean;
}) {
  const g = view.game!;
  const mine = view.scores.find((s) => s.id === view.me?.id);
  const stage = g.stage === 'reveal' ? null : g.stage;
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:text-base">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3">
        <span className="font-semibold tabular-nums">
          Round {g.round}/{g.rounds}
        </span>
        {g.turn && g.stage !== 'draw' && (
          <span className="text-ink-muted tabular-nums">
            Drawing {g.turn.number}/{g.turn.of}
          </span>
        )}
        {mine && g.stage !== 'reveal' && (
          <span
            role="img"
            aria-label={`Your score ${mine.score}`}
            className="font-bold tabular-nums"
          >
            ⭐ {points(mine.score)}
          </span>
        )}
      </div>
      {/* While drawing, the drawing bar has the clock: it shows once. */}
      {stage && stage !== 'draw' && (
        <Countdown
          deadline={g.deadline}
          clockOffset={clockOffset}
          label={CLOCK_LABEL[stage]}
          soft={view.settings.timerMode !== 'strict'}
          expiredHint={quiet ? '' : 'Just a reminder: the game waits for everyone.'}
          atZero={`then ${AT_ZERO[stage]}`}
        />
      )}
    </div>
  );
}

/**
 * The host's way out when the game waits on someone who isn't coming: once time is up (or straight
 * away when everyone named as missing is offline), the stage ends as a strict timeout would.
 * Null while there is nothing to skip.
 */
function useSkip(view: SketchyView, room: GameRoomInfo, online: (id: string) => boolean) {
  const g = view.game;
  const left = useSecondsLeft(g?.deadline ?? null, room.clockOffset);
  if (!room.isHost || view.phase !== 'playing' || !g || g.stage === 'reveal' || !anyMissing(view))
    return null;
  // The host who is still to draw, write or pick just does it: never a button to skip themself.
  if (meMissing(view)) return null;
  const missing = missingIds(view);
  const timeUp = left === 0;
  if (!timeUp && !(missing.length > 0 && missing.every((id) => !online(id)))) return null;
  const names =
    missing.length === 0 || missing.length > 3
      ? 'the players still missing'
      : listNames(missing.map((id) => nameOf(view, id)));
  return { names, timeUp };
}

function ContinueWithout({
  skip,
  act,
}: {
  skip: { names: string; timeUp: boolean } | null;
  act: Act;
}) {
  if (!skip) return null;
  const { names, timeUp } = skip;
  return (
    // Phones: one row (the clock's icon and the button); the sentence stays for screen readers.
    <Panel
      className="space-y-2 text-center max-lg:flex max-lg:items-center max-lg:gap-2 max-lg:space-y-0 max-lg:p-2"
      data-testid="continue-without"
    >
      <span aria-hidden className="text-xl lg:hidden">
        {timeUp ? '⏰' : '📴'}
      </span>
      <p className="text-sm max-lg:sr-only">
        {timeUp ? '⏰ Time’s up. ' : '📴 '}Still waiting for {names}. Continue, and the game moves
        on without them.
      </p>
      <Button
        size="lg"
        className="w-full max-lg:h-11 max-lg:min-w-0 max-lg:flex-1 max-lg:px-3 max-lg:text-base"
        onClick={() => void act({ type: 'continue-without' })}
      >
        <span className="truncate">Continue without {names}</span>
      </Button>
    </Panel>
  );
}

/** The podium, the awards, every drawing's title, then Play again. */
function GameOver({ view, room, act }: { view: SketchyView; room: GameRoomInfo; act: Act }) {
  const ranked = view.scores;
  const top = (pick: (s: (typeof ranked)[number]) => number) => {
    const best = Math.max(0, ...ranked.map(pick));
    return best > 0 ? { ids: ranked.filter((s) => pick(s) === best).map((s) => s.id), best } : null;
  };
  const liar = top((s) => s.fooled);
  const liked = top((s) => s.likes);
  const names = (ids: string[]) => listNames(ids.map((id) => nameOf(view, id)));
  const history = view.game?.history ?? [];
  return (
    <Panel className="space-y-2 text-center max-lg:p-3 lg:space-y-4" data-testid="sketchy-over">
      {view.endReason === 'too-few' && (
        <p className="font-semibold">Too few players left: final scores so far.</p>
      )}
      <Standings
        entries={ranked.map((s) => ({
          id: s.id,
          name: s.left ? `${s.name} (left)` : s.name,
          score: s.score,
        }))}
        you={view.me?.id}
        scoreLabel={(n) => `${points(n)} ${n === 1 ? 'point' : 'points'}`}
        // On a phone the podium alone (the full list is the Scores tab, a tap away); past 6 players
        // Standings drops the podium there, so the table stays.
        className={cn('text-left', ranked.length <= 6 && 'max-lg:[&>div]:hidden')}
      />
      {room.superlatives?.length ? (
        <Superlatives lines={room.superlatives} />
      ) : (
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div className="rounded-xl bg-danger-soft px-3 py-2">
            <dt className="font-semibold">🎭 Best liar</dt>
            <dd className="max-lg:line-clamp-2">
              {liar ? `${names(liar.ids)}: fooled ${liar.best}` : 'Nobody fooled anyone!'}
            </dd>
          </div>
          <div className="rounded-xl bg-special-soft px-3 py-2">
            <dt className="font-semibold">👍 Most liked</dt>
            <dd className="max-lg:line-clamp-2">
              {liked ? `${names(liked.ids)}: ${liked.best} likes` : 'No likes this game.'}
            </dd>
          </div>
        </dl>
      )}
      {history.length > 0 && (
        <Fold
          summary={<span className="font-semibold">🖼️ Every drawing ({history.length})</span>}
          className="text-left text-sm"
          bodyClassName="px-3 pb-3"
        >
          <ul className="space-y-1" data-testid="sketchy-history">
            {history.map((h, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-semibold">{nameOf(view, h.artist)}</span> drew “{h.prompt}”
                </span>
                <span className="shrink-0 text-ink-muted tabular-nums">
                  {h.found}/{h.voters} found
                </span>
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {room.isHost ? (
        <StickyBar fixed>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-center">
            <Button size="lg" className="max-lg:px-3" onClick={() => void act({ type: 'start' })}>
              Play again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="whitespace-nowrap max-lg:px-3"
              onClick={() => void act({ type: 'back-to-lobby' })}
            >
              Change setup
            </Button>
          </div>
        </StickyBar>
      ) : (
        <p>{waitingForHost(room, 'start the next game')}</p>
      )}
    </Panel>
  );
}

export function SketchyGame(props: SketchyUiProps) {
  const { view, room, profile = 'phone-full' } = props;
  const manifest = useManifest();
  const [volumes, setVolume] = useSketchyVolumes();
  useHostVolumes({
    game: GAME_ID,
    host: view.settings.hostVolumes,
    isHost: room.isHost,
    setVolume,
  });
  const stagePresent = room.stage?.present === true;
  return (
    <PhoneShow
      view={view}
      you={room.you}
      isHost={room.isHost}
      clockOffset={room.clockOffset}
      profile={profile}
      stagePresent={stagePresent}
      manifest={manifest}
      volumes={volumes}
    >
      <ChipColours view={view} colours={paintsOf(room.players)} />
      <SketchyPlay
        {...props}
        manifest={manifestOf(manifest)}
        sound={<SketchySoundButton view={view} room={room} act={props.act} manifest={manifest} />}
        lobbySound={
          <SketchyLobbySound view={view} room={room} act={props.act} manifest={manifest} />
        }
      />
    </PhoneShow>
  );
}

function SketchyPlay({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
  sound,
  lobbySound,
  manifest,
}: SketchyUiProps & {
  sound: ReactNode;
  lobbySound: ReactNode;
  manifest: SketchyManifest | null;
}) {
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const title = room.gameName ?? 'Sketchy';
  const blocker = startBlocker(view);
  const turn =
    view.phase === 'playing' && view.game?.stage === 'reveal' ? (view.game.turn ?? null) : null;
  const reveal = useReveal(turn, room.clockOffset);
  const revealing = reveal.progress !== null;
  const status = statusFor(view, room.isHost, blocker, room, revealing);
  // Phones show one screen at a time (the game, or the scores and players); desktop both.
  const [tab, setTab] = useState<PlayTab>('play');
  const skip = useSkip(view, room, online);
  const wide = useWideScreen();
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

  const seats = view.seats.filter((s) => s.playing).length;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? seats < MAX_PLAYERS
        ? {
            text:
              view.phase === 'playing'
                ? 'Take a seat to play from the next round.'
                : 'Take a seat to play.',
            action: () => {
              setTab('scores');
              revealElement(SEAT_CONTROL_ID);
            },
          }
        : { text: 'The table is full for now.' }
      : null,
  );

  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby') {
    return (
      <>
        <Lobby
          view={view}
          room={room}
          act={act}
          status={status}
          blocker={blocker}
          online={online}
          showGuide={showGuide}
          sound={lobbySound}
          manifest={manifest}
        />
      </>
    );
  }
  const g = view.game;
  // Phones: one section at a time from the tab bar; wider screens show both side by side.
  const shown: PlayTab | null = wide ? null : tab;
  return (
    <div className="space-y-3">
      <div className="hidden justify-end lg:flex">{sound}</div>
      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
        <div
          className={cn(
            'min-w-0 space-y-3',
            skip && 'max-sm:space-y-2',
            shown === 'scores' && 'hidden',
          )}
          {...(shown === 'play' && tabPanelProps(PLAY_TABS_ID, 'play'))}
        >
          {view.phase === 'playing' && g && (
            <div className="flex items-center gap-1">
              <div className="min-w-0 flex-1">
                <Header view={view} clockOffset={room.clockOffset} quiet={!!skip && !wide} />
              </div>
              {/* Phones: the sound sliders beside the round line. */}
              <div className="lg:hidden">{sound}</div>
            </div>
          )}
          {view.phase === 'over' && <div className="flex justify-end lg:hidden">{sound}</div>}
          <div className="relative">
            {/* Phones: one line while the skip panel shows (who is missing is on its button). */}
            <Hint dense tone={status.yourMove ? 'action' : 'neutral'}>
              <span className={cn(skip && !wide && 'line-clamp-1')}>{status.text}</span>
            </Hint>
            {/* The last round's banner never stays on the end screen: the status line says who won. */}
            {view.phase !== 'over' && <Toast />}
          </div>
          {view.phase === 'over' ? (
            <GameOver view={view} room={room} act={act} />
          ) : (
            g && (
              // Phones: the stage takes the rest of the screen and scrolls inside when it must.
              <FitArea
                on={!wide && shown === 'play'}
                resetKey={`${g.stage}-${g.round}-${g.turn?.number ?? 0}`}
                className="space-y-3 max-sm:space-y-2"
              >
                <ContinueWithout skip={skip} act={act} />
                {g.stage === 'draw' ? (
                  <Draw view={view} room={room} act={act} />
                ) : (
                  g.turn && (
                    <Panel className="max-sm:p-3">
                      <TurnStage view={view} act={act} isHost={room.isHost} reveal={reveal} />
                    </Panel>
                  )
                )}
              </FitArea>
            )
          )}
        </div>
        <aside
          className={cn('space-y-3', shown === 'play' && 'hidden')}
          {...(shown === 'scores' && tabPanelProps(PLAY_TABS_ID, 'scores'))}
        >
          <Panel className="space-y-3">
            <Scores view={view} revealing={revealing} />
            <Table view={view} online={online} act={act} hostId={room.hostId} />
          </Panel>
        </aside>
      </div>
      {shown && (
        <TabBar
          id={PLAY_TABS_ID}
          label={title}
          items={PLAY_TABS}
          value={tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
    </div>
  );
}
