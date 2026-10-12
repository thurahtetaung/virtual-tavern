import { Button, RefusalSlot, cn } from '@vt/ui';
import { useState } from 'react';
import type { HydraAction, HydraView, Power } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { POWER_EMOJI } from './Boards.tsx';
import { BallotFace } from './Cards.tsx';
import { ClaimForm } from './Claims.tsx';
import { SecretHand, Sheet } from './Secret.tsx';
import { amAlive, nameOf } from './status.ts';

type Act = (a: HydraAction, o?: { anchor?: string }) => Promise<boolean>;

/** The secret task the viewer has right now, if any (it opens a sheet). */
export type SecretTask = 'president' | 'chancellor' | 'veto' | 'peek' | 'claim' | null;

export function secretTask(view: HydraView): SecretTask {
  const g = view.game;
  const me = view.me?.id;
  if (!g || view.phase !== 'playing' || !me || !amAlive(view)) return null;
  switch (view.stage) {
    case 'legislate-president':
      return g.president === me ? 'president' : null;
    case 'legislate-chancellor':
      return g.chancellor === me ? 'chancellor' : null;
    case 'veto-response':
      return g.president === me ? 'veto' : null;
    case 'power':
      return g.president === me && g.power === 'peek' ? 'peek' : null;
    case 'claim':
      return g.needs.some((n) => n.by === me) ? 'claim' : null;
    default:
      return null;
  }
}

const TASK_BUTTON: Record<Exclude<SecretTask, null>, string> = {
  president: '🗂️ Your three cards',
  chancellor: '🗂️ Your two cards',
  veto: '✂️ Answer the veto',
  peek: '👁️ Peek at the top three',
  claim: '📣 Make your claim',
};

const POWER_VERB: Record<Exclude<Power, 'peek'>, (name: string) => string> = {
  investigate: (n) => `Investigate ${n}`,
  special: (n) => `Make ${n} the next candidate`,
  execute: (n) => `Execute ${n}`,
};

/** The action dock: the one thing the viewer can do right now, always in reach. */
export function Dock({
  view,
  c,
  act,
  target,
  onClearTarget,
  onOpenTask,
}: {
  view: HydraView;
  c: Content;
  act: Act;
  /** The seat picked for a nomination or a power. */
  target: string | null;
  onClearTarget: () => void;
  onOpenTask: () => void;
}) {
  const g = view.game!;
  const me = view.me?.id;
  const inGame = g.players.some((p) => p.id === me);
  const alive = amAlive(view);
  const task = secretTask(view);
  const [sure, setSure] = useState<string | null>(null);
  if (view.phase !== 'playing' || !inGame) return null;
  let body: React.ReactNode = null;
  if (view.stage === 'reveal' && !g.ready.includes(me!)) {
    body = (
      <Button size="lg" className="w-full" onClick={() => void act({ type: 'ready' })}>
        ✓ I’ve read my role: Ready
      </Button>
    );
  } else if (task) {
    body = (
      <Button size="lg" className="hy-breathe w-full" onClick={onOpenTask}>
        {TASK_BUTTON[task]}
      </Button>
    );
  } else if (view.stage === 'nominate' && g.president === me) {
    body = target ? (
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClearTarget}>
          Change
        </Button>
        <Button
          size="lg"
          className="flex-1"
          onClick={() => {
            void act({ type: 'nominate', player: target }, { anchor: 'dock' }).then((ok) => {
              if (ok) onClearTarget();
            });
          }}
        >
          Nominate {nameOf(view, target)}
        </Button>
      </div>
    ) : (
      <p className="py-2 text-center text-sm font-semibold">
        👆 Tap a seat to nominate your Chancellor
      </p>
    );
  } else if (view.stage === 'vote' && alive) {
    body = (
      <div className="grid grid-cols-2 gap-3" role="group" aria-label="Your vote">
        {(['yes', 'no'] as const).map((b) => (
          <button
            key={b}
            type="button"
            aria-pressed={g.myVote === b}
            aria-label={`Vote ${c.ballotName(b)}`}
            onClick={() => void act({ type: 'vote', ballot: b }, { anchor: 'dock' })}
            className={cn(
              'flex items-center justify-center gap-2 rounded-xl p-1 ring-1 transition',
              g.myVote === b
                ? 'bg-amber-100 ring-4 ring-amber-500 dark:bg-amber-500/20'
                : g.myVote
                  ? 'opacity-55 ring-stone-300 dark:ring-stone-700'
                  : 'bg-white ring-stone-300 hover:scale-[1.02] dark:bg-stone-800 dark:ring-stone-600',
            )}
          >
            <BallotFace ballot={b} c={c} className="h-10 sm:h-14" />
          </button>
        ))}
      </div>
    );
  } else if (view.stage === 'power' && g.president === me && g.power && g.power !== 'peek') {
    const power = g.power;
    body = (
      <div className="space-y-1.5">
        <details
          className="group text-center text-xs text-stone-600 sm:pointer-events-none dark:text-stone-400"
          open={false}
        >
          <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
            <span aria-hidden>{POWER_EMOJI[power]} </span>
            {c.powerName(power)} <span className="text-stone-400 group-open:hidden">ⓘ</span>
          </summary>
          <p className="mt-0.5">{c.powerText(power)}</p>
        </details>
        <p className="hidden text-center text-xs text-stone-600 sm:block dark:text-stone-400">
          {c.powerText(power)}
        </p>
        {target ? (
          sure === target || power !== 'execute' ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setSure(null);
                  onClearTarget();
                }}
              >
                Change
              </Button>
              <Button
                size="lg"
                variant={power === 'execute' ? 'danger' : 'primary'}
                className="flex-1"
                onClick={() => {
                  void act({ type: power, player: target }, { anchor: 'dock' }).then((ok) => {
                    if (ok) {
                      setSure(null);
                      onClearTarget();
                    }
                  });
                }}
              >
                {power === 'execute'
                  ? `Yes, execute ${nameOf(view, target)}`
                  : POWER_VERB[power](nameOf(view, target))}
              </Button>
            </div>
          ) : (
            <Button size="lg" variant="danger" className="w-full" onClick={() => setSure(target)}>
              {POWER_VERB.execute(nameOf(view, target))}…
            </Button>
          )
        ) : (
          <p className="text-center text-sm font-semibold">👆 Tap a seat to choose</p>
        )}
      </div>
    );
  }
  if (!body) return null;
  return (
    <div
      className="sticky bottom-[4.25rem] z-20 rounded-2xl bg-white/95 p-2.5 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] ring-1 ring-stone-200 backdrop-blur lg:static lg:shadow-sm dark:bg-stone-900/95 dark:ring-stone-700"
      data-testid="dock"
    >
      {body}
      <RefusalSlot anchor="dock" />
    </div>
  );
}

