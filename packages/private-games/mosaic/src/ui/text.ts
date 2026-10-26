import { SPECIAL_SHORT } from '../logic/specials.ts';
import { COLOUR_NAME, targetLine, tilesLine } from '../logic/tiles.ts';
import type { LogEntry, MosaicView } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

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
  if (g.stage === 'wall') {
    const row = g.walls?.[you]?.row;
    if (me && row !== null && row !== undefined)
      return f(
        `Round ${g.round}: choose where line ${row + 1}’s tile goes on your wall (tap a lit space).`,
        true,
      );
    const waiting = Object.entries(g.walls ?? {}).flatMap(([id, w]) =>
      w.row === null ? [] : [name(id)],
    );
    return f(
      `Round ${g.round}: ${waiting.join(' and ')} ${waiting.length === 1 ? 'is' : 'are'} choosing where tiles go on their wall.`,
    );
  }
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
      const jokers = e.jokers ?? 0;
      const what =
        e.colour === 'joker'
          ? tilesLine(e.count, 'joker')
          : `${tilesLine(e.count - jokers, e.colour)}${jokers ? ` + ${tilesLine(jokers, 'joker')}` : ''}`;
      const extra = [
        e.sent
          ? `the rest went ${e.sent.left ? `${e.sent.left} left` : ''}${e.sent.left && e.sent.right ? ', ' : ''}${e.sent.right ? `${e.sent.right} right` : ''}`
          : '',
        e.special === 'sf3' && e.leftover ? 'the rest stayed on it' : '',
        e.special === 'sf5' ? 'kept it as a floor shield' : '',
        e.shielded ? 'the shield caught one' : '',
      ].filter(Boolean);
      return line(
        `${name(e.by)} took ${what} from ${from}${e.marker ? ' and the first-player marker' : ''}: ${where}${e.penalty ? ` (${e.penalty})` : ''}${extra.length ? `; ${extra.join('; ')}` : ''}.`,
      );
    }
    case 'wall':
      return line(
        `${name(e.by)} put line ${e.row + 1}’s ${COLOUR_NAME[e.tile]} in column ${e.col + 1}.`,
      );
    case 'specials':
      return `Round ${e.round}’s special factories: ${e.faces
        .map((f) =>
          f.kind === 'sf2' && f.colour
            ? `${SPECIAL_SHORT.sf2} (${COLOUR_NAME[f.colour]})`
            : SPECIAL_SHORT[f.kind],
        )
        .join(', ')}.`;
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
