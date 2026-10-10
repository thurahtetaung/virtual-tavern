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
