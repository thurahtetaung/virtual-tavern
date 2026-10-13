import { Button, cn } from '@vt/ui';
import { type PointerEvent, useRef, useState } from 'react';
import { leaderKnowsTeam, trackFor } from '../logic/tables.ts';
import type { HydraView, Memory } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { FlipCard, Pips, RoleBack, RoleFace, TEAM_TEXT } from './Cards.tsx';
import { playSfx, useLyingFlat } from './fx.ts';
import { nameOf } from './status.ts';

function knowledge(view: HydraView, c: Content): string {
  const r = view.role!;
  const n = view.game!.players.length;
  if (r.role === 'blue') return c.t('You don’t know anyone’s role. Neither does any other {blue}.');
  if (r.role === 'leader')
    return leaderKnowsTeam(n)
      ? c.t('Your {red} teammate (who also knows you):')
      : c.t('You don’t know your teammates, but they all know you.');
  return c.t('Your team (they know you too):');
}

/** Your role card: face down until you hold it, slide it up or switch it on. */
export function RoleCard({ view, c, big = false }: { view: HydraView; c: Content; big?: boolean }) {
  const r = view.role;
  const [open, setOpen] = useState(false);
  const [held, setHeld] = useState(false);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const flat = useLyingFlat(true);
  if (!r) return null;
  const shown = (open || held) && !flat;
  const down = (e: PointerEvent<HTMLDivElement>) => {
    start.current = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    setHeld(true);
    playSfx('flip');
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (start.current !== null) setDrag(Math.max(0, start.current - e.clientY));
  };
  const up = () => {
    if (drag > 50) setOpen(true);
    start.current = null;
    setDrag(0);
    setHeld(false);
  };
  return (
    <section aria-label="Your role card" className="flex flex-col items-center gap-2">
      <div
        role="presentation"
        onPointerDown={open ? undefined : down}
        onPointerMove={open ? undefined : move}
        onPointerUp={open ? undefined : up}
        onPointerCancel={open ? undefined : up}
        onContextMenu={(e) => e.preventDefault()}
        className={cn(
          'relative cursor-grab touch-none select-none',
          big ? 'w-44 sm:w-52' : 'w-32 sm:w-40',
        )}
        style={{ transform: `translateY(-${Math.min(drag, 60)}px)` }}
      >
        {/* The envelope the card slides out of. */}
        <span
          aria-hidden
          className={cn(
            'absolute inset-x-[-8%] bottom-[-6%] h-[42%] rounded-b-xl bg-gradient-to-b from-amber-200 to-amber-400 shadow-lg ring-1 ring-accent/50 dark:ring-amber-600/50 transition-opacity duration-500 motion-reduce:transition-none dark:from-amber-700 dark:to-amber-900',
            shown && 'opacity-30',
          )}
        />
        <FlipCard
          up={shown}
          back={<RoleBack c={c} />}
          front={<RoleFace role={r.role} art={r.art} seed={view.game?.artSeed} c={c} />}
          className="relative"
        />
        {!shown && (
          <span className="pointer-events-none absolute inset-x-0 bottom-2 text-center text-[0.65rem] font-bold text-white drop-shadow">
            ⬆ Slide up or hold
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOpen((o) => !o)}>
          {open ? '🙈 Hide my role' : '👁️ Show my role'}
        </Button>
      </div>
      {flat && <p className="text-xs text-stone-500">Hidden while your phone lies flat.</p>}
      {shown && (
        <p
          className={cn('text-center text-lg font-black', TEAM_TEXT[r.team])}
          data-testid="role-name"
        >
          {c.copy(`me.youAre.${r.role}`)}
        </p>
      )}
    </section>
  );
}

function MemoryLine({ view, c, m }: { view: HydraView; c: Content; m: Memory }) {
  switch (m.kind) {
    case 'hand':
      return (
        <span className="inline-flex items-center gap-1">
          #{m.round}:{' '}
          {c.t(m.as === 'president' ? 'as {president} you drew' : 'as {chancellor} you got')}{' '}
          <Pips cards={m.cards} c={c} text="counts" />
        </span>
      );
    case 'investigate':
      return (
        <span>
          #{m.round}: you investigated {nameOf(view, m.target)}:{' '}
          <b className={TEAM_TEXT[m.team]}>{c.teamName(m.team)}</b>
        </span>
      );
    case 'peek':
      return (
        <span className="inline-flex items-center gap-1">
          #{m.round}: you peeked <Pips cards={m.cards} c={c} text="order" />
        </span>
      );
  }
}

/** The Me tab: your role, what you know, your secrets, the board's powers and the credits. */
export function MeTab({
  view,
  c,
  showGuide,
  big = false,
  moments,
  setMoments,
  plain,
  setPlain,
}: {
  view: HydraView;
  c: Content;
  showGuide: () => void;
  /** The deal: the role card is the star. */
  big?: boolean;
  moments: boolean;
  setMoments: (on: boolean) => void;
  /** The edition's display font switched off ("Plain headings"). */
  plain: boolean;
  setPlain: (on: boolean) => void;
}) {
  const g = view.game!;
  const r = view.role;
  const track = trackFor(g.players.length);
  return (
    <div className="space-y-3">
      {r && (
        <section className="space-y-3 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
          <RoleCard view={view} c={c} big={big} />
          <div className="space-y-2 text-sm" data-testid="role-details">
            <p className="rounded-lg bg-stone-100 px-3 py-2 dark:bg-stone-800">
              <b>How you win: </b>
              {c.copy(`me.goal.${r.role}`)}
            </p>
            <p className="font-semibold">{knowledge(view, c)}</p>
            {r.known.length > 0 && (
              <ul className="flex flex-wrap gap-2" aria-label="What you know">
                {r.known.map((k) => (
                  <li
                    key={k.id}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white py-1 pr-1 pl-3 text-sm font-semibold ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
                  >
                    {nameOf(view, k.id)}
                    <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs text-white">
                      {c.roleName(k.role)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
      {g.memories.length > 0 && (
        <section className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
          <h3 className="mb-1 font-bold">🔒 What only you saw</h3>
          <ul className="space-y-1">
            {g.memories.map((m, i) => (
              <li key={i}>
                <MemoryLine view={view} c={c} m={m} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-2xl bg-white p-3 text-sm shadow-sm ring-1 ring-stone-200 dark:bg-stone-900 dark:ring-stone-800">
        <h3 className="mb-1 font-bold">Quick reference: {g.players.length} players</h3>
        <ol className="space-y-0.5">
          {track.map((p, i) => (
            <li key={i} className={cn(i < g.enacted.red && 'text-stone-400 line-through')}>
              {c.policyName('red')} #{i + 1}:{' '}
              {i === 5
                ? c.t('the {reds} win')
                : p
                  ? `${POWER_EMOJI[p]} ${c.powerName(p)}`
                  : 'no power'}
              {i === 2 && (
                <span className="text-amber-700 dark:text-amber-400"> · danger zone starts</span>
              )}
              {i === 4 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {c.t(' · {veto} unlocks')}
                </span>
              )}
            </li>
          ))}
        </ol>
        {g.rebalance && <p className="mt-1 text-xs text-stone-500">Community rebalance is on.</p>}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-sm font-semibold text-amber-700 underline dark:text-amber-400"
            onClick={showGuide}
          >
            Full rules →
          </button>
          <button
            type="button"
            role="switch"
            aria-checked={moments}
            onClick={() => setMoments(!moments)}
            className="min-h-9 rounded-full px-3 text-xs font-semibold ring-1 ring-stone-300 dark:ring-stone-600"
          >
            Big moments: {moments ? 'on' : 'off'}
          </button>
          {c.font && (
            <button
              type="button"
              role="switch"
              aria-checked={plain}
              onClick={() => setPlain(!plain)}
              className="min-h-9 rounded-full px-3 text-xs font-semibold ring-1 ring-stone-300 dark:ring-stone-600"
            >
              Plain headings: {plain ? 'on' : 'off'}
            </button>
          )}
        </div>
      </section>
      <CreditBlock c={c} />
    </div>
  );
}

/** The original game's credit, from the private manifest. */
export function CreditBlock({ c }: { c: Content }) {
  const cr = c.credit;
  if (!cr) return null;
  return (
    <section
      aria-label={cr.title}
      className="rounded-2xl bg-stone-100 p-3 text-xs text-stone-600 ring-1 ring-stone-200 dark:bg-stone-900 dark:text-stone-400 dark:ring-stone-800"
    >
      <h3 className="mb-1 font-bold text-stone-800 dark:text-stone-200">{cr.title}</h3>
      <p>{cr.text}</p>
      {cr.changes.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer font-semibold">What we changed</summary>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {cr.changes.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}
      <p className="mt-1 flex flex-wrap gap-x-3">
        {cr.links.map((l) => (
          <a
            key={l.href}
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline"
          >
            {l.label}
          </a>
        ))}
      </p>
    </section>
  );
}
