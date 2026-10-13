import type { GameRoomInfo } from '@vt/game-sdk';
import {
  Button,
  Countdown,
  Panel,
  PlayerTag,
  ProtectedImage,
  RefusalSlot,
  Superlatives,
  cn,
} from '@vt/ui';
import { useState } from 'react';
import { type InquestAction, type InquestView, type RoleId, finalOf } from '../logic/types.ts';
import { ArtCard } from './ArtCard.tsx';
import type { Content } from './assets.ts';
import { Timeline } from './Scene.tsx';
import { nameOf, resultLine, solveBlocker } from './status.ts';
import { useTip } from './tips.ts';
import { TipBox } from './Scene.tsx';
import { FinalList } from './Final.tsx';

type Act = (a: InquestAction, o?: { anchor?: string }) => Promise<boolean>;

const GOALS: Record<RoleId | 'former-forensic', { goal: string; win: string }> = {
  forensic: {
    goal: 'Lead the Investigators to the exact Clue + Means, using only bullets on the tiles.',
    win: 'You win with the Investigators when someone names the crime.',
  },
  'former-forensic': {
    goal: 'You handed over the case. Watch quietly: you know the answer.',
    win: 'You still win with the Investigators.',
  },
  murderer: {
    goal: 'Keep anyone from naming your Key Evidence and Means.',
    win: 'You win if nobody names your pair by the end, or every attempt is spent.',
  },
  accomplice: {
    goal: 'Help the Murderer stay hidden, and point the table elsewhere.',
    win: 'You win with the Murderer.',
  },
  witness: {
    goal: 'Help the Investigators without giving yourself away.',
    win: 'You win with the Investigators, unless the culprits name you at the end.',
  },
  investigator: {
    goal: 'Read the bullets and name the Murderer’s exact Clue + Means.',
    win: 'You win when anyone on your side names the crime.',
  },
};

/** The viewer's role card: face down until tapped, with what they know and how they win. */
export function RoleCard({
  view,
  content,
  showGuide,
}: {
  view: InquestView;
  content: Content;
  showGuide: () => void;
}) {
  const g = view.game!;
  const [revealed, setShown] = useState(false);
  const role = g.myRole;
  if (!role) return null;
  // The Forensic Scientist is public (everyone knows who it is), so that card lies face up. The
  // hidden roles stay face down until tapped.
  const open = role === 'forensic' || role === 'former-forensic';
  const shown = open || revealed;
  const dealt: RoleId = role === 'former-forensic' ? 'forensic' : role;
  const art = content.roleArt(dealt);
  const info = GOALS[role];
  const cardClass =
    'relative aspect-[429/699] w-24 shrink-0 self-start overflow-hidden rounded-lg bg-stone-800 shadow ring-1 ring-black/20';
  const face = (
    <>
      {shown ? (
        art ? (
          <ProtectedImage src={art} alt="" className="size-full object-contain" />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-b from-stone-700 to-stone-950 p-1 text-center text-xs font-bold text-white">
            {content.roleName(dealt)}
          </span>
        )
      ) : content.roleBack ? (
        <ProtectedImage src={content.roleBack} alt="" className="size-full object-contain" />
      ) : (
        <span className="flex size-full items-center justify-center bg-gradient-to-b from-stone-700 to-stone-950 text-3xl">
          ❓
        </span>
      )}
      {!shown && (
        <span className="absolute inset-x-0 bottom-0 bg-black/70 py-0.5 text-center text-[10px] font-semibold text-white">
          Tap to reveal
        </span>
      )}
    </>
  );
  return (
    <Panel className="flex gap-3">
      {open ? (
        <div
          role="img"
          aria-label={`Your role card: ${content.roleName(dealt)}`}
          className={cardClass}
        >
          {face}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShown(!revealed)}
          aria-label={shown ? 'Hide your role card' : 'Reveal your role card'}
          className={cardClass}
        >
          {face}
        </button>
      )}
      <div className="min-w-0 space-y-1 text-sm">
        <h3 className="text-base font-bold">
          {shown
            ? role === 'former-forensic'
              ? 'Former Forensic Scientist'
              : content.roleName(dealt)
            : 'Your role'}
        </h3>
        {shown ? (
          <>
            {open && (
              <p className="inline-block rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-100">
                🔬 Everyone knows you{role === 'former-forensic' ? ' were' : '’re'} the Forensic
                Scientist.
              </p>
            )}
            <p>{info.goal}</p>
            <p className="text-stone-600 dark:text-stone-400">{info.win}</p>
            <Knowledge view={view} content={content} />
          </>
        ) : (
          <p className="text-stone-600 dark:text-stone-400">Tap the card when nobody is looking.</p>
        )}
        <button
          type="button"
          className="text-xs font-semibold text-amber-700 underline dark:text-amber-400"
          onClick={showGuide}
        >
          How to play your role
        </button>
      </div>
    </Panel>
  );
}

