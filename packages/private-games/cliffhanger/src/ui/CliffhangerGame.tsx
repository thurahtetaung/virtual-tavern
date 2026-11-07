import { useHostVolumes } from '@vt/ui/sound';
import { type GameUiProps, storageKey } from '@vt/game-sdk';
import {
  Button,
  Hint,
  Modal,
  Panel,
  TabBar,
  type TabBarItem,
  cn,
  revealElement,
  tabPanelProps,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
} from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import { nounOf } from '../logic/genres.ts';
import {
  type CliffhangerAction,
  type CliffhangerView,
  MAX_PLAYERS,
  TEAMS,
} from '../logic/types.ts';
import { ArtContext, GAME_ID, useArt, useLoadedArt } from './assets.ts';
import { End } from './End.tsx';
import { Lobby, SEAT_CONTROL_ID, Teams } from './Lobby.tsx';
import { MomentOverlay } from './MomentOverlay.tsx';
import { CliffhangerStyles, GenreRace } from './parts.tsx';
import { Bays, Stage } from './Play.tsx';
import { CliffhangerLobbySound, CliffhangerSoundButton } from './Sound.tsx';
import { startBlocker, statusFor } from './status.ts';
import { buzz, useCliffhangerVolumes, useSound } from './useSound.ts';

export type CliffhangerUiProps = GameUiProps<CliffhangerView, CliffhangerAction>;

const TIPS_KEY = 'cliffhanger.tips.v1';

/** First-time tips, until dismissed (per seat in a playtest): one line on phones, the list in a sheet. */
function Tips({ view }: { view: CliffhangerView }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(false);
  if (seen) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(storageKey(TIPS_KEY), '1');
    } catch {
      // Storage blocked: the tips just close for now.
    }
    setSeen(true);
    setOpen(false);
  };
  const nouns = nounOf(view.settings.deck, true);
  const list = (
    <>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Face-off: name one that fits out loud, then press Said it! Whoever runs out of time loses.
        </li>
        <li>
          Describing: each square says how (one word, a quote, acting). Your team shouts guesses.
        </li>
        <li>The app never judges: you all decide out loud what counts, slips included.</li>
      </ul>
      <p className="text-xs">Fill every genre with {nouns} before the other team to win.</p>
    </>
  );
  return (
    <>
      <aside
        data-testid="tips"
        className="cl-rise hidden flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line sm:flex"
      >
        <p className="font-semibold">New here? Three things to know</p>
        {list}
        <Button variant="quiet" size="sm" className="self-end" onClick={dismiss}>
          Got it
        </Button>
      </aside>
      <aside
        data-testid="tips-line"
        className="flex items-center gap-1 rounded-xl bg-info-soft py-0.5 pr-1 pl-3 text-sm text-info-ink ring-1 ring-info-line sm:hidden"
      >
        <span className="min-w-0 flex-1 truncate">New here? The app never judges: you do.</span>
        <Button variant="quiet" size="sm" onClick={() => setOpen(true)}>
          Tips
        </Button>
        <Button variant="quiet" size="sm" aria-label="Hide the tips" onClick={dismiss}>
          ✕
        </Button>
      </aside>
      <Modal open={open} onClose={() => setOpen(false)} title="New here? Three things to know">
        <div className="flex flex-col gap-3 text-sm">
          {list}
          <Button onClick={dismiss}>Got it</Button>
        </div>
      </Modal>
    </>
  );
}

/** A small buzz when this player is newly on the face-off clock. */
function useOnTheClock(view: CliffhangerView) {
  const fo = view.round?.stage === 'faceoff' ? view.round.faceoff : null;
  const mine = !!fo && fo.on === view.me?.id;
  const was = useRef(mine);
  useEffect(() => {
    if (mine && !was.current) buzz(40);
    was.current = mine;
  }, [mine]);
}

type Tab = 'play' | 'board';

const TABS_ID = 'cliffhanger-tabs';
const TABS: readonly TabBarItem<Tab>[] = [
  { id: 'play', label: 'Play', icon: 'gamepad-2' },
  { id: 'board', label: 'Board', icon: 'layout-grid' },
];

