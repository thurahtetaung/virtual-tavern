import { type GameUiProps, storageKey } from '@vt/game-sdk';
import { Button, Hint, Panel, cn, revealElement, useAbandonGame, useSpectatorPrompt } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import { nounOf } from '../logic/genres.ts';
import {
  type CliffhangerAction,
  type CliffhangerView,
  MAX_PLAYERS,
  TEAMS,
} from '../logic/types.ts';
import { ArtContext, useArt, useLoadedArt } from './assets.ts';
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

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips({ view }: { view: CliffhangerView }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  const nouns = nounOf(view.settings.deck, true);
  return (
    <aside
      data-testid="tips"
      className="cl-rise flex flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30"
    >
      <p className="font-semibold">New here? Three things to know</p>
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
      <Button
        variant="ghost"
        size="sm"
        className="self-end"
        onClick={() => {
          try {
            localStorage.setItem(storageKey(TIPS_KEY), '1');
          } catch {
            // Storage blocked: the tips just close for now.
          }
          setSeen(true);
        }}
      >
        Got it
      </Button>
    </aside>
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

function Board({
  view,
  room,
  act,
  online,
}: Pick<CliffhangerUiProps, 'view' | 'room' | 'act'> & { online: (id: string) => boolean }) {
  const r = view.round;
  return (
    <div className="space-y-3">
      <Panel className="space-y-3">
        {TEAMS.map((t) => (
          <div key={t} className="space-y-2">
            <GenreRace view={view} team={t} />
            {r?.board[t] && r.stage !== 'keep' && <Bays view={view} team={t} size="h-16" />}
          </div>
        ))}
      </Panel>
      <Panel>
        <Teams view={view} room={room} act={act} online={online} />
      </Panel>
      {view.log.length > 0 && (
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
  const [volumes] = useCliffhangerVolumes();
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
      <div className="flex items-center gap-2">
        <div
          role="tablist"
          aria-label="Show"
          className="grid flex-1 grid-cols-2 gap-1 rounded-xl bg-card p-1 ring-1 ring-line lg:hidden dark:bg-stone-800 dark:ring-0"
        >
          {(['play', 'board'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-testid={`tab-${t}`}
              onClick={() => setTab(t)}
              className={cn(
                'h-10 rounded-lg text-sm font-semibold',
                tab === t ? 'bg-panel shadow-sm dark:bg-stone-900' : 'text-ink-muted',
              )}
            >
              {t === 'play' ? 'Play' : 'Board'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => showGuide()} aria-label="Rules">
            📖
          </Button>
          <CliffhangerSoundButton {...soundProps} />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className={cn('min-w-0 space-y-3', tab !== 'play' && 'hidden lg:block')}>
          <Hint tone={status.yourMove ? 'action' : 'neutral'} dense>
            {status.text}
          </Hint>
          {/* Never between a player on the clock and their buttons. */}
          {view.phase === 'playing' && !status.yourMove && <Tips view={view} />}
          {view.phase === 'over' ? (
            <Panel>
              <End view={view} room={room} act={act} />
            </Panel>
          ) : (
            <>
              <div className="space-y-1 lg:hidden">
                {TEAMS.map((t) => (
                  <GenreRace key={t} view={view} team={t} compact />
                ))}
              </div>
              <Panel>
                <Stage view={view} room={room} act={act} cue={cue} />
              </Panel>
            </>
          )}
        </div>
        <aside className={cn('min-w-0', tab !== 'board' && 'hidden lg:block')}>
          <Board view={view} room={room} act={act} online={online} />
        </aside>
      </div>
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
