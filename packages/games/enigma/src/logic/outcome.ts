import { MAX_ROUNDS, TOKENS_TO_END, type Team } from './types.ts';

/** Each team's tokens: all the end-of-round check needs, so the UI can run it on a view too. */
export type Tallies = Record<Team, { intercepts: number; misses: number }>;

const LABEL: Record<Team, string> = { red: 'Red', blue: 'Blue' };
const other = (t: Team): Team => (t === 'red' ? 'blue' : 'red');
const qualifies = (tallies: Tallies, t: Team) =>
  tallies[t].intercepts >= TOKENS_TO_END || tallies[other(t)].misses >= TOKENS_TO_END;
const score = (tallies: Tallies, t: Team) => tallies[t].intercepts - tallies[t].misses;

/** End-of-round check: 2 interceptions win, 2 miscommunications lose; score settles ties and round 8. */
export function winnerFrom(tallies: Tallies, round: number): Team | 'draw' | null {
  const red = qualifies(tallies, 'red');
  const blue = qualifies(tallies, 'blue');
  if (red !== blue) return red ? 'red' : 'blue';
  if (!red && round < MAX_ROUNDS) return null;
  const diff = score(tallies, 'red') - score(tallies, 'blue');
  return diff > 0 ? 'red' : diff < 0 ? 'blue' : 'draw';
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** One sentence saying why the game ended the way it did, or null while it's still undecided. */
export function winReason(tallies: Tallies, round: number): string | null {
  const winner = winnerFrom(tallies, round);
  if (!winner) return null;
  if (winner !== 'draw' && !qualifies(tallies, other(winner))) {
    const loser = other(winner);
    const intercepted = tallies[winner].intercepts >= TOKENS_TO_END;
    const missed = tallies[loser].misses >= TOKENS_TO_END;
    if (intercepted && missed) {
      return `${LABEL[winner]} intercepted ${TOKENS_TO_END} codes, and ${LABEL[loser]} had ${TOKENS_TO_END} miscommunications.`;
    }
    return intercepted
      ? `${LABEL[winner]} intercepted ${TOKENS_TO_END} codes.`
      : `${LABEL[loser]} had ${TOKENS_TO_END} miscommunications.`;
  }
  const scores = `Red ${signed(score(tallies, 'red'))}, Blue ${signed(score(tallies, 'blue'))}`;
  const why =
    qualifies(tallies, 'red') && qualifies(tallies, 'blue')
      ? 'Both teams reached 2 tokens at once'
      : `After round ${MAX_ROUNDS} nobody had reached 2 tokens`;
  return winner === 'draw'
    ? `${why}, and the scores (interceptions minus miscommunications) are level: ${scores}.`
    : `${why}, so the score decides (interceptions minus miscommunications): ${scores}.`;
}

/** "1 interception" / "2 miscommunications", for the token tallies on the end screen. */
export function tokenWords(intercepts: number, misses: number): string {
  return `🕵️ ${plural(intercepts, 'interception')} · 💥 ${plural(misses, 'miscommunication')}`;
}
