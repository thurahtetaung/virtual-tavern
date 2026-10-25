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
import {
  DEFAULT_TARGET,
  type JewellerAction,
  type JewellerView,
  MAX_PLAYERS,
  MAX_TARGET,
  MIN_PLAYERS,
  MIN_TARGET,
} from '../logic/types.ts';
import { type Art, artFor, useManifest } from './assets.ts';
import { CardBack, CardTile, JewellerStyles, NobleTile, TokenChip } from './Pieces.tsx';
import { type Act, TIPS_KEY, Table, tipsSeen } from './Table.tsx';
import { type NameOf, statusFor } from './text.ts';

export type JewellerUiProps = GameUiProps<JewellerView, JewellerAction>;

export function JewellerGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: JewellerUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const names = (view.game?.players ?? view.seats).map((p) => `${p.id}=${p.name}`).join('|');
  // Real names for the table and the log; the status line says "You".
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
        ? {
            text: 'Take a seat to play.',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: 'You can join from the next game.' }
      : null,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-2">
      <JewellerStyles />
      {view.phase === 'lobby' || !view.game ? (
        <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />
      ) : (
        <>
          <Hint tone={status.yourMove ? 'action' : 'neutral'}>{status.text}</Hint>
          {view.phase === 'playing' && inGame && <Tips />}
          {view.phase === 'over' && <End view={view} room={room} act={act} art={art} />}
          <Table view={view} room={room} act={act} art={art} name={name} showGuide={showGuide} />
        </>
      )}
    </div>
  );
}

/** First-time tips, until dismissed (per seat in a playtest). */
function Tips() {
  const [seen, setSeen] = useState(tipsSeen);
  if (seen) return null;
  return (
    <aside className="jw-rise flex flex-col gap-1.5 rounded-2xl bg-info-soft px-4 py-3 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30">
      <p className="font-semibold">New here? Three things to know</p>
      <ul className="list-disc space-y-1 pl-5">
        <li>Tap gem piles to pick them, then Take. Tap a card to buy or reserve it.</li>
        <li>
          A green glow means you can buy it now (amber: with gold). The numbers on each card are
          what it still costs you after your cards’ discounts.
        </li>
        <li>Every card you own is a lasting discount, and nobles visit for the right cards.</li>
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
  view: JewellerView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
  showGuide: () => void;
}) {
  const seated = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const offline = (id: string) => room.players.find((p) => p.id === id)?.connected === false;
  const { target, showReserved } = view.settings;
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
        {(art.box ?? art.logo) && (
          <ProtectedImage
            src={(art.box ?? art.logo)!}
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
        <p className="flex items-center gap-2 text-sm text-ink-muted dark:text-stone-400">
          <TokenChip token="red" art={art} size={22} />
          <TokenChip token="gold" art={art} size={22} />
          Take gems, buy cards for lasting discounts, and win the nobles over. First to {
            target
          }{' '}
          points ends the game.
        </p>
      </Panel>
      <LobbySettings
        editable={room.isHost}
        summary={[
          `first to ${target}`,
          showReserved ? 'reserved cards shown' : 'reserved cards hidden',
          timersLine(timers, { clue: 'turns', guess: null }),
        ]}
        className="space-y-4"
      >
        <div className="flex flex-col gap-1.5">
          <label htmlFor="jw-target" className="text-sm font-semibold">
            Points to end the game: {target}
            {target === DEFAULT_TARGET ? ' (the usual)' : ''}
          </label>
          <input
            id="jw-target"
            type="range"
            min={MIN_TARGET}
            max={MAX_TARGET}
            value={target}
            disabled={!room.isHost}
            onChange={(e) =>
              void act(
                { type: 'update-settings', target: Number(e.target.value) },
                { anchor: 'jw-lobby' },
              )
            }
            className="w-full accent-accent"
            data-testid="jw-target"
          />
          <span className="text-xs text-ink-muted dark:text-stone-400">
            Higher makes a longer game. The round is still finished once someone reaches it.
          </span>
        </div>
        <Switch
          on={showReserved}
          editable={room.isHost}
          title="Show reserved cards"
          help="Cards reserved from the rows stay face up for everyone (cards reserved from a deck stay hidden). Off is the usual rule: others see how many and their level."
          onChange={(v) =>
            void act({ type: 'update-settings', showReserved: v }, { anchor: 'jw-lobby' })
          }
          testId="jw-show-reserved"
        />
        <TimerSettings
          values={timers}
          editable={room.isHost}
          clueLabel="Turn timer"
          clueHelp="Time for each turn."
          strictHelp="a safe move is made for them (gems from the fullest piles)"
          onChange={(patch) =>
            void act(
              {
                type: 'update-settings',
                ...(patch.clueSeconds !== undefined && { seconds: patch.clueSeconds }),
                ...(patch.timerMode !== undefined && { timerMode: patch.timerMode }),
              },
              { anchor: 'jw-lobby' },
            )
          }
        />
        <RefusalSlot anchor="jw-lobby" />
      </LobbySettings>
      {room.isHost && (
        <StickyBar>
          <Button
            size="lg"
            className="w-full"
            disabled={!!blocker}
            onClick={() => void act({ type: 'start' }, { anchor: 'jw-start' })}
          >
            Start the game
          </Button>
          <RefusalSlot anchor="jw-start" />
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
}: {
  view: JewellerView;
  room: GameRoomInfo;
  act: Act;
  art: Art;
}) {
  const g = view.game!;
  // Winners first among equal points (a tie goes to fewer cards), so the podium matches.
  const score = (id: string) => {
    const p = g.players.find((x) => x.id === id)!;
    return p.points * 100 - (g.winners.includes(id) ? 0 : 1);
  };
  return (
    <Panel className="jw-rise flex flex-col gap-3">
      <Standings
        entries={g.players.map((p) => ({
          id: p.id,
          name: p.name,
          score: score(p.id),
          note: `${p.cards.length} ${p.cards.length === 1 ? 'card' : 'cards'} · ${p.nobles.length} ${p.nobles.length === 1 ? 'noble' : 'nobles'}${p.reserved.length ? ` · ${p.reserved.length} reserved` : ''}`,
        }))}
        you={room.you}
        scoreLabel={(n) => `${Math.ceil(n / 100)} points`}
      />
      <section aria-label="Every hand" className="flex flex-col gap-1 text-sm">
        <h3 className="font-semibold">What everyone had in hand</h3>
        <ul className="flex flex-col gap-1">
          {g.players.map((p) => (
            <li key={p.id} className="flex items-center gap-2">
              <span className="w-24 truncate">{p.name}</span>
              <span className="flex items-center gap-1">
                {p.reserved.length === 0 ? (
                  <span className="text-ink-muted dark:text-stone-400">—</span>
                ) : (
                  p.reserved.map((r, i) =>
                    r.card ? (
                      <CardTile key={i} id={r.card} art={art} className="!w-16" />
                    ) : (
                      <CardBack key={i} level={r.level} art={art} className="h-12 w-10" />
                    ),
                  )
                )}
              </span>
              <span className="flex items-center gap-1">
                {p.nobles.map((n) => (
                  <NobleTile key={n} id={n} art={art} className="!size-10" />
                ))}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'jw-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'jw-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next game')}</Hint>
      )}
      <RefusalSlot anchor="jw-end" />
    </Panel>
  );
}
