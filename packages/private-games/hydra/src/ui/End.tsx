import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import {
  Button,
  EndHero,
  EndLayout,
  EndTabs,
  NameDot,
  StickyBar,
  Superlatives,
  cn,
  useWideScreen,
} from '@vt/ui';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { claimLied, presidentLies } from '../logic/claims.ts';
import type { HydraAction, HydraView, Truth } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { FlipCard, Pips, RoleBack, RoleFace, TEAM_TEXT } from './Cards.tsx';
import { ClaimLine } from './Claims.tsx';
import { prefersReducedMotion } from './fx.ts';
import { CreditBlock } from './Me.tsx';
import { nameOf } from './status.ts';
import { DISPLAY, Rich } from './text.tsx';

type Act = (a: HydraAction) => Promise<boolean>;

/** Every role flips over, one seat after another. */
function RoleReveal({ view, c }: { view: HydraView; c: Content }) {
  const g = view.game!;
  const end = g.end!;
  const [up, setUp] = useState(prefersReducedMotion() ? g.players.length : 0);
  useEffect(() => {
    if (up >= g.players.length) return;
    const t = window.setTimeout(() => setUp((n) => n + 1), up === 0 ? 400 : 220);
    return () => {
      window.clearTimeout(t);
    };
  }, [up, g.players.length]);
  return (
    <ul
      // Four a row on phones, five wider, the last row centred (no card left alone at the edge).
      className="flex flex-wrap justify-center gap-2 sm:gap-3"
      aria-label="Everyone’s role"
    >
      {g.players.map((p, i) => {
        const role = end.roles[p.id]!;
        return (
          // min-w-0: a long role name wraps in its column instead of widening the grid.
          <li
            key={p.id}
            className="flex w-[calc((100%-1.5rem)/4)] min-w-0 flex-col items-center gap-1 text-center sm:w-[calc((100%-3rem)/5)]"
          >
            <FlipCard
              up={i < up}
              back={<RoleBack c={c} />}
              front={<RoleFace role={role} art={end.art[p.id] ?? 0} seed={g.artSeed} c={c} />}
              className={cn('w-full', p.dead && 'grayscale')}
            />
            <span className="flex w-full min-w-0 items-center justify-center gap-1 text-xs font-semibold">
              <span className="truncate">
                {p.dead && '✝ '}
                {p.name}
              </span>
              <NameDot name={p.name} className="order-first" />
            </span>
            <span
              className={cn(
                'text-xs font-bold',
                TEAM_TEXT[role === 'blue' ? 'blue' : 'red'],
                i >= up && 'invisible',
              )}
            >
              {c.roleName(role)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SessionTruth({ t, c }: { t: Truth; c: Content }) {
  if (!t.drawn) return null;
  return (
    <p className="flex flex-wrap items-center gap-1 text-xs">
      <span className="font-semibold">Really:</span> drew{' '}
      <Pips cards={t.drawn} c={c} text="counts" />
      {t.presidentDiscard && (
        <>
          → discarded <Pips cards={[t.presidentDiscard]} c={c} text="order" />
        </>
      )}
      {t.chancellorHand && (
        <>
          → passed <Pips cards={t.chancellorHand} c={c} text="counts" />
        </>
      )}
      {t.vetoed ? (
        <> → {c.copy('log.vetoedShort')}</>
      ) : t.chancellorDiscard ? (
        <>
          → discarded <Pips cards={[t.chancellorDiscard]} c={c} text="order" />
        </>
      ) : null}
    </p>
  );
}

/** The truth, round by round: what each government really drew, next to what they claimed. */
export function TruthLog({ view, c }: { view: HydraView; c: Content }) {
  const g = view.game!;
  const end = g.end!;
  const rounds = g.rounds.filter((r) => r.session || r.power || r.claims.length);
  if (!rounds.length) return null;
  return (
    <section aria-label="The truth">
      <h3 className="mb-2 font-bold">🔎 The truth</h3>
      <ol className="space-y-2">
        {rounds.map((r) => {
          const t = end.truth.find((x) => x.round === r.n);
          return (
            <li key={r.n} className="rounded-xl bg-card p-2.5 text-sm ring-1 ring-line">
              <p className="mb-1 text-xs font-bold text-ink-muted">
                #{r.n} · {nameOf(view, r.president)} ➜ {nameOf(view, r.chancellor)}
                {r.session?.enacted && (
                  <>
                    {' '}
                    · enacted <Pips cards={[r.session.enacted]} c={c} text="order" />
                  </>
                )}
              </p>
              {t && <SessionTruth t={t} c={c} />}
              {t?.peek && (
                <p className="flex items-center gap-1 text-xs">
                  <span className="font-semibold">Peek really showed:</span>{' '}
                  <Pips cards={t.peek} c={c} text="order" />
                </p>
              )}
              {t?.investigate && (
                <p className="text-xs">
                  <span className="font-semibold">Investigation really showed:</span>{' '}
                  {nameOf(view, t.investigate.target)} is{' '}
                  <b className={TEAM_TEXT[t.investigate.team]}>{c.teamName(t.investigate.team)}</b>
                </p>
              )}
              <ul className="mt-1 space-y-0.5">
                {r.claims.map((cl) => {
                  const lied = claimLied(cl, t);
                  // Which part of a President's claim was false: the draw, the discard or both.
                  const part = presidentLies(cl, t)?.join(' + ');
                  return (
                    <li
                      key={`${cl.by}:${cl.kind}`}
                      className={cn('rounded px-1', lied && 'bg-danger-soft')}
                    >
                      <ClaimLine view={view} c={c} claim={cl} round={r} />{' '}
                      {lied === true && (
                        <span className="rounded bg-danger px-1 text-xs font-black text-white">
                          LIE{part && ` (${part})`}
                        </span>
                      )}
                      {lied === false && (
                        <span className="text-xs font-bold text-success-ink">✓ true</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** The end: who won and how, every role flipped in seat order, the truth, awards, Play again. */
export function End({
  view,
  room,
  c,
  act,
  timeline,
}: {
  view: HydraView;
  room: GameRoomInfo;
  c: Content;
  act: Act;
  /** The timeline: one of the end's tabs on phones, under the roles on wider screens. */
  timeline?: ReactNode;
}) {
  const g = view.game!;
  const end = g.end!;
  const leader = Object.entries(end.roles).find(([, r]) => r === 'leader')?.[0];
  const won = view.role ? view.role.team === end.winner : null;
  const wide = useWideScreen();
  const buttons = (
    <>
      {room.isHost ? (
        <StickyBar className="flex flex-wrap justify-center gap-2">
          <Button size="lg" onClick={() => void act({ type: 'start' })}>
            Play again
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Change setup
          </Button>
        </StickyBar>
      ) : (
        <p className="text-center text-sm">{waitingForHost(room, 'start the next game')}</p>
      )}
      <p className="text-center text-xs text-ink-muted">{c.copy('end.playAgain')}</p>
    </>
  );
  return (
    <div className="space-y-4 max-lg:space-y-3" role="region" aria-label="Game over">
      <EndLayout
        hero={
          <EndHero
            tone="neutral"
            emblem={end.winner === 'blue' ? '🕊️' : '☠️'}
            titleTestId="winner"
            title={
              <span className={cn(TEAM_TEXT[end.winner], DISPLAY)}>
                {c.copy(end.winner === 'blue' ? 'end.win.blue' : 'end.win.red')}
              </span>
            }
            superlatives={wide ? room.superlatives : undefined}
            // Wide screens: Play again at the foot of the finale, beside the roles.
            actions={wide && <div className="space-y-2">{buttons}</div>}
          >
            <p>
              {c.copy(`end.reason.${end.reason}`)}{' '}
              {leader && (
                <Rich
                  text={c.copy(
                    end.reason.startsWith('leader-') ? 'end.leaderWasThem' : 'end.leaderWas',
                    {
                      player: nameOf(view, leader),
                    },
                  )}
                />
              )}
            </p>
            {won !== null && (
              <p className="mt-1 font-semibold text-ink">{c.copy(won ? 'end.won' : 'end.lost')}</p>
            )}
          </EndHero>
        }
      >
        {!wide ? (
          // Phones: the roles, the awards, the truth and the timeline one at a time, with Play
          // again always below, so the end fits the screen.
          <EndTabs
            tabs={[
              { id: 'roles', label: 'Roles', content: <RoleReveal view={view} c={c} /> },
              !!room.superlatives?.length && {
                id: 'awards',
                label: 'Awards',
                content: <Superlatives lines={room.superlatives} />,
              },
              { id: 'truth', label: 'Truth', content: <TruthLog view={view} c={c} /> },
              { id: 'timeline', label: 'Timeline', content: timeline },
              !!c.credit && { id: 'credits', label: 'Credits', content: <CreditBlock c={c} /> },
            ]}
          />
        ) : (
          // Wide screens: the roles large across the column, the timeline (with the truth) and
          // the credits under them, the column scrolling inside when it runs long.
          <>
            <RoleReveal view={view} c={c} />
            {timeline}
          </>
        )}
        {!wide && buttons}
        {wide && <CreditBlock c={c} />}
      </EndLayout>
    </div>
  );
}
