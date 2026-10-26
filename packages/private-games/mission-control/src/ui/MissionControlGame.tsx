import type { GameUiProps } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Hint,
  Panel,
  revealElement,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo } from 'react';
import {
  DUMMY,
  EPILOGUE,
  type MissionControlAction,
  type MissionControlView,
} from '../logic/types.ts';
import { ArtContext, artFor, useArt, useManifest } from './assets.tsx';
import { Briefing, RuleBox } from './Briefing.tsx';
import { CardChip } from './Card.tsx';
import { Debrief } from './Debrief.tsx';
import { Draft } from './Draft.tsx';
import { Lobby, SEAT_CONTROL_ID } from './Lobby.tsx';
import { missionLabel, namer, statusFor } from './status.ts';
import {
  DistressPanel,
  PassPanel,
  PlayTable,
  PlayedCards,
  PredictPanel,
  useTip,
} from './Table.tsx';

export type MissionControlUiProps = GameUiProps<MissionControlView, MissionControlAction>;

const COMMS_NOTE = {
  normal: null,
  currents: '🌀 Currents: signals show the card, not its position.',
  rapture: '🫧 Shared tokens: take one when you need it.',
  none: '🔇 No signals this mission.',
} as const;

/** The line over every dive screen: mission, try, signals and the clock. */
function Header({ view, clockOffset }: { view: MissionControlView; clockOffset: number }) {
  const art = useArt();
  const a = view.attempt!;
  const m = a.mission;
  const note = COMMS_NOTE[a.comms];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-bold">
          {missionLabel(m.n)}
          {m.n === EPILOGUE ? ` · difficulty ${m.difficulty}` : ''}
        </span>
        <span className="text-ink-muted tabular-nums">
          Try {a.number}
          {m.practice ? ' · practice' : ''}
        </span>
        {a.distress.used && <span title={art.say('{Distress} sent')}>🆘</span>}
        {a.terrain && (
          <span className="flex items-center gap-1" title="Unfamiliar terrain">
            ❓ <CardChip card={a.terrain} />
          </span>
        )}
        {note && <span className="text-ink-muted">{note}</span>}
        {a.comms === 'rapture' && <span className="tabular-nums">🫧 {a.pool} left</span>}
      </div>
      {m.seconds !== null && a.stage === 'play' && (
        <Countdown
          deadline={a.deadline}
          clockOffset={clockOffset}
          label="left"
          atZero="then the mission is lost"
        />
      )}
    </div>
  );
}

function Tip({ id, children }: { id: string; children: string }) {
  const [show, dismiss] = useTip(id);
  if (!show) return null;
  return (
    <p className="flex items-start gap-2 rounded-lg bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <span className="flex-1">💡 {children}</span>
      <button type="button" className="shrink-0 underline" onClick={dismiss}>
        Got it
      </button>
    </p>
  );
}

function Game({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: MissionControlUiProps) {
  const art = useArt();
  const me = view.me?.id ?? '';
  const name = namer(view, room, art.names);
  const online = (id: string) =>
    id === DUMMY || (room.players.find((p) => p.id === id)?.connected ?? false);
  const status = statusFor(view, room, art.names);
  const a = view.attempt;

  useAbandonGame(setAbandon, room.isHost && view.phase === 'playing', () => act({ type: 'lobby' }));
  useSpectatorPrompt(
    setSpectator,
    view.me && !view.me.playing
      ? view.seats.filter((s) => s.playing).length < 5
        ? {
            text:
              view.phase === 'lobby'
                ? 'Take a seat to dive.'
                : 'Take a seat in the lobby to dive in the next mission.',
            ...(view.phase === 'lobby' && { action: () => revealElement(SEAT_CONTROL_ID) }),
          }
        : { text: 'The crew is full for now.' }
      : null,
  );
  const tabAlert = view.phase === 'playing' && status.yourMove;
  useEffect(() => {
    setYourMove?.(tabAlert);
    return () => {
      setYourMove?.(false);
    };
  }, [setYourMove, tabAlert]);

  if (view.phase === 'lobby' || !a) {
    return <Lobby view={view} room={room} act={act} status={status} showGuide={showGuide} />;
  }
  if (a.stage === 'briefing') {
    return (
      <div className="space-y-3">
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        <Briefing
          a={a}
          room={room}
          me={me}
          name={name}
          onReady={() => void act({ type: 'ready' })}
        />
      </div>
    );
  }
  const side = (
    <aside className="space-y-3">
      <Panel className="space-y-2">
        <h3 className="font-bold">Mission</h3>
        <RuleBox a={a} />
        <Button variant="secondary" className="w-full" onClick={showGuide}>
          📖 Rules
        </Button>
      </Panel>
      {a.stage === 'play' && (
        <Panel className="hidden space-y-2 lg:block">
          <h3 className="font-bold">{view.settings.playedCards ? 'Played cards' : 'Last trick'}</h3>
          <PlayedCards a={a} name={name} />
        </Panel>
      )}
    </aside>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
      <div className="min-w-0 space-y-3">
        <Header view={view} clockOffset={room.clockOffset} />
        <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
        {a.stage === 'draft' && (
          <>
            <Tip id="draft">
              Each task belongs to whoever takes it. Look at your hand below before you pick.
            </Tip>
            <Draft a={a} me={me} act={act} name={name} openTable={view.settings.openTable} />
          </>
        )}
        {a.stage === 'distress' && <DistressPanel a={a} me={me} act={act} name={name} />}
        {a.stage === 'pass' && <PassPanel a={a} act={act} name={name} />}
        {a.stage === 'predict' && <PredictPanel a={a} act={act} name={name} />}
        {a.stage === 'play' && (
          <Tip id="play">
            Highlighted cards are the ones you may play: tap once to pick, again to play. Tap a card
            during someone else’s turn to play it as soon as yours comes.
          </Tip>
        )}
        {a.stage === 'done' ? (
          <Debrief a={a} room={room} me={me} act={act} name={name} campaign={view.campaign} />
        ) : a.stage === 'play' ? (
          <PlayTable
            a={a}
            me={me}
            act={act}
            name={name}
            online={online}
            emotes={view.emotes}
            openTable={view.settings.openTable}
            showAllPlayed={view.settings.playedCards}
          />
        ) : (
          <HandPreview view={view} />
        )}
      </div>
      {side}
    </div>
  );
}

/** Your hand while the tasks are shared out, so you can judge which to take. */
function HandPreview({ view }: { view: MissionControlView }) {
  const a = view.attempt!;
  if (!a.hand || a.stage === 'pass') return null;
  return (
    <Panel className="space-y-1">
      <p className="text-xs font-semibold">Your hand</p>
      <div className="flex flex-wrap gap-1">
        {a.hand.map((c) => (
          <CardChip key={c} card={c} className="text-base" />
        ))}
      </div>
    </Panel>
  );
}

export function MissionControlGame(props: MissionControlUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  return (
    <ArtContext.Provider value={art}>
      <Game {...props} />
    </ArtContext.Provider>
  );
}
