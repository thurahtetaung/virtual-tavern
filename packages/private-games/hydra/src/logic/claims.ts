import { countBlue } from './deck.ts';
import type { Claim, Policy, Round, Truth } from './types.ts';

/**
 * Claims that public information shows can't all be true: what the government said against what
 * it enacted and against each other, and a peek against the next draw. Never uses anything secret.
 */
export type FlagKind =
  | 'government-mismatch'
  | 'passed-mismatch'
  | 'chancellor-vs-enacted'
  | 'president-vs-enacted'
  | 'peek-mismatch';

export interface Flag {
  round: number;
  kind: FlagKind;
  /** The claims involved (by player). */
  who: string[];
  /** `passed-mismatch`: the blue cards the President says they passed, and the Chancellor got. */
  passed?: number;
  received?: number;
}

/** The blue cards the President says they passed on (their 3 minus their discard), if stated. */
export function passedBlues(claim: Claim | undefined): number | undefined {
  if (claim?.blues === undefined || !claim.discarded) return undefined;
  return claim.blues - (claim.discarded === 'blue' ? 1 : 0);
}

/**
 * The card the Chancellor discarded, worked out from their claim and the enacted policy (public).
 * Undefined after a veto, without a claim, or when the claim can't have left that policy.
 */
export function chancellorDiscard(claim: Claim, round: Round): Policy | undefined {
  const e = round.session?.enacted;
  if (claim.kind !== 'chancellor' || claim.blues === undefined || !e || round.session?.vetoed)
    return undefined;
  // The blue cards left after the enacted one: 0 or 1, or the claim can't be true.
  const left = claim.blues - (e === 'blue' ? 1 : 0);
  if (left < 0 || left > 1) return undefined;
  return left ? 'blue' : 'red';
}

const claimOf = (r: Round, kind: Claim['kind']) =>
  r.claims.find((c) => c.kind === kind && !c.skipped);

export function claimFlags(rounds: readonly Round[]): Flag[] {
  const flags: Flag[] = [];
  rounds.forEach((r, i) => {
    const p = claimOf(r, 'president');
    const c = claimOf(r, 'chancellor');
    const e = r.session?.enacted ?? null;
    if (p?.blues !== undefined && c?.blues !== undefined) {
      // Discarding one of three leaves P or P - 1 blue cards (at most 2).
      const passed = passedBlues(p);
      if (c.blues > Math.min(p.blues, 2) || c.blues < p.blues - 1)
        flags.push({ round: r.n, kind: 'government-mismatch', who: [p.by, c.by] });
      else if (passed !== undefined && passed !== c.blues)
        flags.push({
          round: r.n,
          kind: 'passed-mismatch',
          who: [p.by, c.by],
          passed,
          received: c.blues,
        });
    }
    if (c?.blues !== undefined && e) {
      if ((e === 'blue' && c.blues === 0) || (e === 'red' && c.blues === 2))
        flags.push({ round: r.n, kind: 'chancellor-vs-enacted', who: [c.by] });
    }
    if (p?.blues !== undefined && e) {
      // With a stated discard, judge the two cards they say they passed on.
      const passed = passedBlues(p);
      if (
        passed !== undefined
          ? (e === 'blue' && passed === 0) || (e === 'red' && passed === 2)
          : (e === 'blue' && p.blues === 0) || (e === 'red' && p.blues === 3)
      )
        flags.push({ round: r.n, kind: 'president-vs-enacted', who: [p.by] });
    }
    // A peek shows the next draw, unless the people enact the top card first.
    const peek = claimOf(r, 'peek');
    if (peek?.cards) {
      for (const later of rounds.slice(i + 1)) {
        if (later.chaos) break;
        if (!later.session) continue;
        const next = claimOf(later, 'president');
        if (next?.blues !== undefined && next.blues !== countBlue(peek.cards))
          flags.push({ round: later.n, kind: 'peek-mismatch', who: [peek.by, next.by] });
        break;
      }
    }
  });
  return flags;
}

/** Whether a claim was a lie, against the truth (only known at the end). Null: no claim to judge. */
export function claimLied(claim: Claim, truth: Truth | undefined): boolean | null {
  if (claim.skipped || !truth) return null;
  switch (claim.kind) {
    case 'president': {
      const parts = presidentLies(claim, truth);
      return parts && parts.length > 0;
    }
    case 'chancellor':
      return truth.chancellorHand && claim.blues !== undefined
        ? claim.blues !== countBlue(truth.chancellorHand)
        : null;
    case 'peek':
      return truth.peek && claim.cards ? !sameCards(claim.cards, truth.peek) : null;
    case 'investigate':
      return truth.investigate && claim.team ? claim.team !== truth.investigate.team : null;
  }
}

/**
 * Which parts of a President's claim were false: the draw, the discard, both or neither. Claims
 * from before discards were stated only judge the draw. Null: nothing to judge.
 */
export function presidentLies(
  claim: Claim,
  truth: Truth | undefined,
): ('draw' | 'discard')[] | null {
  if (claim.kind !== 'president' || claim.skipped || !truth?.drawn || claim.blues === undefined)
    return null;
  const parts: ('draw' | 'discard')[] = [];
  if (claim.blues !== countBlue(truth.drawn)) parts.push('draw');
  if (claim.discarded && truth.presidentDiscard && claim.discarded !== truth.presidentDiscard)
    parts.push('discard');
  return parts;
}

const sameCards = (a: readonly Policy[], b: readonly Policy[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
