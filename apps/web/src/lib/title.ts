/** The tab title for a room: marked when the viewer is expected to act, so a background tab stands out. */
export function roomTitle(gameName: string, yourMove: boolean): string {
  const title = `${gameName} · Virtual Tavern`;
  return yourMove ? `● Your turn · ${title}` : title;
}
