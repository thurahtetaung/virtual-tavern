import { Button, PlayerTag, cn } from '@vt/ui';
import { type EchoAction, type EchoView, MAX_PLAYERS } from '../logic/types.ts';

type Act = (a: EchoAction) => Promise<boolean>;

function PlayerChip({
  order,
  name,
  you,
  host,
  online,
  mark,
  label,
}: {
  order: number;
  name: string;
  you: boolean;
  host: boolean;
  online: boolean;
  mark?: string;
  label?: string;
}) {
  return (
    <li
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-stone-100 px-2.5 py-1 text-sm dark:bg-stone-800',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-2 rounded-full',
          online ? 'bg-success dark:bg-emerald-500' : 'bg-stone-400',
        )}
      />
      <span className="text-xs font-bold text-ink-muted tabular-nums">{order}</span>
      <PlayerTag name={name} host={host} you={you} offline={!online} />
      {mark && (
        <span role="img" aria-label={label} title={label}>
          {mark}
        </span>
      )}
    </li>
  );
}

/**
 * Who's playing (numbered in guessing order) and who's watching, with the viewer's own
 * Take a seat / Sit out switch. In play each player is marked: the guesser, and who has sent their clues.
 */
export function Table({
  view,
  online,
  act,
  hostId,
}: {
  view: EchoView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
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
              Sit out (watch)
            </Button>
          ) : (
            players.length < MAX_PLAYERS && (
              <Button
                variant="secondary"
                className="h-11"
                onClick={() => void act({ type: 'sit', playing: true })}
              >
                Take a seat
              </Button>
            )
          ))}
      </div>
      {players.length > 1 && <p className="text-xs text-ink-muted">Numbered in guessing order.</p>}
      <ul className="flex flex-wrap gap-1.5">
        {players.map((s, i) => (
          <PlayerChip
            key={s.id}
            order={i + 1}
            name={s.name}
            you={s.id === me?.id}
            host={s.id === hostId}
            online={online(s.id)}
            {...mark(s.id)}
          />
        ))}
      </ul>
      {watching.length > 0 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <span className="font-semibold">Watching:</span>{' '}
          {watching.map((s, i) => (
            <span key={s.id}>
              {i > 0 && ', '}
              <PlayerTag
                name={s.name}
                host={s.id === hostId}
                you={s.id === me?.id}
                offline={!online(s.id)}
              />
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
