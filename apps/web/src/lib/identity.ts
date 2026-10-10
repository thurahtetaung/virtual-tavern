const TOKEN_KEY = 'vt.playerToken';
const NAME_KEY = 'vt.playerName';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: identity lasts for this tab only.
  }
}

let memoryToken: string | null = null;

/** Secret per-browser token; lets you rejoin your seat after a refresh. */
export function playerToken(): string {
  const existing = read(TOKEN_KEY) ?? memoryToken;
  if (existing) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  memoryToken = token;
  write(TOKEN_KEY, token);
  return token;
}

export const savedName = () => read(NAME_KEY)?.trim() || '';
export const saveName = (name: string) => write(NAME_KEY, name.trim());

const LAST_ROOM_KEY = 'vt.lastRoom';

export interface LastRoom {
  id: string;
  /** The game's display name, for "Rejoin your Codenames room". */
  game: string;
}

/** The room this browser most recently sat in, so the landing page can offer a way back. */
export function lastRoom(): LastRoom | null {
  const raw = read(LAST_ROOM_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastRoom> | null;
    return parsed && typeof parsed.id === 'string' && typeof parsed.game === 'string'
      ? { id: parsed.id, game: parsed.game }
      : null;
  } catch {
    return null;
  }
}

export const saveLastRoom = (room: LastRoom) => write(LAST_ROOM_KEY, JSON.stringify(room));

/** Forgets the last room; with `id`, only if that is the one stored. */
export function forgetLastRoom(id?: string) {
  if (id !== undefined && lastRoom()?.id !== id) return;
  try {
    localStorage.removeItem(LAST_ROOM_KEY);
  } catch {
    // Nothing stored anyway.
  }
}
