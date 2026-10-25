import { Button, PlayerTag, cn, useConfirm } from '@vt/ui';
import { type Names, cowCount, fillNames } from '../logic/names.ts';
import { MAX_PLAYERS, type StampedeAction, type StampedeView } from '../logic/types.ts';
import { CowCount, PinkMark } from './parts.tsx';
import { missingIds, nameOf } from './status.ts';

type Act = (a: StampedeAction) => Promise<boolean>;

/** The Take a seat / Sit out button, which the shell's "You're watching" banner leads to. */
export const SEAT_CONTROL_ID = 'stampede-seat';

/** Everyone's cows, most first, with the Pink Cow on its holder and the target on top. */
export function Scoreboard({ view, names }: { view: StampedeView; names: Names }) {
  const f = (s: string) => fillNames(s, names);
  const gained = new Set(view.round?.stage === 'reveal' ? (view.round.result?.scorers ?? []) : []);
  if (view.scores.length === 0) return null;
  const top = Math.max(view.target, ...view.scores.map((s) => s.cows));
  return (
    <section aria-label="Scores" className="space-y-2" data-testid="scoreboard">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-bold">Herd</h3>
        <span className="text-sm text-ink-muted">first to {cowCount(names, view.target)}</span>
      </div>
      <ol className="space-y-1.5">
        {view.scores.map((s) => (
          <li
            key={s.id}
            data-testid={`score-${s.id}`}
            className={cn('grid grid-cols-[1fr_auto] items-center gap-x-2', s.left && 'opacity-50')}
          >
            <span className="flex min-w-0 items-center gap-1 text-sm">
              <PlayerTag name={s.name} you={s.id === view.me?.id} />
              {view.pinkCow === s.id && <PinkMark names={names} className="sp-walk" />}
              {s.left && <span className="text-ink-muted">(left)</span>}
            </span>
            <span className="flex items-center gap-1.5 text-sm">
              {gained.has(s.id) && (
                <span className="sp-fly text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                  +1
                </span>
              )}
              <CowCount n={s.cows} names={names} />
            </span>
            {/* A bar towards the target, so the race reads at a glance. */}
            <span
              aria-hidden
              className="col-span-2 h-1.5 overflow-hidden rounded-full bg-card ring-1 ring-line dark:bg-stone-800 dark:ring-0"
            >
              <span
                className="block h-full rounded-full bg-accent dark:bg-amber-500"
                style={{ width: `${Math.min(100, (s.cows / top) * 100)}%` }}
              />
            </span>
          </li>
        ))}
      </ol>
      {view.pinkCow && (
        <p className="text-sm text-ink-muted">
          {f(
            `🩷 ${nameOf(view, view.pinkCow)} holds the {pink} and can’t win until someone else takes it.`,
          )}
        </p>
      )}
    </section>
  );
}

/** Past questions this game: the herd's answer and who scored. */
export function RoundLog({ view, names }: { view: StampedeView; names: Names }) {
  if (view.history.length === 0) return null;
  const f = (s: string) => fillNames(s, names);
  return (
    <details className="group text-sm" data-testid="round-log">
      <summary className="flex h-11 cursor-pointer list-none items-center justify-between [&::-webkit-details-marker]:hidden">
        <span className="font-semibold">Round log ({view.history.length})</span>
        <span aria-hidden className="text-ink-muted transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <ol className="space-y-2">
        {[...view.history].reverse().map((h) => (
          <li
            key={h.number}
            className="rounded-lg bg-card px-3 py-2 ring-1 ring-line dark:bg-stone-800/60 dark:ring-0"
          >
            <p className="text-ink-muted">
              {h.number}. {h.prompt}
            </p>
            <p className="font-semibold">
              {h.herd ? `🐄 ${h.herd} ×${h.herdSize}` : 'No herd'}
              {h.pinkMoved && h.pinkTo && (
                <span className="font-normal">{f(` · 🩷 to ${nameOf(view, h.pinkTo)}`)}</span>
              )}
            </p>
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Who's playing and who's watching, with the viewer's own Take a seat / Sit out switch. */
export function Table({
  view,
  online,
  act,
  hostId,
  names,
}: {
  view: StampedeView;
  online: (id: string) => boolean;
  act: Act;
  hostId: string;
  names: Names;
}) {
  const round = view.round;
  const players = view.seats.filter((s) => s.playing);
  const watching = view.seats.filter((s) => !s.playing);
  const me = view.me;
  const [confirm, confirmDialog] = useConfirm();
  const missing = new Set(round ? missingIds(round) : []);
  const mark = (id: string): { mark?: string; label?: string } => {
    if (!round || view.phase !== 'playing') return {};
    if (!round.players.includes(id)) return { mark: '⏳', label: 'joins next question' };
    if (round.stage !== 'answer') return {};
    return missing.has(id) ? { mark: '✏️', label: 'writing' } : { mark: '✅', label: 'answered' };
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
                      body: 'You keep your cows, but you can’t win while you watch.',
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
              data-testid={`seat-${s.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 text-sm ring-1 ring-line dark:bg-stone-800 dark:ring-0"
            >
              <PlayerTag
                name={s.name}
                you={s.id === me?.id}
                host={s.id === hostId}
                offline={!online(s.id)}
              />
              {view.pinkCow === s.id && <PinkMark names={names} />}
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
