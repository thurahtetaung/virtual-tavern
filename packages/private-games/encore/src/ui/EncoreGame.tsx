import { type GameRoomInfo, type GameUiProps, storageKey, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  LobbySettings,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Standings,
  StickyBar,
  Superlatives,
  Switch,
  TimerSettings,
  timersLine,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { type EncoreAction, type EncoreView, MAX_PLAYERS, MIN_PLAYERS } from '../logic/types.ts';
import { wordsOf } from '../logic/names.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { EncoreStyles, Hand } from './Cards.tsx';
import { type Act, ScoreTable, TIPS_KEY, Table, tipsSeen } from './Table.tsx';
import { WordsContext, useSay } from './say.ts';
import { type NameOf, statusFor } from './text.ts';

export type EncoreUiProps = GameUiProps<EncoreView, EncoreAction>;

export function EncoreGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: EncoreUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const words = useMemo(
    () => wordsOf(manifest && manifest !== 'unavailable' ? manifest : null),
    [manifest],
  );
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  // The status line says "You"; the table and the log use names.
  const status = statusFor(view, room.you, (id) => (id === room.you ? 'You' : name(id)));
  const youName: NameOf = (id) => (id === room.you ? 'You' : name(id));
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

  return (
    <WordsContext.Provider value={words}>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
        <EncoreStyles />
        {view.phase === 'lobby' || !view.game ? (
          <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
        ) : (
          <>
            <StatusLine text={status.text} yourMove={status.yourMove} />
            {view.phase === 'playing' && inGame && <Tips />}
            {view.phase === 'over' && (
              <End view={view} room={room} act={act} art={art} name={youName} />
            )}
            <Table
              view={view}
              room={room}
              act={act}
              art={art}
              name={youName}
              logName={name}
              showGuide={showGuide}
            />
          </>
        )}
      </div>
    </WordsContext.Provider>
  );
}

function StatusLine({ text, yourMove }: { text: string; yourMove: boolean }) {
  const say = useSay();
  return <Hint tone={yourMove ? 'action' : 'neutral'}>{say(text)}</Hint>;
}

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips() {
  const say = useSay();
  const [seen, setSeen] = useState(tipsSeen);
  if (seen) return null;
  return (
    <aside className="en-rise flex flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Your hand can’t be rearranged. Lines under cards mark the sets and runs it already holds.
        </li>
        <li>
          On your turn, cards marked ✦ can be shown: tap one and the longest show from it is picked
          (tap again for a shorter one). The button says why it wins.
        </li>
        <li>
          {say(
            'To recruit, tap a card at either end of the table, turn it if you like, then tap a glowing gap in your hand. Nothing is sent until you confirm.',
          )}
        </li>
      </ul>
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

function Lobby({
  view,
  room,
  act,
  art,
  showGuide,
}: {
  view: EncoreView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const say = useSay();
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const { twoEach } = view.settings;
  const n = seated.length;
  const rounds = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, n)) * (twoEach ? 2 : 1);
  const timers = {
    clueSeconds: view.settings.seconds,
    guessSeconds: null,
    timerMode: view.settings.timerMode,
  };
  const blocker =
    n < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${n} seated).`
      : n > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : null;
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
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
      <Panel className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-bold">
            Players ({n}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        {art.logo && (
          <ProtectedImage
            src={art.logo}
            alt=""
            className="max-h-24 w-full rounded-xl object-cover"
          />
        )}
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
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
        {me && !me.playing && n < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <div className="flex items-center gap-3 text-sm text-ink-muted dark:text-stone-400">
          <Hand
            cards={[
              { id: '4-8', up: 4 },
              { id: '5-6', up: 5 },
              { id: '6-9', up: 6 },
            ]}
            art={art}
            columns={3}
            className="w-28 shrink-0"
            label="A run of three"
          />
          <p>
            {say(
              'Show sets and runs from a hand you can’t rearrange, or recruit a card from the table to build a bigger show. Best with 4 or 5.',
            )}
            {n === 2 && ' Two players use the official 2-player rules: 3 chips each a round.'}
          </p>
        </div>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          `${rounds} rounds`,
          twoEach ? 'two each' : 'one each',
          timersLine(timers, { clue: 'turns', guess: null }),
        ]}
        className="space-y-4"
      >
        <Switch
          on={twoEach}
          editable={room.isHost}
          title="Two rounds each"
          help="Everyone starts two rounds instead of one, for a longer game. Off is the usual: one round each."
          onChange={(v) =>
            void act({ type: 'update-settings', twoEach: v }, { anchor: 'en-lobby' })
          }
          testId="en-two-each"
        />
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Turn timer"
          clueHelp="Time for each turn, and for the keep-or-flip choice."
          strictHelp="the app makes its best move for them"
          onChange={(patch) =>
            void act(
              {
                type: 'update-settings',
                ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
                ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
              },
              { anchor: 'en-lobby' },
            )
          }
        />
        <RefusalSlot anchor="en-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'en-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="en-start" />
        </StickyBar>
      )}
    </div>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
}: {
  view: EncoreView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  return (
    <Panel className="en-rise flex flex-col gap-3">
      <Standings
        entries={g.players.map((p) => {
          const ended = g.results.filter((r) => r.ender === p.id).length;
          return {
            id: p.id,
            name: p.name,
            score: p.total,
            ...(ended > 0 && { note: `ended ${ended} ${ended === 1 ? 'round' : 'rounds'}` }),
          };
        })}
        you={room.you}
      />
      <ScoreTable g={g} name={name} you={room.you} />
      {g.finalHands && (
        <details className="text-sm">
          <summary className="cursor-pointer font-semibold">What everyone held at the end</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {g.players.map((p) => (
              <li key={p.id} className="flex flex-col gap-1">
                <span>{p.name}</span>
                {(g.finalHands![p.id] ?? []).length ? (
                  <Hand
                    cards={g.finalHands![p.id]!}
                    art={art}
                    columns={12}
                    label={`${p.name}’s last hand`}
                  />
                ) : (
                  <span className="text-ink-muted dark:text-stone-400">No cards left</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'en-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'en-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next game')}</Hint>
      )}
      <RefusalSlot anchor="en-end" />
    </Panel>
  );
}
