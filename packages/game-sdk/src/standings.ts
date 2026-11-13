import { listNames } from './people.ts';

export interface Placed<T> {
  /** 1-based; players who tie share a place, and the next place skips ("1, 1, 3"). */
  place: number;
  /** Whether someone else has the same place. */
  tied: boolean;
  entry: T;
}

/**
 * Final standings, best first. Equal scores share a place (standard competition ranking), and
 * the input order breaks no ties: tied entries keep their original order but the same place.
 */
export function rankStandings<T>(
  entries: readonly T[],
  score: (entry: T) => number,
  { lowerIsBetter = false }: { lowerIsBetter?: boolean } = {},
): Placed<T>[] {
  const sorted = entries
    .map((entry, i) => ({ entry, i, s: score(entry) }))
    .sort((a, b) => (lowerIsBetter ? a.s - b.s : b.s - a.s) || a.i - b.i);
  const places = sorted.map(({ s }) => sorted.findIndex((x) => x.s === s) + 1);
  return sorted.map(({ entry }, i) => ({
    place: places[i]!,
    tied: places.filter((p) => p === places[i]).length > 1,
    entry,
  }));
}

/** "Ana wins!", "Ana and Ben share the win!", or '' when nobody placed. */
export function winnersLine<T>(standings: readonly Placed<T>[], name: (entry: T) => string) {
  const winners = standings.filter((s) => s.place === 1).map((s) => name(s.entry));
  if (winners.length === 0) return '';
  return winners.length === 1 ? `${winners[0]} wins!` : `${listNames(winners)} share the win!`;
}

/**
 * An end screen's title from final points: "Ana wins!", "You win!", "Ana and Ben share the win!",
 * or '' when nobody scored. `you` names the viewer "You".
 */
export function winnersTitle(
  entries: readonly { id: string; name: string; score: number }[],
  you?: string | null,
): string {
  const ranked = rankStandings(
    entries.filter((e) => e.score > 0),
    (e) => e.score,
  );
  const line = winnersLine(ranked, (e) => (e.id === you ? 'You' : e.name));
  return line === 'You wins!' ? 'You win!' : line;
}

/** An end screen's title from the game's own winners: "Ana wins!", "You and Ben win!", or ''. */
export function winTitle(
  ids: readonly string[],
  name: (id: string) => string,
  you?: string | null,
): string {
  if (ids.length === 0) return '';
  // The viewer first: "You and Ben win!".
  const names = [...ids]
    .sort((a, b) => Number(b === you) - Number(a === you))
    .map((id) => (id === you ? 'You' : name(id)));
  return `${listNames(names)} ${ids.length > 1 || ids[0] === you ? 'win' : 'wins'}!`;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
}
