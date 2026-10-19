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
import { discName, fillNames } from '../logic/names.ts';
import { MAX_PLAYERS, MIN_PLAYERS, type ThornsAction, type ThornsView } from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { DiscView, ThornsStyles } from './Disc.tsx';
import { type Act, Table } from './Table.tsx';
import { type NameOf, statusFor } from './text.ts';

export type ThornsUiProps = GameUiProps<ThornsView, ThornsAction>;

export function ThornsGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: ThornsUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  // Real names for the table and the log; the status line says "You".
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  const status = statusFor(view, room.you, (id) => (id === room.you ? 'You' : name(id)), art.names);
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
        ? {
            text: 'Take a seat to play.',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: 'You can join from the next game.' }
      : null,
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
      <ThornsStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && <Tips art={art} />}
          {view.phase === 'over' && <End view={view} room={room} act={act} art={art} name={name} />}
          <Table view={view} room={room} act={act} art={art} name={name} />
        </>
      )}
    </div>
  );
}

const TIPS_KEY = 'thorns.tips.v1';

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips({ art }: { art: Art }) {
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(storageKey(TIPS_KEY)) === '1';
    } catch {
      return true;
    }
  });
  if (seen) return null;
  const f = (s: string) => fillNames(s, art.names);
  return (
    <aside className="th-rise flex flex-col gap-2 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>{f('Only you see your own discs. Everyone else sees how many are on your mat.')}</li>
        <li>
          {f('A Challenger turns over their own discs first, so bid on the {roses} you know.')}
        </li>
        <li>{f('Put your {thorn} down and bid anyway: whoever goes past you pays for it.')}</li>
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
  view: ThornsView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const lastChance = view.settings.lastChance !== false;
  const timers = {
    clueSeconds: view.settings.seconds,
    guessSeconds: null,
    timerMode: view.settings.timerMode,
  };
  const blocker =
    seated.length < MIN_PLAYERS
      ? `${MIN_PLAYERS} players are needed (${seated.length} seated).`
      : seated.length > MAX_PLAYERS
        ? `At most ${MAX_PLAYERS} can play.`
        : null;
  return (
    <>
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
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        {art.lobby && (
          <ProtectedImage
            src={art.lobby}
            alt=""
            className="max-h-40 w-full rounded-xl object-cover"
          />
        )}
        <ul className="flex flex-col gap-1.5" aria-label="Seats">
          {seated.map((s, i) => (
            <li key={s.id} className="flex items-center gap-2">
              <DiscView
                face="back"
                seat={i}
                color={room.players.find((p) => p.id === s.id)?.color}
                art={art}
                size={28}
              />
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
        <p className="flex items-center gap-2 text-sm text-ink-muted dark:text-stone-400">
          <DiscView face="rose" seat={0} color={undefined} art={art} size={24} />
          <DiscView face="thorn" seat={0} color={undefined} art={art} size={24} />
          {fillNames(
            'Each player gets three {roses} and one {thorn}. Win two challenges, or be the last one left.',
            art.names,
          )}
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          lastChance ? `${art.names.chance} on` : `no ${art.names.chance}`,
          timersLine(timers, { clue: 'decisions', guess: null }),
        ]}
        className="space-y-4"
      >
        <Switch
          on={lastChance}
          editable={room.isHost}
          title={fillNames('{Chance}', art.names)}
          help={fillNames(
            'A Challenger who fails and is left with one disc borrows a known {rose} for the next round.',
            art.names,
          )}
          onChange={(v) =>
            void act({ type: 'update-settings', lastChance: v }, { anchor: 'th-lobby' })
          }
          testId="th-last-chance"
        />
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Decision timer"
          clueHelp="Time for each move: putting a disc down, bidding, turning discs over."
          strictHelp="a safe move is made for them (a rose, a pass, the next disc)"
          onChange={(patch) =>
            void act(
              {
                type: 'update-settings',
                ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
                ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
              },
              { anchor: 'th-lobby' },
            )
          }
        />
        <RefusalSlot anchor="th-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'th-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="th-start" />
        </StickyBar>
      )}
    </>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
}: {
  view: ThornsView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  name: NameOf;
}) {
  const g = view.game!;
  const reveal = new Map((view.reveal ?? []).map((r) => [r.id, r]));
  const lostLine = (id: string) => {
    const lost = reveal.get(id)?.lost ?? [];
    return lost.length
      ? `lost: ${lost.map((d) => discName(art.names, d)).join(', ')}`
      : 'lost nothing';
  };
  return (
    <Panel className="th-rise flex flex-col gap-3">
      <Standings
        entries={g.players.map((p) => ({
          id: p.id,
          name: p.name,
          // Nobody but the winner can have two points, so the winner always tops the podium.
          score: g.winners.includes(p.id) ? 2 : p.points,
          note: `${p.points} ${p.points === 1 ? 'point' : 'points'} · ${p.discs} ${p.discs === 1 ? 'disc' : 'discs'} left · ${lostLine(p.id)}`,
        }))}
        you={room.you}
        scoreLabel={(n) => (n === 2 ? 'winner' : `${n} ${n === 1 ? 'point' : 'points'}`)}
      />
      <section aria-label="Every stack" className="flex flex-col gap-1 text-sm">
        <h3 className="font-semibold">What everyone had down</h3>
        <ul className="flex flex-col gap-1">
          {g.players.map((p, seat) => {
            const stack = reveal.get(p.id)?.stack ?? [];
            return (
              <li key={p.id} className="flex items-center gap-2">
                <span className="w-24 truncate">{name(p.id)}</span>
                <span className="flex items-center">
                  {stack.length === 0 ? (
                    <span className="text-ink-muted dark:text-stone-400">—</span>
                  ) : (
                    stack.map((d, i) => (
                      <DiscView
                        key={i}
                        face={d}
                        seat={seat}
                        color={room.players.find((x) => x.id === p.id)?.color}
                        art={art}
                        size={28}
                        className={i > 0 ? '-ml-2' : undefined}
                      />
                    ))
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'th-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'th-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next game')}</Hint>
      )}
      <RefusalSlot anchor="th-end" />
    </Panel>
  );
}
