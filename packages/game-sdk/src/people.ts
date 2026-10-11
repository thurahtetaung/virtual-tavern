/** A room member as the shell reports them; `connected` is false while their browser is away. */
export interface PresencePlayer {
  id: string;
  name: string;
  connected?: boolean;
}

/** "Ana", "Ana and Ben", "Ana, Ben and Cy". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

export interface NameOptions {
  /** The viewer's id: they are called "you". */
  you?: string;
  /** Most names to spell out; the rest become "and 3 more". Default 4. */
  max?: number;
}

/**
 * The named players, each marked "(offline)" while away, e.g. "Ana, Ben (offline) and you".
 * Ids that aren't in `players` (they left) are skipped.
 */
export function namesWithPresence(
  ids: readonly string[],
  players: readonly PresencePlayer[],
  { you, max = 4 }: NameOptions = {},
): string {
  const byId = new Map(players.map((p) => [p.id, p]));
  const labels = ids.flatMap((id) => {
    const p = byId.get(id);
    if (!p) return [];
    if (id === you) return ['you'];
    return [p.connected === false ? `${p.name} (offline)` : p.name];
  });
  // "You" reads best last: "Ana, Ben and you".
  labels.sort((a, b) => Number(a === 'you') - Number(b === 'you'));
  if (labels.length > max) {
    const shown = labels.slice(0, max - 1);
    return `${shown.join(', ')} and ${labels.length - shown.length} more`;
  }
  return listNames(labels);
}

/**
 * "Waiting for: Ana, Ben (offline)", naming who the game is waiting on rather than counting them.
 * Empty when nobody is left to wait for.
 */
export function waitingFor(
  ids: readonly string[],
  players: readonly PresencePlayer[],
  opts: NameOptions = {},
): string {
  const names = namesWithPresence(ids, players, opts);
  return names ? `Waiting for: ${names}` : '';
}

/** Whether any of these players is offline (so the host may want to step in). */
export const anyOffline = (ids: readonly string[], players: readonly PresencePlayer[]) =>
  ids.some((id) => players.find((p) => p.id === id)?.connected === false);

/** The host's name, marked "(offline)" while away. */
export function hostLabel(room: { hostId: string; players: readonly PresencePlayer[] }): string {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host) return 'the host';
  return host.connected === false ? `${host.name} (offline)` : host.name;
}

/** "Waiting for Ana to start…" (or "to deal…", "to continue…"), naming the host. */
export function waitingForHost(
  room: { hostId: string; players: readonly PresencePlayer[] },
  what = 'start',
): string {
  const host = room.players.find((p) => p.id === room.hostId);
  if (!host) return `Waiting for the host to ${what}…`;
  const note = host.connected === false ? 'host, offline' : 'host';
  return `Waiting for ${host.name} (${note}) to ${what}…`;
}