function Board({
  view,
  room,
  act,
  online,
}: Pick<CliffhangerUiProps, 'view' | 'room' | 'act'> & { online: (id: string) => boolean }) {
  const r = view.round;
  // The end shows both collections and the story itself: the rail keeps only the teams.
  const over = view.phase === 'over';
  return (
    <div className="space-y-3">
      {!over && (
        <Panel className="space-y-3">
          {TEAMS.map((t) => (
            <div key={t} className="space-y-2">
              <GenreRace view={view} team={t} />
              {r?.board[t] && r.stage !== 'keep' && <Bays view={view} team={t} size="h-16" />}
            </div>
          ))}
        </Panel>
      )}
      <Panel>
        <Teams view={view} room={room} act={act} online={online} />
      </Panel>
      {!over && view.log.length > 0 && (
        <Panel>
          <h3 className="mb-1 text-sm font-semibold">What happened</h3>
          <ol className="max-h-64 space-y-1 overflow-y-auto text-sm" data-testid="log">
            {[...view.log].reverse().map((e, i) => (
              <li key={i}>
                <span className="mr-2 text-xs text-ink-muted tabular-nums">R{e.round}</span>
                {e.text}
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}

function Game(props: CliffhangerUiProps) {
  const { view, room, act, showGuide, setYourMove, setSpectator, setAbandon, profile } = props;
  const art = useArt();
  const online = (id: string) => room.players.find((p) => p.id === id)?.connected ?? false;
  const status = statusFor(view, room);
  const [tab, setTab] = useState<Tab>('play');
  const wide = useWideScreen();
  const [volumes, setVolume] = useCliffhangerVolumes();
  useHostVolumes({
    game: GAME_ID,
    host: view.settings.hostVolumes,
    isHost: room.isHost,
    setVolume,
  });
  const cue = useSound({
    view,
    manifest: art.manifest,
    isHost: room.isHost,
    isStage: false,
    stagePresent: room.stage?.present === true,
    clockOffset: room.clockOffset,
    volumes,
  });
  useOnTheClock(view);
  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () =>
    act({ type: 'back-to-lobby' }),
  );

  const playing = view.seats.filter((s) => s.team).length;
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.team
      ? playing < MAX_PLAYERS
        ? {
            text:
              view.phase === 'playing'
                ? 'Join a team to play from the next round.'
                : 'Join a team to play.',
            actionLabel: 'Join a team',
            action: () => revealElement(SEAT_CONTROL_ID),
          }
        : { text: 'The teams are full for now.' }
      : null,
  );

  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  const soundProps = { view, room, act, manifest: art.manifest };
  if (view.phase === 'lobby') {
    return (
      <Lobby
        view={view}
        room={room}
        act={act}
        status={status}
        blocker={startBlocker(view)}
        online={online}
        showGuide={() => showGuide()}
        sound={<CliffhangerLobbySound {...soundProps} />}
      />
    );
  }

  return (
    <div className="space-y-3">
      {profile !== 'stage' && <MomentOverlay view={view} clockOffset={room.clockOffset} />}
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div
          className={cn('min-w-0 space-y-3', tab !== 'play' && 'hidden lg:block')}
          {...(!wide && tab === 'play' && tabPanelProps(TABS_ID, 'play'))}
        >
          {/* The guide and sound sit beside the status line. */}
          <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">
              {status.text && (
                <Hint tone={status.yourMove ? 'action' : 'neutral'} dense>
                  {status.text}
                </Hint>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button variant="quiet" size="sm" onClick={() => showGuide()} aria-label="Rules">
                📖
              </Button>
              <CliffhangerSoundButton {...soundProps} />
            </div>
          </div>
          {/* Never between a player on the clock and their buttons. */}
          {view.phase === 'playing' && !status.yourMove && <Tips view={view} />}
          {view.phase === 'over' ? (
            <Panel>
              <End view={view} room={room} act={act} />
            </Panel>
          ) : (
            <>
              <Panel>
                <Stage view={view} room={room} act={act} cue={cue} />
              </Panel>
            </>
          )}
        </div>
        <aside
          className={cn('min-w-0', tab !== 'board' && 'hidden lg:block')}
          {...(!wide && tab === 'board' && tabPanelProps(TABS_ID, 'board'))}
        >
          <Board view={view} room={room} act={act} online={online} />
        </aside>
      </div>
      {!wide && (
        <TabBar
          id={TABS_ID}
          label="Cliffhanger"
          items={TABS}
          value={tab}
          onChange={setTab}
          className="lg:hidden"
        />
      )}
    </div>
  );
}

export function CliffhangerGame(props: CliffhangerUiProps) {
  const art = useLoadedArt();
  return (
    <ArtContext.Provider value={art}>
      <CliffhangerStyles />
      <Game {...props} />
    </ArtContext.Provider>
  );
}
