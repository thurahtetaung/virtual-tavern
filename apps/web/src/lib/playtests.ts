import type { PlaytestCreated } from '@vt/protocol';

/**
 * The admin's running playtests and their seat links, kept in this browser only so a closed seat
 * tab can be reopened from the Playtest tab. Storage can be missing or blocked; then the list
 * lasts as long as the page.
 */
export interface SavedPlaytest extends PlaytestCreated {
  /** The game's name when it was started. */
  gameName: string;
  startedAt: number;
}

const KEY = 'vt.playtests';
/** Older entries are dropped: the server sweeps idle playtests anyway. */
const MAX = 12;

let memory: SavedPlaytest[] = [];

const valid = (p: unknown): p is SavedPlaytest => {
  const v = p as Partial<SavedPlaytest> | null;
  return (
    !!v &&
    typeof v.roomId === 'string' &&
    typeof v.gameId === 'string' &&
    typeof v.gameName === 'string' &&
    typeof v.startedAt === 'number' &&
    Array.isArray(v.seats) &&
    v.seats.every(
      (s) =>
        typeof s?.name === 'string' &&
        typeof s.playerId === 'string' &&
        typeof s.token === 'string',
    )
  );
};

export function savedPlaytests(): SavedPlaytest[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter(valid) : [];
  } catch {
    return memory;
  }
}

function write(list: SavedPlaytest[]) {
  memory = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: kept in memory for this page.
  }
}

/** Remembers a new playtest, newest first. */
export function savePlaytest(p: SavedPlaytest): SavedPlaytest[] {
  const list = [p, ...savedPlaytests().filter((x) => x.roomId !== p.roomId)].slice(0, MAX);
  write(list);
  return list;
}

/** Forgets a playtest (it ended, or the server no longer has it). */
export function forgetPlaytest(roomId: string): SavedPlaytest[] {
  const list = savedPlaytests().filter((x) => x.roomId !== roomId);
  write(list);
  return list;
}
