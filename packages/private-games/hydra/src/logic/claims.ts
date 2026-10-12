import { countBlue } from './deck.ts';
import type { Claim, Policy, Round, Truth } from './types.ts';

/**
 * Claims that public information shows can't all be true: what the government said against what
 * it enacted and against each other, and a peek against the next draw. Never uses anything secret.
 */
export type FlagKind =
  'government-mismatch' | 'chancellor-vs-enacted' | 'president-vs-enacted' | 'peek-mismatch';

export interface Flag {
  round: number;
  kind: FlagKind;
  /** The claims involved (by player). */
  who: string[];
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
      if (c.blues > Math.min(p.blues, 2) || c.blues < p.blues - 1)
        flags.push({ round: r.n, kind: 'government-mismatch', who: [p.by, c.by] });
    }
    if (c?.blues !== undefined && e) {
      if ((e === 'blue' && c.blues === 0) || (e === 'red' && c.blues === 2))
        flags.push({ round: r.n, kind: 'chancellor-vs-enacted', who: [c.by] });
    }
    if (p?.blues !== undefined && e) {
      if ((e === 'blue' && p.blues === 0) || (e === 'red' && p.blues === 3))
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
    case 'president':
      return truth.drawn && claim.blues !== undefined
        ? claim.blues !== countBlue(truth.drawn)
        : null;
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

const sameCards = (a: readonly Policy[], b: readonly Policy[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
