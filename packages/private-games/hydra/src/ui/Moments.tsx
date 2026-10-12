import { ProtectedImage, cn } from '@vt/ui';
import { useEffect, useRef, useState } from 'react';
import { powerAt } from '../logic/tables.ts';
import type { Ballot, HydraView, Policy, Power } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { BallotBack, BallotFace, FlipCard, PolicyBack, PolicyFace } from './Cards.tsx';
import { playSfx, prefersReducedMotion } from './fx.ts';
import { nameOf } from './status.ts';

/** The table's big moments, played as overlays as they happen (never on a reload). */
export type Moment =
  | { kind: 'vote'; key: string; votes: [string, Ballot][]; elected: boolean; missing: number }
  | {
      kind: 'enact';
      key: string;
      policy: Policy;
      chaos: boolean;
      power: Power | null;
      tracker: boolean;
    }
  | { kind: 'execute'; key: string; target: string }
  | { kind: 'cleared'; key: string; id: string };

const DURATION: Record<Moment['kind'], number> = {
  vote: 3600,
  enact: 3000,
  execute: 2800,
  cleared: 2200,
};

function diff(prev: HydraView, next: HydraView): Moment[] {
  const a = prev.game;
  const b = next.game;
  if (!a || !b || prev.gamesPlayed !== next.gamesPlayed) return [];
  const out: Moment[] = [];
  const g = next.gamesPlayed;
  b.rounds.forEach((r, i) => {
    const old = a.rounds[i];
    if (r.elected !== null && (old?.elected ?? null) === null) {
      const order = b.players.map((p) => p.id).filter((id) => r.votes[id]);
      out.push({
        kind: 'vote',
        key: `${g}:${r.n}:vote`,
        votes: order.map((id) => [id, r.votes[id]!]),
        elected: r.elected,
        missing: r.missing.length,
      });
    }
    if (r.cleared && !old?.cleared && r.chancellor)
      out.push({ kind: 'cleared', key: `${g}:${r.n}:cleared`, id: r.chancellor });
    if (r.session?.enacted && !old?.session)
      out.push({
        kind: 'enact',
        key: `${g}:${r.n}:enact`,
        policy: r.session.enacted,
        chaos: false,
        power: r.session.enacted === 'red' ? powerAt(b.players.length, b.enacted.red) : null,
        tracker: false,
      });
    if (r.chaos && !old?.chaos)
      out.push({
        kind: 'enact',
        key: `${g}:${r.n}:chaos`,
        policy: r.chaos,
        chaos: true,
        power: null,
        tracker: true,
      });
  });
  for (const p of b.players)
    if (p.dead && !a.players.find((x) => x.id === p.id)?.dead)
      out.push({ kind: 'execute', key: `${g}:${p.id}:dead`, target: p.id });
  return out;
}

export function useMoments(view: HydraView, sound: boolean, enabled: boolean) {
  const prev = useRef<HydraView | null>(null);
  const [queue, setQueue] = useState<Moment[]>([]);
  useEffect(() => {
    const before = prev.current;
    prev.current = view;
    if (!before || !enabled) return;
    const found = diff(before, view);
    if (found.length) setQueue((q) => [...q, ...found].slice(-6));
  }, [view, enabled]);
  const current = queue[0] ?? null;
  useEffect(() => {
    if (!current) return;
    const ms = prefersReducedMotion()
      ? Math.min(DURATION[current.kind], 2200)
      : DURATION[current.kind];
    const t = window.setTimeout(() => setQueue((q) => q.slice(1)), ms);
    return () => {
      window.clearTimeout(t);
    };
  }, [current]);
  useEffect(() => {
    if (!current || !sound) return;
    playSfx(current.kind === 'execute' ? 'shot' : current.kind === 'enact' ? 'card' : 'flip');
  }, [current, sound]);
  return { current, skip: () => setQueue((q) => q.slice(1)) };
}

function Overlay({
  children,
  onSkip,
  label,
}: {
  children: React.ReactNode;
  onSkip: () => void;
  label: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className="hy-fade fixed inset-0 z-40 flex cursor-pointer flex-col items-center justify-center gap-4 bg-stone-950/80 p-6 text-white backdrop-blur-[2px]"
      onClick={onSkip}
      data-testid="moment"
    >
      {children}
      <span className="absolute bottom-6 text-xs text-white/60">Tap to continue</span>
    </div>
  );
}

