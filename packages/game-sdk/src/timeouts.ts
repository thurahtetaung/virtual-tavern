/**
 * The shared wording for something the timer did on a player's behalf, e.g.
 * `timedOut('a word was picked for you')` → "⏱ Time ran out: a word was picked for you". Games add it
 * to the log or result line their `onDeadline` produces, so nobody wonders what just happened.
 */
export function timedOut(what: string): string {
  return `⏱ Time ran out: ${what}`;
}
