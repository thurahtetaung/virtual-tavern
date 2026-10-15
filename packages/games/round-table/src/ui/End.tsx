import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, Panel, Superlatives, cn } from '@vt/ui';
import { ROLES } from '../logic/roles.ts';
import type { RoundTableView } from '../logic/types.ts';
import type { Act } from './Actions.tsx';
import { Emblem, SIDE_LABEL, SIDE_TEXT } from './Emblem.tsx';
import { END_LINE, nameOf, namesFor, who } from './status.ts';

/** The end: who won and how, every role, who saw whom, the Lady's checks, then Play again. */
export function End({ view, room, act }: { view: RoundTableView; room: GameRoomInfo; act: Act }) {
  const g = view.game!;
  const end = g.end!;
  const good = end.winner === 'good';
  const merlin = Object.entries(end.roles).find(([, r]) => r === 'merlin')?.[0];
  const order = [...g.players].sort(
    (a, b) =>
      Number(ROLES[end.roles[a.id]!].loyalty === 'evil') -
      Number(ROLES[end.roles[b.id]!].loyalty === 'evil'),
  );
  return (
    <Panel role="region" aria-label="Game over" className="space-y-4">
      <div
        className={cn(
          'rounded-xl px-4 py-3 text-center ring-1',
          good
            ? 'bg-team-b-soft ring-team-b-line dark:bg-blue-500/10 dark:ring-blue-500/30'
            : 'bg-team-a-soft ring-team-a-line dark:bg-red-500/10 dark:ring-red-500/30',
        )}
        data-testid="winner"
      >
        <p className={cn('text-2xl font-bold', SIDE_TEXT[end.winner])}>
          {good ? '🛡️ Good wins' : '🗡️ Evil wins'}
        </p>
        <p className="text-sm">{END_LINE[end.reason]}</p>
        {end.assassin && end.target && (
          <p className="mt-1 text-sm">
            {who(view, end.assassin, 'You')} {end.assassin === view.me?.id ? 'were' : 'was'} the
            Assassin{end.designated ? ' (standing in: no Assassin card)' : ''} and named{' '}
            <b>{who(view, end.target)}</b>
            {end.autoTarget ? ' (picked by the timer)' : ''}
            {merlin && merlin !== end.target && (
              <>
                ; Merlin was <b>{who(view, merlin)}</b>
              </>
            )}
            .
          </p>
        )}
      </div>
      <section aria-label="Everyone’s role">
        <h3 className="mb-2 font-bold">Who was who</h3>
        <ul className="grid gap-2 sm:grid-cols-2">
          {order.map((p) => {
            const r = end.roles[p.id]!;
            const def = ROLES[r];
            const saw = end.knowledge[p.id] ?? [];
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
              >
                <Emblem role={r} className="size-10" />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">
                    {p.name}
                    {p.id === view.me?.id && (
                      <span className="font-normal text-ink-muted"> (you)</span>
                    )}
                  </span>
                  <span className={cn('block font-semibold', SIDE_TEXT[def.loyalty])}>
                    {def.name} · {SIDE_LABEL[def.loyalty]}
                  </span>
                  {saw.length > 0 && (
                    <span className="block text-xs text-stone-600 dark:text-stone-400">
                      Saw{' '}
                      {namesFor(
                        view,
                        saw.map((k) => k.id),
                      )}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {end.ladyChecks.length > 0 && (
        <section aria-label="Lady of the Lake">
          <h3 className="mb-1 font-bold">🌊 The Lady of the Lake</h3>
          <ul className="text-sm">
            {end.ladyChecks.map((c) => (
              <li key={c.round}>
                After quest {c.round}: {nameOf(view, c.holder)} saw {nameOf(view, c.target)} as{' '}
                <b className={SIDE_TEXT[c.loyalty]}>{SIDE_LABEL[c.loyalty]}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Superlatives lines={room.superlatives} />
      {room.isHost ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change settings
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm">{waitingForHost(room, 'start the next game')}</p>
      )}
      <p className="text-center text-xs text-ink-muted">
        Play again keeps the same roles and options. The full history is on the History tab.
      </p>
    </Panel>
  );
}
