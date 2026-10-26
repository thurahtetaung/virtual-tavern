import { Button, NameDot, PlayerTag, cn, useConfirm } from '@vt/ui';
import { MAX_PLAYERS, type SketchyView } from '../logic/types.ts';
import type { Act } from './act.ts';
import { missingIds, points, shownScores } from './status.ts';

/** The Play / Just watch button, which the shell's "You're watching" banner leads to. */
export const SEAT_CONTROL_ID = 'sketchy-seat';

/**
 * Who's playing and who's watching, with the viewer's own Take a seat / Sit out switch. While
 * drawing each player is marked drawing or done; while writing and picking, only the players the
 * game may name as still missing are marked, so the marks never point at the artist.
 */
export function Table({
  view,
  online,
  act,
  hostId,
}: {
  view: SketchyView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
}) {
  const g = view.phase === 'playing' ? view.game : null;
  const players = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const missing = new Set(missingIds(view));
  const [confirm, confirmDialog] = useConfirm();
  const mark = (id: string): { mark?: string; label?: string } => {
    if (!g) return {};
    if (!g.players.includes(id)) return { mark: '⏳', label: 'joins next round' };
    if (g.stage === 'draw') {
      return g.drawn.includes(id)
        ? { mark: '✅', label: 'drawing sent' }
        : { mark: '✏️', label: 'drawing' };
    }
    if (missing.has(id)) {
      return g.stage === 'write'
        ? { mark: '✏️', label: 'writing' }
        : { mark: '🤔', label: 'picking' };
    }
    return {};
  };
  return (
    <section aria-label="Players" className="space-y-2">
      {confirmDialog}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-bold">
          Players ({players.length}/{MAX_PLAYERS})
        </h3>
        {me &&
          (me.playing ? (
            <Button
              id={SEAT_CONTROL_ID}
              variant="ghost"
              className="h-11"
              onClick={() =>
                void (async () => {
                  if (
                    view.phase !== 'playing' ||
                    (await confirm({
                      title: 'Sit out and just watch?',
                      body: 'You can join again from the next round.',
                      confirmLabel: 'Sit out',
                    }))
                  ) {
                    void act({ type: 'sit', playing: false });
                  }
                })()
              }
            >
              Sit out (watch)
            </Button>
          ) : (
            players.length < MAX_PLAYERS && (
              <Button
                id={SEAT_CONTROL_ID}
                variant="secondary"
                className="h-11"
                onClick={() => void act({ type: 'sit', playing: true })}
              >
                Take a seat
              </Button>
            )
          ))}
      </div>
      <ul className="flex flex-wrap gap-1.5">
        {players.map((s) => {
          const m = mark(s.id);
          return (
            <li
              key={s.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-sm ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700"
            >
              <PlayerTag
                name={s.name}
                you={s.id === me?.id}
                host={s.id === hostId}
                offline={!online(s.id)}
              />
              {m.mark && (
                <span role="img" aria-label={m.label} title={m.label}>
                  {m.mark}
                </span>
              )}
            </li>
          );
        })}
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
export function Scores({ view, revealing }: { view: SketchyView; revealing: boolean }) {
  if (view.scores.length === 0) return null;
  const turn = view.game?.turn;
  const gained = revealing ? null : (turn?.points ?? null);
  const streaks = view.game?.streaks ?? {};
  return (
    <section aria-label="Scores">
      <h3 className="mb-1 font-bold">Scores</h3>
      <ol className="space-y-1 text-sm" data-testid="sketchy-scores">
        {shownScores(view, revealing).map((s) => (
          <li key={s.id} className={cn('flex items-center gap-2', s.left && 'opacity-50')}>
            <span className="min-w-0 flex-1 truncate">
              {s.name}
              {s.id === view.me?.id && ' (you)'}
              {s.left && ' (left)'}
            </span>
            <NameDot name={s.name} className="order-first" />
            {!revealing && (streaks[s.id] ?? 0) >= 2 && (
              <span
                className="text-xs"
                title={`${streaks[s.id]} in a row`}
                aria-label={`${streaks[s.id]} in a row`}
              >
                🔥{streaks[s.id]}
              </span>
            )}
            {gained?.[s.id] ? (
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                +{points(gained[s.id]!)}
              </span>
            ) : null}
            <span className="font-bold tabular-nums" data-testid={`score-${s.id}`}>
              {points(s.score)}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
