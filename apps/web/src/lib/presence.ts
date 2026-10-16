/**
 * "offline", "offline 3 min", "offline 2 h": how long since an offline player's last connection
 * closed. The same word as `PlayerTag`'s chip in every lobby and seat list.
 */
export function offlineFor(awaySince: number | undefined, serverNow: number): string {
  if (awaySince === undefined) return 'offline';
  const minutes = Math.floor((serverNow - awaySince) / 60_000);
  if (minutes < 1) return 'offline';
  if (minutes < 60) return `offline ${minutes} min`;
  return `offline ${Math.floor(minutes / 60)} h`;
}
