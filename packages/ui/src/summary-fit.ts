/** One item of a guests' settings summary; falsy items (settings that are off) are left out. */
export type SummaryPart = string | false | null | undefined;

/** The summary with its first `shown` parts, the rest counted ("+2 more"). */
export function summaryText(parts: readonly string[], shown = parts.length): string {
  const rest = parts.length - shown;
  return [...parts.slice(0, shown), ...(rest > 0 ? [`+${rest} more`] : [])].join(' · ');
}

/**
 * How many parts, from the first, the summary can show while `fits` (two lines on this screen),
 * counting the rest. Never fewer than one: the first part is the one a guest needs most.
 */
export function fitSummary(parts: readonly string[], fits: (text: string) => boolean): number {
  for (let shown = parts.length; shown > 1; shown--) {
    if (fits(summaryText(parts, shown))) return shown;
  }
  return Math.min(1, parts.length);
}