/** What the viewer secretly knows: the crime, their partner, or the Witness's pair. */
function Knowledge({ view, content }: { view: InquestView; content: Content }) {
  const g = view.game!;
  const lines: string[] = [];
  if (g.solution)
    lines.push(
      `The crime: ${nameOf(view, g.solution.murderer)}’s ${content.cardName('clue', g.solution.clue)} + ${content.cardName('means', g.solution.means)}.`,
    );
  if (g.partner) lines.push(`Your partner: ${nameOf(view, g.partner)}.`);
  if (g.witnessPair)
    lines.push(
      `You saw ${g.witnessPair.map((id) => nameOf(view, id)).join(' and ')} leave the scene. One of them did it.`,
    );
  if (g.autoCrime && g.myRole === 'murderer')
    lines.push('⏱ Time ran out at night, so this pair was picked for you.');
  if (!lines.length) return null;
  return (
    <ul className="space-y-0.5 rounded-lg bg-rose-50 p-2 text-rose-950 ring-1 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-100 dark:ring-rose-500/30">
      {lines.map((l) => (
        <li key={l}>🤫 {l}</li>
      ))}
    </ul>
  );
}

/**
 * Who the Forensic Scientist is: a public role, so everyone else sees it at all times (and who
 * handed over, after a handover).
 */
export function ForensicLine({ view }: { view: InquestView }) {
  const g = view.game!;
  if (g.myRole === 'forensic') return null;
  const former = g.formerFs.map((id) => (id === view.me?.id ? 'you' : nameOf(view, id)));
  return (
    <p
      aria-label="Forensic Scientist"
      className="flex flex-wrap items-center gap-x-1.5 text-xs text-stone-600 dark:text-stone-400"
    >
      <span className="rounded-full bg-sky-100 px-2 py-0.5 font-semibold text-sky-900 dark:bg-sky-500/15 dark:text-sky-100">
        🔬 Forensic Scientist: {nameOf(view, g.fs)}
      </span>
      {former.length > 0 && <span>took over from {former.join(', ')}</span>}
    </p>
  );
}

/** The crime, pinned for those who know it (Forensic Scientist, Murderer, Accomplice). */
export function SolutionPin({ view, content }: { view: InquestView; content: Content }) {
  const g = view.game!;
  const s = g.solution;
  if (!s || g.stage === 'done') return null;
  return (
    <div className="flex items-center gap-2 rounded-xl bg-rose-950/90 p-1.5 text-rose-50 ring-1 ring-rose-500">
      <div className="w-10 shrink-0">
        <ArtCard deck="clue" n={s.clue} content={content} size="thumb" />
      </div>
      <div className="w-10 shrink-0">
        <ArtCard deck="means" n={s.means} content={content} size="thumb" />
      </div>
      <p className="min-w-0 text-xs leading-tight">
        <span className="font-bold">🤫 The answer:</span> {nameOf(view, s.murderer)}’s{' '}
        <b>{content.cardName('clue', s.clue)}</b> + <b>{content.cardName('means', s.means)}</b>
      </p>
    </div>
  );
}

/** The Solve button with the viewer's badge state. */
export function SolveButton({
  view,
  onSolve,
  compact = false,
  label = '🔎 Solve',
}: {
  view: InquestView;
  onSolve: () => void;
  compact?: boolean;
  label?: string;
}) {
  const blocker = solveBlocker(view);
  const me = view.game?.players.find((p) => p.id === view.me?.id);
  if (!me || me.isFs || me.formerFs) return null;
  return (
    <Button
      variant={blocker ? 'secondary' : 'red'}
      size={compact ? 'md' : 'lg'}
      disabled={!!blocker}
      title={blocker ?? undefined}
      onClick={onSolve}
      className={cn(!compact && 'w-full')}
    >
      {label}
      {me.badges > 1 ? ` (${me.badges})` : ''}
      {me.badges <= 0 ? ' · used' : ''}
    </Button>
  );
}

