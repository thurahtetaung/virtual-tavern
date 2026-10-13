import { type GameRoomInfo, waitingForHost } from '@vt/game-sdk';
import { Button, Superlatives, cn } from '@vt/ui';
import { useEffect, useState } from 'react';
import { claimLied, presidentLies } from '../logic/claims.ts';
import type { HydraAction, HydraView, Truth } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { FlipCard, Pips, RoleBack, RoleFace, TEAM_SOFT, TEAM_TEXT } from './Cards.tsx';
import { ClaimLine } from './Claims.tsx';
import { prefersReducedMotion } from './fx.ts';
import { CreditBlock } from './Me.tsx';
import { nameOf } from './status.ts';

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
    <ul className="grid grid-cols-5 gap-2 sm:gap-3" aria-label="Everyone’s role">
      {g.players.map((p, i) => {
        const role = end.roles[p.id]!;
        return (
          <li key={p.id} className="flex flex-col items-center gap-1 text-center">
            <FlipCard
              up={i < up}
              back={<RoleBack c={c} />}
              front={<RoleFace role={role} art={end.art[p.id] ?? 0} c={c} />}
              className={cn('w-full', p.dead && 'grayscale')}
            />
            <span className="w-full truncate text-xs font-semibold">
              {p.dead && '✝ '}
              {p.name}
            </span>
            <span
              className={cn(
                'text-[0.65rem] font-bold',
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
      <span className="font-semibold">Really:</span> drew <Pips cards={t.drawn} c={c} />
      {t.presidentDiscard && (
        <>
          → discarded <Pips cards={[t.presidentDiscard]} c={c} />
        </>
      )}
      {t.chancellorHand && (
        <>
          → passed <Pips cards={t.chancellorHand} c={c} />
        </>
      )}
      {t.vetoed ? (
        <> → vetoed</>
      ) : t.chancellorDiscard ? (
        <>
          → discarded <Pips cards={[t.chancellorDiscard]} c={c} />
        </>
      ) : null}
    </p>
  );
}

/** The truth, round by round: what each government really drew, next to what they claimed. */
function TruthLog({ view, c }: { view: HydraView; c: Content }) {
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
            <li
              key={r.n}
              className="rounded-xl bg-white p-2.5 text-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800"
            >
              <p className="mb-1 text-xs font-bold text-stone-500">
                #{r.n} · {nameOf(view, r.president)} ➜ {nameOf(view, r.chancellor)}
                {r.session?.enacted && (
                  <>
                    {' '}
                    · enacted <Pips cards={[r.session.enacted]} c={c} />
                  </>
                )}
              </p>
              {t && <SessionTruth t={t} c={c} />}
              {t?.peek && (
                <p className="flex items-center gap-1 text-xs">
                  <span className="font-semibold">Peek really showed:</span>{' '}
                  <Pips cards={t.peek} c={c} />
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
                      className={cn('rounded px-1', lied && 'bg-rose-100 dark:bg-rose-500/20')}
                    >
                      <ClaimLine view={view} c={c} claim={cl} round={r} />{' '}
                      {lied === true && (
                        <span className="rounded bg-rose-600 px-1 text-[0.6rem] font-black text-white">
                          LIE{part && ` (${part})`}
                        </span>
                      )}
                      {lied === false && (
                        <span className="text-[0.65rem] font-bold text-emerald-700 dark:text-emerald-400">
                          ✓ true
                        </span>
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

const REASON: Record<string, string> = {
  'blue-policies': 'Five {blue} policies passed.',
  'red-policies': 'Six {red} policies passed.',
  'leader-executed': '{Leader} was executed.',
  'leader-elected': '{Leader} was elected Chancellor in the danger zone.',
};

/** The end: who won and how, every role flipped in seat order, the truth, awards, Play again. */
export function End({
  view,
  room,
  c,
  act,
}: {
  view: HydraView;
  room: GameRoomInfo;
  c: Content;
  act: Act;
}) {
  const g = view.game!;
  const end = g.end!;
  const leader = Object.entries(end.roles).find(([, r]) => r === 'leader')?.[0];
  const won = view.role ? view.role.team === end.winner : null;
  return (
    <div className="space-y-4" role="region" aria-label="Game over">
      <div
        className={cn('hy-pop rounded-2xl px-4 py-4 text-center ring-1', TEAM_SOFT[end.winner])}
        data-testid="winner"
      >
        <p className={cn('text-3xl font-black', TEAM_TEXT[end.winner])}>
          {end.winner === 'blue' ? '🕊️' : '☠️'}{' '}
          {c.t(end.winner === 'blue' ? 'The {blues} win!' : 'The {reds} win!')}
        </p>
        <p className="mt-1 text-sm">
          {c.t(REASON[end.reason]!)}{' '}
          {leader && (
            <>
              {c.names.leader.replace(/^the /, 'The ')} was <b>{nameOf(view, leader)}</b>.
            </>
          )}
        </p>
        {won !== null && (
          <p className="mt-1 text-sm font-semibold">
            {won ? 'Your team won. 🎉' : 'Your team lost this one.'}
          </p>
        )}
      </div>
      <RoleReveal view={view} c={c} />
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
      <p className="text-center text-xs text-stone-500">
        Play again keeps the seats and settings, with a new first President.
      </p>
      <TruthLog view={view} c={c} />
      <CreditBlock c={c} />
    </div>
  );
}
