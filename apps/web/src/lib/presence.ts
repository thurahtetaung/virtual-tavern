/** "away", "away 3 min", "away 2 h": how long since an away player's last connection closed. */
export function awayFor(awaySince: number | undefined, serverNow: number): string {
  if (awaySince === undefined) return 'away';
  const minutes = Math.floor((serverNow - awaySince) / 60_000);
  if (minutes < 1) return 'away';
  if (minutes < 60) return `away ${minutes} min`;
  return `away ${Math.floor(minutes / 60)} h`;
}
