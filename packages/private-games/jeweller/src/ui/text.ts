import { cardOf } from '../logic/cards.ts';
import { LEVEL_NAME, TOKEN_EMOJI, TOKEN_NAME } from '../logic/gems.ts';
import { totalOf } from '../logic/rules.ts';
import {
  TOKENS,
  TOKEN_LIMIT,
  type JewellerView,
  type LogEntry,
  type Pieces,
} from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "a level II Ruby card (2★)". */
export function cardLine(id: string): string {
  const c = cardOf(id);
  return `a level ${LEVEL_NAME[c.level]} ${TOKEN_NAME[c.bonus]} card${c.points ? ` (${c.points}★)` : ''}`;
}

/** "2 🔴 1 ⚫" for a set of pieces. */
export function piecesLine(p: Partial<Pieces>): string {
  return TOKENS.filter((t) => (p[t] ?? 0) > 0)
    .map((t) => `${p[t]} ${TOKEN_EMOJI[t]}`)
    .join(' ');
}

/** The one line that says what is happening and what the viewer should do. */
export function statusFor(view: JewellerView, you: string, name: NameOf): Status {
  const g = view.game;
  const f = (text: string, yourMove = false) => ({ text, yourMove });
  if (!g) return f('');
  if (view.phase === 'over') {
    const w = g.winners;
    const pts = (id: string) => g.players.find((p) => p.id === id)?.points ?? 0;
    if (!w.length) return f('The game is over.');
    if (w.length > 1)
      return f(
        `${w.map((id) => (id === you ? 'You' : name(id))).join(' and ')} share the win with ${pts(w[0]!)} points!`,
      );
    return w[0] === you
      ? f(`You win with ${pts(you)} points!`)
      : f(`${name(w[0])} wins with ${pts(w[0]!)} points!`);
  }
  const me = g.players.find((p) => p.id === you);
  const mine = g.current === you;
  const final = g.finalBy
    ? ` Final round: ${g.finalBy === you ? 'you' : name(g.finalBy)} ${view.settings.cities ? 'met a City' : `reached ${view.settings.target}`}.`
    : '';
  switch (g.stage) {
    case 'hold':
      return mine
        ? f(
            'Place a stronghold on a face-up card (or move one of yours), or send back a lone stronghold of another player’s.',
            true,
          )
        : f(`${name(g.current)} is placing a stronghold.${final}`);
    case 'conquer':
      return mine
        ? f('Conquest: all three of your strongholds hold a card you can afford. Buy it too?', true)
        : f(`${name(g.current)} may buy the card they conquered.${final}`);
    case 'return': {
      const over = me ? totalOf(me.tokens) - TOKEN_LIMIT : 0;
      return mine
        ? f(
            `You hold more than ${TOKEN_LIMIT} pieces: hand back ${plural(over, 'piece')} of your choice.`,
            true,
          )
        : f(`${name(g.current)} is handing back pieces down to ${TOKEN_LIMIT}.${final}`);
    }
    case 'noble':
      return mine
        ? f('More than one noble wants to visit: pick one. The others may come later.', true)
        : f(`${name(g.current)} is choosing which noble visits.${final}`);
    case 'action':
      return mine
        ? f(`Your turn: take gems, reserve a card, or buy one.${final}`, true)
        : f(`${name(g.current)}’s turn.${final}`);
  }
}

/** A log entry as a line, or null for entries not worth a line. */
export function logLine(e: LogEntry, name: NameOf): string | null {
  const t =
    e.auto === 'timer' ? ' ⏱' : e.auto === 'host' ? ' (host)' : e.auto === 'left' ? ' (away)' : '';
  const line = (s: string) => s + t;
  switch (e.kind) {
    case 'start':
      return line(`${name(e.first)} goes first.`);
    case 'take':
      return line(`${name(e.by)} takes ${e.gems.map((g) => TOKEN_EMOJI[g]).join(' ')}.`);
    case 'reserve':
      return line(
        `${name(e.by)} reserves ${e.card ? cardLine(e.card) : `a level ${LEVEL_NAME[e.level]} card`}${e.blind ? ' from the deck' : ''}${e.gold ? ' and takes a 🟡' : ''}.`,
      );
    case 'buy': {
      const paid = totalOf(e.paid);
      return line(
        `${e.conquest ? '🏰 Conquest! ' : ''}${name(e.by)} buys ${cardLine(e.card)}${e.fromReserve ? ' from their hand' : ''}${paid ? ` for ${piecesLine(e.paid)}` : ' for free'}.`,
      );
    }
    case 'hold':
      return line(
        `${name(e.by)} ${e.from ? 'moves a stronghold' : 'places a stronghold'} on ${cardLine(e.card)}.`,
      );
    case 'evict':
      return line(
        `${name(e.by)} sends ${name(e.owner)}’s stronghold back from ${cardLine(e.card)}.`,
      );
    case 'conquest-pass':
      return line(`${name(e.by)} doesn’t buy the conquered card.`);
    case 'return':
      return line(`${name(e.by)} hands back ${piecesLine(e.tokens)}.`);
    case 'noble':
      return line(`👑 A noble visits ${name(e.by)}: +3.`);
    case 'pass':
      return line(`${name(e.by)} can’t do anything and passes.`);
    case 'final':
      return line(
        e.city
          ? `🏙 ${name(e.by)} meets a City: this is the final round.`
          : `${name(e.by)} reached ${e.points} points: this is the final round.`,
      );
    case 'left':
      return line(`${name(e.player)} left: the table plays their turns.`);
    case 'back':
      return line(`${name(e.player)} is back.`);
    case 'removed':
      return line(
        `${name(e.player)} was removed: their pieces went back to the supply and their cards (and strongholds) left play.`,
      );
    case 'end':
      return line(
        `${e.how === 'stalled' ? 'Nobody could move for a whole round, so the game ends. ' : e.how === 'alone' ? 'Only one player is left, so the game ends. ' : ''}${e.winners.map(name).join(' and ')} ${e.winners.length > 1 ? 'share the win' : 'wins'}.`,
      );
  }
}
