import { Button, RefusalSlot, cn } from '@vt/ui';
import { useEffect, useState } from 'react';
import { chancellorDiscard } from '../logic/claims.ts';
import type {
  Claim,
  ClaimNeed,
  HydraAction,
  HydraView,
  Memory,
  Policy,
  Round,
  Team,
} from '../logic/types.ts';
import type { Content } from './assets.ts';
import {
  FlipCard,
  PartyBack,
  PartyFace,
  Pips,
  PipsLegend,
  TEAM_TEXT,
  bluesCards,
  cardsText,
} from './Cards.tsx';
import { nameOf } from './status.ts';

type Act = (a: HydraAction, o?: { anchor?: string }) => Promise<boolean>;

/** Every draw a President can claim, with each colour they could have discarded from it. */
const PRESIDENT_CLAIMS: readonly (readonly [number, Policy])[] = [
  [0, 'red'],
  [1, 'blue'],
  [1, 'red'],
  [2, 'blue'],
  [2, 'red'],
  [3, 'blue'],
];

/** What the viewer privately saw that this claim is about (their own memory), if any. */
function seen(view: HydraView, need: ClaimNeed): Memory | undefined {
  const g = view.game!;
  const round = g.rounds.at(-1)?.n;
  return [...g.memories]
    .reverse()
    .find(
      (m) =>
        m.round === round &&
        (need.kind === 'investigate'
          ? m.kind === 'investigate'
          : need.kind === 'peek'
            ? m.kind === 'peek'
            : m.kind === 'hand' && m.as === need.kind),
    );
}

/** The investigated party card, flipping over once. */
function PartyReveal({ team, c }: { team: Team; c: Content }) {
  const [up, setUp] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setUp(true), 350);
    return () => {
      window.clearTimeout(t);
    };
  }, []);
  return (
    <div className="mx-auto mt-2 w-28">
      <FlipCard up={up} front={<PartyFace team={team} c={c} />} back={<PartyBack c={c} />} />
    </div>
  );
}

