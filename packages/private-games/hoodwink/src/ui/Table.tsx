import { NameDot, PlayerTag, cn, SeatHeading, SeatToggle } from '@vt/ui';
import { type HoodwinkAction, type HoodwinkView, MAX_PLAYERS } from '../logic/types.ts';
import { points, shownScores } from './status.ts';

type Act = (a: HoodwinkAction) => Promise<boolean>;

/** The Play / Just watch button, which the shell's "You're watching" banner leads to. */
export const SEAT_CONTROL_ID = 'hoodwink-seat';

function PlayerChip({
  name,
  you,
  host,
  online,
  mark,
  label,
}: {
  name: string;
  you: boolean;
  host: boolean;
  online: boolean;
  mark?: string;
  label?: string;
}) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full bg-sunk px-2.5 py-1 text-sm">
      <PlayerTag name={name} you={you} host={host} offline={!online} />
      {mark && (
        <span role="img" aria-label={label} title={label}>
          {mark}
        </span>
      )}
    </li>
  );
}

/**
 * Who's playing and who's watching, with the viewer's own Take a seat / Sit out switch. In play each
 * player is marked: still writing or voting, or done.
 */
export function Table({
  view,
  online,
  act,
  hostId,
}: {
  view: HoodwinkView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
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
      <SeatHeading title={`Players (${players.length}/${MAX_PLAYERS})`}>
        {me && (me.playing || players.length < MAX_PLAYERS) && (
          <SeatToggle
            id={SEAT_CONTROL_ID}
            playing={me.playing}
            confirmLeave={
              view.phase === 'playing'
                ? {
                    title: 'Sit out and just watch?',
                    body: 'You can join again later.',
                    confirmLabel: 'Watch instead',
                  }
                : null
            }
            onChange={(playing) => void act({ type: 'sit', playing })}
          />
        )}
      </SeatHeading>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((s) => (
          <PlayerChip
            key={s.id}
            name={s.name}
            you={s.id === me?.id}
            host={s.id === hostId}
            online={online(s.id)}
            {...mark(s.id)}
          />
        ))}
      </ul>
      {watching.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-muted">
          <span className="font-semibold">Watching:</span>
          {watching.map((s) => (
            <PlayerTag
              key={s.id}
              name={s.name}
              host={s.id === hostId}
              you={s.id === me?.id}
              offline={!online(s.id)}
            />
          ))}
        </p>
      )}
    </section>
  );
}

/** Everyone's score, highest first, compact enough to sit under the game on a phone. */
export function Scores({ view, revealing }: { view: HoodwinkView; revealing: boolean }) {
  if (view.scores.length === 0) return null;
  const gained = revealing ? null : (view.round?.points ?? null);
  return (
    <section aria-label="Scores">
      <h3 className="mb-1 font-bold">Scores</h3>
      <ol className="space-y-1 text-sm">
        {shownScores(view, revealing).map((s) => (
          <li key={s.id} className={cn('flex items-center gap-2', s.left && 'opacity-50')}>
            <span className="min-w-0 flex-1 truncate">
              {s.name}
              {s.id === view.me?.id && ' (you)'}
              {s.left && ' (left)'}
            </span>
            <NameDot name={s.name} className="order-first" />
            {gained?.[s.id] ? (
              <span className="text-xs font-semibold text-success-ink">
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