/** The Me tab: role card, Solve, attempts so far and the table's notices. */
export function MeTab({
  view,
  content,
  showGuide,
  onSolve,
}: {
  view: InquestView;
  content: Content;
  showGuide: () => void;
  onSolve: () => void;
}) {
  const g = view.game!;
  const blocker = solveBlocker(view);
  const [tipOpen, dismissTip] = useTip('solve');
  return (
    <div className="space-y-2">
      <RoleCard view={view} content={content} showGuide={showGuide} />
      {g.stage !== 'done' && (
        <>
          {tipOpen && !blocker && (
            <TipBox onClose={dismissTip}>
              Solve names another player’s Clue + Means. You get one attempt, so be sure, but don’t
              wait too long:{' '}
              {finalOf(view.settings)
                ? 'after round 3 comes one last accusation each, in turn.'
                : 'the game ends after round 3.'}
            </TipBox>
          )}
          <SolveButton view={view} onSolve={onSolve} />
          {blocker && <p className="text-center text-xs text-stone-500">{blocker}</p>}
        </>
      )}
      <Attempts view={view} content={content} />
    </div>
  );
}

export function Attempts({ view, content }: { view: InquestView; content: Content }) {
  const g = view.game!;
  if (!g.attempts.length) return null;
  return (
    <Panel className="space-y-1">
      <h3 className="text-sm font-bold">Solve attempts</h3>
      <ul className="space-y-0.5 text-sm">
        {g.attempts.map((a) => (
          <li key={`${a.by}-${a.at}`}>
            {a.correct ? '✅' : '❌'} <b>{nameOf(view, a.by)}</b> named {nameOf(view, a.target)}’s{' '}
            {content.cardName('clue', a.clue)} + {content.cardName('means', a.means)}
            <span className="text-stone-500">
              {' '}
              · {a.final ? 'final accusation' : `round ${a.round}`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** A hand of cards to pick from: full width on phones, capped so 8 cards fit a desktop screen. */
const HAND = 'mx-auto grid w-full max-w-lg gap-2';

/** Night: the Murderer picks the crime from their own cards, with a confirm step. */
export function NightPanel({
  view,
  content,
  act,
  room,
}: {
  view: InquestView;
  content: Content;
  act: Act;
  room: GameRoomInfo;
}) {
  const g = view.game!;
  const me = g.players.find((p) => p.id === view.me?.id);
  const [clue, setClue] = useState<number | null>(null);
  const [means, setMeans] = useState<number | null>(null);
  const clock = (
    <Countdown
      deadline={g.deadline}
      clockOffset={room.clockOffset}
      label="to choose the crime"
      atZero="then a pair is picked at random"
    />
  );
  if (g.myRole !== 'murderer' || !me)
    return (
      <Panel className="space-y-2 bg-stone-900 text-center text-stone-100 dark:bg-stone-950">
        <p className="text-2xl">🌙</p>
        <p className="font-semibold">Night falls. The Murderer is choosing the crime…</p>
        <div className="flex justify-center">{clock}</div>
        <p className="text-sm text-stone-400">
          Look at your role card on the Me tab, and study the suspects meanwhile.
        </p>
      </Panel>
    );
  return (
    <Panel role="region" aria-label="Choose your crime" className="space-y-2 ring-2 ring-rose-500">
      <div className="flex items-start justify-between gap-2">
        <h3 className="shrink-0 font-bold whitespace-nowrap">🔪 Choose your crime</h3>
        {clock}
      </div>
      <p className="text-sm">
        Pick 1 Clue card (the Key Evidence) and 1 Means card from your own cards.
      </p>
      <div className={cn(HAND, me.clue.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
        {me.clue.map((n) => (
          <ArtCard
            key={n}
            deck="clue"
            n={n}
            content={content}
            selected={clue === n}
            onTap={() => setClue(n)}
          />
        ))}
      </div>
      <div className={cn(HAND, me.means.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
        {me.means.map((n) => (
          <ArtCard
            key={n}
            deck="means"
            n={n}
            content={content}
            selected={means === n}
            onTap={() => setMeans(n)}
          />
        ))}
      </div>
      <Button
        size="lg"
        variant="red"
        className="w-full"
        disabled={clue === null || means === null}
        onClick={() =>
          void act(
            { type: 'commit-crime', clue: clue!, means: means! },
            { anchor: 'inquest-night' },
          )
        }
      >
        {clue !== null && means !== null
          ? `Commit: ${content.cardName('clue', clue)} + ${content.cardName('means', means)}`
          : 'Tap one Clue and one Means'}
      </Button>
      <RefusalSlot anchor="inquest-night" />
    </Panel>
  );
}

/** Cleared Evidence: the current player flips one of their own Clue cards, with a confirm. */
export function FlipPanel({
  view,
  content,
  act,
  room,
}: {
  view: InquestView;
  content: Content;
  act: Act;
  room: GameRoomInfo;
}) {
  const g = view.game!;
  const ev = g.event;
  const [pick, setPick] = useState<number | null>(null);
  if (ev?.kind !== 'ruled-out') return null;
  const me = g.players.find((p) => p.id === view.me?.id);
  const mine = ev.current === me?.id && me;
  const key = g.solution && g.myRole === 'murderer' ? g.solution.clue : null;
  return (
    <Panel
      role="region"
      aria-label="Flip a Clue card"
      className={cn('space-y-2', mine && 'ring-2 ring-amber-500')}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 font-bold">🃏 {content.eventName('ruled-out')}</h3>
        <Countdown
          deadline={ev.deadline}
          clockOffset={room.clockOffset}
          label="to flip"
          atZero="then one is flipped at random"
        />
      </div>
      <ol className="flex flex-wrap gap-1 text-xs">
        {ev.order.map((id, i) => (
          <li
            key={id}
            className={cn(
              'rounded-full px-2 py-0.5 ring-1 ring-stone-300 dark:ring-stone-600',
              i < ev.index && 'line-through opacity-60',
              i === ev.index && 'bg-amber-500 font-bold text-stone-950 ring-amber-600',
            )}
          >
            {id === me?.id ? 'you' : nameOf(view, id)}
          </li>
        ))}
      </ol>
      {mine ? (
        <>
          <p className="text-sm">
            Your turn: flip one of your own Clue cards. It can no longer be the answer.
          </p>
          <div className={cn(HAND, me.clue.length > 4 ? 'grid-cols-5' : 'grid-cols-4')}>
            {me.clue.map((n) => (
              <ArtCard
                key={n}
                deck="clue"
                n={n}
                content={content}
                selected={pick === n}
                key_={key === n}
                ruledOut={me.ruledOut.includes(n)}
                disabled={me.ruledOut.includes(n) || key === n}
                onTap={() => setPick(n)}
              />
            ))}
          </div>
          <Button
            className="w-full"
            disabled={pick === null}
            onClick={() =>
              void act({ type: 'rule-out', clue: pick! }, { anchor: 'inquest-flip' }).then(() =>
                setPick(null),
              )
            }
          >
            {pick === null ? 'Tap a Clue card' : `Flip ${content.cardName('clue', pick)}`}
          </Button>
          <RefusalSlot anchor="inquest-flip" />
        </>
      ) : (
        <p className="text-sm">
          Everyone flips one of their own Clue cards. Now: <b>{nameOf(view, ev.current)}</b>.
        </p>
      )}
    </Panel>
  );
}

/** The Reversal: the culprits name the Witness; they see each other's taps. */
export function ReversalPanel({
  view,
  act,
  room,
}: {
  view: InquestView;
  act: Act;
  room: GameRoomInfo;
}) {
  const g = view.game!;
  const r = g.reversal;
  if (g.stage !== 'reversal' || !r) return null;
  const culprit = g.myRole === 'murderer' || g.myRole === 'accomplice';
  const candidates = g.players.filter(
    (p) => !p.isFs && !p.formerFs && p.id !== view.me?.id && p.id !== g.partner,
  );
  return (
    <Panel role="region" aria-label="The Reversal" className="space-y-2 ring-2 ring-rose-500">
      <div className="flex items-start justify-between gap-2">
        <h3 className="shrink-0 font-bold whitespace-nowrap">⚖️ The Reversal</h3>
        <Countdown
          deadline={r.deadline}
          clockOffset={room.clockOffset}
          label="to name the Witness"
          atZero="then the Murderer’s tap counts"
        />
      </div>
      {culprit ? (
        <>
          <p className="text-sm">
            {g.myRole === 'murderer'
              ? 'Tap who you think the Witness is, then confirm. Your choice is final.'
              : 'Tap who you think the Witness is: the Murderer sees your tap and decides.'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {candidates.map((p) => {
              const mineTap = g.myRole === 'murderer' ? r.murdererTap : r.accompliceTap;
              const theirs = g.myRole === 'murderer' ? r.accompliceTap : r.murdererTap;
              return (
                <Button
                  key={p.id}
                  variant={mineTap === p.id ? 'primary' : 'secondary'}
                  className="min-h-12"
                  onClick={() =>
                    void act({ type: 'reversal-tap', target: p.id }, { anchor: 'inquest-reversal' })
                  }
                >
                  {p.name}
                  {theirs === p.id && <span className="text-xs">👈 {nameOf(view, g.partner)}</span>}
                </Button>
              );
            })}
          </div>
          {g.myRole === 'murderer' && (
            <Button
              variant="red"
              size="lg"
              className="w-full"
              disabled={!r.murdererTap}
              onClick={() => void act({ type: 'reversal-confirm' }, { anchor: 'inquest-reversal' })}
            >
              {r.murdererTap
                ? `Final answer: ${nameOf(view, r.murdererTap)}`
                : 'Tap a player first'}
            </Button>
          )}
          <RefusalSlot anchor="inquest-reversal" />
        </>
      ) : (
        <p className="text-sm">
          The crime is solved, but the culprits get one last chance: if they find the Witness, they
          win after all. Stay calm…
        </p>
      )}
    </Panel>
  );
}

/** The end: who won, the answer, roles, the bullet timeline and every attempt. */
export function OverScreen({
  view,
  content,
  room,
  act,
}: {
  view: InquestView;
  content: Content;
  room: GameRoomInfo;
  act: Act;
}) {
  const g = view.game!;
  const r = g.result!;
  const s = g.solution;
  const roles = g.roles ?? {};
  const order: RoleId[] = ['forensic', 'murderer', 'accomplice', 'witness', 'investigator'];
  const ranked = [...g.players].sort(
    (a, b) => order.indexOf(roles[a.id]!) - order.indexOf(roles[b.id]!),
  );
  return (
    <div className="space-y-3">
      <Panel
        className={cn(
          'space-y-2 text-center',
          r.winner === 'investigators' ? 'ring-2 ring-emerald-500' : 'ring-2 ring-rose-500',
        )}
      >
        <p className="text-3xl">{r.winner === 'investigators' ? '🕵️' : '🩸'}</p>
        <p className="font-semibold">{resultLine(view)}</p>
        {s && (
          <div className="mx-auto flex max-w-xs items-center justify-center gap-3">
            <div className="w-28">
              <ArtCard deck="clue" n={s.clue} content={content} key_ />
            </div>
            <div className="w-28">
              <ArtCard deck="means" n={s.means} content={content} key_ />
            </div>
          </div>
        )}
        {s && (
          <p className="text-sm">
            The Murderer was <b>{nameOf(view, s.murderer)}</b>.
          </p>
        )}
      </Panel>
      <Superlatives lines={room.superlatives} />
      <Panel className="space-y-1">
        <h3 className="text-sm font-bold">Who was who</h3>
        <ul className="grid grid-cols-2 gap-1 text-sm">
          {ranked.map((p) => (
            <li key={p.id} className={cn(r.winners.includes(p.id) && 'font-semibold')}>
              <PlayerTag name={p.name} you={p.id === view.me?.id} /> ·{' '}
              {content.roleName(roles[p.id]!)}
              {p.formerFs || (p.isFs && roles[p.id] !== 'forensic') ? ' (took over as FS)' : ''}
              {r.winners.includes(p.id) ? ' 🏆' : ''}
            </li>
          ))}
        </ul>
      </Panel>
      <Attempts view={view} content={content} />
      {g.final && (
        <Panel className="space-y-1">
          <h3 className="text-sm font-bold">Final accusations</h3>
          <FinalList view={view} content={content} />
        </Panel>
      )}
      <Panel className="space-y-1">
        <h3 className="text-sm font-bold">How the bullets fell</h3>
        <Timeline g={g} content={content} full />
      </Panel>
      {room.isHost ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            size="lg"
            className="sm:flex-1"
            onClick={() => void act({ type: 'play-again' }, { anchor: 'inquest-again' })}
          >
            Play again (same settings)
          </Button>
          <Button variant="secondary" size="lg" onClick={() => void act({ type: 'back-to-lobby' })}>
            Back to the lobby
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-stone-500">The host can start another case.</p>
      )}
      <RefusalSlot anchor="inquest-again" />
    </div>
  );
}
