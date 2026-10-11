import type { RecapLine, RoomRecap } from '@vt/protocol';
import { type Labeler, resolveSegments } from './resolve.ts';

/** Most lines "Copy for chat" produces. */
export const MAX_CHAT_LINES = 15;

/** "Sat 11 Oct". */
export const nightDate = (ts: number) =>
  new Date(ts).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });

/** "1h 52m", "25m", "under a minute". */
export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}

/** Total time spent playing (games only, not the breaks between them). */
export const playedMs = (recap: RoomRecap) => recap.games.reduce((sum, g) => sum + g.durationMs, 0);

/**
 * The night as plain text for a group chat: names in **bold** and the moment of the night behind
 * a `||spoiler||`, which chat apps that know the markup reveal on a tap. No links, at most 15 lines.
 */
export function chatText(
  recap: RoomRecap,
  opts: {
    game: { name: string; icon: string };
    names: ReadonlyMap<string, string>;
    labels: Labeler | null;
    spoiler?: boolean;
  },
): string {
  const bold = (text: string) =>
    resolveSegments(text, opts.names, opts.labels)
      .map((s) => (s.name ? `**${s.text}**` : s.text))
      .join('');
  const line = (l: RecapLine) => `${l.emoji} ${l.title}: ${bold(l.text)}`;
  const out = [
    `🍻 Tavern night · ${nightDate(recap.startedAt)} · ${duration(playedMs(recap))}`,
    `${opts.game.icon} ${opts.game.name} ×${recap.games.length}`,
    '',
  ];
  if (recap.moment) {
    const text = `${recap.moment.emoji} ${bold(recap.moment.text)}`;
    out.push(opts.spoiler === false ? text : `🎬 ||${text}||`);
  }
  if (recap.mvp) out.push(line(recap.mvp));
  const room = MAX_CHAT_LINES - out.length - (recap.nuggets.length ? 1 : 0);
  for (const a of recap.awards.slice(0, Math.max(0, room))) out.push(line(a));
  if (recap.nuggets.length) out.push(`🔢 ${recap.nuggets.map((n) => bold(n.text)).join(' · ')}`);
  return out.slice(0, MAX_CHAT_LINES).join('\n');
}
