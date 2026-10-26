import { groupLine, legalShows, strengthOf } from '../logic/rules.ts';
import type { EncoreView, GameView, LogEntry, RoundResult } from '../logic/types.ts';

export type NameOf = (id: string | null | undefined) => string;

export interface Status {
  text: string;
  /** The viewer is expected to act now. */
  yourMove: boolean;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Ana’s" / "your" (or "Your" at the start of a sentence). */
export const poss = (name: string, start = false) =>
  name === 'You' ? (start ? 'Your' : 'your') : `${name}’s`;

/** Whether the next player owns the set on the table: one more recruit ends the round. */
export function lastChance(g: GameView): boolean {
  if (g.twoPlayer || g.stage !== 'play' || !g.table) return false;
  const next = g.order[(g.order.indexOf(g.current) + 1) % g.order.length];
  return next === g.table.owner;
}

/** The one line that says what is happening and what the viewer should do. */
export function statusFor(view: EncoreView, you: string, name: NameOf): Status {
  const g = view.game;
  const f = (text: string, yourMove = false) => ({ text, yourMove });
  if (!g) return f('');
  const me = g.players.find((p) => p.id === you);
  if (view.phase === 'over') {
    const w = g.winners;
    const total = (id: string) => g.players.find((p) => p.id === id)?.total ?? 0;
    if (!w.length) return f('The show is over.');
    if (w.length > 1)
      return f(
        `${w.map((id) => name(id)).join(' and ')} share the win with ${plural(total(w[0]!), 'point')}!`,
      );
    return w[0] === you
      ? f(`You win with ${plural(total(you), 'point')}!`)
      : f(`${name(w[0])} wins with ${plural(total(w[0]!), 'point')}!`);
  }
  const round = `Round ${g.round} of ${g.rounds}`;
  if (g.stage === 'flip')
    return me && !me.done
      ? f(
          `${round}: keep your hand as dealt, or turn it all round. Nobody sees which you pick.`,
          true,
        )
      : f(`${round}: everyone is deciding whether to turn their hand round.`);
  if (g.stage === 'scores')
    return me && !me.done
      ? f(`${round} is over. Tap Ready when you’ve seen the scores.`, true)
      : f(`${round} is over. The next round starts when everyone is ready.`);
  const table = g.table?.cards.length ? g.table : null;
  const owner = table ? name(table.owner) : '';
  const tableLine = table ? `${poss(owner)} ${groupLine(table.cards)}` : '';
  if (g.current === you && g.hand) {
    if (!table) return f('Your turn: the table is empty, so show any card or group.', true);
    const can = legalShows(g.hand, strengthOf(table.cards)).length > 0;
    if (g.twoPlayer && !can)
      return f(
        `Your turn: nothing beats ${tableLine}, so recruit (a chip each) until you can show.`,
        true,
      );
    const warn = lastChance(g)
      ? ` Careful: if you only recruit, the round ends and ${owner} wins it.`
      : '';
    return f(
      `Your turn: show something stronger than ${tableLine}${can ? '' : ' (nothing in your hand can)'}, or recruit a card from it.${warn}`,
      true,
    );
  }
  const who = name(g.current);
  if (lastChance(g))
    return f(
      `${poss(who, true)} turn. Everyone after ${owner} has recruited: if ${who === 'You' ? 'you recruit' : `${who} recruits`} too, the round ends.`,
    );
  return f(`${poss(who, true)} turn${table ? `, facing ${tableLine}` : ''}.`);
}

/** Why a round ended, in words (the round-end moment and the score table). */
export function endLine(r: RoundResult, name: NameOf): string {
  const who = name(r.ender);
  const shown = r.last.length ? groupLine(r.last) : '';
  switch (r.how) {
    case 'out':
      return `${who} played ${who === 'You' ? 'your' : 'their'} last cards${shown ? ` (${shown})` : ''}: round over.`;
    case 'unbeaten':
      return `Nobody beat ${poss(who)} show${shown ? ` (${shown})` : ''}, so the round is over. ${poss(who, true)} hand costs nothing.`;
    case 'stuck':
      return `${poss(who, true)} show${shown ? ` (${shown})` : ''} couldn’t be beaten and no chips were left to recruit with: round over. ${poss(who, true)} hand costs nothing.`;
  }
}

/** A log entry as a line, or null for entries not worth a line. */
export function logLine(e: LogEntry, name: NameOf): string | null {
  const t =
    e.auto === 'timer' ? ' ⏱' : e.auto === 'host' ? ' (host)' : e.auto === 'left' ? ' (away)' : '';
  const line = (s: string) => s + t;
  switch (e.kind) {
    case 'round':
      return line(
        `Round ${e.round}: ${name(e.starter)} ${e.startCard ? 'holds the 1/2 card and ' : ''}starts.`,
      );
    case 'show': {
      const verb = e.double ? 'recruits and shows' : 'shows';
      if (!e.beat.length) return line(`${name(e.by)} ${verb} ${groupLine(e.cards)}.`);
      return line(
        `${name(e.by)} ${verb} ${groupLine(e.cards)}, capturing ${groupLine(e.beat)} (+${e.beat.length}).`,
      );
    }
    case 'recruit':
      if (e.double) return null;
      return line(
        e.paid
          ? `${name(e.by)} pays a chip and recruits the ${e.card.up}.`
          : `${name(e.by)} recruits the ${e.card.up} from ${poss(name(e.owner))} show (${name(e.owner)} +1).`,
      );
    case 'end':
      return line(
        e.how === 'out'
          ? `${name(e.ender)} is out of cards: round over.`
          : e.how === 'unbeaten'
            ? `Nobody beat ${poss(name(e.ender))} show: round over.`
            : `${poss(name(e.ender), true)} show went unanswered: round over.`,
      );
    case 'left':
      return line(`${name(e.player)} left: the table plays for them.`);
    case 'back':
      return line(`${name(e.player)} is back.`);
    case 'over':
      return line(
        `${e.winners.map(name).join(' and ')} ${e.winners.length > 1 ? 'share the win' : 'wins'}.`,
      );
  }
}
