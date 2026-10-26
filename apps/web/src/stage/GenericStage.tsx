import type { GameUiProps } from '@vt/game-sdk';
import { PlayerTag } from '@vt/ui';

/**
 * The table screen of a game that has no `Stage` of its own: the room, who is in it, and that the
 * game is played on the phones.
 */
export function GenericStage({
  room,
  icon,
  roomId,
}: Pick<GameUiProps<unknown, unknown>, 'room'> & { icon: string; roomId: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 p-16 text-center">
      <div className="space-y-3">
        <p className="text-8xl" aria-hidden>
          {icon}
        </p>
        <h1 className="text-6xl font-bold">{room.gameName}</h1>
        <p className="font-mono text-2xl text-ink-muted dark:text-stone-400">{roomId}</p>
      </div>
      <ul className="flex max-w-5xl flex-wrap justify-center gap-x-8 gap-y-4 text-3xl [&_[data-color]]:size-5">
        {room.players.map((p) => (
          <li key={p.id}>
            <PlayerTag name={p.name} host={p.id === room.hostId} offline={!p.connected} />
          </li>
        ))}
      </ul>
      <p className="max-w-3xl text-2xl text-ink-muted dark:text-stone-400">
        This game has no table screen yet: everything happens on your phones.
      </p>
    </div>
  );
}