function Stamp({
  text,
  tone,
  delay,
}: {
  text: string;
  tone: 'good' | 'bad' | 'gold';
  delay: number;
}) {
  return (
    <span
      className={cn(
        'hy-stamp inline-block rounded-lg border-4 px-4 py-1 text-3xl font-black tracking-widest uppercase sm:text-5xl',
        tone === 'good' && 'border-emerald-400 text-emerald-300',
        tone === 'bad' && 'border-rose-400 text-rose-300',
        tone === 'gold' && 'border-amber-300 text-amber-200',
      )}
      style={{ ['--d' as string]: `${delay}ms` }}
    >
      {text}
    </span>
  );
}

function VoteMoment({
  view,
  c,
  m,
  sound,
}: {
  view: HydraView;
  c: Content;
  m: Extract<Moment, { kind: 'vote' }>;
  sound: boolean;
}) {
  const step = prefersReducedMotion() ? 0 : 140;
  const [shown, setShown] = useState(step === 0 ? m.votes.length : 0);
  useEffect(() => {
    if (step === 0) return;
    const id = window.setInterval(() => {
      setShown((s) => {
        if (s >= m.votes.length) {
          window.clearInterval(id);
          return s;
        }
        if (sound) playSfx('flip');
        return s + 1;
      });
    }, step);
    return () => {
      window.clearInterval(id);
    };
  }, [m, step, sound]);
  useEffect(() => {
    if (shown === m.votes.length && sound) playSfx('stamp');
  }, [shown, m.votes.length, sound]);
  const yes = m.votes.slice(0, shown).filter(([, b]) => b === 'yes').length;
  const no = shown - yes;
  const g = view.game!;
  const r = g.rounds.at(-1);
  return (
    <>
      <p className="text-center text-sm text-white/80">
        President {nameOf(view, r?.president)} with Chancellor {nameOf(view, r?.chancellor)}
      </p>
      <ul className="grid max-w-md grid-cols-5 gap-2 sm:gap-3">
        {m.votes.map(([id, b], i) => (
          <li key={id} className="flex flex-col items-center gap-1">
            <FlipCard
              up={i < shown}
              back={<BallotBack c={c} className="w-14 sm:w-16" />}
              front={<BallotFace ballot={b} c={c} className="w-14 sm:w-16" />}
            />
            <span className="max-w-16 truncate text-[0.65rem] text-white/80">
              {nameOf(view, id)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-2xl font-black tabular-nums" aria-live="polite">
        {c.ballotName('yes')} {yes} · {c.ballotName('no')} {no}
      </p>
      {shown === m.votes.length && (
        <Stamp
          text={m.elected ? 'Elected' : 'Rejected'}
          tone={m.elected ? 'good' : 'bad'}
          delay={150}
        />
      )}
      {shown === m.votes.length && !m.elected && g.tracker === 2 && (
        <p
          className="hy-rise text-center text-sm font-semibold text-rose-200"
          style={{ ['--d' as string]: '400ms' }}
        >
          One more failed government and the people take over!
        </p>
      )}
      {m.missing > 0 && <p className="text-xs text-white/60">{m.missing} vote(s) not counted</p>}
    </>
  );
}

function EnactMoment({ c, m }: { c: Content; m: Extract<Moment, { kind: 'enact' }> }) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setUp(true), prefersReducedMotion() ? 0 : 450);
    return () => {
      window.clearTimeout(t);
    };
  }, []);
  const icon = m.power ? c.powerIcon(m.power) : null;
  return (
    <>
      <p className="text-center text-sm font-semibold tracking-widest text-white/80 uppercase">
        {m.chaos ? 'The people have spoken' : 'A policy is enacted'}
      </p>
      <div className={cn('w-32 sm:w-40', m.chaos && !up && 'hy-shake')}>
        <FlipCard
          up={up}
          back={<PolicyBack c={c} />}
          front={<PolicyFace policy={m.policy} c={c} />}
        />
      </div>
      {up && (
        <p className="hy-rise text-xl font-black">
          A {c.teamName(m.policy)} policy{m.chaos ? ' from the top of the deck' : ''}
        </p>
      )}
      {up && m.chaos && (
        <p
          className="hy-rise text-center text-sm text-white/80"
          style={{ ['--d' as string]: '200ms' }}
        >
          Any power is ignored, the tracker resets and term limits are forgotten.
        </p>
      )}
      {up && m.power && (
        <div
          className="hy-rise flex items-center gap-3 rounded-2xl bg-red-900/70 px-4 py-2 ring-2 ring-amber-300/70"
          style={{ ['--d' as string]: '350ms' }}
        >
          {icon ? (
            <ProtectedImage
              src={icon}
              alt=""
              className="hy-ignite size-12 rounded-lg"
              style={{ ['--d' as string]: '450ms' }}
            />
          ) : (
            <span className="hy-ignite text-3xl" aria-hidden style={{ ['--d' as string]: '450ms' }}>
              {POWER_EMOJI[m.power]}
            </span>
          )}
          <span>
            <span className="block text-xs tracking-widest text-amber-200 uppercase">
              Power unlocked
            </span>
            <span className="block font-bold">{c.powerName(m.power)}</span>
          </span>
        </div>
      )}
    </>
  );
}