/** The claim form: pick what you say you saw, then confirm (claims are final). */
export function ClaimForm({
  view,
  c,
  need,
  act,
}: {
  view: HydraView;
  c: Content;
  need: ClaimNeed;
  act: Act;
}) {
  const [blues, setBlues] = useState<number | null>(null);
  const [discarded, setDiscarded] = useState<Policy | null>(null);
  const [cards, setCards] = useState<(Policy | null)[]>([null, null, null]);
  const [team, setTeam] = useState<Team | null>(null);
  const [sure, setSure] = useState(false);
  const memory = seen(view, need);
  const n = need.kind === 'president' ? 3 : 2;
  const ready =
    need.kind === 'peek'
      ? cards.every((x) => x !== null)
      : need.kind === 'investigate'
        ? team !== null
        : need.kind === 'president'
          ? blues !== null && discarded !== null
          : blues !== null;
  const send = () => {
    const action: HydraAction =
      need.kind === 'peek'
        ? { type: 'claim', cards: cards as Policy[] }
        : need.kind === 'investigate'
          ? { type: 'claim', team: team! }
          : need.kind === 'president'
            ? { type: 'claim', blues: blues!, discarded: discarded! }
            : { type: 'claim', blues: blues! };
    void act(action, { anchor: 'claim' });
  };
  const summary =
    need.kind === 'peek' && ready ? (
      <Pips cards={cards as Policy[]} c={c} size="md" text="order" />
    ) : need.kind === 'investigate' && team ? (
      <b>{c.teamName(team)}</b>
    ) : need.kind === 'president' && blues !== null && discarded ? (
      <span>
        <Pips cards={bluesCards(blues, n)} c={c} size="md" text="counts" />, discarded{' '}
        <Pips cards={[discarded]} c={c} size="md" text="order" />
      </span>
    ) : blues !== null ? (
      <Pips cards={bluesCards(blues, n)} c={c} size="md" text="counts" />
    ) : null;
  return (
    <div className="space-y-4" data-testid="claim-form">
      {need.kind !== 'investigate' && <PipsLegend c={c} />}
      {memory && (
        <div className="rounded-xl bg-stone-100 p-3 text-sm dark:bg-stone-800">
          <p className="font-semibold">Only you know what you really saw:</p>
          <p className="mt-1 flex items-center gap-2">
            {memory.kind === 'hand' && (
              <>
                {memory.as === 'president' ? 'You drew' : 'You got'}{' '}
                <Pips cards={[...memory.cards].sort().reverse()} c={c} size="md" text="counts" />
              </>
            )}
            {memory.kind === 'peek' && (
              <>
                The top three, in order: <Pips cards={memory.cards} c={c} size="md" text="order" />
              </>
            )}
            {memory.kind === 'investigate' && (
              <>
                {c.t(`${nameOf(view, memory.target)}’s {party} card is`)}{' '}
                <b>{c.teamName(memory.team)}</b>
              </>
            )}
          </p>
          {memory.kind === 'investigate' && <PartyReveal team={memory.team} c={c} />}
        </div>
      )}
      {need.kind === 'president' && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            Say the three cards you drew, and the one you discarded
          </legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {PRESIDENT_CLAIMS.map(([b, d]) => {
              const on = blues === b && discarded === d;
              return (
                <button
                  key={`${b}${d}`}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${n - b} ${c.policyName('red')}, ${b} ${c.policyName('blue')}, discarded ${c.policyName(d)}`}
                  onClick={() => {
                    setBlues(b);
                    setDiscarded(d);
                    setSure(false);
                  }}
                  className={cn(
                    'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 ring-1 transition',
                    on
                      ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/15'
                      : 'bg-white ring-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:ring-stone-600',
                  )}
                >
                  <Pips cards={bluesCards(b, n)} c={c} size="md" />
                  <span className="text-[0.7rem] leading-tight font-semibold text-stone-800 dark:text-stone-200">
                    {cardsText(c, bluesCards(b, n))}
                  </span>
                  <span className="flex items-center gap-1 text-[0.65rem] text-stone-600 dark:text-stone-400">
                    discarded <Pips cards={[d]} c={c} />
                    <span className={TEAM_TEXT[d]}>{c.policyName(d)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </fieldset>
      )}
      {need.kind === 'chancellor' && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Say the two cards you were handed</legend>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: n + 1 }, (_, b) => (
              <button
                key={b}
                type="button"
                aria-pressed={blues === b}
                aria-label={`${n - b} ${c.policyName('red')}, ${b} ${c.policyName('blue')}`}
                onClick={() => {
                  setBlues(b);
                  setSure(false);
                }}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 ring-1 transition',
                  blues === b
                    ? 'bg-amber-50 ring-2 ring-amber-500 dark:bg-amber-500/15'
                    : 'bg-white ring-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:ring-stone-600',
                )}
              >
                <Pips cards={bluesCards(b, n)} c={c} size="md" />
                <span className="text-[0.7rem] leading-tight font-semibold text-stone-800 dark:text-stone-200">
                  {cardsText(c, bluesCards(b, n))}
                </span>
              </button>
            ))}
          </div>
        </fieldset>
      )}
      {need.kind === 'peek' && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">Say the top three cards, top first</legend>
          <div className="grid grid-cols-3 gap-2">
            {cards.map((x, i) => (
              <div key={i} className="space-y-1 text-center">
                <span className="text-xs text-stone-500">
                  {i === 0 ? 'Top' : i === 1 ? '2nd' : '3rd'}
                </span>
                {(['blue', 'red'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={x === p}
                    aria-label={`Card ${i + 1}: ${c.policyName(p)}`}
                    onClick={() => {
                      setCards(cards.map((y, k) => (k === i ? p : y)));
                      setSure(false);
                    }}
                    className={cn(
                      'block w-full rounded-lg py-2 text-xs font-bold ring-1',
                      x === p
                        ? p === 'blue'
                          ? 'bg-sky-600 text-white ring-sky-800'
                          : 'bg-red-600 text-white ring-red-800'
                        : 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600',
                    )}
                  >
                    {c.policyName(p)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
      )}
      {need.kind === 'investigate' && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">
            {c.t(`Say what ${nameOf(view, need.target)}’s {party} card showed`)}
          </legend>
          <div className="mx-auto grid max-w-xs grid-cols-2 gap-3">
            {(['blue', 'red'] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={team === p}
                aria-label={`Claim ${c.teamName(p)}`}
                onClick={() => {
                  setTeam(p);
                  setSure(false);
                }}
                className={cn(
                  'rounded-xl p-1 transition',
                  team === p ? 'ring-4 ring-amber-400' : 'opacity-80',
                )}
              >
                <PartyFace team={p} c={c} />
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <div className="space-y-2">
        {!sure ? (
          <Button size="lg" className="w-full" disabled={!ready} onClick={() => setSure(true)}>
            Make this claim
          </Button>
        ) : (
          <div className="hy-rise space-y-2 rounded-xl bg-amber-50 p-3 ring-1 ring-amber-300 dark:bg-amber-500/10">
            <p className="text-center text-sm leading-7 font-semibold">
              Claim {summary}? Claims are final.
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => setSure(false)}>
                Change
              </Button>
              <Button className="flex-1" onClick={send}>
                Confirm claim
              </Button>
            </div>
          </div>
        )}
        <RefusalSlot anchor="claim" />
        <p className="text-center text-xs text-stone-500">
          Anyone may lie. Everyone sees your claim at once.
        </p>
      </div>
    </div>
  );
}

/** A card's colour named in its colour: "Red". */
function Colour({ p, c }: { p: Policy; c: Content }) {
  return <b className={TEAM_TEXT[p]}>{c.policyName(p)}</b>;
}

/**
 * One claim as the log shows it: "Ana (President) drew 🟥🟥🟦, discarded Red". Given the round,
 * a Chancellor's discard is worked out from the enacted policy.
 */
export function ClaimLine({
  view,
  c,
  claim,
  round,
}: {
  view: HydraView;
  c: Content;
  claim: Claim;
  round?: Round;
}) {
  const role = claim.kind === 'chancellor' ? c.names.chancellor : c.names.president;
  const derived = round && chancellorDiscard(claim, round);
  return (
    <span>
      <b>{nameOf(view, claim.by)}</b> <span className="text-stone-500">({role})</span>{' '}
      {claim.skipped ? (
        <span className="text-stone-500 italic">
          (no claim, {claim.skipped === 'host' ? 'skipped by host' : 'left the game'})
        </span>
      ) : claim.kind === 'investigate' ? (
        <>
          says {nameOf(view, claim.target)} is{' '}
          <b className={TEAM_TEXT[claim.team!]}>{c.teamName(claim.team!)}</b>
        </>
      ) : claim.kind === 'peek' ? (
        <>
          peeked <Pips cards={claim.cards!} c={c} text="order" />
        </>
      ) : claim.kind === 'president' ? (
        <>
          drew <Pips cards={bluesCards(claim.blues!, 3)} c={c} text="counts" />
          {claim.discarded && (
            <>
              ,{' '}
              <span className="whitespace-nowrap">
                discarded <Colour p={claim.discarded} c={c} />
              </span>
            </>
          )}
        </>
      ) : (
        <>
          got <Pips cards={bluesCards(claim.blues!, 2)} c={c} text="counts" />
          {derived && (
            <span className="whitespace-nowrap text-stone-500">
              {' '}
              → discarded 1 <Colour p={derived} c={c} />
            </span>
          )}
        </>
      )}
    </span>
  );
}
