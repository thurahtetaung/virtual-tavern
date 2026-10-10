import { Badge, Button, cn } from '@vt/ui';
import { type HoodwinkAction, type HoodwinkView, MAX_PLAYERS } from '../logic/types.ts';
import { points } from './status.ts';

type Act = (a: HoodwinkAction) => Promise<boolean>;

const AVATAR_TONES = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-fuchsia-600',
  'bg-teal-600',
  'bg-orange-600',
];

function toneOf(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length]!;
}

/** A small round initial badge for a player. */
export function Avatar({ id, name, className }: { id: string; name: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={name}
      title={name}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ring-2 ring-white dark:ring-stone-900',
        toneOf(id),
        className,
      )}
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  );
}

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
 * Who's playing and who's watching, with the viewer's own Play / Just watch switch. In play each
 * player is marked: still writing or voting, or done.
 */
export function Table({
  view,
  online,
  act,
}: {
  view: HoodwinkView;
  online: (id: string) => boolean;
  act: Act;
}) {
  const round = view.round;
  const players = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const mark = (id: string): { mark?: string; label?: string } => {
    if (!round) return {};
    if (round.stage === 'write' && round.players.includes(id)) {
      return round.written.includes(id)
        ? { mark: '✅', label: 'lie written' }
        : { mark: '✏️', label: 'writing' };
    }
    if (round.stage === 'vote' && round.voters.includes(id)) {
      return round.voted.includes(id)
        ? { mark: '✅', label: 'voted' }
        : { mark: '🤔', label: 'voting' };
    }
    if (!round.players.includes(id) && !round.voters.includes(id)) {
      return { mark: '⏳', label: 'joins next round' };
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

/** Everyone's score, highest first, compact enough to sit under the game on a phone. */
export function Scores({ view }: { view: HoodwinkView }) {
  if (view.scores.length === 0) return null;
  const gained = view.round?.points ?? null;
  return (
    <section aria-label="Scores">
      <h3 className="mb-1 font-bold">Scores</h3>
      <ol className="space-y-1 text-sm">
        {view.scores.map((s) => (
          <li key={s.id} className={cn('flex items-center gap-2', s.left && 'opacity-50')}>
            <Avatar id={s.id} name={s.name} className="size-6" />
            <span className="min-w-0 flex-1 truncate">
              {s.name}
              {s.id === view.me?.id && ' (you)'}
              {s.left && ' (left)'}
            </span>
            {gained?.[s.id] ? (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                +{points(gained[s.id]!)}
              </span>
            ) : null}
            <span className="font-bold tabular-nums">{points(s.score)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
