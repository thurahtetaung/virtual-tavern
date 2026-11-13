import type { GameUiProps } from '@vt/game-sdk';
import { PlayerTag } from '@vt/ui';
import { Poster } from '@vt/ui/show';

/**
 * The table screen of a game that has no `Stage` of its own: the room, who is in it, and that the
 * game is played on the phones.
 */
export function GenericStage({ room }: Pick<GameUiProps<unknown, unknown>, 'room'>) {
  return (
    <Poster
      eyebrow="At the table"
      headline={room.gameName}
      line="This game has no table screen yet: everything happens on your phones."
      footer={{ icon: 'users', text: `${room.players.length} at the table` }}
      testId="generic-stage"
    >
      <ul className="mt-6 flex max-w-[1500px] flex-wrap justify-center gap-x-10 gap-y-5 text-[36px] [&_[data-color]]:size-6">
        {room.players.map((p) => (
          <li key={p.id}>
            <PlayerTag name={p.name} host={p.id === room.hostId} offline={!p.connected} />
          </li>
        ))}
      </ul>
    </Poster>
  );
}