/** The sheets for secret tasks: the session's cards, the veto, the peek and the claims. */
export function TaskSheet({
  view,
  c,
  act,
  open,
  onClose,
}: {
  view: HydraView;
  c: Content;
  act: Act;
  open: boolean;
  onClose: () => void;
}) {
  const task = secretTask(view);
  const g = view.game;
  const [pick, setPick] = useState<{ key: string; i: number } | null>(null);
  if (!g || !task) return null;
  const key = `${g.rounds.length}:${view.stage}:${g.vetoRefused}`;
  const picked = pick?.key === key ? pick.i : null;
  const select = (i: number) => setPick({ key, i });
  const hand = g.hand ?? [];
  const P = nameOf(view, g.president);
  const C = nameOf(view, g.chancellor);
  if (task === 'president') {
    const card = picked !== null ? hand[picked] : undefined;
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="You’re the President"
        footer={
          <div className="space-y-1">
            <Button
              size="lg"
              className="w-full"
              disabled={picked === null}
              onClick={() => void act({ type: 'discard', index: picked! }, { anchor: 'sheet' })}
            >
              {card ? `Discard this ${c.teamName(card)} policy` : 'Pick a card to discard'}
            </Button>
            <RefusalSlot anchor="sheet" />
          </div>
        }
      >
        <p className="mb-3 text-center text-sm">
          Discard one. The other two are <b>shuffled</b> and handed to {C}. No talking until the
          policy is out!
        </p>
        <SecretHand
          cards={hand}
          c={c}
          selected={picked}
          onSelect={select}
          verb="Discard"
          testId="president-hand"
        />
      </Sheet>
    );
  }
  if (task === 'chancellor') {
    const card = picked !== null ? hand[picked] : undefined;
    const canVeto = g.vetoUnlocked && !g.vetoRequested;
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="You’re the Chancellor"
        footer={
          <div className="space-y-2">
            <Button
              size="lg"
              className="w-full"
              disabled={picked === null}
              onClick={() => void act({ type: 'enact', index: picked! }, { anchor: 'sheet' })}
            >
              {card ? `Enact this ${c.teamName(card)} policy` : 'Pick a card to enact'}
            </Button>
            {canVeto && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => void act({ type: 'veto' }, { anchor: 'sheet' })}
              >
                ✂️ Ask {P} for a veto (tracker {g.tracker} → {g.tracker + 1})
              </Button>
            )}
            <RefusalSlot anchor="sheet" />
          </div>
        }
      >
        {g.vetoRefused && (
          <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-center text-sm font-semibold text-rose-900 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100">
            {P} refused the veto: you must enact one.
          </p>
        )}
        <p className="mb-3 text-center text-sm">
          Enact one policy; the other is discarded face down.
        </p>
        <SecretHand
          cards={hand}
          c={c}
          selected={picked}
          onSelect={select}
          verb="Enact"
          shuffleKey={`${g.rounds.length}`}
          testId="chancellor-hand"
        />
      </Sheet>
    );
  }
  if (task === 'veto') {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title="A veto request"
        footer={
          <div className="space-y-2">
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => void act({ type: 'veto-answer', agree: false }, { anchor: 'sheet' })}
              >
                Refuse
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => void act({ type: 'veto-answer', agree: true }, { anchor: 'sheet' })}
              >
                Agree to veto
              </Button>
            </div>
            <RefusalSlot anchor="sheet" />
          </div>
        }
      >
        <p className="mb-3 text-center text-sm">
          {C} wants to veto this agenda. If you agree, both cards are discarded and the election
          tracker moves on ({g.tracker} → {g.tracker + 1}
          {g.tracker + 1 >= 3 ? ': the people will enact the top policy' : ''}). If you refuse, {C}{' '}
          must enact one.
        </p>
        <SecretHand cards={hand} c={c} testId="veto-hand" />
      </Sheet>
    );
  }
  if (task === 'peek') {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        title={c.powerName('peek')}
        footer={
          <Button size="lg" className="w-full" onClick={() => void act({ type: 'peek-done' })}>
            Done: put them back
          </Button>
        }
      >
        <p className="mb-3 text-center text-sm">
          The top three cards of the deck, top first. They stay in this order.
        </p>
        <SecretHand cards={g.peek ?? []} c={c} testId="peek-hand" />
      </Sheet>
    );
  }
  const need = g.needs.find((n) => n.by === view.me?.id)!;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={
        need.kind === 'investigate'
          ? 'Your investigation'
          : need.kind === 'peek'
            ? 'Your peek'
            : 'Your claim'
      }
    >
      <ClaimForm view={view} c={c} need={need} act={act} />
    </Sheet>
  );
}
