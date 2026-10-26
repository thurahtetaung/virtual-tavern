import { SUIT_NAME, SUIT_SYMBOL, cardName } from '../logic/cards.ts';
import type { EndHow, LogEntry, SkyfireView } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "red", "3s": what a clue named. */
export function clueText(e: { colour?: string | undefined; rank?: number | undefined }): string {
  if (e.rank !== undefined) return `${e.rank}s`;
  const c = e.colour as keyof typeof SUIT_NAME;
  return `${SUIT_NAME[c].toLowerCase()} ${SUIT_SYMBOL[c]}`;
}

/** One log line, with "You" for the viewer (`name` already does that). */
export function logLine(e: LogEntry, name: NameOf, you: string): string {
  const auto =
    e.auto === 'timer'
      ? ' ⏱'
      : e.auto === 'left'
        ? ' (left: the app moved)'
        : e.auto === 'host'
          ? ' (host acted)'
          : '';
  switch (e.kind) {
    case 'start':
      return `${name(e.first)} ${e.first === you ? 'start' : 'starts'} the show.`;
    case 'clue': {
      const to = e.to === you ? 'you' : name(e.to);
      const n = e.touched.length;
      return `${name(e.by)} told ${to}: ${clueText(e)}, ${n ? plural(n, 'card') : 'none'}.${auto}`;
    }
    case 'play':
      return e.ok
        ? `${name(e.by)} played ${cardName(e)}${e.completed ? `: the ${SUIT_NAME[e.suit].toLowerCase()} firework is finished${e.bonus ? ', +1 clue' : ''}` : ''}.${auto}`
        : `${name(e.by)} played ${cardName(e)}: it didn’t fit, a fuse burned.${auto}`;
    case 'discard':
      return `${name(e.by)} discarded ${cardName(e)}: +1 clue.${auto}`;
    case 'last-round':
      return `The deck is empty: everyone has one last turn.`;
    case 'left':
      return `${name(e.player)} left: the app makes safe moves for them.`;
    case 'back':
      return `${name(e.player)} is back.`;
    case 'end':
      return endHowText(e.how);
  }
}

export function endHowText(how: EndHow): string {
  switch (how) {
    case 'perfect':
      return 'Every firework is finished: a perfect show!';
    case 'deck':
      return 'The last round is over.';
    case 'fuses':
      return 'The third fuse burned: the show went up in smoke.';
    case 'lost-card':
      return 'The last copy of a needed card is gone: the show is lost.';
    case 'no-cards':
      return 'A player started a turn with no cards: the show is lost.';
    case 'ended':
      return 'The host ended the show early.';
  }
}

/** The status line: what the viewer should do now. */
export function statusFor(
  view: SkyfireView,
  you: string,
  name: NameOf,
): { text: string; yourMove: boolean } {
  const g = view.game;
  if (!g) return { text: '', yourMove: false };
  if (view.phase === 'over') {
    const r = g.result;
    return { text: r ? endHowText(r.how) : 'The show is over.', yourMove: false };
  }
  const playing = !!g.hands[you];
  const mine = g.current === you;
  const last = g.lastTurns;
  const lastNote = last
    ? ` Last round: ${last.length === 1 ? 'the final turn' : `${plural(last.length, 'turn')} left`}.`
    : '';
  if (!playing)
    return { text: `Watching: ${name(g.current)} is on turn.${lastNote}`, yourMove: false };
  if (mine) {
    const options = [
      ...(g.clues > 0 ? ['give a clue (tap a teammate)'] : []),
      'play a card',
      ...(g.clues < 8 ? ['discard one'] : []),
    ];
    const text = `Your turn: ${options.join(', ').replace(/, ([^,]*)$/, ' or $1')}.`;
    return { text: text + lastNote, yourMove: true };
  }
  return {
    text: `${name(g.current)} is on turn. Read the table: you can’t see your own cards.${lastNote}`,
    yourMove: false,
  };
}
