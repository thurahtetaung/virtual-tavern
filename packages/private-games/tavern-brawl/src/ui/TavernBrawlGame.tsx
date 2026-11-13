import { type GameRoomInfo, type GameUiProps, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  Hint,
  NameDot,
  Panel,
  RefusalSlot,
  EndTabs,
  Superlatives,
  useAbandonGame,
  useSpectatorPrompt,
  useWideScreen,
  cn,
} from '@vt/ui';
import { type ReactNode, useEffect, useMemo } from 'react';
import type { TavernBrawlAction, TavernBrawlView } from '../logic/types.ts';
import { type Art, artFor, heroVars, useManifest } from './assets.ts';
import { Lobby, Portrait } from './Lobby.tsx';
import { HpDial, type Status, Table, statusFor } from './Table.tsx';
import { type NameOf, nameKey, namesFrom } from './text.ts';

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
  // Kept the same function while nobody's name changes, so memoised seats and cards stay put.
  const names = nameKey(view);
  const name = useMemo(() => namesFrom(names, room.you), [names, room.you]);
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

  const wide = useWideScreen();
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
  // Phones: the table is one of the end's tabs, so the end fits the screen.
  const phoneEnd = view.phase === 'over' && !wide;
  const table = <Table view={view} room={room} act={act} art={art} name={name} status={status} />;
  return (
    <div className="flex flex-col gap-3">
      {view.phase === 'over' && (
        <End
          view={view}
          room={room}
          act={act}
          art={art}
          name={name}
          status={status}
          table={phoneEnd ? table : null}
        />
      )}
      {!phoneEnd && table}
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
  table,
}: {
  view: TavernBrawlView;
  room: GameRoomInfo;
  act: TavernBrawlUiProps['act'];
  art: Art;
  name: NameOf;
  status: Status;
  /** Phones: the table, as one of the end's tabs. */
  table: ReactNode;
}) {
  const g = view.game!;
  const winner = g.winners[0];
  const hero = winner ? g.players.find((p) => p.id === winner)?.hero : null;
  const kos = g.knockouts;
  const card = (id: string | null) => (id ? art.card(id) : null);
  return (
    <Panel className="mx-auto flex w-full max-w-3xl flex-col gap-3" style={heroVars(hero)}>
      {/* The finale: the winner's hero large in their own colour, the line under it. */}
      <div className="flex flex-col items-center gap-2 pt-1 text-center">
        {hero && <Portrait hero={hero} art={art} size={128} className="shadow-vt-2 ring-4" />}
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-black sm:text-3xl">{status.text}</h2>
          {hero && (
            <p className="text-sm text-ink-muted">
              {art.hero(hero)} is the last one standing after {g.turn.number} turns.
            </p>
          )}
        </div>
      </div>
      <EndTabs
        tabs={[
          {
            id: 'players',
            label: '❤️ Players',
            content: (
              // Standings: who is still up first, each with their hero's portrait.
              <ul className="grid gap-2 sm:grid-cols-2" aria-label="Final hit points">
                {[...g.players]
                  .sort((a, b) => Number(a.out) - Number(b.out) || b.hp - a.hp)
                  .map((p) => (
                    <li
                      key={p.id}
                      className={cn(
                        'flex items-center gap-2.5 rounded-xl bg-panel px-2.5 py-2 ring-1 ring-line dark:ring-0',
                        p.out && 'opacity-75',
                      )}
                      style={heroVars(p.hero)}
                    >
                      <Portrait hero={p.hero} art={art} size={44} />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="flex items-center gap-1 font-semibold">
                          <NameDot name={p.name} />
                          {name(p.id)}
                          {g.winners.includes(p.id) && <span aria-label="winner">🏆</span>}
                        </span>
                        <span className="block text-ink-muted">
                          {art.hero(p.hero)}
                          {!p.out && ` · ${p.hp} hit points left`}
                        </span>
                      </span>
                      <HpDial hp={p.hp} size={34} out={p.out} />
                    </li>
                  ))}
              </ul>
            ),
          },
          kos.length > 0 && {
            id: 'knockouts',
            label: '💥 KOs',
            content: (
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
            ),
          },
          !!room.superlatives?.length && {
            id: 'awards',
            label: '✨ Awards',
            content: <Superlatives lines={room.superlatives} />,
          },
          !!table && { id: 'table', label: '🍺 Table', content: table },
        ]}
      />
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
