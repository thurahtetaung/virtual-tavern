import { type GameRoomInfo, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  NameDot,
  Panel,
  RefusalSlot,
  Superlatives,
  useAbandonGame,
  useSpectatorPrompt,
} from '@vt/ui';
import { useEffect, useMemo } from 'react';
import type { TavernBrawlAction, TavernBrawlView } from '../logic/types.ts';
import { type Art, artFor, heroVars, useManifest } from './assets.ts';
import { Lobby, Portrait } from './Lobby.tsx';
import { HpDial, type Status, Table, statusFor } from './Table.tsx';
import { type NameOf, namesFor } from './text.ts';

export type TavernBrawlUiProps = GameUiProps<TavernBrawlView, TavernBrawlAction>;

export function TavernBrawlGame({
  view,
  room,
  act,
  showGuide,
  setYourMove,
  setSpectator,
  setAbandon,
}: TavernBrawlUiProps) {
  const manifest = useManifest();
  const art = useMemo(() => artFor(manifest), [manifest]);
  const name = useMemo(() => namesFor(view, room.you), [view, room.you]);
  const status = statusFor(view, room.you, name, art);
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

  const seatedInGame = !!view.game?.players.some((p) => p.id === room.you);
  const watching = !!view.me && (view.phase === 'lobby' ? !view.me.playing : !seatedInGame);
  useSpectatorPrompt(
    setSpectator,
    watching
      ? view.phase === 'lobby'
        ? {
            text: 'Take a seat and pick a hero to play.',
            actionLabel: 'Take a seat',
            action: () => void act({ type: 'sit', playing: true }),
          }
        : { text: 'You can join from the next game.' }
      : null,
  );

  if (view.phase === 'lobby' || !view.game)
    return <Lobby view={view} room={room} act={act} art={art} showGuide={showGuide} />;
  return (
    <div className="flex flex-col gap-3">
      {view.phase === 'over' && (
        <End view={view} room={room} act={act} art={art} name={name} status={status} />
      )}
      <Table view={view} room={room} act={act} art={art} name={name} status={status} />
    </div>
  );
}

function End({
  view,
  room,
  act,
  art,
  name,
  status,
}: {
  view: TavernBrawlView;
  room: GameRoomInfo;
  act: TavernBrawlUiProps['act'];
  art: Art;
  name: NameOf;
  status: Status;
}) {
  const g = view.game!;
  const winner = g.winners[0];
  const hero = winner ? g.players.find((p) => p.id === winner)?.hero : null;
  const kos = g.knockouts;
  const card = (id: string | null) => (id ? art.card(id) : null);
  return (
    <Panel className="mx-auto flex w-full max-w-3xl flex-col gap-3" style={heroVars(hero)}>
      <div className="flex items-center gap-3">
        {hero && <Portrait hero={hero} art={art} size={64} />}
        <div className="min-w-0">
          <h2 className="text-xl font-black">{status.text}</h2>
          {hero && (
            <p className="text-sm text-ink-muted dark:text-stone-400">
              {art.hero(hero)} is the last one standing after {g.turn.number} turns.
            </p>
          )}
        </div>
      </div>
      {kos.length > 0 && (
        <section aria-label="Knockouts">
          <h3 className="text-sm font-semibold">Knockouts</h3>
          <ol className="text-sm">
            {kos.map((k) => (
              <li key={`${k.player}-${k.turn}`}>
                💥 {name(k.player)}, turn {k.turn}
                {k.removed
                  ? ' (removed)'
                  : k.by === k.player
                    ? `: ${card(k.card) ?? 'their own card'} (their own)`
                    : `: ${card(k.card) ?? 'a card'} by ${name(k.by)}`}
              </li>
            ))}
          </ol>
        </section>
      )}
      <ul className="flex flex-wrap gap-2" aria-label="Final hit points">
        {g.players.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-1.5 rounded-xl bg-panel px-2 py-1 ring-1 ring-line dark:bg-stone-800 dark:ring-0"
          >
            <HpDial hp={p.hp} size={30} out={p.out} />
            <span className="inline-flex items-center gap-1 text-sm">
              <span>
                <span className="font-semibold">{name(p.id)}</span> · {art.hero(p.hero)}
              </span>
              <NameDot name={p.name} className="order-first" />
            </span>
          </li>
        ))}
      </ul>
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="lg"
            className="flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'tb-end' })}
          >
            Play again
          </Button>
          <Button
            variant="secondary"
            size="lg"
            onClick={() => void act({ type: 'back-to-lobby' }, { anchor: 'tb-end' })}
          >
            Change setup
          </Button>
        </div>
      ) : (
        <Hint>{waitingForHost(room, 'start the next brawl')}</Hint>
      )}
      <RefusalSlot anchor="tb-end" />
    </Panel>
  );
}
