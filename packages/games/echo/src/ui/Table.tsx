import { Badge, Button, cn } from '@vt/ui';
import { type EchoAction, type EchoView, MAX_PLAYERS } from '../logic/types.ts';

type Act = (a: EchoAction) => Promise<boolean>;

function PlayerChip({
  name,
  you,
  online,
  mark,
  label,
}: {
  name: string;
  you: boolean;
  online: boolean;
  mark?: string;
  label?: string;
}) {
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-sm dark:bg-stone-800',
        !online && 'opacity-50',
      )}
    >
      <span
        aria-hidden
        className={cn('size-2 rounded-full', online ? 'bg-emerald-500' : 'bg-stone-400')}
      />
      {name}
      {you && <Badge>you</Badge>}
      {mark && (
        <span role="img" aria-label={label} title={label}>
          {mark}
        </span>
      )}
    </li>
  );
}

/**
 * Who's playing (in guessing order) and who's watching, with the viewer's own Play / Just watch
 * switch. In play each player is marked: the guesser, and who has sent their clues.
 */
export function Table({
  view,
  online,
  act,
}: {
  view: EchoView;
  online: (id: string) => boolean;
  act: Act;
}) {
  const turn = view.turn;
  const players = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const mark = (id: string): { mark?: string; label?: string } => {
    if (!turn) return {};
    if (id === turn.guesser) return { mark: '🎯', label: 'guesser' };
    if (turn.stage === 'clues' && turn.givers.includes(id)) {
      return turn.submitted.includes(id)
        ? { mark: '✅', label: 'clues sent' }
        : { mark: '✏️', label: 'writing' };
    }
    return {};
  };
  return (
    <section aria-label="Players" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          Players ({players.length}/{MAX_PLAYERS})
        </h3>
        {me &&
          (me.playing ? (
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => {
                if (
                  view.phase !== 'playing' ||
                  window.confirm('Sit out and just watch? You can join again later.')
                ) {
                  void act({ type: 'sit', playing: false });
                }
              }}
            >
              Just watch
            </Button>
          ) : (
            players.length < MAX_PLAYERS && (
              <Button
                variant="secondary"
                className="h-11"
                onClick={() => void act({ type: 'sit', playing: true })}
              >
                Play
              </Button>
            )
          ))}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((s) => (
          <PlayerChip
            key={s.id}
            name={s.name}
            you={s.id === me?.id}
            online={online(s.id)}
            {...mark(s.id)}
          />
        ))}
      </ul>
      {watching.length > 0 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <span className="font-semibold">Watching:</span>{' '}
          {watching.map((s) => s.name + (s.id === me?.id ? ' (you)' : '')).join(', ')}
        </p>
      )}
    </section>
  );
}
