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
  TimerSettings,
  timersLine,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { fullRows } from '../logic/rules.ts';
import {
  type Board,
  type Bonus,
  COLOUR_BONUS,
  COLOURS,
  COLUMN_BONUS,
  FACTORIES_FOR,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type MosaicAction,
  type MosaicView,
  ROW_BONUS,
} from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { MosaicStyles, Tile } from './Pieces.tsx';
import { type Act, TIPS_KEY, Table, tipsSeen } from './Table.tsx';
import { Tiling } from './Tiling.tsx';
import { type NameOf, statusFor } from './text.ts';

export type MosaicUiProps = GameUiProps<MosaicView, MosaicAction>;

export function MosaicGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: MosaicUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  const name = useMemo<NameOf>(() => {
    const map = new Map(names.split('|').map((kv) => kv.split('=') as [string, string]));
    return (id) => (id ? (map.get(id) ?? 'Someone') : 'Someone');
  }, [names]);
  const status = statusFor(view, room.you, (id) => (id === room.you ? 'You' : name(id)));
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
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <MosaicStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && inGame && <Tips art={art} />}
          {view.phase === 'over' ? (
            <End view={view} room={room} act={act} art={art} />
          ) : (
            <Table view={view} room={room} act={act} art={art} name={name} showGuide={showGuide} />
          )}
        </>
      )}
    </div>
  );
}

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips({ art }: { art: Art }) {
  const [seen, setSeen] = useState(tipsSeen);
  if (seen) return null;
  return (
    <aside className="mo-rise flex flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">New here?</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>
          Tap a tile to take every tile of its colour there; a sheet shows what each line costs.
        </li>
        <li className="flex flex-wrap items-center gap-1">
          Each colour has a symbol:
          {COLOURS.map((c) => (
            <Tile key={c} colour={c} art={art} size={18} />
          ))}
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
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
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
  const n = Math.min(MAX_PLAYERS, Math.max(MIN_PLAYERS, seated.length));
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
            Players ({seated.length}/{MAX_PLAYERS})
          </h2>
          <Button variant="ghost" size="sm" onClick={() => showGuide()}>
            📖 Rules
          </Button>
        </div>
        {art.box && (
          <ProtectedImage
            src={art.box}
            alt=""
            className="max-h-40 w-full rounded-xl object-cover"
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
        {me && !me.playing && seated.length < MAX_PLAYERS && (
          <Button variant="soft" onClick={() => void act({ type: 'sit', playing: true })}>
            Take a seat
          </Button>
        )}
        <p className="flex flex-wrap items-center gap-1 text-sm text-ink-muted dark:text-stone-400">
          {COLOURS.map((c) => (
            <Tile key={c} colour={c} art={art} size={20} />
          ))}
          <span className="ml-1">
            Take tiles of one colour, fill your lines, and tile a wall that scores in runs.{' '}
            {FACTORIES_FOR[n]} factories for {n} players.
          </span>
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[timersLine(timers, { clue: 'turns', guess: null })]}
        className="space-y-4"
      >
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Turn timer"
          clueHelp="Time for each turn. By default it only nudges."
          strictHelp="the safe move is made for them (the take that costs least)"
          onChange={(patch) =>
            void act(
              {
                type: 'update-settings',
                ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
                ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
              },
              { anchor: 'mo-lobby' },
            )
          }
        />
        <RefusalSlot anchor="mo-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'mo-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="mo-start" />
        </StickyBar>
      )}
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Under each standing: the full rows (the tie-break) and the end bonuses they earned, so the
 * whole result reads in one place, e.g. "3 full rows +6 · 1 colour +10 = +16 bonus" or "1 full row +2 bonus".
 */
function endNote(wall: Board['wall'], bonus: Bonus | undefined, left: boolean | undefined) {
  const rows = fullRows(wall);
  const parts = [
    `${plural(rows, 'full row', 'full rows')}${bonus && rows ? ` +${rows * ROW_BONUS}` : ''}`,
  ];
  if (bonus?.columns)
    parts.push(`${plural(bonus.columns, 'column', 'columns')} +${bonus.columns * COLUMN_BONUS}`);
  if (bonus?.colours)
    parts.push(`${plural(bonus.colours, 'colour', 'colours')} +${bonus.colours * COLOUR_BONUS}`);
  const earned = [rows, bonus?.columns, bonus?.colours].filter(Boolean).length;
  const total = !bonus
    ? ''
    : !bonus.points
      ? ' · no bonus'
      : earned > 1
        ? ` = +${bonus.points} bonus`
        : ' bonus';
  return `${parts.join(' · ')}${total}${left ? ' · left' : ''}`;
}

function End({
  view,
  room,
  act,
  art,
}: {
  view: MosaicView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const g = view.game!;
  const players = g.players.filter((p) => !p.removed);
  // Winners first among equal points (a tie goes to most full rows), so the podium matches.
  const score = (id: string) => {
    const p = g.players.find((x) => x.id === id)!;
    return p.score * 100 - (g.winners.includes(id) ? 0 : 1);
  };
  return (
    <div className="flex flex-col gap-2 lg:mx-auto lg:max-w-4xl">
      <Panel className="mo-rise flex flex-col gap-3">
        <Standings
          entries={players.map((p) => ({
            id: p.id,
            name: p.name,
            score: score(p.id),
            note: endNote(
              p.wall,
              g.scoring?.last ? g.scoring.players[p.id]?.bonus : undefined,
              p.left,
            ),
          }))}
          you={room.you}
          scoreLabel={(n) =>
            `${Math.ceil(n / 100)} ${Math.ceil(n / 100) === 1 ? 'point' : 'points'}`
          }
        />
        <Superlatives lines={room.superlatives} />
        {room.isHost ? (
          <div className="flex flex-wrap gap-2">
            <Button
              size="lg"
              className="flex-1"
              onClick={() => void act({ type: 'play-again' }, { anchor: 'mo-end' })}
            >
              Play again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'mo-end' })}
            >
              Change setup
            </Button>
          </div>
        ) : (
          <Hint>{waitingForHost(room, 'start the next game')}</Hint>
        )}
        <RefusalSlot anchor="mo-end" />
      </Panel>
      <Tiling view={view} room={room} act={act} art={art} />
    </div>
  );
}