/** Plays the current moment, if any. */
export function MomentView({
  view,
  c,
  moment,
  onSkip,
  sound,
}: {
  view: HydraView;
  c: Content;
  moment: Moment | null;
  onSkip: () => void;
  sound: boolean;
}) {
  if (!moment) return null;
  switch (moment.kind) {
    case 'vote':
      return (
        <Overlay
          onSkip={onSkip}
          label={moment.elected ? 'Government elected' : 'Government rejected'}
        >
          <VoteMoment key={moment.key} view={view} c={c} m={moment} sound={sound} />
        </Overlay>
      );
    case 'enact':
      return (
        <Overlay onSkip={onSkip} label={`${c.teamName(moment.policy)} policy enacted`}>
          <EnactMoment key={moment.key} c={c} m={moment} />
        </Overlay>
      );
    case 'execute':
      return (
        <Overlay onSkip={onSkip} label={`${nameOf(view, moment.target)} was executed`}>
          <span className="hy-pop text-6xl" aria-hidden>
            ✝
          </span>
          <p className="hy-rise text-center text-2xl font-black">
            {nameOf(view, moment.target)} has been executed
          </p>
          <p
            className="hy-rise max-w-xs text-center text-sm text-white/80"
            style={{ ['--d' as string]: '300ms' }}
          >
            They can no longer speak, vote or run for office. Their role stays secret.
          </p>
        </Overlay>
      );
    case 'cleared':
      return (
        <Overlay
          onSkip={onSkip}
          label={`${nameOf(view, moment.id)} is not ${c.roleName('leader')}`}
        >
          <p className="text-center text-xl font-bold">{nameOf(view, moment.id)}</p>
          <Stamp text={`Not ${c.roleName('leader')} ✓`} tone="good" delay={0} />
          <p className="text-center text-sm text-white/80">
            The government stands. The session begins.
          </p>
        </Overlay>
      );
  }
}

/** While the table learns whether the new Chancellor is the Leader: a spotlight and a pause. */
export function LeaderCheck({ view, c }: { view: HydraView; c: Content }) {
  const g = view.game!;
  return (
    <div
      className="fixed inset-0 z-[45] flex items-center justify-center p-6"
      role="status"
      data-testid="leader-check"
    >
      <div className="hy-spot flex flex-col items-center gap-2 rounded-3xl bg-stone-900 px-8 py-6 text-center text-white">
        <span className="text-xs font-bold tracking-[0.3em] text-amber-300 uppercase">
          The danger zone
        </span>
        <span className="text-2xl font-black">{nameOf(view, g.chancellor)}</span>
        <span className="hy-breathe text-lg">Is the new Chancellor {c.names.leader}?</span>
      </div>
    </div>
  );
}

/** Three failed governments: the deck shakes and the people take over. */
export function Chaos({ c }: { c: Content }) {
  return (
    <div
      className="fixed inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-stone-950/85 p-6 text-white"
      role="status"
      data-testid="chaos"
    >
      <div className="hy-shake w-28">
        <PolicyBack c={c} />
      </div>
      <p className="text-2xl font-black">Chaos!</p>
      <p className="max-w-xs text-center text-sm text-white/80">
        Three failed governments in a row: the people enact the top policy themselves.
      </p>
    </div>
  );
}
