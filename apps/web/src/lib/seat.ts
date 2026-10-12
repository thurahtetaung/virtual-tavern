import { playerToken } from '@vt/protocol';

/**
 * Playtest seats: in an admin playtest, each browser tab plays a different seat. A seat link
 * (`/r/<room>#seat=<token>&as=<name>`) carries the seat's secret in the URL fragment, which
 * browsers never send to a server, and the tab keeps it in sessionStorage (per tab, and kept on
 * refresh) under the room's id only. With no seat stored, which is every normal room and every
 * normal visitor, the room uses the browser's own `playerToken()` exactly as before.
 */
export interface Seat {
  token: string;
  name: string;
}

const KEY = 'vt.seat.';

function parse(raw: string | null): Seat | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Seat> | null;
    return v && typeof v.token === 'string' && playerToken.safeParse(v.token).success
      ? { token: v.token, name: typeof v.name === 'string' && v.name.trim() ? v.name : 'Seat' }
      : null;
  } catch {
    return null;
  }
}

/** The seat link for one seat of a playtest. */
export const seatLink = (roomId: string, seat: Seat) =>
  `/r/${roomId}#${new URLSearchParams({ seat: seat.token, as: seat.name }).toString()}`;

/**
 * Takes a seat link's fragment off the address bar (always, so the secret never lingers in
 * history or gets copied along) and keeps a valid seat for this room in this tab. Whether the
 * seat is honoured is decided later, by `confirmSeat`, once the server says the room is a
 * playtest.
 */
export function adoptSeat(roomId: string): void {
  const hash = window.location.hash;
  if (!hash.startsWith('#')) return;
  const params = new URLSearchParams(hash.slice(1));
  const token = params.get('seat');
  if (token === null) return;
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
  if (!playerToken.safeParse(token).success) return;
  const name = params.get('as')?.trim().slice(0, 24) || 'Seat';
  try {
    sessionStorage.setItem(KEY + roomId, JSON.stringify({ token, name } satisfies Seat));
  } catch {
    // Storage blocked: the seat can't be kept, and the tab plays as the browser's own player.
  }
}

/** This tab's seat in `roomId`, if it has one (never another room's). */
export function seatFor(roomId: string): Seat | null {
  try {
    return parse(sessionStorage.getItem(KEY + roomId));
  } catch {
    return null;
  }
}

/** Forgets this tab's seat in `roomId` (the playtest ended, or it was never one). */
export function clearSeat(roomId: string): void {
  try {
    sessionStorage.removeItem(KEY + roomId);
  } catch {
    // Nothing stored anyway.
  }
}

/**
 * The seat to play once the room is known: only a playtest honours one. Anywhere else a stored
 * seat (a crafted link, say) is wiped, and the tab is the browser's own player as usual.
 */
export function confirmSeat(roomId: string, playtest: boolean): Seat | null {
  if (!playtest) {
    clearSeat(roomId);
    return null;
  }
  return seatFor(roomId);
}
