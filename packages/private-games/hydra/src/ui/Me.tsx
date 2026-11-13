import { NameDot, Peek, cn } from '@vt/ui';
import { useState } from 'react';
import { leaderKnowsTeam, trackFor } from '../logic/tables.ts';
import type { HydraView, Memory } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { Pips, RoleBack, RoleFace, TEAM_TEXT } from './Cards.tsx';
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

/** Whether your role card is up. Everything that gives your side away shows only while it is. */
export interface RoleReveal {
  open: boolean;
  setOpen: (open: boolean) => void;
  held: boolean;
  setHeld: (held: boolean) => void;
  flat: boolean;
  shown: boolean;
}

/** One reveal state for every copy of the card (phone tab, desktop sidebar) and the seats;
 * switched-on cards turn face down again whenever `resetKey` changes. */
export function useRoleReveal(resetKey: string): RoleReveal {
  const [opened, setOpened] = useState<string | null>(null);
  const [held, setHeld] = useState(false);
  const flat = useLyingFlat(true);
  const open = opened === resetKey;
  return {
    open,
    setOpen: (on) => setOpened(on ? resetKey : null),
    held,
    setHeld,
    flat,
    shown: (open || held) && !flat,
  };
}

/** Your role card: face down until you hold it, slide it up or switch it on. */
export function RoleCard({
  view,
  c,
  reveal,
  big = false,
}: {
  view: HydraView;
  c: Content;
  reveal: RoleReveal;
  big?: boolean;
}) {
  const r = view.role;
  const { open, setOpen, setHeld, flat, shown } = reveal;
  if (!r) return null;
  // The big card grows with a tall desktop window (the deal's panel has the room), never past
  // what keeps the quick reference and Ready on screen.
  const size = cn(
    'relative mx-auto block',
    big ? 'w-44 sm:w-52 lg:w-[clamp(13rem,calc((100dvh-40rem)*0.75),22rem)]' : 'w-32 sm:w-40',
  );
  // The face is only in the page while the card is up, so a face-down card carries no role name,
  // not even for a screen reader.
  return (
    <section aria-label="Your role card" className="flex flex-col items-center gap-2">
      <Peek
        what="my role"
        slide
        open={open}
        onOpenChange={setOpen}
        onShownChange={setHeld}
        blocked={flat && 'Hidden while your phone lies flat.'}
        onReveal={() => playSfx('flip')}
        className="w-full"
        cover={
          <span className={size}>
            {/* The envelope the card slides out of. */}
            <span
              aria-hidden
              className="absolute inset-x-[-8%] bottom-[-6%] h-[42%] rounded-b-xl bg-gradient-to-b from-amber-200 to-amber-400 shadow-lg ring-1 ring-accent/50 dark:from-amber-700 dark:to-amber-900"
            />
            <RoleBack c={c} className="relative" />
            {/* On a dark pill, so it reads over the envelope and the card's light art alike. */}
            <span className="pointer-events-none absolute inset-x-1 bottom-2 rounded-full bg-black/75 px-2 py-1 text-center text-xs leading-tight font-bold text-white shadow-vt-1">
              ⬆ Slide up or hold
            </span>
          </span>
        }
      >
        <span className={size}>
          <RoleFace role={r.role} art={r.art} seed={view.game?.artSeed} c={c} />
        </span>
      </Peek>
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

/** The Me tab: your role, what you know, your secrets and the board's powers. */
export function MeTab({
  view,
  c,
  reveal,
  showGuide,
  big = false,
  moments,
  setMoments,
  plain,
  setPlain,
  part = 'all',
}: {
  view: HydraView;
  c: Content;
  reveal: RoleReveal;
  showGuide: () => void;
  /** The deal: the role card is the star. */
  big?: boolean;
  /**
   * Which sections: all of them, or split between columns (the deal on desktops keeps the role in
   * the main column above Ready, the quick reference in the rail).
   */
  part?: 'all' | 'role' | 'reference';
  moments: boolean;
  setMoments: (on: boolean) => void;
  /** The edition's display font switched off ("Themed lettering" off). */
  plain: boolean;
  setPlain: (on: boolean) => void;
}) {
  const g = view.game!;
  const r = view.role;
  const track = trackFor(g.players.length);
  return (
    <div className="space-y-3">
      {part !== 'reference' && r && (
        <section
          className={cn(
            'space-y-3 rounded-2xl bg-card p-3 shadow-sm ring-1 ring-line',
            // The deal on wide screens: how you win and who you know sit beside the card, so they
            // are in view above Ready on a laptop window.
            big &&
              'lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-x-6 lg:space-y-0',
          )}
        >
          <RoleCard view={view} c={c} reveal={reveal} big={big} />
          {/* Only with the card up: a glance at a face-down card must give nothing away. */}
          {!reveal.shown ? (
            <p className="text-center text-xs text-ink-muted" data-testid="role-details-hidden">
              Your goal, what you know and what only you saw show while your card is up.
            </p>
          ) : (
            <div className="space-y-2 text-sm" data-testid="role-details">
              <p className="rounded-lg bg-sunk px-3 py-2">
                <b>How you win: </b>
                {c.copy(`me.goal.${r.role}`)}
              </p>
              <p className="font-semibold">{knowledge(view, c)}</p>
              {r.known.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="What you know">
                  {r.known.map((k) => (
                    <li
                      key={k.id}
                      className="inline-flex items-center gap-1.5 rounded-full bg-card py-1 pr-1 pl-3 text-sm font-semibold ring-1 ring-line-strong"
                    >
                      {nameOf(view, k.id)}
                      <NameDot name={nameOf(view, k.id)} className="order-first" />
                      <span className="rounded-full bg-red-700 px-2 py-0.5 text-xs text-white">
                        {c.roleName(k.role)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
      {part !== 'reference' && reveal.shown && g.memories.length > 0 && (
        <section className="rounded-2xl bg-card p-3 text-sm shadow-sm ring-1 ring-line">
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
      {part !== 'role' && (
        <section className="rounded-2xl bg-card p-3 text-sm shadow-sm ring-1 ring-line">
          <h3 className="mb-1 font-bold">Quick reference: {g.players.length} players</h3>
          <ol className="space-y-0.5">
            {track.map((p, i) => (
              <li key={i} className={cn(i < g.enacted.red && 'text-ink-muted line-through')}>
                {c.policyName('red')} #{i + 1}:{' '}
                {i === 5
                  ? c.t('the {reds} win')
                  : p
                    ? `${POWER_EMOJI[p]} ${c.powerName(p)}`
                    : 'no power'}
                {i === 2 && <span className="text-accent-text"> · danger zone starts</span>}
                {i === 4 && <span className="text-accent-text">{c.t(' · {veto} unlocks')}</span>}
              </li>
            ))}
          </ol>
          {g.rebalance && <p className="mt-1 text-xs text-ink-muted">Community rebalance is on.</p>}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-accent-text underline"
              onClick={showGuide}
            >
              Rules →
            </button>
            <button
              type="button"
              role="switch"
              aria-checked={moments}
              onClick={() => setMoments(!moments)}
              className="min-h-11 rounded-full px-3 text-xs font-semibold ring-1 ring-line-strong"
            >
              Big moments: {moments ? 'on' : 'off'}
            </button>
            {c.font && (
              <button
                type="button"
                role="switch"
                aria-checked={!plain}
                onClick={() => setPlain(!plain)}
                className="min-h-11 rounded-full px-3 text-xs font-semibold ring-1 ring-line-strong"
              >
                Themed lettering: {plain ? 'off' : 'on'}
              </button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/** The original game's credit, from the private manifest: on the end screen only (the guide has it as its footer). */
export function CreditBlock({ c }: { c: Content }) {
  const cr = c.credit;
  if (!cr) return null;
  return (
    <section
      aria-label={cr.title}
      className="rounded-2xl bg-sunk p-3 text-xs text-ink-muted ring-1 ring-line"
    >
      <h3 className="mb-1 font-bold text-ink">{cr.title}</h3>
      <p>{cr.text}</p>
      {cr.changes.length > 0 && (
        <details className="mt-1">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold">
            What we changed
          </summary>
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
