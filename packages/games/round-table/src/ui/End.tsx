import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndTabs,
  NameDot,
  Panel,
  StickyBar,
  Superlatives,
  cn,
  useWideScreen,
} from '@vt/ui';
import type { ReactNode } from 'react';
import { ROLES } from '../logic/roles.ts';
import type { RoundTableView } from '../logic/types.ts';
import type { Act } from './Actions.tsx';
import { Emblem, SIDE_LABEL, SIDE_TEXT } from './Emblem.tsx';
import { END_LINE, nameOf, namesFor, who } from './status.ts';

/** The end: who won and how, every role, who saw whom, the Lady's checks, then Play again. */
export function End({
  view,
  room,
  act,
  quests,
}: {
  view: RoundTableView;
  room: GameRoomInfo;
  act: Act;
  /** Phones: the quest track, as one of the end's tabs. */
  quests?: ReactNode;
}) {
  const wide = useWideScreen();
  const g = view.game!;
  const end = g.end!;
  const good = end.winner === 'good';
  // The viewer's own side lights the card: ember if it won, danger if it lost; quiet for watchers.
  const myRole = view.me ? end.roles[view.me.id] : undefined;
  const mySide = myRole ? ROLES[myRole].loyalty : undefined;
  const merlin = Object.entries(end.roles).find(([, r]) => r === 'merlin')?.[0];
  const order = [...g.players].sort(
    (a, b) =>
      Number(ROLES[end.roles[a.id]!].loyalty === 'evil') -
      Number(ROLES[end.roles[b.id]!].loyalty === 'evil'),
  );
  return (
    <div className="space-y-3">
      <EndHero
        title={
          <span className={good ? 'text-team-b-ink' : 'text-team-a-ink'}>
            {good ? 'Good wins' : 'Evil wins'}
          </span>
        }
        titleTestId="winner"
        emblem={good ? '🛡️' : '🗡️'}
        tone={mySide ? (mySide === end.winner ? 'win' : 'loss') : 'neutral'}
        superlatives={wide ? room.superlatives : undefined}
        actions={
          room.isHost ? (
            <StickyBar>
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={() => void act({ type: 'start' })}>
                  Play again
                </Button>
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void act({ type: 'back-to-lobby' })}
                >
                  Change setup
                </Button>
              </div>
            </StickyBar>
          ) : (
            <p className="text-center text-small text-ink-2">
              {waitingForHost(room, 'start the next game')}
            </p>
          )
        }
      >
        <p>{END_LINE[end.reason]}</p>
        {end.assassin && end.target && (
          <p className="mt-1">
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
      </EndHero>
      <Panel className="space-y-4 max-lg:space-y-3 max-lg:p-3">
        {/* Phones: the roles, the Lady's checks and the awards one at a time, so the end fits. */}
        <EndTabs
          tabs={[
            {
              id: 'roles',
              label: '🎭 Roles',
              content: (
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
                          className="flex items-center gap-2 rounded-xl bg-card p-2 ring-1 ring-line"
                        >
                          <Emblem role={r} className="size-10" />
                          <span className="min-w-0 text-small">
                            <span className="flex items-center gap-1 font-semibold">
                              <span className="truncate">{p.name}</span>
                              <NameDot name={p.name} className="order-first" />
                              {p.id === view.me?.id && (
                                <span className="shrink-0 font-normal text-ink-muted">(you)</span>
                              )}
                            </span>
                            <span className={cn('block font-semibold', SIDE_TEXT[def.loyalty])}>
                              {def.name} · {SIDE_LABEL[def.loyalty]}
                            </span>
                            {saw.length > 0 && (
                              <span className="block text-caption text-ink-muted">
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
              ),
            },
            end.ladyChecks.length > 0 && {
              id: 'lady',
              label: '🌊 The Lady',
              content: (
                <section aria-label="Lady of the Lake">
                  <h3 className="mb-1 font-bold">🌊 The Lady of the Lake</h3>
                  <ul className="text-small">
                    {end.ladyChecks.map((c) => (
                      <li key={c.round}>
                        After quest {c.round}: {nameOf(view, c.holder)} saw {nameOf(view, c.target)}{' '}
                        as <b className={SIDE_TEXT[c.loyalty]}>{SIDE_LABEL[c.loyalty]}</b>
                      </li>
                    ))}
                  </ul>
                </section>
              ),
            },
            !!quests && { id: 'quests', label: '🏰 Quests', content: quests },
            !wide &&
              !!room.superlatives?.length && {
                id: 'awards',
                label: '✨ Awards',
                content: <Superlatives lines={room.superlatives} />,
              },
          ]}
        />
        <p className="text-center text-caption text-ink-muted">
          Play again keeps the same roles and settings. The full history is under History.
        </p>
      </Panel>
    </div>
  );
}
