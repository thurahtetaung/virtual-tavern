/**
 * Per-seat browser storage for game UIs. Every tab of a browser shares localStorage, which suits
 * a player with two tabs open but not an admin playtest, where each tab is a different seat. In
 * a playtest the room shell names the tab's seat, and `storageKey` keeps each seat's marks,
 * notes and tips apart; everywhere else it returns the key unchanged.
 */
let seat: string | null = null;

/** Called by the room shell: the seat this tab plays in a playtest, or null in a normal room. */
export function setStorageSeat(id: string | null): void {
  seat = id;
}

/** `base`, or `base:<seat id>` in a playtest seat tab. Use it for every localStorage key. */
export function storageKey(base: string): string {
  return seat ? `${base}:${seat}` : base;
}
