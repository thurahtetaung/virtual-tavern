import { COLOUR_NAME, targetLine } from '../logic/tiles.ts';
import type { LogEntry, MosaicView } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The one line that says what is happening and what the viewer should do. */
export function statusFor(view: MosaicView, you: string, name: NameOf): Status {
  const g = view.game;
  const f = (text: string, yourMove = false) => ({ text, yourMove });
  if (!g) return f('');
  const score = (id: string) => g.players.find((p) => p.id === id)?.score ?? 0;
  if (view.phase === 'over') {
    const w = g.winners;
    if (!w.length) return f('The game is over.');
    if (w.length > 1)
      return f(
        `${w.map((id) => (id === you ? 'You' : name(id))).join(' and ')} share the win with ${score(w[0]!)} points!`,
      );
    return w[0] === you
      ? f(`You win with ${score(you)} points!`)
      : f(`${name(w[0])} wins with ${score(w[0]!)} points!`);
  }
  const me = g.players.find((p) => p.id === you && !p.removed);
  if (g.stage === 'tiling')
    return me && !g.ready.includes(you)
      ? f(`Round ${g.round} is over: watch the walls fill, then tap Next round.`)
      : f(`Round ${g.round} is over: the walls are being tiled.`);
  if (g.current === you)
    return f(
      'Your turn: tap a tile to take every tile of its colour from that factory or the centre.',
      true,
    );
  return f(`${name(g.current)}’s turn: they’re choosing tiles.`);
}

/** A log entry as a line, or null for entries not worth a line. */
export function logLine(e: LogEntry, name: NameOf): string | null {
  const t =
    e.auto === 'timer' ? ' ⏱' : e.auto === 'host' ? ' (host)' : e.auto === 'left' ? ' (away)' : '';
  const line = (s: string) => s + t;
  switch (e.kind) {
    case 'start':
      return line(`${name(e.first)} goes first.`);
    case 'take': {
      const from = e.source === 'centre' ? 'the centre' : `factory ${e.source + 1}`;
      const where =
        e.target === 'floor'
          ? 'on the floor'
          : `in ${targetLine(e.target)}${e.toFloor + e.toLid ? `, ${e.toFloor + e.toLid} spilled` : ''}`;
      return line(
        `${name(e.by)} took ${plural(e.count, COLOUR_NAME[e.colour], COLOUR_NAME[e.colour])} from ${from}${e.marker ? ' and the first-player marker' : ''}: ${where}${e.penalty ? ` (${e.penalty})` : ''}.`,
      );
    }
    case 'round':
      return `Round ${e.round}: the walls were tiled.`;
    case 'left':
      return line(`${name(e.player)} left: the table plays their turns.`);
    case 'back':
      return line(`${name(e.player)} is back.`);
    case 'removed':
      return line(`${name(e.player)} was removed: their lines and floor went to the lid.`);
    case 'end':
      return line(
        `${e.how === 'empty' ? 'No tiles were left for another round, so the game ends. ' : e.how === 'alone' ? 'Only one player is left, so the game ends. ' : ''}${e.winners.map(name).join(' and ')} ${e.winners.length > 1 ? 'share the win' : 'wins'}.`,
      );
  }
}
